// 디스크→방 브리지 e2e: 외부(AI) 디스크 편집이 협업 방에 'agent' 협업자로 주입되고, 앱 자신의
// 자동저장(메아리)은 주입되지 않는지 확인한다.
//
// 브리지가 방의 doc을 붙들지 않고 프로토콜로만 말하게 된 뒤(ADR 0035)로는 가짜 방으로 검증할 수
// 없다 — 실제 WebSocket 서버 + 실제 클라이언트를 세워 collab.ts·syncCodec·roomDoc·브리지를 한
// 줄로 태운다. `MEW_COLLAB_RUST=1`로 돌리면 Rust 백엔드가 같은 검증을 받는다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import * as Y from 'yjs'
import { WebSocket } from 'ws'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import type { HttpServer } from 'vite'
import { WORKSPACE_ROOT } from './paths.ts'
import { attachCollabWebSocket } from './collab.ts'
import { attachCollabAgents } from './collabAgent.ts'
import { noteAppWrite } from './appWrites.ts'
import { SYNC_STEP1, decodeMessage, encodeAwarenessFrame, encodeSyncStep2, encodeSyncUpdate } from './syncCodec.ts'

const REMOTE = 'remote'
const withFm = (body: string) => `---\ntitle: "T"\n---\n\n${body}`
const fragText = (doc: Y.Doc) => doc.getXmlFragment('default').toString()

/** 조건이 참이 될 때까지 기다린다 — 에디터 모듈 로드·fs.watch·디바운스가 겹쳐 고정 sleep은 불안정하다 */
async function waitFor(label: string, ok: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (ok()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  assert.fail(`시간 초과: ${label}`)
}

/** 브라우저 클라이언트(src/hooks/useCollab.ts)와 같은 일을 하는 최소 협업 클라이언트 */
function connectClient(port: number, roomKey: string) {
  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/collab?room=${encodeURIComponent(roomKey)}`)

  ws.on('message', (raw: Buffer) => {
    const message = decodeMessage(new Uint8Array(raw))
    if (!message) return
    if (message.channel === 'awareness') {
      applyAwarenessUpdate(awareness, message.payload, REMOTE)
      return
    }
    if (message.syncType === SYNC_STEP1) {
      ws.send(encodeSyncStep2(Y.encodeStateAsUpdate(doc, message.payload)))
      return
    }
    Y.applyUpdate(doc, message.payload, REMOTE)
  })

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE || ws.readyState !== WebSocket.OPEN) return
    ws.send(encodeSyncUpdate(update))
  })
  awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === REMOTE || ws.readyState !== WebSocket.OPEN) return
    ws.send(encodeAwarenessFrame(encodeAwarenessUpdate(awareness, added.concat(updated, removed))))
  })

  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })

  /** 방에 보이는 'agent' 협업자 (원격 awareness 상태로 들어온다) */
  const agentSeen = () => {
    for (const state of awareness.getStates().values()) {
      const user = (state as { user?: { name?: string } } | null)?.user
      if (user?.name === 'agent') return true
    }
    return false
  }

  return { doc, awareness, ws, opened, agentSeen }
}

test('외부 디스크 편집은 agent로 방에 주입되고, 앱 메아리는 무시된다', async () => {
  const project = `ztest${process.pid}${Math.random().toString(36).slice(2, 6)}`
  const projectDir = path.join(WORKSPACE_ROOT, project)
  const absPath = path.join(projectDir, 'doc.md')
  const roomKey = `${project}:doc.md`

  fs.mkdirSync(projectDir, { recursive: true })
  fs.writeFileSync(absPath, withFm('시작 본문\n'), 'utf-8')

  const server = http.createServer()
  attachCollabWebSocket(server as unknown as HttpServer)
  attachCollabAgents()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port

  const client = connectClient(port, roomKey)
  try {
    await client.opened
    // 방이 열리면 브리지가 붙어 자기 커서를 올린다
    await waitFor("awareness에 'agent'가 뜬다", client.agentSeen)

    // ── 외부(AI) 편집 → 방에 주입 ──
    fs.writeFileSync(absPath, withFm('AI가 고친 한 줄\n'), 'utf-8')
    await waitFor('외부 편집이 클라이언트 doc까지 도달한다', () => fragText(client.doc).includes('AI가 고친 한 줄'))

    // ── 앱 자동저장(메아리) → 무시 ──
    const echo = withFm('앱이 저장한 다른 줄\n')
    noteAppWrite(absPath, echo) // 앱이 쓴 것으로 먼저 기록
    fs.writeFileSync(absPath, echo, 'utf-8')
    await new Promise((r) => setTimeout(r, 600)) // 주입될 시간을 충분히 준 뒤에 없음을 확인
    assert.ok(!fragText(client.doc).includes('앱이 저장한 다른 줄'), '앱 메아리는 방에 주입되면 안 된다')
    assert.ok(fragText(client.doc).includes('AI가 고친 한 줄'), '메아리 무시 후에도 이전 내용이 유지되어야 한다')
  } finally {
    client.ws.close()
    client.awareness.destroy()
    client.doc.destroy()
    // 마지막 실제 접속자가 나가면 방이 닫히고 브리지도 떨어진다 — 소켓 종료가 서버에 닿을 틈을 준다
    await new Promise((r) => setTimeout(r, 100))
    await new Promise<void>((resolve) => server.close(() => resolve()))
    fs.rmSync(projectDir, { recursive: true, force: true })
  }
})
