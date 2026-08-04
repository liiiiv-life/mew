import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { messageYjsSyncStep1, readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import { guestName, identityColor } from '../utils/collabColor'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const RETRY_MIN_MS = 300
const RETRY_MAX_MS = 3000

export interface Collab {
  ydoc: Y.Doc
  awareness: Awareness
  // 첫 sync 응답을 받기 전까지는 문서가 "비어 있는지"를 신뢰할 수 없다 — 컴포넌트는 이 값이
  // true가 된 뒤에야 로컬 콘텐츠로 방을 시딩할지 판단해야 한다
  synced: boolean
}

// path가 null이면 협업 연결을 하지 않는다 — 호출부(App)가 "지금 활성 탭·뷰모드가 주 편집화면인지"를
// 판단해서 넘긴다. 문서 내용 시딩은 이 훅이 하지 않는다 — Y.Text냐 Y.XmlFragment냐에 따라 방식이
// 달라서 CodePane·Editor 각자가 synced 플래그를 보고 알아서 한다.
export function useCollab(project: string, path: string | null, authEmail: string | null): Collab | null {
  const [doc, setDoc] = useState<{ ydoc: Y.Doc; awareness: Awareness } | null>(null)
  const [synced, setSynced] = useState(false)

  useEffect(() => {
    if (!path) {
      setDoc(null)
      setSynced(false)
      return
    }

    let cancelled = false
    let ws: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    // 순간 끊김(랩탑 깨어남·와이파이 전환)은 곧바로 다시 붙는 게 맞다 — 3초를 그냥 기다리면 그동안 내
    // 편집이 방에 안 올라간다. 반면 서버가 죽었거나 인증이 막힌 경우엔 300ms 재시도가 두들기는 셈이라
    // 붙을 때까지 두 배씩 늘린다. 접속 성공하면 다시 300ms로 되돌린다.
    let retryDelay = RETRY_MIN_MS
    // 서버에서 온 메시지를 적용할 때 이 값을 origin으로 넘겨, 되돌려 보내지 않게 걸러낸다
    const remoteOrigin = {}

    const ydoc = new Y.Doc()
    const awareness = new Awareness(ydoc)
    setDoc({ ydoc, awareness })
    setSynced(false)

    const name = authEmail ? authEmail.split('@')[0] : guestName()
    awareness.setLocalStateField('user', { name, color: identityColor(authEmail) })

    function send(buf: Uint8Array<ArrayBuffer>) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(buf)
    }

    ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === remoteOrigin) return
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      writeUpdate(encoder, update)
      send(encoding.toUint8Array(encoder))
    })

    awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        if (origin === remoteOrigin) return
        const changed = added.concat(updated, removed)
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
        encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, changed))
        send(encoding.toUint8Array(encoder))
      },
    )

    function connect() {
      if (cancelled) return
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const roomKey = `${project}:${path}`
      ws = new WebSocket(`${protocol}//${location.host}/api/collab?room=${encodeURIComponent(roomKey)}`)
      ws.binaryType = 'arraybuffer'

      ws.onopen = () => {
        retryDelay = RETRY_MIN_MS
        const syncEncoder = encoding.createEncoder()
        encoding.writeVarUint(syncEncoder, MESSAGE_SYNC)
        writeSyncStep1(syncEncoder, ydoc)
        send(encoding.toUint8Array(syncEncoder))

        // 재연결 시 서버 쪽 방이 (마지막 클라이언트가 나가서) 새로 생겼을 수 있으니 내 상태를 다시 알린다
        const localState = awareness.getLocalState()
        if (localState !== null) {
          const awarenessEncoder = encoding.createEncoder()
          encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS)
          encoding.writeVarUint8Array(awarenessEncoder, encodeAwarenessUpdate(awareness, [awareness.clientID]))
          send(encoding.toUint8Array(awarenessEncoder))
        }
      }

      ws.onmessage = (event) => {
        const decoder = decoding.createDecoder(new Uint8Array(event.data as ArrayBuffer))
        const messageType = decoding.readVarUint(decoder)
        switch (messageType) {
          case MESSAGE_SYNC: {
            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, MESSAGE_SYNC)
            const syncMessageType = readSyncMessage(decoder, encoder, ydoc, remoteOrigin)
            if (encoding.length(encoder) > 1) send(encoding.toUint8Array(encoder))
            // syncStep1은 상대의 상태 벡터 "요청"일 뿐 문서 내용을 담지 않는다 — 서버가 접속 즉시
            // 보내는 이 메시지를 sync 완료로 착각하면, 아직 비어 있는 로컬 ydoc을 "빈 문서"로 오판해
            // 실제 원격 내용(뒤이어 오는 syncStep2)과 로컬 콘텐츠를 이중으로 시딩해버린다.
            if (syncMessageType !== messageYjsSyncStep1) setSynced(true)
            break
          }
          case MESSAGE_AWARENESS: {
            applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), remoteOrigin)
            break
          }
        }
      }

      ws.onclose = () => {
        if (cancelled) return
        retryTimer = setTimeout(connect, retryDelay)
        retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)
      }
    }
    connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      awareness.setLocalState(null)
      ws?.close()
      awareness.destroy()
      ydoc.destroy()
    }
  }, [project, path, authEmail])

  return doc ? { ydoc: doc.ydoc, awareness: doc.awareness, synced } : null
}
