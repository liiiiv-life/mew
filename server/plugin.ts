import './config.ts' // 반드시 첫 줄 — 설정 파일을 다른 모듈보다 먼저 읽는다
import type { Plugin } from 'vite'
import express from 'express'
import { createApiApp } from './api.ts'
import { createBrowserPortProxyMiddleware, createBrowserProxyApp } from './browserProxy.ts'
import { createAuthRouter, checkOrigin } from './authRoutes.ts'
import { attachAuthContext, resolveAuth, authorizeTmux, authorizeCollab } from './reqAuth.ts'
import { attachTmuxWebSocket } from '@mew/tmux-term/server'
import { WORKSPACE_ROOT } from './paths.ts'
import { attachPresenceWebSocket } from './presence.ts'
import { attachCollabWebSocket } from './collab.ts'
import { attachCollabAgents } from './collabAgent.ts'
import { attachDbWebSocket } from './db/socket.ts'
import { attachAgentWebSocket } from './agentWs.ts'
import { attachAgentSetWebSocket } from './agentSetWs.ts'
import { reapOrphanAgents } from './agentAcp.ts'
import { watchDocsTree } from './watcher.ts'

export function docsApiPlugin(): Plugin {
  return {
    name: 'docs-api',
    configureServer(server) {
      // 5000(server/serve.ts)과 동일한 인증 체계 — 미로그인 = 게스트, 로그인하면 owner/manager/member.
      // checkOrigin·attachAuthContext는 Express Response 확장(res.status 등)에 의존하므로 connect
      // 미들웨어로 낱개 등록하지 않고 하나의 Express 앱으로 묶어 mount한다.
      const app = express()
      app.use(checkOrigin)
      app.use(createBrowserPortProxyMiddleware())
      app.use('/__mew_browser', attachAuthContext, createBrowserProxyApp())
      app.use('/api/auth', createAuthRouter())
      app.use('/api', attachAuthContext, createApiApp())
      server.middlewares.use(app)
      // httpServer는 미들웨어 모드(server.middlewares만 쓰는 임베딩)에선 null일 수 있음.
      // destroyUnknownUpgrades는 쓰지 않는다 — vite 자신의 HMR 업그레이드까지 끊어버리기 때문.
      if (server.httpServer) {
        attachTmuxWebSocket(server.httpServer, { cwd: WORKSPACE_ROOT, authorize: authorizeTmux })
        attachPresenceWebSocket(server.httpServer, { getAuth: resolveAuth })
        attachCollabWebSocket(server.httpServer, { authorize: authorizeCollab })
        attachDbWebSocket(server.httpServer, { authorize: authorizeCollab })
        attachAgentWebSocket(server.httpServer, { authorize: authorizeTmux })
        attachAgentSetWebSocket(server.httpServer, { authorize: authorizeTmux })
        // 지난 실행이 SIGKILL로 끊겼다면 그때 남은 에이전트 자식이 아직 램을 물고 있다
        reapOrphanAgents()
        // AI가 터미널에서 직접 고친 파일을 열려 있는 협업 방에 'agent' 협업자로 실시간 주입한다
        attachCollabAgents()
        watchDocsTree()
      }
    },
  }
}
