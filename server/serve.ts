import './config.ts'
import { createRemoteAgent } from './remote-access-agent.ts'
import { watchSocketAccess } from './access-socket.ts' // 반드시 첫 줄 — 다른 모듈이 상수를 계산하기 전에 설정 파일을 읽어야 한다
import { attachDomBrowserWebSocket, closeDomBrowsers, DOM_BROWSER_WS } from './browser-dom.ts'
import { attachRemoteDesktopWebSocket, DESKTOP_WS } from './remote-desktop.ts'
import express from 'express'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { createApiApp } from './api.ts'
import { BROWSER_PROXY_WS_PREFIX, attachBrowserProxyWebSocket, createBrowserPortProxyMiddleware, createBrowserProxyApp } from './browserProxy.ts'
import { createAuthRouter, checkOrigin } from './authRoutes.ts'
import { attachAuthContext, resolveAuth, authorizeTmux, authorizeCollab, authorizeFeature, authorizeDatabase } from './reqAuth.ts'
import { attachTmuxWebSocket } from '@mew/tmux-term/server'
import { WORKSPACE_ROOT } from './paths.ts'
import { attachPresenceWebSocket } from './presence.ts'
import { attachCollabWebSocket } from './collab.ts'
import { attachCollabAgents } from './collabAgent.ts'
import { attachDbWebSocket } from './db/socket.ts'
import { attachAgentWebSocket, AGENT_WS_PATH } from './agentWs.ts'
import { disposeAllSessions, reapOrphanAgents } from './agentAcp.ts'
import { startAgentScheduledPrompts } from './agentScheduledPrompts.ts'
import { purgeForbiddenAgentEnv } from './agentSettings.ts'
import { watchDocsTree } from './watcher.ts'

// 프로덕션 서버 — `npm run build` 후 `npm run serve`.
// 단일 서버(5000) — 로그인 없이 접속하면 게스트(뷰어), 로그인하면 owner/manager/member.
// 게스트가 무엇을 보고 편집할 수 있는지는 guestAccess.ts의 경로별 승인 규칙이 결정한다.
// dev(HMR)는 vite가 4999에서 따로 담당하며(server/plugin.ts) 동일한 인증 체계를 공유한다.

// 크래시 가드 — 이 서버엔 supervisor가 없어서 한 번 프로세스가 죽으면 재기동이 안 되고, 그러면
// 사용자는 재접속해도 "failed to fetch"만 본다. 에이전트 SDK 쿼리 한 건의 미처리 거부/예외가
// 서버 전체를 끌어내리지 않도록 최상단에서 잡아 로그만 남기고 계속 돈다. (라우트별 try/catch가
// 정상 경로를 이미 처리하므로, 여기 걸리는 건 비동기 경계를 넘어 새어나온 예외뿐이다.)
process.on('unhandledRejection', (reason) => {
  console.error('[mew] unhandledRejection (무시하고 계속):', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[mew] uncaughtException (무시하고 계속):', err)
})

// 이 프로세스가 직접 소유한 일회성 세션만 정리한다. 에이전트 탭은 별도 감독 프로세스가
// 소유하므로 mew 종료·재시작과 함께 접지 않는다. 신호 처리 뒤에는 직접 나가야 한다.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.once(signal, () => {
    disposeAllSessions()
    void closeDomBrowsers().finally(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  })
}

const here = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(here, '../dist')
const INDEX_HTML = path.join(DIST, 'index.html')
if (!fs.existsSync(INDEX_HTML)) {
  console.error('dist/index.html이 없습니다 — 먼저 `npm run build`를 실행하세요')
  process.exit(1)
}

const PORT = Number(process.env.MEW_TEAM_PORT ?? 5000)

function securityHeaders(req: express.Request, res: express.Response, next: express.NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=()')
  // index.html의 Google Fonts CSS와 해당 CSS가 참조하는 폰트 파일만 외부 출처로 허용한다.
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; connect-src 'self' ws: wss:; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; object-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; worker-src 'self' blob:")
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  next()
}

function addStaticAndSpaFallback(app: express.Express) {
  // vite가 해시를 붙이는 /assets는 영구 캐시, 그 외(index.html 등)는 항상 재검증
  app.use('/assets', express.static(path.join(DIST, 'assets'), { immutable: true, maxAge: '30d' }))
  app.use(express.static(DIST, { index: false }))
  app.use((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(404).end()
      return
    }
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(INDEX_HTML)
  })
}

/** tmux·presence·collab이 처리하지 않은 업그레이드 요청이 매달려 있지 않도록 끊는다 (vite와 달리 HMR이 없다) */
function destroyUnknownUpgrades(server: http.Server, knownPaths: string[]) {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    if (!knownPaths.some((path) => path.endsWith('/') ? url.pathname.startsWith(path) : url.pathname === path)) socket.destroy()
  })
}

const app = express()
const server = http.createServer(app)
const remoteAgent = createRemoteAgent(server)
app.disable('x-powered-by')
app.use(securityHeaders)
app.use(createBrowserPortProxyMiddleware())
app.use('/__mew_browser', attachAuthContext, createBrowserProxyApp())
app.use(checkOrigin)
app.use('/api/auth', createAuthRouter())
app.use('/api/remote-access', attachAuthContext, remoteAgent.router)
app.use('/api', attachAuthContext, createApiApp())
addStaticAndSpaFallback(app)

attachTmuxWebSocket(server, { cwd: WORKSPACE_ROOT, authorize: authorizeTmux, onConnection: (ws, req) => watchSocketAccess(ws, req, authorizeTmux) })
attachPresenceWebSocket(server, { getAuth: resolveAuth })
attachCollabWebSocket(server, { authorize: authorizeCollab })
attachDbWebSocket(server, { authorize: authorizeFeature('database'), authorizeProject: authorizeDatabase })
// 에이전트는 셸을 쓸 수 있다 — 게이트가 tmux와 같은 집합(owner/manager)이어야 한다
attachAgentWebSocket(server, { authorize: authorizeFeature('agent') })
attachDomBrowserWebSocket(server)
attachRemoteDesktopWebSocket(server)
attachBrowserProxyWebSocket(server, {
  account: (req) => {
    const auth = resolveAuth(req)
    return (authorizeFeature('browser')(req) || authorizeFeature('android')(req)) ? auth.email : null
  },
})
destroyUnknownUpgrades(server, [
  '/api/tmux/ws',
  '/api/presence',
  '/api/collab',
  '/api/db/ws',
  AGENT_WS_PATH,
  DOM_BROWSER_WS,
  DESKTOP_WS,
  `${BROWSER_PROXY_WS_PREFIX}/`,
])

// 공개 경계 전환 전의 OAuth bearer token은 다음 spawn에 절대 넘기지 않고 파일에서도 지운다.
if (purgeForbiddenAgentEnv()) console.warn('[mew] 저장된 공급자 OAuth token을 제거했습니다')

// 지난 실행이 SIGKILL로 끊겼다면 그때 남은 에이전트 자식이 아직 램을 물고 있다
reapOrphanAgents()
startAgentScheduledPrompts()

// AI가 터미널에서 직접 고친 파일을 열려 있는 협업 방에 'agent' 협업자로 실시간 주입한다
attachCollabAgents()
watchDocsTree()

// 공개 기본값은 loopback이다. LAN 직접 공개가 정말 필요할 때만 MEW_BIND를 명시한다.
const BIND = process.env.MEW_BIND || '127.0.0.1'

server.listen(PORT, BIND, () => {
  console.log(`[mew] 서버: http://${BIND}:${PORT} (미로그인 = 게스트)`)
})
