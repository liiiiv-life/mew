import { canUse, accessChanges } from './access-policy.ts'
import express from 'express'
import crypto from 'node:crypto'
import type { IncomingMessage, Server as HttpServer } from 'node:http'
import type { Http2SecureServer } from 'node:http2'
import type { Duplex } from 'node:stream'
import { CookieJar } from 'tough-cookie'
import {
  parse,
  parseFragment,
  serialize,
  type DefaultTreeAdapterTypes,
} from 'parse5'
import { WebSocket, WebSocketServer } from 'ws'
import { authOf, resolveAuth } from './reqAuth.ts'

export const BROWSER_PROXY_PREFIX = '/__mew_browser'
export const BROWSER_PROXY_WS_PREFIX = '/__mew_browser_ws'

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000
const TOKEN_SECRET = crypto.randomBytes(32)
const PORT_PROXY_RE = /^\/([0-9]{2,5})(?:\/~([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+))?(\/.*)?$/
const SESSION_SWEEP_MS = 10 * 60 * 1000
const MAX_STORAGE_BYTES = 1024 * 1024

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

const REQUEST_HEADERS_TO_DROP = new Set([
  'cookie',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-real-ip',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
])

const RESPONSE_HEADERS_TO_DROP = new Set([
  'alt-svc',
  'access-control-allow-credentials',
  'access-control-allow-origin',
  'cache-control',
  'clear-site-data',
  'content-encoding',
  'content-length',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'etag',
  'expires',
  'last-modified',
  'link',
  'location',
  'nel',
  'origin-agent-cluster',
  'permissions-policy',
  'reporting-endpoints',
  'refresh',
  'set-cookie',
  'strict-transport-security',
  'www-authenticate',
  'x-frame-options',
])

const URL_ATTRIBUTES = new Set([
  'action',
  'background',
  'cite',
  'data',
  'formaction',
  'href',
  'manifest',
  'poster',
  'src',
])

class BrowserProxyError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

type BrowserTokenPayload = {
  sessionId: string
  pageOrigin: string
  exp: number
}

type StorageArea = Record<string, string>

type BrowserSession = {
  accountHash: string
  expiresAt: number
  /** 일반 브라우저는 빈 목록. 인증 작업이 발급한 세션만 제한된 외부 HTTPS를 연다. */
  httpsHosts: string[]
  jar: CookieJar
  localStorage: Map<string, StorageArea>
  sessionStorage: Map<string, StorageArea>
}

type VerifiedBrowserToken = {
  payload: BrowserTokenPayload
  session: BrowserSession
}

const sessions = new Map<string, BrowserSession>()
accessChanges.on('change', () => sessions.clear())

const sessionSweep = setInterval(() => {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id)
  }
}, SESSION_SWEEP_MS)
sessionSweep.unref?.()

function accountHash(account: string): string {
  return crypto.createHash('sha256').update(account.trim().toLowerCase()).digest('base64url')
}

function encodeOrigin(origin: string): string {
  return Buffer.from(origin, 'utf8').toString('base64url')
}

function signTokenPayload(encoded: string): string {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url')
}

function createSession(account: string, httpsHosts: readonly string[] = []): { id: string; session: BrowserSession } {
  const id = crypto.randomBytes(24).toString('base64url')
  const session: BrowserSession = {
    accountHash: accountHash(account),
    expiresAt: Date.now() + TOKEN_TTL_MS,
    httpsHosts: [...new Set(httpsHosts.map((host) => host.trim().toLowerCase()).filter(Boolean))],
    jar: new CookieJar(),
    localStorage: new Map(),
    sessionStorage: new Map(),
  }
  sessions.set(id, session)
  return { id, session }
}

