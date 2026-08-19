import express from 'express'
import crypto from 'node:crypto'
import net from 'node:net'
import { resolveAuth } from './reqAuth.ts'

const PROXY_PREFIX = '/__mew_browser'
const TOKEN_TTL_MS = 5 * 60 * 1000
const TOKEN_SECRET = crypto.randomBytes(32)
const PORT_PROXY_RE = /^\/([0-9]{2,5})(?:\/~([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+))?(\/.*)?$/

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const PRIVATE_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-csrf-token',
  'x-xsrf-token',
])

const RESPONSE_HEADERS_TO_DROP = new Set([
  'content-encoding',
  'content-length',
  'content-security-policy',
  'content-security-policy-report-only',
  'set-cookie',
  'x-frame-options',
])

class BrowserProxyError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

type BrowserTokenPayload = {
  origin: string
  exp: number
}

function encodeOrigin(origin: string): string {
  return Buffer.from(origin, 'utf8').toString('base64url')
}

function signTokenPayload(encoded: string): string {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url')
}

function createBrowserToken(origin: string): string {
  const payload: BrowserTokenPayload = { origin, exp: Date.now() + TOKEN_TTL_MS }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encoded}.${signTokenPayload(encoded)}`
}

function verifyBrowserToken(token: string | null, origin: string): boolean {
  if (!token) return false
  const [encoded, signature] = token.split('.')
  if (!encoded || !signature) return false
  const expected = signTokenPayload(encoded)
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return false
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<BrowserTokenPayload>
    return payload.origin === origin && typeof payload.exp === 'number' && payload.exp > Date.now()
  } catch {
    return false
  }
}

function decodeOrigin(token: string): string {
  try {
    return Buffer.from(token, 'base64url').toString('utf8')
  } catch {
    throw new BrowserProxyError('브라우저 주소가 올바르지 않습니다')
  }
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost') return true
  const ip = net.isIP(normalized)
  if (ip === 4) return normalized.startsWith('127.')
  if (ip === 6) return normalized === '::1' || normalized === '0:0:0:0:0:0:0:1'
  return false
}

function assertAllowedTarget(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BrowserProxyError('http 또는 https 주소만 열 수 있습니다')
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new BrowserProxyError('mew 브라우저는 이 서버의 localhost/loopback 주소만 열 수 있습니다', 403)
  }
}

function parseProxyRequest(req: express.Request): { originToken: string; browserToken: string; target: URL; prefix: string; origin: string } {
  const parts = req.path.split('/')
  const originToken = parts[1] ?? ''
  const browserToken = parts[2] ?? ''
  if (!originToken || !browserToken) throw new BrowserProxyError('브라우저 주소가 없습니다')
  const origin = decodeOrigin(originToken)
  const originUrl = new URL(origin)
  assertAllowedTarget(originUrl)
  const rest = `/${parts.slice(3).join('/')}`
  const target = new URL(rest + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''), originUrl.origin)
  assertAllowedTarget(target)
  return { originToken, browserToken, target, prefix: `${PROXY_PREFIX}/${originToken}/${browserToken}`, origin: originUrl.origin }
}

function proxiedPath(url: URL): string {
  assertAllowedTarget(url)
  return `${PROXY_PREFIX}/${encodeOrigin(url.origin)}${url.pathname}${url.search}${url.hash}`
}

function requestHeaders(req: express.Request, target: URL): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lower) || PRIVATE_HEADERS.has(lower) || lower.startsWith('sec-')) continue
    if (value === undefined) continue
    headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  headers.set('accept-encoding', 'identity')
  headers.set('host', target.host)
  return headers
}

function copyResponseHeaders(upstream: Response, res: express.Response, sandbox: boolean) {
  res.removeHeader('Content-Security-Policy')
  res.removeHeader('Content-Security-Policy-Report-Only')
  res.removeHeader('X-Frame-Options')
  upstream.headers.forEach((value, name) => {
    if (RESPONSE_HEADERS_TO_DROP.has(name.toLowerCase())) return
    res.setHeader(name, value)
  })
  res.setHeader('Access-Control-Allow-Origin', 'null')
  res.setHeader('Access-Control-Allow-Credentials', 'false')
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (sandbox) {
    res.setHeader(
      'Content-Security-Policy',
      "sandbox allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-scripts",
    )
  }
}

function rewriteText(text: string, contentType: string, prefix: string): string {
  const root = `${prefix}/`
  let next = text
  if (contentType.includes('text/html')) {
    const guard = `<script>(()=>{const p=${JSON.stringify(prefix)};const r=(u)=>{try{if(typeof u!=='string')return u;if(u.startsWith('/')&&!u.startsWith('//')&&!u.startsWith(p+'/'))return p+u;return u}catch{return u}};const f=window.fetch;window.fetch=(u,o)=>f(r(u),o);const xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,...a){return xo.call(this,m,r(u),...a)};const EO=window.EventSource;if(EO)window.EventSource=function(u,o){return new EO(r(u),o)};const ps=history.pushState.bind(history);history.pushState=(s,t,u)=>ps(s,t,r(u));const rs=history.replaceState.bind(history);history.replaceState=(s,t,u)=>rs(s,t,r(u));const sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){return sa.call(this,n,(['src','href','action'].includes(String(n).toLowerCase())?r(v):v))};const pp=(C,k)=>{try{const d=Object.getOwnPropertyDescriptor(C.prototype,k);if(!d||!d.set||!d.get)return;Object.defineProperty(C.prototype,k,{get:d.get,set(v){d.set.call(this,r(v))}})}catch{}};[HTMLScriptElement,HTMLLinkElement,HTMLImageElement,HTMLIFrameElement,HTMLFormElement,HTMLAnchorElement].forEach(C=>{pp(C,'src');pp(C,'href');pp(C,'action')});document.addEventListener('click',e=>{const a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;const h=a.getAttribute('href');if(!h||!h.startsWith('/')||h.startsWith('//'))return;e.preventDefault();e.stopImmediatePropagation();location.href=r(h)},true);document.addEventListener('submit',e=>{const form=e.target;if(!form||!form.getAttribute)return;const a=form.getAttribute('action');if(!a||!a.startsWith('/')||a.startsWith('//'))return;e.preventDefault();location.href=r(a)},true);})();</script>`
    next = next.replaceAll('="/', `="${root}`)
    next = next.replaceAll("='/", `='${root}`)
    next = next.replace(/<head([^>]*)>/i, `<head$1><base href="${root}">${guard}`)
  }
  if (contentType.includes('text/css')) {
    next = next.replaceAll('url(/', `url(${root}`)
  }
  return next
}

