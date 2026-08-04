// 접속 즉시 동기화(unsolicited sync step2) e2e: 방에 붙은 클라이언트는 자기 step1을 보내지
// 않아도 synced가 되고 방의 현재 내용을 받아야 한다. 이 왕복 하나가 문서 열기 지연의 마지막
// 게이트라서(Editor.tsx가 collab.synced를 기다린다) 서버 쪽 step2를 지우면 여기서 걸린다.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { WebSocket as WsClient } from 'ws'
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { readSyncMessage, writeUpdate, messageYjsSyncStep1 } from 'y-protocols/sync'
import { attachCollabWebSocket } from './collab.ts'

const MESSAGE_SYNC = 0
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Client = { doc: Y.Doc; ws: WsClient; synced: () => boolean; close: () => void }

/**
 * useCollab.ts의 수신 처리만 옮긴 최소 클라이언트 — 단, step1을 **보내지 않는다**.
 * 서버가 요청 없이 상태를 밀어주는지만 보려면 클라이언트가 조용해야 한다.
 */
function join(port: number, room: string, opts: { push?: boolean } = {}): Promise<Client> {
  const doc = new Y.Doc()
  const remoteOrigin = Symbol('remote')
  let synced = false
  const ws = new WsClient(`ws://127.0.0.1:${port}/api/collab?room=${encodeURIComponent(room)}`)
  ws.binaryType = 'arraybuffer'

  const send = (data: Uint8Array) => {
    if (ws.readyState === WsClient.OPEN) ws.send(data)
  }

  ws.on('message', (raw: ArrayBuffer | Buffer) => {
    const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw)
    const decoder = decoding.createDecoder(bytes)
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    const type = readSyncMessage(decoder, encoder, doc, remoteOrigin)
    if (encoding.length(encoder) > 1) send(encoding.toUint8Array(encoder))
    if (type !== messageYjsSyncStep1) synced = true
  })

  // 자기 편집분을 방에 올려보내는 쪽(내용을 심는 클라이언트)만 필요하다
  if (opts.push) {
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === remoteOrigin) return
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      writeUpdate(encoder, update)
      send(encoding.toUint8Array(encoder))
    })
  }

  return new Promise((resolve, reject) => {
    ws.on('error', reject)
    ws.on('open', () => resolve({ doc, ws, synced: () => synced, close: () => ws.close() }))
  })
}

test('클라이언트가 step1을 보내지 않아도 접속만으로 synced가 되고 방 내용을 받는다', async () => {
  const server = http.createServer()
  attachCollabWebSocket(server as unknown as Parameters<typeof attachCollabWebSocket>[0])
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as { port: number }
  const room = `ztest${process.pid}:doc.md`

  const seeder = await join(port, room, { push: true })
  const passive: Client[] = []
  try {
    await sleep(30)
    assert.equal(seeder.synced(), true, '빈 방에서도 접속만으로 synced가 돼야 한다')

    seeder.doc.getText('t').insert(0, '시작 본문')
    await sleep(30)

    // 내용이 있는 방에 조용한 클라이언트가 뒤늦게 붙는다
    const late = await join(port, room)
    passive.push(late)
    await sleep(30)

    assert.equal(late.synced(), true, 'step1을 안 보낸 클라이언트도 synced가 돼야 한다')
    // 중복 없이 정확히 한 번 — step1 응답과 겹쳐 두 번 적용되면 '시작 본문시작 본문'이 된다
    assert.equal(late.doc.getText('t').toString(), '시작 본문')
  } finally {
    for (const c of passive) c.close()
    seeder.close()
    await new Promise<void>((r) => server.close(() => r()))
  }
})