function createBrowserToken(sessionId: string, pageOrigin: string, expiresAt: number): string {
  const payload: BrowserTokenPayload = { sessionId, pageOrigin, exp: expiresAt }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encoded}.${signTokenPayload(encoded)}`
}

function verifyBrowserToken(token: string | null): VerifiedBrowserToken | null {
  if (!token) return null
  const [encoded, signature, extra] = token.split('.')
  if (!encoded || !signature || extra) return null
  const expected = signTokenPayload(encoded)
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return null
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<BrowserTokenPayload>
    if (
      typeof payload.sessionId !== 'string' ||
      typeof payload.pageOrigin !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.exp <= Date.now()
    ) return null
    const session = sessions.get(payload.sessionId)
    if (!session || session.expiresAt <= Date.now() || payload.exp !== session.expiresAt) return null
    const pageOrigin = new URL(payload.pageOrigin)
    if (pageOrigin.origin !== payload.pageOrigin || !isHttpProtocol(pageOrigin.protocol)) return null
    return { payload: payload as BrowserTokenPayload, session }
  } catch {
    return null
  }
}

function decodeOrigin(token: string, protocols: ReadonlySet<string>): URL {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8')
    const url = new URL(raw)
    if (!protocols.has(url.protocol) || url.origin !== raw || url.username || url.password) throw new Error('invalid origin')
    return url
  } catch {
    throw new BrowserProxyError('브라우저 주소가 올바르지 않습니다')
  }
}

function isHttpProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:'
}

function assertHttpTarget(url: URL): void {
  if (!isHttpProtocol(url.protocol)) throw new BrowserProxyError('http 또는 https 주소만 열 수 있습니다')
  if (url.username || url.password) throw new BrowserProxyError('주소에 사용자 이름이나 비밀번호를 넣을 수 없습니다')
}

/**
 * 브라우저 창은 서버가 직접 띄운 개발 서버를 보는 용도다. 공개·사설망을 프록시하면
 * 목적지 IP와 기기 지문이 갈리는 범용 웹 프록시가 되어 OAuth/anti-bot 문제도 풀지 못하고
 * manager 셸 경계 밖의 불필요한 SSRF 표면만 넓어진다.
 */
function isLoopbackHostname(host: string): boolean {
  if (host === 'localhost' || host === '[::1]') return true
  const parts = host.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function assertLoopbackTarget(url: URL): void {
  assertHttpTarget(url)
  const host = url.hostname.toLowerCase()
  if (isLoopbackHostname(host)) return
  throw new BrowserProxyError('Mew 브라우저는 이 서버의 localhost/loopback 주소만 열 수 있습니다', 403)
}

function matchesHttpsHost(hostname: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1)
    return hostname.endsWith(suffix) && hostname.length > suffix.length
  }
  return hostname === pattern
}

function assertTargetForHosts(url: URL, httpsHosts: readonly string[]): void {
  assertHttpTarget(url)
  const host = url.hostname.toLowerCase()
  if (isLoopbackHostname(host)) return
  if (url.protocol === 'https:' && httpsHosts.some((pattern) => matchesHttpsHost(host, pattern))) return
  throw new BrowserProxyError('이 브라우저 세션에 허용되지 않은 주소입니다', 403)
}

function assertSessionTarget(url: URL, session: BrowserSession): void {
  assertTargetForHosts(url, session.httpsHosts)
}

function parseProxyPath(
  rawUrl: string,
  prefix: string,
  protocols: ReadonlySet<string>,
): { originToken: string; browserToken: string; target: URL } {
  const requestUrl = new URL(rawUrl, 'http://mew.invalid')
  if (!requestUrl.pathname.startsWith(`${prefix}/`)) throw new BrowserProxyError('브라우저 주소가 없습니다')
  const parts = requestUrl.pathname.slice(prefix.length + 1).split('/')
  const originToken = parts.shift() ?? ''
  const browserToken = parts.shift() ?? ''
  if (!originToken || !browserToken) throw new BrowserProxyError('브라우저 주소가 없습니다')
  const origin = decodeOrigin(originToken, protocols)
  const pathname = `/${parts.join('/')}`
  const target = new URL(`${pathname}${requestUrl.search}`, origin.origin)
  if (!protocols.has(target.protocol)) throw new BrowserProxyError('브라우저 주소가 올바르지 않습니다')
  return { originToken, browserToken, target }
}

function proxyPath(url: URL, browserToken: string): string {
  assertHttpTarget(url)
  return `${BROWSER_PROXY_PREFIX}/${encodeOrigin(url.origin)}/${browserToken}${url.pathname}${url.search}${url.hash}`
}

function proxySocketPath(url: URL, browserToken: string): string {
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return url.toString()
  return `${BROWSER_PROXY_WS_PREFIX}/${encodeOrigin(url.origin)}/${browserToken}${url.pathname}${url.search}${url.hash}`
}

function tokenForPage(verified: VerifiedBrowserToken, pageOrigin: string): string {
  if (verified.payload.pageOrigin === pageOrigin) return createBrowserToken(
    verified.payload.sessionId,
    verified.payload.pageOrigin,
    verified.session.expiresAt,
  )
  return createBrowserToken(verified.payload.sessionId, pageOrigin, verified.session.expiresAt)
}

function isNavigation(req: express.Request): boolean {
  return req.headers['sec-fetch-mode'] === 'navigate' || req.headers['sec-fetch-dest'] === 'document' || req.headers['sec-fetch-dest'] === 'iframe'
}

function requestHeaders(req: express.Request, pageOrigin: string, cookie: string): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase()
    if (
      HOP_BY_HOP_HEADERS.has(lower) ||
      REQUEST_HEADERS_TO_DROP.has(lower) ||
      lower.startsWith('sec-fetch-') ||
      value === undefined
    ) continue
    headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  headers.set('accept-encoding', 'identity')
  if (cookie) headers.set('cookie', cookie)
  if (req.headers.origin) headers.set('origin', pageOrigin)
  if (req.headers.referer) headers.set('referer', `${pageOrigin}/`)
  return headers
}

function corsHeaders(req: express.Request, res: express.Response): void {
  res.setHeader('Access-Control-Allow-Origin', 'null')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS')
  const requested = req.headers['access-control-request-headers']
  res.setHeader('Access-Control-Allow-Headers', typeof requested === 'string' && requested ? requested : '*')
  res.setHeader('Access-Control-Max-Age', '600')
}

function copyResponseHeaders(
  upstream: Response,
  req: express.Request,
  res: express.Response,
  sandbox: boolean,
  targetOrigin: string,
  pageOrigin: string,
): void {
  res.removeHeader('Content-Security-Policy')
  res.removeHeader('Content-Security-Policy-Report-Only')
  res.removeHeader('X-Frame-Options')
  upstream.headers.forEach((value, name) => {
    if (RESPONSE_HEADERS_TO_DROP.has(name.toLowerCase())) return
    res.setHeader(name, value)
  })
  const upstreamCors = upstream.headers.get('access-control-allow-origin')
  if (targetOrigin === pageOrigin || upstreamCors === '*' || upstreamCors === pageOrigin) {
    res.setHeader('Access-Control-Allow-Origin', 'null')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  } else {
    res.removeHeader('Access-Control-Allow-Origin')
    res.removeHeader('Access-Control-Allow-Credentials')
  }
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (sandbox) {
    const requestHost = typeof req.headers.host === 'string' && /^[A-Za-z0-9.:[\]-]+$/.test(req.headers.host)
      ? req.headers.host
      : 'localhost'
    res.setHeader(
      'Content-Security-Policy',
      `sandbox allow-downloads allow-forms allow-modals allow-pointer-lock allow-scripts; base-uri 'self'; form-action 'self'; default-src 'self' data: blob:; connect-src 'self' ws://${requestHost} wss://${requestHost} data: blob:; font-src 'self' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'self' 'unsafe-inline' data: blob:; worker-src 'self' data: blob:`,
    )
  }
}

