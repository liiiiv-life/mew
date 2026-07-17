import type { Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApiApp } from './api'
import { attachTmuxWebSocket } from './tmuxWs'
import { attachPresenceWebSocket } from './presence'

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env')
if (fs.existsSync(envPath)) process.loadEnvFile(envPath)

export function docsApiPlugin(): Plugin {
  return {
    name: 'docs-api',
    configureServer(server) {
      server.middlewares.use('/api', createApiApp())
      // 5000(편집용) 서버에만 연결 — tmux는 셸 접근이라 게스트 터널(5001, configurePreviewServer)에
      // 노출되면 안 된다. httpServer는 미들웨어 모드(server.middlewares만 쓰는 임베딩)에선 null일 수 있음.
      if (server.httpServer) {
        attachTmuxWebSocket(server.httpServer)
        attachPresenceWebSocket(server.httpServer)
      }
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api', createApiApp({ readOnly: true }))
      // 의도적으로 attachTmuxWebSocket을 붙이지 않음 — 5001은 cloudflare tunnel로 게스트에게 노출됨
      // presence는 셸 접근이 아니라 "누가 이 문서를 열어뒀는지" 카운트일 뿐이라 게스트 쪽에도 붙인다
      attachPresenceWebSocket(server.httpServer)
    },
  }
}
