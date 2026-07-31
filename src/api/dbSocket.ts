import type { DbEvent } from '@mew/editor'
import { getProject } from './client'

// /db 실시간 소켓 — 연결 하나로 여러 데이터베이스 룸을 다중화한다(한 문서에 /db 노드가 여럿일 수 있음).
// 서버(server/db/socket.ts) 프로토콜: 보내기 {type:'subscribe'|'unsubscribe', project, dbId},
// 받기 {type:'db.event', project, dbId, event}. presence 소켓과 같은 재연결 전략.

type Listener = (event: DbEvent) => void

// dbId → { 구독 당시의 프로젝트, 리스너들 }. 프로젝트는 앱 안에서 바뀌므로(프로젝트 탭)
// 구독한 시점의 값을 붙들고 있어야 재연결·이벤트 필터가 엉뚱한 프로젝트를 보지 않는다.
const listeners = new Map<string, { project: string; set: Set<Listener> }>()
let ws: WebSocket | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null

function send(type: 'subscribe' | 'unsubscribe', project: string, dbId: string) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, project, dbId }))
  }
}

function ensureSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${protocol}//${location.host}/api/db/ws`)
  ws.onopen = () => {
    // 재연결 시 활성 룸을 모두 다시 구독한다
    for (const [dbId, entry] of listeners) send('subscribe', entry.project, dbId)
  }
  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return
    try {
      const msg = JSON.parse(event.data) as { type?: string; project?: string; dbId?: string; event?: DbEvent }
      if (msg.type !== 'db.event' || !msg.dbId || !msg.event) return
      const entry = listeners.get(msg.dbId)
      if (entry && entry.project === msg.project) for (const fn of entry.set) fn(msg.event)
    } catch {
      // 잘못된 메시지 무시
    }
  }
  ws.onclose = () => {
    ws = null
    // 구독자가 남아 있으면 재연결 예약
    if (listeners.size > 0 && !retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (listeners.size > 0) ensureSocket()
      }, 3000)
    }
  }
}

/** 데이터베이스 실시간 구독 — 반환된 함수를 호출하면 해제된다 */
export function subscribeDb(dbId: string, onEvent: Listener): () => void {
  const project = getProject()
  let entry = listeners.get(dbId)
  if (!entry) {
    entry = { project, set: new Set() }
    listeners.set(dbId, entry)
  }
  const isFirst = entry.set.size === 0
  entry.set.add(onEvent)
  ensureSocket()
  if (isFirst) send('subscribe', entry.project, dbId)

  return () => {
    const e = listeners.get(dbId)
    if (!e) return
    e.set.delete(onEvent)
    if (e.set.size === 0) {
      listeners.delete(dbId)
      send('unsubscribe', e.project, dbId)
    }
  }
}