function shouldLeaveUrl(raw: string): boolean {
  const value = raw.trim().toLowerCase()
  return (
    !value ||
    value.startsWith('#') ||
    value.startsWith('about:') ||
    value.startsWith('blob:') ||
    value.startsWith('data:') ||
    value.startsWith('javascript:') ||
    value.startsWith('mailto:') ||
    value.startsWith('tel:') ||
    value.startsWith(`${BROWSER_PROXY_PREFIX}/`) ||
    value.startsWith(`${BROWSER_PROXY_WS_PREFIX}/`)
  )
}

function rewriteUrl(raw: string, base: URL, browserToken: string): string {
  if (shouldLeaveUrl(raw)) return raw
  try {
    const url = new URL(raw, base)
    if (isHttpProtocol(url.protocol)) return proxyPath(url, browserToken)
    if (url.protocol === 'ws:' || url.protocol === 'wss:') return proxySocketPath(url, browserToken)
    return raw
  } catch {
    return raw
  }
}

function rewriteSrcset(raw: string, base: URL, browserToken: string): string {
  if (raw.trim().toLowerCase().startsWith('data:')) return raw
  return raw.split(',').map((candidate) => {
    const match = /^(\s*)(\S+)(.*)$/.exec(candidate)
    return match ? `${match[1]}${rewriteUrl(match[2], base, browserToken)}${match[3]}` : candidate
  }).join(',')
}

