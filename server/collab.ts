import { watchSocketAccess } from './access-socket.ts'
import { SHARED_MEMO_ROOM } from '../shared/shared-memo.ts'
import { createSharedMemoDoc } from './shared-memo.ts'
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { HttpServer } from 'vite'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import { createRoomDoc, type RoomDoc } from './roomDoc.ts'
import {
  SYNC_STEP1,
  decodeMessage,
  encodeAwarenessFrame,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeSyncUpdate,
} from './syncCodec.ts'

const WS_PATH = '/api/collab'

/**
 * 방에 붙은 상대 하나. 실제 WebSocket이거나, 디스크→방 브리지의 인프로세스 클라이언트다
 * (ADR 0035 — 브리지는 방의 doc을 붙들지 않고 프로토콜로 말한다).
 */
interface Client {
  send(frame: Uint8Array): void
  rejectUpdate?(): void
  /** 브리지처럼 방 자신이 띄운 클라이언트. 방을 살려두는 근거가 되지 않는다 — closeRoomIfEmpty 참고 */
  local: boolean
}

interface Room {
  doc: RoomDoc
  awareness: Awareness
  // 상대별로 자신이 소유한 awareness clientID들을 추적 — 연결이 끊기면 30초 타임아웃을 기다리지 않고
  // 즉시 커서를 지워주기 위함 (y-websocket 서버 구현의 doc.conns 패턴과 동일)
  clients: Map<Client, Set<number>>
  destroyed: boolean
}

/** 방에 인프로세스로 붙은 클라이언트의 손잡이 */
export interface RoomConnection {
  send(frame: Uint8Array): void
  close(): void
  /** 아직 방에 붙어 있는지. 붙는 쪽이 await 하는 사이 방이 닫힐 수 있다. */
  readonly open: boolean
}

// 협업 방의 공개 표면 — collabAgent(디스크→방 브리지)가 쓰는 것만 노출한다.
// **doc은 노출하지 않는다**: 방 상태는 Rust(yrs)일 수 있고, 붙들면 백엔드를 갈 수 없다.
export interface CollabRoom {
  awareness: Awareness
  /**
   * 방에 인프로세스 클라이언트로 붙는다. 프레임 형식은 WebSocket 경로와 완전히 같다.
   * 붙는 즉시 step1 + 전체 상태 step2 + 현재 awareness를 받는다(ws 클라이언트와 동일).
   * 방이 이미 닫혔으면 null.
   */
  connect(onFrame: (frame: Uint8Array) => void): RoomConnection | null
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

// 일반 파일 방(room)은 순수 메모리 상태다. 공통 메모 예약 방만 영속 RoomDoc 어댑터를 쓴다.
// 파일 영속화는 클라이언트가 하는
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

function broadcast(room: Room, frame: Uint8Array, exclude: Client | null) {
  for (const client of room.clients.keys()) {
    if (client !== exclude) client.send(frame)
  }
}

/** 방을 살려두는 것은 실제 접속자뿐이다 — 브리지의 인프로세스 클라이언트는 세지 않는다.
 * 세면 브리지가 붙은 방이 영원히 닫히지 않아 헤드리스 에디터와 fs watcher가 그대로 쌓인다. */
function realClientCount(room: Room): number {
  let count = 0
  for (const client of room.clients.keys()) {
    if (!client.local) count++
  }
  return count
}

function closeRoomIfEmpty(roomKey: string, room: Room) {
  if (realClientCount(room) > 0) return
  // 에이전트 에디터가 방에 매여 있으므로, 상태를 버리기 전에 먼저 떼어낸다
  try {
    if (roomKey !== SHARED_MEMO_ROOM) lifecycle?.onClose(roomKey, publicRoom(room))
  } catch (err) {
    console.error('[mew] collab onClose 실패:', err)
  }
  room.destroyed = true
  room.clients.clear()
  room.awareness.destroy()
  room.doc.destroy()
  rooms.delete(roomKey)
}

/** 방에 붙은 상대 하나를 받아들이고, 따라잡을 것을 전부 보낸다 (ws·인프로세스 공통 경로) */
function admit(room: Room, client: Client) {
  room.clients.set(client, new Set())

  // step1(내 상태 벡터)로 상대의 편집분을 요청하고,
  client.send(encodeSyncStep1(room.doc.stateVector()))
  // 요청받기 전에 step2(방의 전체 상태)도 같은 묶음으로 보낸다. 상대의 step1을 기다리지 않으므로
  // 접속 직후에 synced가 되고, 본문 렌더가 왕복 한 번을 덜 기다린다(3 RTT -> 2 RTT).
  // 상태 벡터 없는 step2 = 전체 상태이고, Yjs 업데이트 적용은 멱등이라 뒤이어 올 step1 응답과
  // 겹쳐도 결과가 같다. 위 step1은 그대로 남겨 상대가 자기 편집분을 올려보내게 한다.
  client.send(encodeSyncStep2(room.doc.encodeStateAsUpdate()))

  const states = room.awareness.getStates()
  if (states.size > 0) {
    client.send(encodeAwarenessFrame(encodeAwarenessUpdate(room.awareness, Array.from(states.keys()))))
  }
}

/** 상대가 보낸 프레임 하나를 처리한다 (ws·인프로세스 공통 경로) */
function handleFrame(room: Room, client: Client, bytes: Uint8Array) {
  const message = decodeMessage(bytes)
  if (!message) return // 알 수 없거나 잘린 프레임 — 무시한다

  if (message.channel === 'awareness') {
    applyAwarenessUpdate(room.awareness, message.payload, client)
    return
  }

  if (message.syncType === SYNC_STEP1) {
    // 상대의 상태 벡터 요청 — 그 기준 diff를 돌려준다
    client.send(encodeSyncStep2(room.doc.encodeStateAsUpdate(message.payload)))
    return
  }

  // step2·update — 둘 다 업데이트 바이트다. 적용하고 새로 생긴 만큼만 남에게 퍼뜨린다.
  let diff: Uint8Array | null
  try {
    diff = room.doc.applyUpdate(message.payload)
  } catch (err) {
    // 깨진 업데이트로 방을 죽이지 않는다 — 보낸 쪽만 손해다
    console.error('[mew] collab 업데이트 적용 실패:', err)
    client.rejectUpdate?.()
    return
  }
  if (diff) broadcast(room, encodeSyncUpdate(diff), client)
}

function publicRoom(room: Room): CollabRoom {
  return {
    awareness: room.awareness,
    connect(onFrame) {
      if (room.destroyed) return null
      const client: Client = { send: onFrame, local: true }
      admit(room, client)
      let joined = true
      return {
        get open() {
          return joined && !room.destroyed
        },
        // 닫힌 뒤·방이 파괴된 뒤의 프레임은 버린다 — 파괴된 doc에 손대면 던진다(Rust 백엔드는 확실히)
        send: (frame) => {
          if (joined && !room.destroyed) handleFrame(room, client, frame)
        },
        close: () => {
          if (!joined) return
          joined = false
          const owned = room.clients.get(client)
          room.clients.delete(client)
          if (owned && owned.size > 0 && !room.destroyed) {
            removeAwarenessStates(room.awareness, Array.from(owned), null)
          }
          // 방의 수명은 실제 접속자만 결정한다 — 여기서 closeRoomIfEmpty를 부르면
          // onClose 처리 중에 다시 들어온다(재진입).
        },
      }
    },
  }
}

function getRoom(roomKey: string): Room {
  const existing = rooms.get(roomKey)
  if (existing) return existing

  // awareness는 CRDT가 아니라 clock+JSON 맵이라 백엔드와 무관하게 JS에 남는다. Awareness가
  // clientID를 doc에서 얻으므로 그 용도로만 쓰는 빈 Y.Doc을 붙인다 — 방의 내용은 여기 없다.
  const doc = roomKey === SHARED_MEMO_ROOM ? createSharedMemoDoc() : createRoomDoc()
  const awareness = new Awareness(new Y.Doc())
  const room: Room = { doc, awareness, clients: new Map(), destroyed: false }
  rooms.set(roomKey, room)

  awareness.on(
    'update',
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const client = origin as Client | null
      const owned = client && room.clients.get(client)
      if (owned) {
        for (const id of added) owned.add(id)
        for (const id of removed) owned.delete(id)
      }
      const changed = added.concat(updated, removed)
      const frame = encodeAwarenessFrame(encodeAwarenessUpdate(awareness, changed))
      broadcast(room, frame, owned ? client : null)
    },
  )

