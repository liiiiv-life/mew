import assert from 'node:assert/strict'
import http from 'node:http'
import { afterEach, test } from 'node:test'
import express from 'express'
import { Window } from 'happy-dom'
import { WebSocket, WebSocketServer } from 'ws'
import { attachBrowserProxyWebSocket, browserProxyFrameUrl, createBrowserProxyApp } from './browserProxy.ts'

const servers: http.Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
})

async function listen(app: express.Express): Promise<string> {
  const server = http.createServer(app)
  return listenServer(server)
}

async function listenServer(server: http.Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}`
}

function mewProxyApp(account = 'owner@example.com'): express.Express {
  const app = express()
  app.use((req, _res, next) => {
    req.auth = { role: 'owner', email: account, mustChangePassword: false }
    next()
  })
  app.use('/__mew_browser', createBrowserProxyApp())
  return app
}

test('대상 WebSocket도 Mew 서버가 연결하고 frame을 양방향 중계한다', async () => {
  const upstreamServer = http.createServer()
  const upstreamWss = new WebSocketServer({ server: upstreamServer })
  let upstreamOrigin = ''
  let upstreamForwardedFor: string | string[] | undefined
  upstreamWss.on('connection', (socket, request) => {
    upstreamOrigin = request.headers.origin ?? ''
    upstreamForwardedFor = request.headers['x-forwarded-for']
    socket.on('message', (data) => socket.send(`echo:${data.toString()}`))
  })
  const upstreamHttpOrigin = await listenServer(upstreamServer)
  const upstreamWsOrigin = upstreamHttpOrigin.replace(/^http/, 'ws')

  const frame = browserProxyFrameUrl(`${upstreamHttpOrigin}/`, 'owner@example.com')
  const token = new URL(frame, 'http://mew.invalid').pathname.split('/')[3]
  assert(token)
  const originToken = Buffer.from(upstreamWsOrigin, 'utf8').toString('base64url')

  const mewServer = http.createServer(express())
  attachBrowserProxyWebSocket(mewServer, { account: () => 'owner@example.com' })
  const mewHttpOrigin = await listenServer(mewServer)
  const client = new WebSocket(`${mewHttpOrigin.replace(/^http/, 'ws')}/__mew_browser_ws/${originToken}/${token}/socket`, {
    headers: { 'user-agent': 'Mew-Phone-Test/1.0', 'x-forwarded-for': '203.0.113.44' },
  })
  await new Promise<void>((resolve, reject) => {
    client.once('open', () => resolve())
    client.once('error', reject)
    client.once('close', (code, reason) => reject(new Error(`proxy websocket closed before open: ${code} ${reason.toString()}`)))
    setTimeout(() => reject(new Error('proxy websocket open timeout')), 2000).unref()
  })
  const echoed = new Promise<string>((resolve, reject) => {
    client.once('message', (data) => resolve(data.toString()))
    client.once('error', reject)
    client.once('close', (code, reason) => reject(new Error(`proxy websocket closed before echo: ${code} ${reason.toString()}`)))
    setTimeout(() => reject(new Error('proxy websocket echo timeout')), 2000).unref()
  })
  client.send('hello')
  assert.equal(await echoed, 'echo:hello')
  assert.equal(upstreamOrigin, upstreamHttpOrigin)
  assert.equal(upstreamForwardedFor, undefined)
  client.terminate()
  for (const socket of upstreamWss.clients) socket.terminate()
  await new Promise<void>((resolve) => upstreamWss.close(() => resolve()))
})

test('서버 loopback HTTP(S)만 허용하고 공개 주소·다른 프로토콜은 거부한다', () => {
  assert.match(browserProxyFrameUrl('http://localhost:3100/path?q=1', 'owner@example.com'), /^\/__mew_browser\//)
  assert.match(browserProxyFrameUrl('https://127.0.0.1:3443/path', 'owner@example.com'), /^\/__mew_browser\//)
  assert.throws(() => browserProxyFrameUrl('https://example.com/path?q=1', 'owner@example.com'), /localhost\/loopback/)
  assert.throws(() => browserProxyFrameUrl('file:///etc/passwd', 'owner@example.com'), /http 또는 https/)
})

test('인증 세션은 등록된 HTTPS host와 서버 loopback만 이어 준다', async () => {
  const frame = browserProxyFrameUrl('https://auth.example.com/oauth/start', 'owner@example.com', {
    httpsHosts: ['auth.example.com', '*.assets.example.com'],
  })
  assert.match(frame, /^\/__mew_browser\//)
  assert.match(browserProxyFrameUrl('https://static.assets.example.com/app.js', 'owner@example.com', {
    httpsHosts: ['*.assets.example.com'],
  }), /^\/__mew_browser\//)
  assert.throws(() => browserProxyFrameUrl('https://example.com/', 'owner@example.com', {
    httpsHosts: ['auth.example.com'],
  }), /허용되지 않은/)

  const callback = express()
  callback.get('/auth/callback', (_req, res) => res.send('oauth complete'))
  const callbackOrigin = await listen(callback)
  const parts = new URL(frame, 'http://mew.invalid').pathname.split('/')
  const callbackOriginToken = Buffer.from(callbackOrigin, 'utf8').toString('base64url')
  const callbackPath = `/__mew_browser/${callbackOriginToken}/${parts[3]}/auth/callback?code=redacted`
  const mewOrigin = await listen(mewProxyApp())

  const response = await fetch(`${mewOrigin}${callbackPath}`, { headers: { 'sec-fetch-mode': 'navigate' }, redirect: 'manual' })
  assert.equal(response.status, 200)
  assert.match(await response.text(), /oauth complete/)

  const deniedOrigin = Buffer.from('https://denied.example.com', 'utf8').toString('base64url')
  const denied = await fetch(`${mewOrigin}/__mew_browser/${deniedOrigin}/${parts[3]}/secret`)
  assert.equal(denied.status, 403)
})

test('서명 URL만 복사해도 다른 Mew 계정에서는 사용할 수 없다', async () => {
  const target = express()
  target.get('/', (_req, res) => res.send('secret'))
  const targetOrigin = await listen(target)
  const frame = browserProxyFrameUrl(`${targetOrigin}/`, 'owner@example.com')
  const mewOrigin = await listen(mewProxyApp('other@example.com'))
  const response = await fetch(`${mewOrigin}${frame}`, { headers: { 'sec-fetch-mode': 'navigate' } })
  assert.equal(response.status, 403)
})

test('sandbox가 Mew 로그인 cookie를 보내지 않아도 서명 URL로 후속 자원을 연다', async () => {
  const target = express()
  target.get('/', (_req, res) => res.send('ok'))
  const targetOrigin = await listen(target)
  const frame = browserProxyFrameUrl(`${targetOrigin}/`, 'owner@example.com')
  const app = express()
  app.use((req, _res, next) => {
    req.auth = { role: 'guest', email: null, mustChangePassword: false }
    next()
  })
  app.use('/__mew_browser', createBrowserProxyApp())
  const mewOrigin = await listen(app)

  const response = await fetch(`${mewOrigin}${frame}`, { headers: { 'sec-fetch-mode': 'navigate' } })
  assert.equal(response.status, 200)
  assert.equal(await response.text().then((body) => body.includes('ok')), true)
})

test('교차 origin fetch는 가상 페이지 Origin과 대상 CORS 결정을 보존한다', async () => {
  const page = express()
  const pageOrigin = await listen(page)
  let receivedOrigin = ''
  const api = express()
  api.get('/denied', (req, res) => {
    receivedOrigin = req.headers.origin ?? ''
    res.json({ ok: true })
  })
  api.get('/allowed', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', pageOrigin)
    res.json({ ok: true })
  })
  const apiOrigin = await listen(api)
  const frame = browserProxyFrameUrl(`${pageOrigin}/`, 'owner@example.com')
  const token = new URL(frame, 'http://mew.invalid').pathname.split('/')[3]
  assert(token)
  const apiToken = Buffer.from(apiOrigin, 'utf8').toString('base64url')
  const mewOrigin = await listen(mewProxyApp())
  const headers = { origin: 'null', 'sec-fetch-mode': 'cors' }

  const denied = await fetch(`${mewOrigin}/__mew_browser/${apiToken}/${token}/denied`, { headers })
  assert.equal(receivedOrigin, pageOrigin)
  assert.equal(denied.headers.get('access-control-allow-origin'), null)

  const allowed = await fetch(`${mewOrigin}/__mew_browser/${apiToken}/${token}/allowed`, { headers })
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'null')
  assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true')
})

test('교차 origin OAuth 리다이렉트가 같은 서버 cookie jar를 거쳐 localhost callback으로 돌아온다', async () => {
  let appOrigin = ''
  let providerOrigin = ''

  const callbackApp = express()
  callbackApp.get('/login', (_req, res) => {
    res.cookie('oauth_state', 'state-123', { httpOnly: true, sameSite: 'lax' })
    res.redirect(`${providerOrigin}/authorize`)
  })
  callbackApp.get('/callback', (req, res) => {
    res.json({
      cookie: req.headers.cookie ?? '',
      forwardedFor: req.headers['x-forwarded-for'] ?? null,
      userAgent: req.headers['user-agent'] ?? '',
    })
  })
  appOrigin = await listen(callbackApp)

  const provider = express()
  provider.get('/authorize', (_req, res) => res.redirect(`${appOrigin}/callback?code=ok`))
  providerOrigin = await listen(provider)

  const mewOrigin = await listen(mewProxyApp())
  const start = browserProxyFrameUrl(`${appOrigin}/login`, 'owner@example.com')
  const headers = {
    'sec-fetch-mode': 'navigate',
    'user-agent': 'Mew-Phone-Test/1.0',
    'x-forwarded-for': '203.0.113.44',
  }

  const login = await fetch(`${mewOrigin}${start}`, { headers, redirect: 'manual' })
  assert.equal(login.status, 302)
  const providerLocation = login.headers.get('location')
  assert(providerLocation?.startsWith('/__mew_browser/'))

  const authorize = await fetch(`${mewOrigin}${providerLocation}`, { headers, redirect: 'manual' })
  assert.equal(authorize.status, 302)
  const callbackLocation = authorize.headers.get('location')
  assert(callbackLocation?.startsWith('/__mew_browser/'))

  const callback = await fetch(`${mewOrigin}${callbackLocation}`, { headers, redirect: 'manual' })
  assert.equal(callback.status, 200)
  const body = await callback.json() as { cookie: string; forwardedFor: string | null; userAgent: string }
  assert.match(body.cookie, /oauth_state=state-123/)
  assert.equal(body.forwardedFor, null)
  assert.equal(body.userAgent, 'Mew-Phone-Test/1.0')
})

test('HTML의 링크와 정적 자원을 프록시 안으로 재작성하고 Next용 가상 location guard를 가장 먼저 넣는다', async () => {
  const external = express()
  const externalOrigin = await listen(external)

  const target = express()
  target.get('/page', (_req, res) => {
    res.type('html').send(`<!doctype html><html><head><title>Proxy</title><link rel="stylesheet" href="/app.css"></head><body><a href="${externalOrigin}/next">next</a><script src="/app.js" integrity="sha256-nope"></script></body></html>`)
  })
  const targetOrigin = await listen(target)

  const mewOrigin = await listen(mewProxyApp())
  const frame = browserProxyFrameUrl(`${targetOrigin}/page`, 'owner@example.com')
  const response = await fetch(`${mewOrigin}${frame}`, { headers: { 'sec-fetch-mode': 'navigate' } })
  const html = await response.text()

  assert.equal(response.status, 200)
  assert.match(html, /mew-browser-state/)
  assert.match(html, /__mewBrowserVirtualUrl/)
  assert.match(html, /\/__mew_browser\//)
  assert.doesNotMatch(html, /integrity=/)
  assert(html.indexOf('__mewBrowserVirtualUrl') < html.indexOf('<title>Proxy</title>'))
})

test('Next 정적 JavaScript chunk는 source map을 변형하지 않고 원문으로 중계한다', async () => {
  const target = express()
  const chunk = 'const map = { sourcesContent: ["@import \'./theme.css\';"] }; globalThis.nextChunk = map'
  target.get('/_next/static/chunks/main-app.js', (_req, res) => res.type('application/javascript').send(chunk))
  const targetOrigin = await listen(target)
  const mewOrigin = await listen(mewProxyApp())
  const frame = browserProxyFrameUrl(`${targetOrigin}/_next/static/chunks/main-app.js`, 'owner@example.com')

  const response = await fetch(`${mewOrigin}${frame}`)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), chunk)
})

test('Next 클라이언트 라우트는 내부 프록시 prefix가 아니라 대상 localhost 경로를 읽는다', async () => {
  const target = express()
  target.get('/', (_req, res) => res.type('html').send('<!doctype html><html><head><title>Next-like</title></head><body>app</body></html>'))
  const targetOrigin = await listen(target)
  const mewOrigin = await listen(mewProxyApp())
  const frame = browserProxyFrameUrl(`${targetOrigin}/`, 'owner@example.com')
  const response = await fetch(`${mewOrigin}${frame}`, { headers: { 'sec-fetch-mode': 'navigate' } })
  const html = await response.text()
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1])
  assert(scripts.length >= 4)

  const window = new Window({ url: `${mewOrigin}${frame}` })
  window.eval(scripts[1]) // location/document 가상화는 앱 스크립트보다 먼저 실행한다.
  window.eval(scripts[2]) // history와 fetch 재작성
  window.eval(scripts[3]) // Next가 내부 프록시 URL을 history에 다시 기록하는 경우 보정

  assert.equal(window.location.origin, targetOrigin)
  assert.equal(window.location.pathname, '/')
  assert.equal(window.document.baseURI, `${targetOrigin}/`)
  window.history.pushState({}, '', '/data')
  assert.equal(window.location.pathname, '/data')
  window.history.replaceState({}, '', new URL(frame, mewOrigin).pathname)
  assert.equal(window.location.pathname, '/')
})

test('새 창 링크와 window.open은 프록시의 현재 프레임에서 이동한다', async () => {
  const target = express()
  target.get('/', (_req, res) => res.type('html').send('<!doctype html><html><head><title>Links</title></head><body></body></html>'))
  const targetOrigin = await listen(target)
  const mewOrigin = await listen(mewProxyApp())
  const frame = browserProxyFrameUrl(`${targetOrigin}/`, 'owner@example.com')
  const response = await fetch(`${mewOrigin}${frame}`, { headers: { 'sec-fetch-mode': 'navigate' } })
  assert(!response.headers.get('content-security-policy')?.includes('allow-popups'))
  const scripts = [...(await response.text()).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1])
  const window = new Window({ url: `${mewOrigin}${frame}` })
  let popups = 0
  window.open = () => { popups++; return null }
  const navigation = { href: '', protocol: 'http:', host: new URL(mewOrigin).host }
  Object.assign(window, { testNavigation: navigation })
  window.eval(`(function(location){${scripts[2]}})(testNavigation)`)
  const next = frame.replace(/\/$/, '/next')
  try {
    for (const href of [next, '/next', '#section']) {
      for (const event of [
        new window.MouseEvent('click', { bubbles: true, cancelable: true }),
        new window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }),
        new window.MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }),
        new window.MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }),
      ]) {
        navigation.href = ''
        const link = window.document.createElement('a')
        link.setAttribute('href', href)
        link.target = '_blank'
        const child = window.document.createElement('span')
        link.append(child)
        window.document.body.append(link)
        child.dispatchEvent(event)
        assert.equal(event.defaultPrevented, true)
        assert.equal(link.target, '_self')
        assert.equal(navigation.href, href === '#section' ? href : next)
        link.remove()
      }
    }
    window.open('/next', '_blank')
    assert.equal(navigation.href, next)
    assert.equal(popups, 0)
    const form = window.document.createElement('form')
    form.target = '_blank'
    const button = window.document.createElement('button')
    button.formTarget = '_blank'
    form.append(button)
    window.document.body.append(form)
    form.dispatchEvent(new window.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button }))
    assert.equal(form.target, '_self')
    assert.equal(button.formTarget, '_self')
  } finally {
    await window.happyDOM.close()
  }
})
