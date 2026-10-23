type DemoEnvironment = {
  CENTRAL_ORIGIN: string
  APP_ORIGIN: string
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export const DEMO_USERNAME = 'demo'
export const DEMO_USERNAME_CONFLICT_QUERY = "SELECT account FROM usernames WHERE lower(username)='demo' UNION SELECT id AS account FROM accounts WHERE lower(username)='demo' LIMIT 1"

export function assertDemoUsernameAvailable(results: unknown) {
  if (!Array.isArray(results) || results.length !== 1 || results.some(result => !result || typeof result !== 'object' || result.success === false || !Array.isArray(result.results))) {
    throw new Error('데모 예약 이름 조회 결과를 확인하지 못했습니다. 배포를 중단합니다.')
  }
  if (results.some(result => result.results.length > 0)) {
    throw new Error('demo 유저이름 또는 이전 별칭을 사용하는 계정이 있습니다. 기존 계정을 변경하지 않고 배포를 중단합니다. 계정 소유자와 주소 이전을 먼저 처리하세요.')
  }
}

function htmlAttribute(value: string) {
  return value.replace(/[&"<>]/g, character => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[character]!)
}

function demoResponse(body: ConstructorParameters<typeof Response>[0], status: number, env: DemoEnvironment, app: boolean, extra?: ConstructorParameters<typeof Headers>[0]) {
  const headers = new Headers(extra)
  headers.set('Cache-Control', 'no-store, no-transform')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('Content-Security-Policy', app
    ? `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src ${env.APP_ORIGIN}/demo/; worker-src 'self' blob:; frame-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${env.CENTRAL_ORIGIN}`
    : `default-src 'none'; style-src 'unsafe-inline'; frame-src ${env.APP_ORIGIN}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`)
  return new Response(body, { status, headers })
}

function isStaticDemoPath(pathname: string) {
  let decoded: string
  try { decoded = decodeURIComponent(pathname) } catch { return false }
  if (decoded !== pathname || !pathname.startsWith('/demo/')) return false
  const segments = pathname.slice('/demo/'.length).split('/')
  if (segments.some(segment => !segment || segment.startsWith('.') || segment.includes('\\'))) return false
  return /\.(?:js|mjs|css|json|wasm|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg|ico|pdf|mp4|webm|txt|bin|mp3|ogg|wav|bmp)$/i.test(pathname)
}

export async function handleMewlinkDemo(request: Request, env: DemoEnvironment): Promise<Response | null> {
  const url = new URL(request.url), app = url.origin === env.APP_ORIGIN
  if (url.origin !== env.CENTRAL_ORIGIN && !app) return null
  if (url.pathname !== '/demo' && !url.pathname.startsWith('/demo/')) return null
  const head = request.method === 'HEAD'
  if (request.method !== 'GET' && !head) return demoResponse(null, 405, env, app, { Allow: 'GET, HEAD' })
  if (!app) {
    if (url.pathname === '/demo/') return demoResponse(null, 308, env, false, { Location: `${env.CENTRAL_ORIGIN}/demo${url.search}` })
    if (url.pathname !== '/demo') return demoResponse(null, 404, env, false)
    const frame = htmlAttribute(`${env.APP_ORIGIN}/demo/`)
    const body = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><title>Mew demo</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#18181b}iframe{display:block;width:100%;height:100dvh;border:0}</style></head><body><iframe src="${frame}" title="Mew demo" allow="clipboard-read; clipboard-write; fullscreen" sandbox="allow-scripts allow-same-origin allow-downloads allow-popups allow-popups-to-escape-sandbox"></iframe></body></html>`
    return demoResponse(head ? null : body, 200, env, false, { 'Content-Type': 'text/html; charset=utf-8' })
  }
  if (url.pathname === '/demo') return demoResponse(null, 308, env, true, { Location: `${env.APP_ORIGIN}/demo/${url.search}` })
  if (url.pathname !== '/demo/' && !isStaticDemoPath(url.pathname)) return demoResponse(null, 404, env, true)
  const response = await env.ASSETS.fetch(new Request(url, request))
  if (url.pathname === '/demo/' && response.status === 404) {
    return demoResponse(head ? null : '데모 화면을 준비 중입니다.', 503, env, true, { 'Content-Type': 'text/plain; charset=utf-8' })
  }
  return demoResponse(head ? null : response.body, response.status, env, true, response.headers)
}
