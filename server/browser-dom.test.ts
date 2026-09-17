import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DATA_DIR } from './dataDir.ts'
import http, { type IncomingMessage } from 'node:http'
import test from 'node:test'
import express from 'express'
import { chromium } from 'playwright-core'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { WebSocket, WebSocketServer } from 'ws'
import { createDomNetworkGate } from './browser-dom-network.ts'
import { domBrowserHeadless } from './browser-dom-profile.ts'
import { launchNativeBrowser } from './browser-dom-process.ts'
import {
  DomBrowserSession, attachDomBrowserWebSocket, closeDomBrowsers, createDomBrowserRoutes,
  createDomBrowserSession, createDomBrowserAuthSession, closeDomBrowserJob, openDomBrowserTab, domBrowserExecutable, domConnectionAllowed, domTargetAllowed,
} from './browser-dom.ts'

const owner = { role: 'owner' as const, email: 'owner@example.com', mustChangePassword: false }

test('native browser launch rejects missing executables without leaving a pending connection', async () => {
  await assert.rejects(launchNativeBrowser('/nonexistent/mew-test-browser', '/nonexistent/mew-test-profile', true), /서버 Chromium 프로세스/)
})

test('native launch handles executable/profile paths with spaces and flushes cookies before reopening', { skip: !domBrowserExecutable() || process.platform === 'win32', timeout: 30_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew native browser-'))
  const launcher = path.join(root, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  const profile = path.join(root, 'Library/Application Support/mew/browser/profiles/test account')
  await fs.mkdir(path.dirname(launcher), { recursive: true })
  await fs.mkdir(profile, { recursive: true })
  // A POSIX exec wrapper tests app-shaped paths on Linux and macOS while keeping
  // the installed browser's resources/bundle intact. It is not a macOS emulator.
  const quotedExecutable = "'" + domBrowserExecutable()!.replaceAll("'", "'\\''") + "'"
  await fs.writeFile(launcher, `#!/bin/sh\nexec ${quotedExecutable} "$@"\n`, { mode: 0o700 })
  let native: Awaited<ReturnType<typeof launchNativeBrowser>> | undefined
  t.after(async () => { await native?.close(); await fs.rm(root, { recursive: true, force: true }) })
  native = await launchNativeBrowser(launcher, profile, domBrowserHeadless())
  const page = await native.context.newPage()
  if (!domBrowserHeadless()) assert.equal(await page.evaluate('navigator.webdriver'), false)
  await native.context.addCookies([{ name: 'mew-native-fixture', value: 'persisted', domain: 'example.test', path: '/', expires: Math.floor(Date.now() / 1000) + 3600 }])
  await native.close()
  native = await launchNativeBrowser(launcher, profile, domBrowserHeadless())
  assert.equal((await native.context.cookies('https://example.test')).find((cookie) => cookie.name === 'mew-native-fixture')?.value, 'persisted')
  await native.close()
  await native.close()
})

test('browser uses the server display and honors explicit headed/headless settings', () => {
  assert.equal(domBrowserHeadless({ DISPLAY: ':0' }, 'linux'), false)
  assert.equal(domBrowserHeadless({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), false)
  assert.equal(domBrowserHeadless({}, 'linux'), true)
  assert.equal(domBrowserHeadless({}, 'darwin'), false)
  assert.equal(domBrowserHeadless({ MEW_BROWSER_HEADLESS: '1' }, 'darwin'), true)
  assert.equal(domBrowserHeadless({ MEW_BROWSER_HEADLESS: '0' }, 'darwin'), false)
  assert.equal(domBrowserHeadless({}, 'win32'), false)
  assert.equal(domBrowserHeadless({ MEW_BROWSER_HEADLESS: '1', DISPLAY: ':0' }, 'linux'), true)
  assert.equal(domBrowserHeadless({ MEW_BROWSER_HEADLESS: '0' }, 'linux'), false)
  assert.throws(() => domBrowserHeadless({ MEW_BROWSER_HEADLESS: 'false' }, 'linux'), /0 또는 1/)
})

test('DOM browser restricts origins, credentials, ports and session ownership', () => {
  const hosts = ['auth.openai.com', '*.oaistatic.com']
  const callback = 'http://localhost:1455'
  assert(domTargetAllowed('https://auth.openai.com/login', hosts, callback))
  assert(domTargetAllowed('https://cdn.oaistatic.com/font.woff2', hosts, callback))
  assert(domTargetAllowed(`${callback}/auth/callback?code=example`, hosts, callback))
  for (const url of ['http://auth.openai.com', 'https://auth.openai.com.evil.test', 'https://auth.openai.com:444', 'https://user:pass@auth.openai.com', 'http://localhost:5000/api/auth/me', 'file:///etc/passwd', 'https://oaistatic.com']) {
    assert.equal(domTargetAllowed(url, hosts, callback), false, url)
  }
  const req = { headers: { host: 'mew.example', origin: 'https://mew.example', 'x-forwarded-proto': 'https' } } as unknown as IncomingMessage
  assert(domConnectionAllowed(req, owner, owner.email))
  assert.equal(domConnectionAllowed(req, { ...owner, role: 'member' }, owner.email), false)
  assert.equal(domConnectionAllowed(req, { ...owner, mustChangePassword: true }, owner.email), false)
  assert.equal(domConnectionAllowed(req, owner, 'other@example.com'), false)
  assert.equal(domConnectionAllowed({ headers: { host: 'mew.example', origin: 'http://mew.example', 'x-forwarded-proto': 'https' } } as unknown as IncomingMessage, owner, owner.email), false)
  assert.equal(domConnectionAllowed({ headers: { host: 'mew.example', origin: 'https://evil.example' } } as IncomingMessage, owner, owner.email), false)
  assert.equal(domConnectionAllowed({ headers: { host: 'mew.example' } } as IncomingMessage, owner, owner.email), false)
})

test('DOM replay strips active documents and maps assets without an arbitrary fetch endpoint', async () => {
  const session = new DomBrowserSession(owner.email, 'test', 'https://auth.openai.com/login', ['auth.openai.com'], 'http://localhost:1455')
  try {
    const value = session.sanitize({ type: 2, tagName: 'img', attributes: {
      src: 'https://auth.openai.com/logo.png', srcset: 'https://evil.test/tracker 2x',
      onerror: 'parent.stolen = true', style: 'background:url(https://evil.test/track)',
    } }, 'https://auth.openai.com') as { attributes: Record<string, string> }
    assert.match(value.attributes.src, /^\/api\/browser-dom\/[\w-]+\/asset\/[a-f0-9]{64}$/)
    assert.equal(value.attributes.onerror, undefined)
    assert.equal(value.attributes.srcset, undefined)
    assert.equal(value.attributes.style, 'background:url("")')
    const frame = session.sanitize({ tagName: 'iframe', attributes: { srcdoc: '<script>evil()</script>', src: 'https://auth.openai.com/' }, childNodes: [] }, '') as { tagName: string }
    assert.equal(frame.tagName, 'div')
    assert.equal(await session.asset('not-captured'), null)
    const mutation = session.sanitize({ type: 3, data: { source: 0, attributes: [
      { id: 1, attributes: { style: 'display: block;', onclick: 'alert(1)' } },
      { id: 2, attributes: { src: 'https://auth.openai.com/logo.png' } },
    ] } }, 'https://auth.openai.com') as { data: { attributes: { id: number; attributes: Record<string, string> }[] } }
    assert(Array.isArray(mutation.data.attributes), 'incremental attribute changes remain an array')
    assert.equal(mutation.data.attributes[0].attributes.style, 'display: block;')
    assert.equal(mutation.data.attributes[0].attributes.onclick, undefined)
    assert.match(mutation.data.attributes[1].attributes.src, /^\/api\/browser-dom\//)

  } finally { await session.close() }
})

test('network gate blocks cross-origin redirects and CONNECT before any forbidden server receives a request', { skip: !domBrowserExecutable(), timeout: 15_000 }, async () => {
  let forbiddenRequests = 0
  const forbidden = http.createServer((_req, res) => { forbiddenRequests++; res.end('forbidden') })
  await new Promise<void>((resolve) => forbidden.listen(0, '127.0.0.1', resolve))
  const forbiddenPort = (forbidden.address() as { port: number }).port
  const upstream = http.createServer((_req, res) => { res.writeHead(302, { Location: `http://127.0.0.1:${forbiddenPort}/private` }); res.end() })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  const gate = await createDomNetworkGate((url) => new URL(url).origin === origin)
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true, proxy: { server: gate.server, bypass: '<-loopback>' } })
  try {
    const page = await browser.newPage()
    await page.goto(origin).catch(() => {})
    assert.equal(forbiddenRequests, 0)
    const proxy = new URL(gate.server)
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ hostname: proxy.hostname, port: proxy.port, method: 'CONNECT', path: 'forbidden.example:443' })
      req.on('connect', (res, socket) => { resolve(res.statusCode ?? 0); socket.destroy() })
      req.on('error', reject)
      req.end()
    })
    assert.equal(status, 403)
  } finally {
    await browser.close()
    await gate.close()
    upstream.closeAllConnections()
    forbidden.closeAllConnections()
    await Promise.all([new Promise<void>((resolve) => upstream.close(() => resolve())), new Promise<void>((resolve) => forbidden.close(() => resolve()))])
  }
})

