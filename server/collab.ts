import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { HttpServer } from 'vite'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as Y from 'yjs'
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'

const WS_PATH = '/api/collab'
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

interface Room {
  doc: Y.Doc
  awareness: Awareness
  // ws별로 자신이 소유한 awareness clientID들을 추적 — 연결이 끊기면 30초 타임아웃을 기다리지 않고
  // 즉시 커서를 지워주기 위함 (y-websocket 서버 구현의 doc.conns 패턴과 동일)
  clients: Map<WebSocket, Set<number>>
}

// 협업 방의 공개 표면 — collabAgent(디스크→방 브리지)가 방의 doc/awareness에만 접근하도록 좁힌 타입.
export interface CollabRoom {
  doc: Y.Doc
  awareness: Awareness
}

// 방이 처음 열릴 때/마지막 클라이언트가 나가 닫힐 때 알림받는 훅. collabAgent가 방마다 헤드리스
// 에이전트 에디터를 붙였다 떼는 데 쓴다. relay 자체는 이 훅의 존재를 몰라도(null) 정상 동작한다.
interface RoomLifecycle {
  onOpen(roomKey: string, room: CollabRoom): void
  onClose(roomKey: string, room: CollabRoom): void
}
let lifecycle: RoomLifecycle | null = null
export function setRoomLifecycle(next: RoomLifecycle | null): void {
  lifecycle = next
}

// 방(room)은 순수 메모리 상태 — 디스크 입출력은 전혀 하지 않는다. 영속화는 클라이언트가 하는
// updateTabContent → autosave → PUT /api/file 경로가 전담하며, 원격 Yjs 병합도 로컬 편집과
// 동일하게 에디터의 onChange를 태우므로 이 서버는 그저 바이트를 중계할 뿐이다.
const rooms = new Map<string, Room>()
// 인증된 사용자만 접속 가능하지만(authorize), 계정당 무제한으로 room을 열 수 있으면 메모리 소모형
// DoS가 가능하다 — 활성 room 수에 상한을 둔다.
const MAX_ROOMS = 200

function toUint8Array(raw: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
  if (Array.isArray(raw)) return new Uint8Array(Buffer.concat(raw))
  return raw
}

function send(ws: WebSocket, buf: Uint8Array) {
  if (ws.readyState === WebSocket.OPEN) ws.send(buf)
}

function broadcast(room: Room, buf: Uint8Array, exclude: WebSocket | null) {
  for (const client of room.clients.keys()) {
    if (client !== exclude) send(client, buf)
  }
}

function closeRoomIfEmpty(roomKey: string, room: Room) {
  if (room.clients.size === 0) {
    // 에이전트 에디터가 room.doc/awareness에 매여 있으므로, doc을 파괴하기 전에 먼저 떼어낸다
    try {
      lifecycle?.onClose(roomKey, room)
    } catch (err) {
      console.error('[mew] collab onClose 실패:', err)
    }
    room.awareness.destroy()
    room.doc.destroy()
    rooms.delete(roomKey)
  }
}

function getRoom(roomKey: string): Room {
  const existing = rooms.get(roomKey)
  if (existing) return existing

  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  const room: Room = { doc, awareness, clients: new Map() }
  rooms.set(roomKey, room)

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    writeUpdate(encoder, update)
    broadcast(room, encoding.toUint8Array(encoder), origin instanceof WebSocket ? origin : null)
  })

  awareness.on(
    'update',
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin instanceof WebSocket) {
        const owned = room.clients.get(origin)
        if (owned) {
          for (const id of added) owned.add(id)
          for (const id of removed) owned.delete(id)
        }
      }
      const changed = added.concat(updated, removed)
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, changed))
      broadcast(room, encoding.toUint8Array(encoder), origin instanceof WebSocket ? origin : null)
    },
  )

  // 방이 완전히 구성된 뒤에 브리지에 알린다 — 에이전트 에디터가 이 doc/awareness에 매인다
  try {
    lifecycle?.onOpen(roomKey, room)
  } catch (err) {
    console.error('[mew] collab onOpen 실패:', err)
  }

  return room
}

const wss = new WebSocketServer({ noServer: true })

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url ?? '', 'http://localhost')
  const roomKey = url.searchParams.get('room')
  if (!roomKey) {
    ws.close()
    return
  }
  if (!rooms.has(roomKey) && rooms.size >= MAX_ROOMS) {
    ws.close(1013, 'too many active rooms')
    return
  }
  const room = getRoom(roomKey)
  room.clients.set(ws, new Set())

  // 접속 즉시 sync step1(내 상태 벡터)과 현재 awareness 상태를 보내 새 클라이언트가 따라잡게 한다
  {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    writeSyncStep1(encoder, room.doc)
    send(ws, encoding.toUint8Array(encoder))

    const states = room.awareness.getStates()
    if (states.size > 0) {
      const awarenessEncoder = encoding.createEncoder()
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(awarenessEncoder, encodeAwarenessUpdate(room.awareness, Array.from(states.keys())))
      send(ws, encoding.toUint8Array(awarenessEncoder))
    }
  }

  ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
    const decoder = decoding.createDecoder(toUint8Array(raw))
    const messageType = decoding.readVarUint(decoder)
    switch (messageType) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        readSyncMessage(decoder, encoder, room.doc, ws)
        if (encoding.length(encoder) > 1) send(ws, encoding.toUint8Array(encoder))
        break
      }
      case MESSAGE_AWARENESS: {
        applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), ws)
        break
      }
    }
  })

  ws.on('close', () => {
    const owned = room.clients.get(ws)
    room.clients.delete(ws)
    if (owned && owned.size > 0) removeAwarenessStates(room.awareness, Array.from(owned), null)
    closeRoomIfEmpty(roomKey, room)
  })
})

export function attachCollabWebSocket(
  httpServer: HttpServer,
  opts: { authorize?: (req: IncomingMessage) => boolean } = {},
) {
  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    // 이 경로가 아니면 손대지 않고 통과시킨다 — tmux·presence 등 다른 웹소켓 업그레이드와 공존해야 함
    if (url.pathname !== WS_PATH) return
    if (opts.authorize && !opts.authorize(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })
}