  // 방이 완전히 구성된 뒤에 브리지에 알린다
  try {
    if (roomKey !== SHARED_MEMO_ROOM) lifecycle?.onOpen(roomKey, publicRoom(room))
  } catch (err) {
    console.error('[mew] collab onOpen 실패:', err)
  }

  return room
}

const wss = new WebSocketServer({ noServer: true })
const accessChecks = new WeakMap<WebSocket, () => boolean>()
const socketRooms = new WeakMap<WebSocket, string>()

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
  let room: Room
  try { room = getRoom(roomKey) } catch (error) {
    console.error('[mew] collab room load failed:', error)
    ws.close(1011, 'room unavailable')
    return
  }
  socketRooms.set(ws, roomKey)
  const client: Client = {
    rejectUpdate: () => ws.close(1011, 'update failed'),
    send: (frame) => {
      if (accessChecks.get(ws)?.() === false) { ws.terminate(); return }
      if (ws.readyState === WebSocket.OPEN) ws.send(frame)
    },
    local: false,
  }
  admit(room, client)

  ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
    if (accessChecks.get(ws)?.() === false) { ws.terminate(); return }
    handleFrame(room, client, toUint8Array(raw))
  })

  ws.on('close', () => {
    const owned = room.clients.get(client)
    room.clients.delete(client)
    if (owned && owned.size > 0) removeAwarenessStates(room.awareness, Array.from(owned), null)
    closeRoomIfEmpty(roomKey, room)
  })
})

/** 프로젝트 파일 방을 전부 끊는다 — 워크스페이스를 바꿀 때 부른다. 서버 공통 메모는 유지한다.
 *
 * 방 키는 `프로젝트:경로`뿐이라 워크스페이스가 바뀌면 **같은 키가 다른 파일**을 가리킨다. 옛 워크스페이스
 * 내용을 든 방을 그대로 두면 디스크 브리지(collabAgent)가 그 내용을 새 워크스페이스의 동명 파일에 쓴다.
 * 소켓을 끊으면 close 핸들러가 방을 정리하고(closeRoomIfEmpty) 브리지도 떨어진다 — close 프레임 왕복을
 * 기다리지 않도록 terminate로 즉시 끊는다. 클라이언트는 어차피 곧 새로고침한다. */
export function closeAllRooms(): void {
  for (const ws of wss.clients) {
    if (socketRooms.get(ws) !== SHARED_MEMO_ROOM) ws.terminate()
  }
}

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
      accessChecks.set(ws, () => opts.authorize?.(req) ?? true)
      watchSocketAccess(ws, req, opts.authorize)
      wss.emit('connection', ws, req)
    })
  })
}