test('real Chromium DOM view relays input, cookie-backed submission and navigation without running page scripts locally', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const bundle = await build({ input: new URL('../src/utils/browser-dom-view.ts', import.meta.url).pathname, output: { format: 'esm' }, platform: 'browser', write: false })
  const code = bundle.output.find((item) => item.type === 'chunk')!
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.auth = req.headers['x-test-account'] === 'other' ? { ...owner, email: 'other@example.com' } : owner; next() })
  app.use('/api/browser-dom', createDomBrowserRoutes())
  let submitted: { email: string; password: string; accepted: boolean } | undefined
  let siteCookie = ''
  app.get('/login', (_req, res) => {
    res.cookie('site_session', 'server-only', { httpOnly: true })
    res.type('html').send(`<!doctype html><html><head><style>body{font:16px sans-serif}label{display:block;margin:12px}button{padding:12px}</style></head><body>
      <h1>Server sign in</h1><img id="logo" src="/logo.png"><form><label>Email<input id="email" type="email" required></label><label>Password<input id="password" type="password" required></label><label><input id="accepted" type="checkbox">Accept</label><button>Sign in</button></form>
      <script>window.siteScriptExecuted=true;document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const r=await fetch('/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#email').value,password:document.querySelector('#password').value,accepted:document.querySelector('#accepted').checked})});if(r.ok)location.href='/callback';});</script>
    </body></html>`)
  })
  app.get('/logo.png', (_req, res) => res.type('png').send(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')))
  app.post('/submit', (req, res) => { submitted = req.body; siteCookie = req.headers.cookie ?? ''; res.json({ ok: true }) })
  app.get('/callback', (_req, res) => res.type('html').send('<html><head><title>Done</title></head><body><h1>Signed in on server</h1></body></html>'))
  app.get('/viewer.js', (_req, res) => res.type('js').send(code.type === 'chunk' ? code.code : ''))
  let streamUrl = ''
  app.get('/viewer-init.js', (_req, res) => res.type('js').send(`import {mountDomBrowser} from '/viewer.js';window.dispose=mountDomBrowser(document.querySelector('#root'),${JSON.stringify(streamUrl)},s=>document.querySelector('#status').textContent=JSON.stringify(s));`))
  app.get('/viewer', (_req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; connect-src 'self' ws: wss:; font-src 'self' data:; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:")
    res.type('html').send('<!doctype html><html><body style="margin:0"><div id="status"></div><div id="root" style="width:100vw;height:600px"></div><script type="module" src="/viewer-init.js"></script></body></html>')
  })
  const server = http.createServer(app)
  attachDomBrowserWebSocket(server, () => owner)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  streamUrl = await createDomBrowserSession(owner.email, 'fixture-job', `${origin}/login?redirect_uri=${encodeURIComponent(origin + '/callback')}`, [])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    // An untrusted top-level origin cannot attach even with a known session ID.
    const rejected = new WebSocket(`${origin.replace('http:', 'ws:')}${streamUrl}`, { origin: 'https://evil.test' })
    await new Promise<void>((resolve, reject) => {
      rejected.on('unexpected-response', (_req, res) => { assert.equal(res.statusCode, 403); res.resume(); resolve() })
      rejected.on('open', () => reject(new Error('unauthorized connection opened')))
      rejected.on('error', () => {})
    })
    rejected.terminate()
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.context().addCookies([{ name: 'mew_session', value: 'must-not-reach-server-page', url: origin }])
    await page.goto(`${origin}/viewer`)
    const frame = page.frameLocator('#root iframe')
    await frame.locator('#email').waitFor({ timeout: 15_000 }).catch(async (error) => {
      throw new Error(`${String(error)}; viewer=${await page.locator('#status').textContent()}; page errors=${errors.join(';')}; frames=${page.frames().length}`)
    })
    assert.equal(await frame.locator('body').evaluate((node) => (node as unknown as { ownerDocument: { defaultView: { siteScriptExecuted?: boolean } } }).ownerDocument.defaultView.siteScriptExecuted), undefined)
    const logo = await frame.locator('#logo').getAttribute('src')
    assert(logo?.startsWith('/api/browser-dom/'))
    assert.equal((await fetch(origin + logo)).status, 200)
    assert.equal((await fetch(origin + logo, { headers: { 'x-test-account': 'other' } })).status, 403)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('#root iframe[width="390"]').waitFor()
    await frame.locator('#email').fill('initial@example.com')
    // A synchronous burst exceeds the old 100-message queue limit. The final
    // value and subsequent field/click must survive the actual viewer WebSocket.
    await page.evaluate(`(() => {
      const node = document.querySelector('#root iframe').contentDocument.querySelector('#email');
      node.focus();
      for (let i = 0; i < 500; i++) {
        node.value = 'person' + i + '@example.com';
        node.dispatchEvent(new Event('input', { bubbles: true }));
      }
      node.value = 'person@example.com';
      node.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await frame.locator('#password').fill('fixture-password')
    await frame.locator('#accepted').click()
    // Masked server echoes cannot replace the real password when focus moves away.
    await page.waitForTimeout(100)
    assert.equal(await frame.locator('#password').inputValue(), 'fixture-password')
    await frame.locator('button').click()
    await frame.getByText('Signed in on server').waitFor({ timeout: 12_000 })
    assert.deepEqual(submitted, { email: 'person@example.com', password: 'fixture-password', accepted: true })
    assert.match(siteCookie, /site_session=server-only/)
    assert.doesNotMatch(siteCookie, /mew_session/)
    // Reattachment rebuilds a complete current document rather than replaying credentials.
    await page.reload()
    await page.frameLocator('#root iframe').getByText('Signed in on server').waitFor({ timeout: 10_000 })
  } finally {
    await browser.close()
    await closeDomBrowsers()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})


test('general browser shares persistent server state, preserves popups/history, and operates cross-origin frames without pixels', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const account = `browser-test-${crypto.randomUUID()}@example.test`
  const auth = { ...owner, email: account }
  const profileDir = path.join(DATA_DIR, 'browser', 'profiles', crypto.createHash('sha256').update(account).digest('hex'))
  const bundle = await build({ input: new URL('../src/utils/browser-dom-view.ts', import.meta.url).pathname, output: { format: 'esm' }, platform: 'browser', write: false })
  const code = bundle.output.find((item) => item.type === 'chunk')!
  const panelBundle = await build({
    input: 'virtual:browser-panel', output: { format: 'esm' }, platform: 'browser', write: false,
    transform: { define: { 'process.env.NODE_ENV': JSON.stringify('test') }, jsx: 'react-jsx' },
    plugins: [{ name: 'browser-panel-fixture',
      resolveId(id) { if (id === 'virtual:browser-panel') return id; if (id.endsWith('.css')) return 'virtual:empty-style' },
      load(id) {
        if (id === 'virtual:empty-style') return ''
        if (id === 'virtual:browser-panel') return `import React from ${JSON.stringify(new URL('../node_modules/react/index.js', import.meta.url).pathname)};
          import {createRoot} from ${JSON.stringify(new URL('../node_modules/react-dom/client.js', import.meta.url).pathname)};
          import {I18nProvider} from ${JSON.stringify(new URL('../src/i18n.tsx', import.meta.url).pathname)};
          import {BrowserPanel} from ${JSON.stringify(new URL('../src/components/BrowserPanel.tsx', import.meta.url).pathname)};
          import {ServerDomBrowserTabs} from ${JSON.stringify(new URL('../src/components/server-dom-browser.tsx', import.meta.url).pathname)};
          const authStream = new URL(location.href).searchParams.get('auth');
          createRoot(document.querySelector('#panel')).render(React.createElement(I18nProvider,null,authStream ? React.createElement(ServerDomBrowserTabs,{streamUrl:authStream,reopen:async()=>authStream}) : React.createElement(BrowserPanel,{standalone:true,onClose:()=>{window.panelClosed=(window.panelClosed||0)+1}})));`
      },
    }],
  })
  const panelCode = panelBundle.output.find((item) => item.type === 'chunk')!
  const sourceDir = new URL('../src/', import.meta.url).pathname
  const panelSources = (await Promise.all(['components/BrowserPanel.tsx', 'components/server-dom-browser.tsx', 'components/browser-notice.tsx'].map(file => fs.readFile(path.join(sourceDir, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(path.join(sourceDir, 'index.css'), 'utf8'), { base: sourceDir, onDependency() {} })
  const panelCss = compiler.build([...new Set(panelSources.match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
    + await fs.readFile(path.join(sourceDir, 'components/server-dom-browser.css'), 'utf8')

  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.auth = req.headers['x-test-account'] === 'other' ? owner : auth; next() })
  app.use('/api/browser-dom', createDomBrowserRoutes())
  let origin = ''
  const childServer = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.end('<html><body><button id="child-button" onclick="document.querySelector(\'output\').textContent=\'Child clicked on server\'">Child action</button><output></output></body></html>')
  })
  await new Promise<void>((resolve) => childServer.listen(0, '127.0.0.1', resolve))
  const childOrigin = `http://127.0.0.1:${(childServer.address() as { port: number }).port}`
  app.get('/site', (_req, res) => res.type('html').send(`<!doctype html><html><head><title>Server site</title></head><body>
    <h1>General server browser</h1><button id="blank-frame" onclick="const f=document.createElement('iframe');f.id='blank-document';document.body.append(f);f.contentDocument.open();f.contentDocument.write('<html><body>Written blank frame</body></html>');f.contentDocument.close()">Blank frame</button><a id="next" href="/next">Next</a><button id="popup" onclick="window.open('/popup')">Popup</button>
    <button id="blank-popup">Blank popup</button><button id="dialog" onclick="document.querySelector('#answer').textContent=prompt('Your answer','initial')">Prompt</button><output id="answer"></output>
    <input id="file" type="file" onchange="document.querySelector('#filename').textContent=this.files[0].name"><output id="filename"></output>
    <a href="/file" download>Download fixture</a>
    <iframe id="child" src="${childOrigin}" style="width:500px;height:180px;border:0"></iframe>
    <div id="closed-widget"></div>
    <output id="socket"></output><output id="worker"></output>
    <script>
      const closedWidget = document.querySelector('#closed-widget').attachShadow({mode:'closed'});
      closedWidget.innerHTML = '<style>button { color: rgb(17, 34, 51); }</style><button id="closed-action">Closed widget action</button><output></output><input type="password" value="masked-shadow-password"><div id="nested-closed"></div>';
      closedWidget.querySelector('button').onclick = () => closedWidget.querySelector('output').textContent = 'Closed widget clicked on server';
      closedWidget.querySelector('#nested-closed').attachShadow({mode:'closed'}).innerHTML = '<iframe id="closed-child" src="${childOrigin}" style="width:300px;height:100px"></iframe>';
      document.querySelector('#blank-popup').onclick=()=>{const popup=window.open('','sso');popup.document.write('<html><body><h1>Waiting for sign-in</h1></body></html>');popup.document.close()};
      window.siteScriptExecuted=true; document.cookie='persistent_site=kept; Max-Age=3600';localStorage.setItem('server-local','kept');
      new WebSocket(location.origin.replace('http:','ws:')+'/site-ws').onmessage=e=>document.querySelector('#socket').textContent=e.data;
      navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(()=>document.querySelector('#worker').textContent='Worker ready');
    </script></body></html>`))
  app.get('/sw.js', (_req, res) => res.type('js').send("self.addEventListener('install',()=>self.skipWaiting()); self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));"))
  app.get('/stall', () => { /* Deliberately leave the initial document pending. */ })
  app.get('/next', (_req, res) => res.type('html').send('<html><head><title>Next page</title></head><body><h1>Next page</h1></body></html>'))
  app.get('/popup', (_req, res) => res.type('html').send('<html><head><title>Popup page</title></head><body><h1>Popup page</h1><script>window.opener.document.querySelector(\'h1\').textContent=\'Opener preserved\'</script></body></html>'))
  app.get('/file', (_req, res) => { res.setHeader('Content-Disposition', 'attachment; filename="fixture.txt"'); res.send('server download') })
  app.get('/viewer.js', (_req, res) => res.type('js').send(code.type === 'chunk' ? code.code : ''))

  app.get('/panel.js', (_req, res) => res.type('js').send(panelCode.type === 'chunk' ? panelCode.code : ''))
  app.get('/panel', (_req, res) => res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${panelCss}#panel{display:flex;flex-direction:column;height:100dvh}</style></head><body><div id="panel"></div><script type="module" src="/panel.js"></script></body></html>`))
  let streamUrl = ''
  app.get('/init.js', (_req, res) => res.type('js').send(`import {mountDomBrowser} from '/viewer.js'; window.packets=[];window.controller=mountDomBrowser(document.querySelector('#root'),${JSON.stringify(streamUrl)},s=>{window.packets.push(s);document.querySelector('#status').textContent=JSON.stringify(s)});`))
  app.get('/viewer', (_req, res) => res.type('html').send('<html><body><div id="status"></div><div id="root" style="width:900px;height:700px"></div><script type="module" src="/init.js"></script></body></html>'))
  const server = http.createServer(app)
  attachDomBrowserWebSocket(server, () => auth)
  const siteWs = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => { if (req.url === '/site-ws') siteWs.handleUpgrade(req, socket, head, (ws) => ws.send('Server WebSocket connected')) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const session = openDomBrowserTab(account, 'general-fixture', `${origin}/site`)
  streamUrl = session.info().streamUrl
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const viewer = await browser.newPage()
    const errors: string[] = []
    viewer.on('pageerror', (error) => errors.push(error.message))
    await viewer.goto(`${origin}/viewer`)
    const view = viewer.frameLocator('#root > .replayer-wrapper > iframe')
    await view.getByText('General server browser').waitFor({ timeout: 15_000 })
    // Shadow roots stay closed on the source page; only the inert replica exposes
    // their rendered DOM so human clicks still resolve through the server mirror.
    await view.locator('#closed-action').waitFor({ timeout: 5000 })
    assert.equal(await session.page!.evaluate('document.querySelector("#closed-widget").shadowRoot'), null)
    assert.equal(await session.page!.evaluate('closedWidget.mode'), 'closed')
    assert.equal(await view.locator('#closed-action').evaluate((node) => {
      const win = globalThis as unknown as { getComputedStyle: (node: unknown) => { color: string } }
      return win.getComputedStyle(node).color
    }), 'rgb(17, 34, 51)')
    assert.doesNotMatch(await view.locator('#closed-widget input').inputValue(), /masked-shadow-password/)
    await view.locator('#closed-action').click()
    await view.getByText('Closed widget clicked on server').waitFor({ timeout: 5000 })
    const closedChild = view.frameLocator('#closed-child iframe')
    await closedChild.locator('#child-button').click()
    await closedChild.getByText('Child clicked on server').waitFor({ timeout: 5000 })
    await session.page!.evaluate(`(() => {
      const host = document.createElement('div'); host.id = 'late-closed'; document.body.append(host);
      const root = host.attachShadow({mode:'closed'});
      root.innerHTML = '<button id="late-closed-action">Late closed action</button><output></output>';
      root.querySelector('button').onclick = () => root.querySelector('output').textContent = 'Late closed clicked on server';
    })()`)
    await view.locator('#late-closed-action').click()
    await view.getByText('Late closed clicked on server').waitFor({ timeout: 5000 })
    await viewer.evaluate(`(() => {
      window.beforeShadowSnapshot = document.querySelector('#root > .replayer-wrapper > iframe').contentDocument.querySelector('#closed-widget');
      window.controller.command('snapshot');
    })()`)
    await viewer.waitForFunction(`window.beforeShadowSnapshot !== document.querySelector('#root > .replayer-wrapper > iframe')?.contentDocument?.querySelector('#closed-widget')`)
    await view.getByText('Closed widget clicked on server').waitFor({ timeout: 5000 })
    await view.getByText('Late closed clicked on server').waitFor({ timeout: 5000 })
    if (!domBrowserHeadless()) assert.equal(await session.page!.evaluate('navigator.webdriver'), false)
    await view.getByText('Server WebSocket connected').waitFor()
    await view.getByText('Worker ready').waitFor()
    const sourceErrors: string[] = []
    session.page!.on('pageerror', (error) => sourceErrors.push(error.message))
    await view.locator('#blank-frame').click()
    await view.frameLocator('#blank-document iframe').getByText('Written blank frame').waitFor({ timeout: 5000 })
    assert.deepEqual(sourceErrors, [])
    // Late same-origin iframes (including hidden SDK frames) must never replace
    // the parent replay document with their own rrweb Document mutation.
    await session.page!.evaluate(() => {
      const doc = (globalThis as unknown as { document: { createElement: (tag: string) => { id: string; srcdoc: string; style: { display: string } }; body: { append: (node: unknown) => void } } }).document
      const frame = doc.createElement('iframe')
      frame.id = 'late-hidden-frame'
      frame.style.display = 'none'
      frame.srcdoc = '<html><body>Hidden SDK frame</body></html>'
      doc.body.append(frame)
    })
    await session.page!.waitForFunction('document.querySelector("#late-hidden-frame")?.contentDocument?.body?.textContent.includes("Hidden SDK")')
    await viewer.waitForTimeout(300)
    assert.equal(await view.locator('h1').textContent({ timeout: 2000 }), 'General server browser')
    assert.equal(await view.locator('#late-hidden-frame').isVisible(), false)
    await session.page!.evaluate('document.querySelector("#late-hidden-frame").style.display="inline-block"')
    await view.frameLocator('#late-hidden-frame iframe').getByText('Hidden SDK frame').waitFor({ timeout: 3000 })
    await viewer.reload()
    await view.getByText('General server browser').waitFor()
    await view.frameLocator('#late-hidden-frame iframe').getByText('Hidden SDK frame').waitFor({ timeout: 3000 })


    const child = view.frameLocator('#child iframe')
    await child.locator('#child-button').waitFor({ timeout: 8000 }).catch(async (error) => { throw new Error(`${error}; frame html=${await view.locator('#child').evaluate((node) => (node as unknown as { outerHTML: string }).outerHTML)}; errors=${errors}`) })
    await child.locator('#child-button').click()
    await child.getByText('Child clicked on server').waitFor()
    assert.equal(await session.page!.frames()[1].locator('output').textContent(), 'Child clicked on server')
    await view.locator('#dialog').click()
    await viewer.waitForFunction('window.packets.some(p=>p.dialog)')
    await viewer.evaluate('window.controller.command("dialog",{accept:true,value:"accepted remotely"})')
    await view.getByText('accepted remotely').waitFor()
    await view.locator('#file').click()
    await viewer.waitForFunction('window.packets.some(p=>p.fileChooser)')
    const chooserId = await viewer.evaluate<string>('window.packets.find(p=>p.fileChooser).fileChooser.id')
    const form = new FormData(); form.append('files', new Blob(['file from device']), 'upload-fixture.txt')
    assert.equal((await fetch(`${origin}/api/browser-dom/${session.id}/upload/${chooserId}`, { method: 'POST', body: form })).status, 200)
    await view.getByText('upload-fixture.txt').waitFor()
    await view.getByText('Download fixture').click()
    await viewer.waitForFunction('window.packets.some(p=>p.download)')
    const downloadUrl = await viewer.evaluate<string>('window.packets.find(p=>p.download).download.url')
    assert.equal(await (await fetch(origin + downloadUrl)).text(), 'server download')
    assert.equal((await fetch(origin + downloadUrl, { headers: { 'x-test-account': 'other' } })).status, 403)
    await view.locator('#popup').click()
    await viewer.waitForFunction('window.packets.some(p=>p.popup)')
    await view.getByText('Opener preserved').waitFor()
    const tabs = await (await fetch(`${origin}/api/browser-dom/tabs`)).json() as { id: string; url: string }[]
    assert.equal(tabs.length, 2)
    assert(tabs.some((tab) => tab.url === origin + '/popup'))
    assert.deepEqual(await (await fetch(`${origin}/api/browser-dom/tabs`, { headers: { 'x-test-account': 'other' } })).json(), [])
    await view.locator('#next').click()
    await view.getByText('Next page').waitFor()
    await viewer.evaluate('window.controller.command("back")')
    await view.getByText('General server browser').waitFor()
    await viewer.evaluate('window.controller.command("forward")')
    await view.getByText('Next page').waitFor()
    await session.page!.evaluate('history.pushState({},"","/spa-route");document.querySelector("h1").textContent="SPA route"')
    await view.getByText('SPA route').waitFor()
    await viewer.waitForFunction('JSON.parse(document.querySelector("#status").textContent).url.endsWith("/spa-route")')
    assert.deepEqual(errors, [])

    // Exercise the shipped panel wiring, including reconnecting existing server tabs.
    await viewer.goto(origin + '/panel')
    await viewer.getByRole('textbox').waitFor()
    const address = viewer.getByRole('textbox')
    const localAddress = `localhost:${(server.address() as { port: number }).port}/next`
    await address.fill(localAddress)
    await address.press('Enter')
    await viewer.frameLocator('.mew-dom-browser iframe').first().getByText('Next page').waitFor({ timeout: 10_000 })
    assert.equal(await address.inputValue(), 'http://' + localAddress)
    await session.page!.waitForURL('http://' + localAddress)
    // Use the actual panel CSS: a fixed viewer height would conceal a broken flex chain.
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await viewer.setViewportSize(viewport)
      await viewer.waitForFunction(`() => {
        const surface = [...document.querySelectorAll('.mew-dom-browser')].find(element => element.getBoundingClientRect().width > 0)
        const area = surface?.getBoundingClientRect(), panel = surface?.closest('section')?.getBoundingClientRect()
        const frame = surface?.querySelector('iframe')?.getBoundingClientRect()
        return area && panel && frame && area.height > 500 && Math.abs(area.bottom - panel.bottom) < 1 && Math.abs(frame.height - area.height) < 1
      }`, undefined, { timeout: 5000 })
      const area = await viewer.locator('.mew-dom-browser:visible').boundingBox()
      assert.ok(area)
      await session.page!.waitForFunction('height => Math.abs(innerHeight - height) < 1', area.height)
    }
    // Hardware Back follows the selected remote tab, and rearms for repeated presses.
    const remote = viewer.frameLocator('.mew-dom-browser:visible iframe').first()
    for (const route of ['/back-one', '/back-two']) {
      await session.page!.evaluate(`history.pushState({}, '', ${JSON.stringify(route)}); document.querySelector('h1').textContent=${JSON.stringify(route)}`)
      await remote.getByText(route, { exact: true }).waitFor()
      await viewer.waitForFunction(`document.querySelector('input').value.endsWith(${JSON.stringify(route)})`)
    }
    for (const route of ['/back-one', '/next']) {
      await viewer.evaluate('history.back()')
      await session.page!.waitForURL(new URL(route, 'http://' + localAddress).href)
      await viewer.waitForFunction(`document.querySelector('input').value.endsWith(${JSON.stringify(route)})`)
      assert.equal(await viewer.evaluate('window.panelClosed || 0'), 0)
      assert.equal(new URL(viewer.url()).pathname, '/panel')
    }
    // A new empty tab has no remote history; hidden tabs must not consume its Back.
    await viewer.getByRole('button', { name: /새 탭|New tab/ }).click()
    await viewer.evaluate('history.back()')
    await viewer.waitForFunction('window.panelClosed === 1')
    await viewer.close()
    await closeDomBrowsers()
    const reopened = openDomBrowserTab(account, 'reopened', origin + '/next')
    await reopened.start()
    await reopened.page!.waitForURL(origin + '/next')
    await reopened.page!.waitForLoadState('domcontentloaded')
    assert((await reopened.context!.cookies(origin)).some((cookie) => cookie.name === 'persistent_site' && cookie.value === 'kept'))
    assert.equal(await reopened.page!.evaluate('localStorage.getItem("server-local")'), 'kept')
    // Device-code OAuth has no redirect_uri and shares normal server login state.
    const authStream = await createDomBrowserAuthSession(account, 'device-oauth', origin + '/site')
    assert.equal(await createDomBrowserAuthSession(account, 'device-oauth', origin + '/site'), authStream)
    const authViewer = await browser.newPage()
    await authViewer.goto(origin + '/panel?auth=' + encodeURIComponent(authStream))
    const authMain = authViewer.frameLocator('.mew-dom-browser iframe').first()
    await authMain.getByText('General server browser').waitFor({ timeout: 10_000 })
    await authMain.locator('#blank-popup').click()
    await authViewer.frameLocator('.mew-dom-browser iframe').last().getByText('Waiting for sign-in').waitFor({ timeout: 5000 })
    // Navigate the same real popup, as an asynchronous SSO SDK would.
    const ssoPopup = (await Promise.all(reopened.context!.pages().map(async (page) => ({ page, opener: await page.opener() })))).find((item) => item.opener)?.page
    assert(ssoPopup)
    await ssoPopup.goto(origin + '/popup')
    await authViewer.getByRole('tab', { name: 'Popup page' }).waitFor()
    await authViewer.frameLocator('.mew-dom-browser iframe').last().getByText('Popup page').waitFor()
    // OAuth tabs and popups are absent from the general BrowserPanel list.
    const ordinaryTabs = await (await fetch(origin + '/api/browser-dom/tabs')).json() as { id: string }[]
    assert.deepEqual(ordinaryTabs.map((tab) => tab.id), ['reopened'])
    assert.equal(reopened.context!.pages().filter((page) => page.url().startsWith(origin)).length, 3)
    await closeDomBrowserJob('other-account', 'device-oauth')
    assert.equal(reopened.context!.pages().filter((page) => page.url().startsWith(origin)).length, 3)
    await closeDomBrowserJob(account, 'device-oauth')
    assert.equal(reopened.context!.pages().filter((page) => page.url().startsWith(origin)).length, 1)
    assert.equal(reopened.page!.isClosed(), false)
    await authViewer.close()
    await reopened.close()

    // A stalled first address must not hold subsequent address/stop commands.
    const stalled = openDomBrowserTab(account, 'stalled', origin + '/stall')
    streamUrl = stalled.info().streamUrl
    const recovery = await browser.newPage()
    await recovery.goto(origin + '/viewer')
    await recovery.waitForFunction('window.packets.some(p=>p.state==="connecting")')
    await recovery.evaluate(`window.controller.command('navigate',{url:${JSON.stringify(origin + '/next')}})`)
    await recovery.frameLocator('#root iframe').getByText('Next page').waitFor({ timeout: 5000 })
    const unused = http.createServer()
    await new Promise<void>((resolve) => unused.listen(0, '127.0.0.1', resolve))
    const refused = `http://127.0.0.1:${(unused.address() as { port: number }).port}/`
    await new Promise<void>((resolve) => unused.close(() => resolve()))
    const crashes: string[] = []
    stalled.page!.on('crash', () => crashes.push('crashed'))
    await recovery.evaluate(`window.controller.command('navigate',{url:${JSON.stringify(refused)}})`)
    await recovery.waitForFunction('window.packets.some(p=>p.state==="error" && p.message?.includes("연결이 거부"))')
    assert.equal(stalled.info().url, refused)
    unused.on('request', (_req, res) => res.end('<html><body><h1>Server available again</h1></body></html>'))
    await new Promise<void>((resolve) => unused.listen(Number(new URL(refused).port), '127.0.0.1', resolve))
    try {
      await recovery.evaluate('window.controller.command("reload")')
      await recovery.frameLocator('#root iframe').getByText('Server available again').waitFor({ timeout: 5000 })
    } finally {
      unused.closeAllConnections()
      await new Promise<void>((resolve) => unused.close(() => resolve()))
    }
    await recovery.evaluate(`window.controller.command('navigate',{url:${JSON.stringify(origin + '/next')}})`)
    await recovery.waitForFunction('JSON.parse(document.querySelector("#status").textContent).state==="ready" && !JSON.parse(document.querySelector("#status").textContent).message', undefined, { timeout: 5000 })
    assert.deepEqual(crashes, [])
    await recovery.frameLocator('#root iframe').getByText('Next page').waitFor()
    await recovery.close()
    await stalled.close()
  } finally {
    await browser.close()
    await closeDomBrowsers()
    for (const client of siteWs.clients) client.terminate()
    siteWs.close()
    server.closeAllConnections(); childServer.closeAllConnections()
    await Promise.all([new Promise<void>((resolve) => server.close(() => resolve())), new Promise<void>((resolve) => childServer.close(() => resolve()))])
    await fs.rm(profileDir, { recursive: true, force: true })
  }
})

test('OAuth browser rejects active schemes and URL credentials without creating a browser', async () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:password@example.com/']) {
    await assert.rejects(createDomBrowserAuthSession(owner.email, 'invalid-auth-job', url), /HTTP/)
  }
})
