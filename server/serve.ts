import './config.ts' // 반드시 첫 줄 — 다른 모듈이 상수를 계산하기 전에 설정 파일을 읽어야 한다
import express from 'express'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { createApiApp } from './api.ts'
import { createAuthRouter, checkOrigin } from './authRoutes.ts'
import { attachAuthContext, resolveAuth, authorizeTmux, authorizeCollab } from './reqAuth.ts'
import { attachTmuxWebSocket } from '@mew/tmux-term/server'
import { WORKSPACE_ROOT } from './paths.ts'
import { attachPresenceWebSocket } from './presence.ts'
import { attachCollabWebSocket } from './collab.ts'
import { attachCollabAgents } from './collabAgent.ts'
import { attachDbWebSocket } from './db/socket.ts'
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

const here = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(here, '../dist')
const INDEX_HTML = path.join(DIST, 'index.html')
if (!fs.existsSync(INDEX_HTML)) {
  console.error('dist/index.html이 없습니다 — 먼저 `npm run build`를 실행하세요')
  process.exit(1)
}

const PORT = Number(process.env.MEW_TEAM_PORT ?? 5000)

function securityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'same-origin')
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
    if (!knownPaths.includes(url.pathname)) socket.destroy()
  })
}

const app = express()
app.disable('x-powered-by')
app.use(securityHeaders)
app.use(checkOrigin)
app.use('/api/auth', createAuthRouter())
app.use('/api', attachAuthContext, createApiApp())
addStaticAndSpaFallback(app)

const server = http.createServer(app)
attachTmuxWebSocket(server, { cwd: WORKSPACE_ROOT, authorize: authorizeTmux })
attachPresenceWebSocket(server, { getAuth: resolveAuth })
attachCollabWebSocket(server, { authorize: authorizeCollab })
attachDbWebSocket(server, { authorize: authorizeCollab })
destroyUnknownUpgrades(server, ['/api/tmux/ws', '/api/presence', '/api/collab', '/api/db/ws'])

// AI가 터미널에서 직접 고친 파일을 열려 있는 협업 방에 'agent' 협업자로 실시간 주입한다
attachCollabAgents()
watchDocsTree()

// 기본은 모든 인터페이스 — 터널·다른 기기에서 붙는 것이 정상 사용이다.
// 이 컴퓨터에서만 쓰려면 MEW_BIND=127.0.0.1 (SECURITY.md §노출).
const BIND = process.env.MEW_BIND || '0.0.0.0'

server.listen(PORT, BIND, () => {
  console.log(`[mew] 서버: http://${BIND}:${PORT} (미로그인 = 게스트)`)
})