function rewriteCss(text: string, base: URL, browserToken: string): string {
  return text
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (_match, quote: string, url: string) => `url(${quote}${rewriteUrl(url, base, browserToken)}${quote})`)
    .replace(/(@import\s+)(["'])([^"']+)(\2)/gi, (_match, start: string, quote: string, url: string) => `${start}${quote}${rewriteUrl(url, base, browserToken)}${quote}`)
}

function rewriteJavascript(text: string, base: URL, browserToken: string): string {
  const imports = text.replace(
    /(\b(?:import|export)\s+(?:[^;\n]*?\sfrom\s*)?)(["'])([^"']+)(\2)/g,
    (_match, start: string, quote: string, url: string) => `${start}${quote}${rewriteUrl(url, base, browserToken)}${quote}`,
  )
  return imports.replace(
    /(\bimport\s*\(\s*)(["'])([^"']+)(\2)/g,
    (_match, start: string, quote: string, url: string) => `${start}${quote}${rewriteUrl(url, base, browserToken)}${quote}`,
  )
}

function storageSnapshot(map: Map<string, StorageArea>, origin: string): StorageArea {
  return { ...(map.get(origin) ?? {}) }
}

function browserGuard(
  target: URL,
  browserToken: string,
  cookies: Record<string, string>,
  localStorage: StorageArea,
  sessionStorage: StorageArea,
): string {
  const config = JSON.stringify({
    token: browserToken,
    virtualUrl: target.toString(),
    httpPrefix: BROWSER_PROXY_PREFIX,
    wsPrefix: BROWSER_PROXY_WS_PREFIX,
    control: `${BROWSER_PROXY_PREFIX}/_control/${browserToken}`,
    cookies,
    localStorage,
    sessionStorage,
  }).replace(/</g, '\\u003c')
  return `<script>(()=>{const c=${config};let v=globalThis.__mewBrowserVirtualUrl||c.virtualUrl;const enc=s=>btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');const special=u=>/^(?:#|about:|blob:|data:|javascript:|mailto:|tel:)/i.test(u)||u.startsWith(c.httpPrefix+'/')||u.startsWith(c.wsPrefix+'/');const abs=u=>{try{return new URL(String(u),v)}catch{return null}};const p=u=>{if(typeof u!=='string'||special(u))return u;const x=abs(u);return x&&/^https?:$/.test(x.protocol)?c.httpPrefix+'/'+enc(x.origin)+'/'+c.token+x.pathname+x.search+x.hash:u};const pw=u=>{if(typeof u!=='string'||special(u))return u;const x=abs(u);if(!x||!/^wss?:$/.test(x.protocol))return u;const proto=location.protocol==='https:'?'wss:':'ws:';return proto+'//'+location.host+c.wsPrefix+'/'+enc(x.origin)+'/'+c.token+x.pathname+x.search+x.hash};const tell=()=>parent.postMessage({type:'mew-browser-state',url:v,title:document.title,historyLength:history.length},'*');const control=m=>{try{fetch(c.control,{method:'POST',body:JSON.stringify({...m,url:v}),credentials:'include',keepalive:true})}catch{}};const makeStorage=(kind,initial)=>{const data=new Map(Object.entries(initial));return{get length(){return data.size},key:i=>Array.from(data.keys())[Number(i)]??null,getItem:k=>data.has(String(k))?data.get(String(k)):null,setItem:(k,x)=>{k=String(k);x=String(x);data.set(k,x);control({kind:'storage',area:kind,op:'set',key:k,value:x})},removeItem:k=>{k=String(k);data.delete(k);control({kind:'storage',area:kind,op:'remove',key:k})},clear:()=>{data.clear();control({kind:'storage',area:kind,op:'clear'})}}};try{Object.defineProperty(window,'localStorage',{configurable:true,value:makeStorage('local',c.localStorage)})}catch{}try{Object.defineProperty(window,'sessionStorage',{configurable:true,value:makeStorage('session',c.sessionStorage)})}catch{}const ck=new Map(Object.entries(c.cookies));try{Object.defineProperty(Document.prototype,'cookie',{configurable:true,get(){return Array.from(ck.entries()).map(([k,x])=>k+'='+x).join('; ')},set(raw){const first=String(raw).split(';',1)[0];const at=first.indexOf('=');if(at>0){const k=first.slice(0,at).trim(),x=first.slice(at+1).trim();ck.set(k,x);control({kind:'cookie',cookie:String(raw)})}}})}catch{}const nativeFetch=window.fetch.bind(window);window.fetch=(u,o)=>nativeFetch(u instanceof Request?new Request(p(u.url),u):p(u),{...o,credentials:'include'});const xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,...a){const result=xo.call(this,m,p(String(u)),...a);this.withCredentials=true;return result};const ES=window.EventSource;if(ES)window.EventSource=new Proxy(ES,{construct(T,a){a[0]=p(String(a[0]));a[1]={...(a[1]??{}),withCredentials:true};return Reflect.construct(T,a)}});const WS=window.WebSocket;if(WS)window.WebSocket=new Proxy(WS,{construct(T,a){a[0]=pw(String(a[0]));return Reflect.construct(T,a)}});window.open=u=>{if(u!=null&&String(u)!=='')location.href=p(String(u));return window};for(const name of ['assign','replace']){try{const fn=Location.prototype[name];Object.defineProperty(Location.prototype,name,{value:function(u){return fn.call(this,p(String(u)))}})}catch{}}const hs=(name)=>{const original=history[name].bind(history);history[name]=(state,title,u)=>{if(u!=null){const x=abs(String(u));if(x&&x.origin!==new URL(v).origin)throw new DOMException('Cross-origin history URL','SecurityError');if(x){v=x.toString();globalThis.__mewBrowserVirtualUrl=v}u=p(String(u))}const result=original(state,title,u);tell();return result}};hs('pushState');hs('replaceState');const patch=(C,k)=>{try{const d=Object.getOwnPropertyDescriptor(C.prototype,k);if(!d?.set||!d.get)return;Object.defineProperty(C.prototype,k,{configurable:d.configurable,enumerable:d.enumerable,get:d.get,set(x){d.set.call(this,p(String(x)))}})}catch{}};for(const [C,keys] of [[HTMLAnchorElement,['href']],[HTMLAreaElement,['href']],[HTMLAudioElement,['src']],[HTMLBaseElement,['href']],[HTMLButtonElement,['formAction']],[HTMLEmbedElement,['src']],[HTMLFormElement,['action']],[HTMLIFrameElement,['src']],[HTMLImageElement,['src']],[HTMLInputElement,['src','formAction']],[HTMLLinkElement,['href']],[HTMLMediaElement,['src']],[HTMLObjectElement,['data']],[HTMLScriptElement,['src']],[HTMLSourceElement,['src']],[HTMLTrackElement,['src']],[HTMLVideoElement,['src','poster']]])for(const k of keys)patch(C,k);const sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,x){const k=String(n).toLowerCase();return sa.call(this,n,k==='srcset'?String(x).split(',').map(y=>{const z=y.trim().split(/\\s+/);z[0]=p(z[0]);return z.join(' ')}).join(', '):['action','background','cite','data','formaction','href','manifest','poster','src'].includes(k)?p(String(x)):x)};const rewrite=e=>{if(!(e instanceof Element))return;if(e.matches('a,area,base,form')&&e.getAttribute('target')!=='_self')sa.call(e,'target','_self');if(e.hasAttribute('formtarget')&&e.getAttribute('formtarget')!=='_self')sa.call(e,'formtarget','_self');for(const k of ['action','background','cite','data','formaction','href','manifest','poster','src']){const old=e.getAttribute(k),next=old==null?old:p(old);if(next!==old&&next!=null)sa.call(e,k,next)}if(e.hasAttribute('srcset')){const old=e.getAttribute('srcset')??'',next=old.split(',').map(y=>{const z=y.trim().split(/\\s+/);z[0]=p(z[0]);return z.join(' ')}).join(', ');if(next!==old)sa.call(e,'srcset',next)}};new MutationObserver(ms=>{for(const m of ms){if(m.type==='attributes')rewrite(m.target);for(const n of m.addedNodes){rewrite(n);if(n instanceof Element)n.querySelectorAll('*').forEach(rewrite)}}}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['target','formtarget','action','background','cite','data','formaction','href','manifest','poster','src','srcset']});const followLink=e=>{if(e.type==='auxclick'&&e.button!==1)return;const a=e.composedPath().find(n=>n instanceof Element&&n.matches('a[href],area[href]'));if(!a)return;sa.call(a,'target','_self');const h=a.getAttribute('href');if(h!=null&&!a.hasAttribute('download')){e.preventDefault();location.href=p(h)}};document.addEventListener('click',followLink,true);document.addEventListener('auxclick',followLink,true);document.addEventListener('submit',e=>{if(e.target instanceof HTMLFormElement){sa.call(e.target,'target','_self');if(e.submitter)sa.call(e.submitter,'formtarget','_self')}},true);window.addEventListener('popstate',tell);window.addEventListener('message',e=>{const m=e.data;if(!m||m.type!=='mew-browser-command')return;if(m.command==='back')history.back();else if(m.command==='forward')history.forward();else if(m.command==='reload')location.reload();else if(m.command==='stop')window.stop();else if(m.command==='navigate'&&typeof m.url==='string')location.href=p(m.url)},false);addEventListener('DOMContentLoaded',tell);addEventListener('load',tell);new MutationObserver(tell).observe(document.querySelector('title')??document.documentElement,{subtree:true,childList:true,characterData:true});tell()})();</script>`
}

/** Next.js App Router처럼 `location.pathname`을 읽어 basePath를 만드는 앱이 iframe의 내부 프록시 경로를
 * 자기 URL이라고 오인하지 않게 한다. 실제 navigation은 계속 같은-origin Mew 프록시 경로로만 보낸다. */
function browserLocationGuard(target: URL, browserToken: string): string {
  const config = JSON.stringify({ token: browserToken, virtualUrl: target.toString(), httpPrefix: BROWSER_PROXY_PREFIX }).replace(/</g, '\\u003c')
  return `<script>(()=>{const c=${config};let v=new URL(c.virtualUrl);globalThis.__mewBrowserVirtualUrl=v.toString();const current=()=>{try{return new URL(globalThis.__mewBrowserVirtualUrl||v)}catch{return v}};const enc=s=>btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');const toProxy=u=>c.httpPrefix+'/'+enc(u.origin)+'/'+c.token+u.pathname+u.search+u.hash;const set=(key,x)=>{try{if(key==='href'&&String(x).startsWith(c.httpPrefix+'/'))return String(x);const n=current();if(key==='href')v=new URL(String(x),n);else{n[key]=String(x);v=n}globalThis.__mewBrowserVirtualUrl=v.toString();return toProxy(v)}catch{return String(x)}};for(const key of ['href','origin','protocol','host','hostname','port','pathname','search','hash'])try{const d=Object.getOwnPropertyDescriptor(Location.prototype,key);if(!d?.get)continue;Object.defineProperty(Location.prototype,key,{configurable:true,enumerable:d.enumerable,get(){return current()[key]},...(d.set?{set(x){return d.set.call(this,set(key,x))}}:{})})}catch{}for(const key of ['URL','baseURI'])try{Object.defineProperty(Document.prototype,key,{configurable:true,get(){return current().toString()}})}catch{}})();</script>`
}

/**
 * SPA router가 iframe의 실제 Mew 경로를 기준으로 client-side navigation 하지 않게 한다.
 * 일반 링크는 항상 프록시의 새 문서 요청으로 보낸다. 따라서 Next 등의 basePath 추측과
 * 관계없이 대상 localhost 앱의 실제 라우트를 다시 받아 렌더링한다.
 */
function browserDocumentNavigationGuard(target: URL, browserToken: string): string {
  const config = JSON.stringify({ token: browserToken, virtualUrl: target.toString(), httpPrefix: BROWSER_PROXY_PREFIX }).replace(/</g, '\\u003c')
  return `<script>(()=>{const c=${config};const enc=s=>btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');const p=u=>{try{if(String(u).startsWith(c.httpPrefix+'/'))return String(u);const x=new URL(String(u),c.virtualUrl);return /^https?:$/.test(x.protocol)?c.httpPrefix+'/'+enc(x.origin)+'/'+c.token+x.pathname+x.search+x.hash:String(u)}catch{return String(u)}};document.addEventListener('click',e=>{if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;const a=e.target?.closest?.('a[href],area[href]');if(!a||a.hasAttribute('download'))return;const h=a.getAttribute('href'),t=a.getAttribute('target');if(!h||/^(?:#|javascript:|mailto:|tel:)/i.test(h)||(t&&t!=='_self'))return;e.preventDefault();e.stopImmediatePropagation();location.href=p(h)},true)})();</script>`
}

/**
 * Next는 초기화 중 현재 `history` URL을 한 번 다시 기록한다. iframe의 실제 URL은
 * `/__mew_browser/<origin>/<token>/…`이므로, 이를 그대로 넘기면 Next가 그 prefix를
 * 자기 basePath로 기억한다. history 경계에서 대상 앱의 상대 경로로 되돌린다.
 */
function browserHistoryGuard(): string {
  return `<script>(()=>{const prefix='${BROWSER_PROXY_PREFIX}/';const unwrap=u=>{try{const x=new URL(String(u),'http://mew.invalid');if(!x.pathname.startsWith(prefix))return u;const parts=x.pathname.slice(prefix.length).split('/');if(parts.length<2||!parts[0]||!parts[1])return u;return '/'+parts.slice(2).join('/')+x.search+x.hash}catch{return u}};for(const name of ['pushState','replaceState']){const previous=history[name].bind(history);history[name]=(state,title,url)=>previous(state,title,url==null?url:unwrap(url))}})();</script>`
}

function browserInsertionGuard(target: URL, browserToken: string): string {
  const config = JSON.stringify({
    token: browserToken,
    virtualUrl: target.toString(),
    httpPrefix: BROWSER_PROXY_PREFIX,
  }).replace(/</g, '\\u003c')
  return `<script>(()=>{const c=${config};const enc=s=>btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');const p=u=>{try{if(typeof u!=='string'||u.startsWith(c.httpPrefix+'/'))return u;const x=new URL(u,c.virtualUrl);return /^https?:$/.test(x.protocol)?c.httpPrefix+'/'+enc(x.origin)+'/'+c.token+x.pathname+x.search+x.hash:u}catch{return u}};const rewrite=n=>{if(!(n instanceof Element))return;for(const k of ['action','background','cite','data','formaction','href','manifest','poster','src']){const v=n.getAttribute(k);if(v!=null)n.setAttribute(k,p(v))}n.querySelectorAll('*').forEach(rewrite)};for(const k of ['appendChild','insertBefore','replaceChild']){const f=Node.prototype[k];try{Object.defineProperty(Node.prototype,k,{configurable:true,value:function(n,...a){rewrite(n);return f.call(this,n,...a)}})}catch{}}})();</script>`
}

function attribute(element: DefaultTreeAdapterTypes.Element, name: string): string | null {
  return element.attrs.find((item) => item.name === name)?.value ?? null
}

function rewriteHtml(
  text: string,
  target: URL,
  browserToken: string,
  cookies: Record<string, string>,
  localStorage: StorageArea,
  sessionStorage: StorageArea,
): string {
  const document = parse(text)
  let head: DefaultTreeAdapterTypes.Element | null = null

  const walk = (node: DefaultTreeAdapterTypes.Node): void => {
    if ('tagName' in node) {
      if (node.tagName === 'head') head = node
      const httpEquiv = attribute(node, 'http-equiv')?.toLowerCase()
      node.attrs = node.attrs.filter((item) => {
        if (item.name === 'integrity' || item.name === 'nonce') return false
        if (node.tagName === 'meta' && httpEquiv === 'content-security-policy') return false
        return true
      })
      for (const item of node.attrs) {
        if (URL_ATTRIBUTES.has(item.name)) item.value = rewriteUrl(item.value, target, browserToken)
        else if (item.name === 'srcset') item.value = rewriteSrcset(item.value, target, browserToken)
        else if (item.name === 'style') item.value = rewriteCss(item.value, target, browserToken)
        else if (node.tagName === 'meta' && item.name === 'content' && httpEquiv === 'refresh') {
          item.value = item.value.replace(/(url\s*=\s*)([^;]+)/i, (_match, start: string, url: string) => `${start}${rewriteUrl(url.trim().replace(/^['"]|['"]$/g, ''), target, browserToken)}`)
        }
      }
      if (node.tagName === 'style') {
        for (const child of node.childNodes) {
          if ('value' in child) child.value = rewriteCss(child.value, target, browserToken)
        }
      }
      if ('content' in node) walk(node.content)
    }
    if ('childNodes' in node) for (const child of node.childNodes) walk(child)
  }
  walk(document)

  const documentHead = head as DefaultTreeAdapterTypes.Element | null
  if (!documentHead) throw new BrowserProxyError('HTML 문서에 head를 만들 수 없습니다', 502)
  const fragment = parseFragment(
    `${browserDocumentNavigationGuard(target, browserToken)}${browserLocationGuard(target, browserToken)}${browserGuard(target, browserToken, cookies, localStorage, sessionStorage)}${browserHistoryGuard()}${browserInsertionGuard(target, browserToken)}`,
  )
  for (const guard of [...fragment.childNodes].reverse()) {
    guard.parentNode = documentHead
    documentHead.childNodes.unshift(guard)
  }
  return serialize(document)
}

function rewriteXml(text: string, target: URL, browserToken: string): string {
  return rewriteCss(text, target, browserToken).replace(
    /(\b(?:href|src|action|poster|data)\s*=\s*)(["'])([^"']+)(\2)/gi,
    (_match, start: string, quote: string, url: string) => `${start}${quote}${rewriteUrl(url, target, browserToken)}${quote}`,
  )
}

async function visibleCookies(jar: CookieJar, target: URL): Promise<Record<string, string>> {
  const cookies = await jar.getCookies(target.toString())
  return Object.fromEntries(cookies.filter((cookie) => !cookie.httpOnly).map((cookie) => [cookie.key, cookie.value]))
}

async function rememberResponseCookies(upstream: Response, target: URL, session: BrowserSession): Promise<void> {
  for (const value of upstream.headers.getSetCookie()) {
    await session.jar.setCookie(value, target.toString(), { ignoreError: true })
  }
}

async function rewriteBody(
  buffer: Buffer,
  contentType: string,
  target: URL,
  browserToken: string,
  session: BrowserSession,
): Promise<Buffer | string> {
  const text = buffer.toString('utf8')
  if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
    return rewriteHtml(
      text,
      target,
      browserToken,
      await visibleCookies(session.jar, target),
      storageSnapshot(session.localStorage, target.origin),
      storageSnapshot(session.sessionStorage, target.origin),
    )
  }
  if (contentType.includes('text/css')) return rewriteCss(text, target, browserToken)
  // Next는 runtime이 만든 script/link URL을 이미 guard가 가로채게 한다. 개발용
  // chunk에는 source map의 sourcesContent까지 들어 있어 일반 import 정규식으로
  // 재작성하면 실제 코드와 무관한 source map 문자열을 대량 변형한다. hydration
  // 오류를 피하려고 Next 정적 chunk는 원문을 그대로 보낸다.
  if (contentType.includes('javascript') || contentType.includes('ecmascript')) {
    if (target.pathname.startsWith('/_next/')) return buffer
    return rewriteJavascript(text, target, browserToken)
  }
  if (contentType.includes('xml') || contentType.includes('svg')) return rewriteXml(text, target, browserToken)
  return buffer
}

function rewriteRefresh(value: string, target: URL, browserToken: string): string {
  return value.replace(/(url\s*=\s*)(.*)$/i, (_match, start: string, url: string) => `${start}${rewriteUrl(url.trim().replace(/^['"]|['"]$/g, ''), target, browserToken)}`)
}

async function proxyRequest(
  req: express.Request,
  res: express.Response,
  target: URL,
  verified: VerifiedBrowserToken,
  sandbox: boolean,
): Promise<void> {
  const cookie = await verified.session.jar.getCookieString(target.toString())
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : (req as unknown as ReadableStream)
  const upstream = await fetch(target, {
    method: req.method,
    headers: requestHeaders(req, verified.payload.pageOrigin, cookie),
    body,
    duplex: body ? 'half' : undefined,
    redirect: 'manual',
  } as RequestInit & { duplex?: 'half' })

  await rememberResponseCookies(upstream, target, verified.session)
  copyResponseHeaders(upstream, req, res, sandbox, target.origin, verified.payload.pageOrigin)

  const navigation = isNavigation(req)
  const location = upstream.headers.get('location')
  if (location && upstream.status >= 300 && upstream.status < 400) {
    const next = new URL(location, target)
    assertSessionTarget(next, verified.session)
    const nextToken = navigation ? tokenForPage(verified, next.origin) : tokenForPage(verified, verified.payload.pageOrigin)
    res.setHeader('Location', proxyPath(next, nextToken))
  }
  const refresh = upstream.headers.get('refresh')
  if (refresh) res.setHeader('Refresh', rewriteRefresh(refresh, target, tokenForPage(verified, verified.payload.pageOrigin)))

  res.status(upstream.status)
  if (req.method === 'HEAD' || upstream.status === 204 || upstream.status === 304) {
    res.end()
    return
  }
  const contentType = upstream.headers.get('content-type') ?? ''
  const buffer = Buffer.from(await upstream.arrayBuffer())
  res.send(await rewriteBody(buffer, contentType, target, tokenForPage(verified, verified.payload.pageOrigin), verified.session))
}

function tokenMatchesAuthenticatedAccount(req: express.Request, verified: VerifiedBrowserToken): boolean {
  const auth = authOf(req)
  // iframe sandbox와 브라우저의 third-party-cookie 정책 때문에, 후속 resource
  // 요청에는 Mew 세션 cookie가 없을 수 있다. 서명된 짧은 URL 자체를 capability로
  // 쓰되, 다른 Mew 계정의 cookie가 제시되면 명시적으로 거부한다.
  if (!auth.email) return true
  return (
    (canUse(auth, 'browser') || canUse(auth, 'android')) &&
    accountHash(auth.email) === verified.session.accountHash
  )
}

function proxyError(res: express.Response, error: unknown, targetLabel = '주소'): void {
  if (error instanceof BrowserProxyError) {
    res.status(error.status).type('text/plain').send(error.message)
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  res.status(502).type('text/plain').send(`${targetLabel}에 연결할 수 없습니다: ${message}`)
}

function storageSize(area: StorageArea): number {
  return Buffer.byteLength(JSON.stringify(area), 'utf8')
}

async function browserControl(req: express.Request, res: express.Response): Promise<void> {
  corsHeaders(req, res)
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token
  const verified = verifyBrowserToken(token ?? null)
  if (!verified || !tokenMatchesAuthenticatedAccount(req, verified)) {
    res.status(403).type('text/plain').send('브라우저 토큰이 없거나 만료되었습니다')
    return
  }
  let message: unknown
  try {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    const raw = Buffer.concat(chunks)
    if (raw.byteLength > 64 * 1024) throw new Error('too large')
    message = JSON.parse(raw.toString('utf8'))
  } catch {
    res.status(400).type('text/plain').send('브라우저 저장 요청이 올바르지 않습니다')
    return
  }
  if (!message || typeof message !== 'object') {
    res.status(400).end()
    return
  }
  const value = message as Record<string, unknown>
  try {
    const target = new URL(String(value.url ?? ''))
    assertSessionTarget(target, verified.session)
    if (target.origin !== verified.payload.pageOrigin) throw new BrowserProxyError('다른 origin의 저장소를 바꿀 수 없습니다', 403)
    if (value.kind === 'cookie' && typeof value.cookie === 'string' && value.cookie.length <= 4096) {
      await verified.session.jar.setCookie(value.cookie, target.toString(), { ignoreError: true })
    } else if (value.kind === 'storage' && (value.area === 'local' || value.area === 'session')) {
      const areas = value.area === 'local' ? verified.session.localStorage : verified.session.sessionStorage
      const next = { ...(areas.get(target.origin) ?? {}) }
      if (value.op === 'clear') {
        areas.delete(target.origin)
      } else if (typeof value.key === 'string' && value.key.length <= 1024 && value.op === 'remove') {
        delete next[value.key]
        areas.set(target.origin, next)
      } else if (typeof value.key === 'string' && value.key.length <= 1024 && value.op === 'set' && typeof value.value === 'string') {
        next[value.key] = value.value
        if (storageSize(next) > MAX_STORAGE_BYTES) throw new BrowserProxyError('브라우저 저장 공간이 가득 찼습니다', 413)
        areas.set(target.origin, next)
      } else {
        throw new BrowserProxyError('브라우저 저장 요청이 올바르지 않습니다')
      }
    } else {
      throw new BrowserProxyError('브라우저 저장 요청이 올바르지 않습니다')
    }
    res.status(204).end()
  } catch (error) {
    proxyError(res, error, '브라우저 저장소')
  }
}

export function browserProxyFrameUrl(
  rawUrl: string,
  account: string,
  options: { httpsHosts?: readonly string[] } = {},
): string {
  const url = new URL(rawUrl)
  if (!account.trim()) throw new BrowserProxyError('브라우저 계정이 없습니다', 403)
  if (!options.httpsHosts?.length) assertLoopbackTarget(url)
  else assertTargetForHosts(url, options.httpsHosts)
  const created = createSession(account, options.httpsHosts)
  const token = createBrowserToken(created.id, url.origin, created.session.expiresAt)
  return proxyPath(url, token)
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
    const auth = resolveAuth(req)
    if (auth.mustChangePassword || (!canUse(auth, 'browser') && !canUse(auth, 'android')) || !auth.email) {
      res.status(403).type('text/plain').send('권한이 없습니다')
      return
    }

    if (!browserToken) {
      const created = createSession(auth.email)
      const token = createBrowserToken(created.id, origin, created.session.expiresAt)
      res.redirect(302, `/${port}/~${token}${rest}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`)
      return
    }

    const verified = verifyBrowserToken(browserToken)
    if (!verified || verified.payload.pageOrigin !== origin || accountHash(auth.email) !== verified.session.accountHash) {
      res.status(403).type('text/plain').send('브라우저 토큰이 없거나 만료되었습니다')
      return
    }

    try {
      const target = new URL(`${rest}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`, origin)
      assertLoopbackTarget(target)
      await proxyRequest(req, res, target, verified, true)
    } catch (error) {
      proxyError(res, error, 'localhost')
    }
  }
}

export function createBrowserProxyApp(): express.Express {
  const app = express()
  app.post('/_control/:token', (req, res) => { void browserControl(req, res) })
  app.use(async (req, res) => {
    try {
      const parsed = parseProxyPath(`${BROWSER_PROXY_PREFIX}${req.url}`, BROWSER_PROXY_PREFIX, new Set(['http:', 'https:']))
      const verified = verifyBrowserToken(parsed.browserToken)
      if (!verified || !tokenMatchesAuthenticatedAccount(req, verified)) {
        res.status(403).type('text/plain').send('브라우저 토큰이 없거나 만료되었습니다')
        return
      }
      assertSessionTarget(parsed.target, verified.session)
      if (isNavigation(req) && parsed.target.origin !== verified.payload.pageOrigin) {
        const token = tokenForPage(verified, parsed.target.origin)
        res.redirect(req.method === 'GET' || req.method === 'HEAD' ? 302 : 307, proxyPath(parsed.target, token))
        return
      }
      await proxyRequest(req, res, parsed.target, verified, true)
    } catch (error) {
      proxyError(res, error)
    }
  })
  return app
}

function socketCookieUrl(target: URL): string {
  const next = new URL(target)
  next.protocol = target.protocol === 'wss:' ? 'https:' : 'http:'
  return next.toString()
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

function canForwardCloseCode(code: number): boolean {
  return code === 1000 || (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) || (code >= 3000 && code <= 4999)
}

export function attachBrowserProxyWebSocket(
  httpServer: HttpServer | Http2SecureServer,
  opts: { account: (req: IncomingMessage) => string | null },
): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 })
  httpServer.on('upgrade', (req, socket: Duplex, head: Buffer) => {
    const requestUrl = new URL(req.url ?? '', 'http://mew.invalid')
    if (!requestUrl.pathname.startsWith(`${BROWSER_PROXY_WS_PREFIX}/`)) return
    let parsed: ReturnType<typeof parseProxyPath>
    try {
      parsed = parseProxyPath(req.url ?? '', BROWSER_PROXY_WS_PREFIX, new Set(['ws:', 'wss:']))
    } catch {
      rejectUpgrade(socket, 400, 'Bad Request')
      return
    }
    const verified = verifyBrowserToken(parsed.browserToken)
    const account = opts.account(req)
    // HTTP resource proxy와 같은 이유로 Mew cookie가 없는 sandbox WebSocket도
    // 서명 URL capability로 이어 준다. 다른 로그인 계정이 보이면 차단한다.
    if (!verified || (account && accountHash(account) !== verified.session.accountHash)) {
      rejectUpgrade(socket, 403, 'Forbidden')
      return
    }
    try {
      const httpTarget = new URL(parsed.target)
      httpTarget.protocol = parsed.target.protocol === 'wss:' ? 'https:' : 'http:'
      assertSessionTarget(httpTarget, verified.session)
    } catch {
      rejectUpgrade(socket, 403, 'Forbidden')
      return
    }

    wss.handleUpgrade(req, socket, head, (client) => {
      const revoked = () => client.terminate()
      accessChanges.on('change', revoked)
      client.once('close', () => accessChanges.off('change', revoked))
      const protocols = typeof req.headers['sec-websocket-protocol'] === 'string'
        ? req.headers['sec-websocket-protocol'].split(',').map((value) => value.trim()).filter(Boolean)
        : []
      const queued: Array<{ data: Buffer; binary: boolean }> = []
      let queuedBytes = 0
      let upstream: WebSocket | null = null

      client.on('message', (data, binary) => {
        const buffer = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
        if (upstream?.readyState === WebSocket.OPEN) upstream.send(buffer, { binary })
        else if (queuedBytes + buffer.byteLength <= 1024 * 1024) {
          queued.push({ data: buffer, binary })
          queuedBytes += buffer.byteLength
        } else client.close(1009, 'upstream is not ready')
      })
      client.on('close', (code, reason) => {
        if (upstream?.readyState === WebSocket.OPEN && canForwardCloseCode(code)) upstream.close(code, reason.toString().slice(0, 120))
        else upstream?.terminate()
      })
      client.on('error', () => upstream?.terminate())

      void verified.session.jar.getCookieString(socketCookieUrl(parsed.target)).then((cookie) => {
        const headers: Record<string, string> = { Origin: verified.payload.pageOrigin }
        if (cookie) headers.Cookie = cookie
        if (typeof req.headers['user-agent'] === 'string') headers['User-Agent'] = req.headers['user-agent']
        upstream = new WebSocket(parsed.target, protocols, { headers, maxPayload: 16 * 1024 * 1024 })
        upstream.on('open', () => {
          for (const item of queued) upstream?.send(item.data, { binary: item.binary })
          queued.length = 0
        })
        upstream.on('message', (data, binary) => {
          if (client.readyState === WebSocket.OPEN) client.send(data, { binary })
        })
        upstream.on('close', (code, reason) => {
          if (client.readyState === WebSocket.OPEN && canForwardCloseCode(code)) client.close(code, reason.toString().slice(0, 120))
          else if (client.readyState === WebSocket.OPEN) client.terminate()
        })
        upstream.on('error', () => {
          if (client.readyState === WebSocket.OPEN) client.close(1011, 'upstream websocket failed')
        })
      }).catch(() => client.close(1011, 'upstream websocket failed'))
    })
  })
}