function isTextual(contentType: string): boolean {
  return (
    contentType.startsWith('text/') ||
    contentType.includes('javascript') ||
    contentType.includes('json') ||
    contentType.includes('xml')
  )
}

export function browserProxyUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  assertAllowedTarget(url)
  return proxiedPath(url)
}

export function browserProxyFrameUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  assertAllowedTarget(url)
  const token = createBrowserToken(url.origin)
  return `${PROXY_PREFIX}/${encodeOrigin(url.origin)}/${token}${url.pathname}${url.search}${url.hash}`
}

async function proxyRequest(req: express.Request, res: express.Response, target: URL, prefix: string, sandbox: boolean) {
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : (req as unknown as ReadableStream)
  const upstream = await fetch(target, {
    method: req.method,
    headers: requestHeaders(req, target),
    body,
    // Node fetch requires this when the request stream is forwarded.
    duplex: body ? 'half' : undefined,
    redirect: 'manual',
  } as RequestInit & { duplex?: 'half' })

  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get('location')
    if (location) {
      const next = new URL(location, target)
      res.setHeader('location', `${prefix}${next.pathname}${next.search}${next.hash}`)
    }
  }

  copyResponseHeaders(upstream, res, sandbox)
  res.status(upstream.status)
  const contentType = upstream.headers.get('content-type') ?? ''
  const buffer = Buffer.from(await upstream.arrayBuffer())
  if (isTextual(contentType)) {
    res.send(rewriteText(buffer.toString('utf8'), contentType, prefix))
  } else {
    res.send(buffer)
  }
}

export function createBrowserPortProxyMiddleware(): express.RequestHandler {
  return async (req, res, next) => {
    const match = PORT_PROXY_RE.exec(req.path)
    if (!match) {
      next()
      return
    }

    const port = Number(match[1])
    const browserToken = match[2] ?? null
    const rest = match[3] ?? '/'
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      res.status(400).type('text/plain').send('포트가 올바르지 않습니다')
      return
    }
    const origin = `http://localhost:${port}`

    if (!browserToken) {
      const auth = resolveAuth(req)
      if (auth.mustChangePassword || (auth.role !== 'manager' && auth.role !== 'owner')) {
        res.status(403).type('text/plain').send('권한이 없습니다')
        return
      }
      res.redirect(302, `/${port}/~${createBrowserToken(origin)}${rest}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`)
      return
    }

    if (!verifyBrowserToken(browserToken, origin)) {
      res.status(403).type('text/plain').send('브라우저 토큰이 없거나 만료되었습니다')
      return
    }

    try {
      const prefix = `/${port}/~${browserToken}`
      const target = new URL(`${rest}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`, origin)
      assertAllowedTarget(target)
      await proxyRequest(req, res, target, prefix, true)
    } catch (err) {
      if (err instanceof BrowserProxyError) {
        res.status(err.status).type('text/plain').send(err.message)
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      res.status(502).type('text/plain').send(`localhost에 연결할 수 없습니다: ${message}`)
    }
  }
}

export function createBrowserProxyApp() {
  const app = express()
  app.options(/.*/, (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'null')
    res.setHeader('Access-Control-Allow-Credentials', 'false')
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization,x-csrf-token,x-xsrf-token')
    res.status(204).end()
  })
  app.use(async (req, res) => {
    try {
      const { target, prefix, origin, browserToken } = parseProxyRequest(req)
      if (!verifyBrowserToken(browserToken, origin)) {
        res.removeHeader('X-Frame-Options')
        res.status(403).type('text/plain').send('브라우저 토큰이 없거나 만료되었습니다')
        return
      }
      await proxyRequest(req, res, target, prefix, false)
    } catch (err) {
      if (err instanceof BrowserProxyError) {
        res.status(err.status).type('text/plain').send(err.message)
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      res.status(502).type('text/plain').send(`localhost에 연결할 수 없습니다: ${message}`)
    }
  })
  return app
}
