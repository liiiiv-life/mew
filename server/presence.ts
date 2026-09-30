import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { HttpServer } from 'vite'
import { randomUUID } from 'node:crypto'
import { fileAccess, unrestrictedFiles, accessChanges } from './access-policy.ts'
import type { RequestAuth } from './reqAuth.ts'
import { getUser } from './auth.ts'
import type { ActiveMewSession } from '../shared/active-sessions.ts'
import { SESSION_ACTIVITY_MAX_AGE_MS, validRunningAgentCount } from '../shared/active-sessions.ts'
import { recordPresence, endPresence } from './presence-history.ts'

const WS_PATH = '/api/presence'
const FALLBACK_COLOR = '#737373' // 색을 아직 안 보낸(구버전) 클라이언트용 회색 — 정상 경로에서는 나오지 않음
const OWNER_AUTH: RequestAuth = { role: 'owner', email: null, mustChangePassword: false }

const wss = new WebSocketServer({ noServer: true })
// 연결(세션)마다 "지금 포커스 중인 문서 경로 하나"(열어만 둔 탭은 안 셈)와, 사이드바·탭의 점을
// 커서 색과 일치시키기 위한 색상 하나, 그리고 이 연결이 어떤 권한으로 접속했는지(auth)를 들고 있다.
// participants 전송은 auth별로 필터링되므로 게스트는 자신이 볼 수 있는 경로의 참가자만 받는다.
const clientState = new Map<WebSocket, {
  path: string | null; color: string; auth: RequestAuth
  session: ActiveMewSession; observedAt: number; alive: boolean; getAuth: () => RequestAuth
}>()

function clientDevice(agent: string): Pick<ActiveMewSession, 'browser' | 'device'> {
  const browser = /Edg(?:e|A|iOS)?\//.test(agent) ? 'Edge'
    : /Firefox\/|FxiOS\//.test(agent) ? 'Firefox'
      : /Chrome\/|CriOS\//.test(agent) ? 'Chrome'
        : /Safari\//.test(agent) ? 'Safari' : null
  const device = /iPad/.test(agent) ? 'iPad' : /iPhone/.test(agent) ? 'iPhone'
    : /Android/.test(agent) ? 'Android' : /Windows/.test(agent) ? 'Windows'
      : /Macintosh|Mac OS X/.test(agent) ? 'Mac' : /Linux/.test(agent) ? 'Linux' : null
  return { browser, device }
}

function publicSessions(): ActiveMewSession[] {
  return [...clientState.entries()].filter(([ws]) => ws.readyState === WebSocket.OPEN).map(([, state]) => {
    const email = state.auth.role !== 'guest' && !state.auth.mustChangePassword ? state.auth.email : null
    const user = email ? getUser(email) : null
    const agents = state.session.agents
    const session = { ...state.session, agents: agents && Date.now() - agents.reportedAt <= SESSION_ACTIVITY_MAX_AGE_MS ? agents : null, email, displayName: email ? user?.displayName?.trim() || email.split('@')[0] : null }
    recordPresence(session, state.observedAt)
    return session
  })
}

/** path는 클라이언트가 "{project}:{relPath}" 형식으로 보낸다(usePresence.ts) — guest 필터를 위해 분해 */
function splitProjectPath(qualified: string): { project: string; relPath: string } | null {
  const idx = qualified.indexOf(':')
  if (idx === -1) return null
  return { project: qualified.slice(0, idx), relPath: qualified.slice(idx + 1) }
}

function visibleTo(auth: RequestAuth, qualifiedPath: string): boolean {
  const parsed = splitProjectPath(qualifiedPath)
  if (!parsed) return false
  return fileAccess(auth, parsed.project, parsed.relPath).view
}

function computeParticipants(forAuth: RequestAuth): Record<string, string[]> {
  const participants: Record<string, string[]> = {}
  for (const { path, color } of clientState.values()) {
    if (path && visibleTo(forAuth, path)) (participants[path] ??= []).push(color)
  }
  return participants
}

/** presence 소켓에 연결된 모든 세션에 메시지를 보낸다 — 트리 변경 알림(watcher) 등 내용 없는 신호 전용.
 * participants처럼 경로가 담긴 데이터는 이 함수를 쓰지 말고 sendParticipantsTo로 수신자별 필터링해야 한다. */
export function broadcast(msg: object) {
  const payload = JSON.stringify(msg)
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload)
  }
}

/**
 * 부분 tree invalidation은 부모 경로를 담는다. 로그인 역할에는 성능을 위해 범위를 보내되,
 * guest에게는 승인 밖 이름이 새지 않도록 기존의 내용 없는 전체 갱신 신호만 보낸다.
 */
export function treeSignalFor(
  auth: RequestAuth,
  msg: { type: 'tree'; project: string; version: number; parents: string[] },
): object {
  return auth.role === 'guest' || !unrestrictedFiles(auth, msg.project) ? { type: 'tree' } : msg
}

export function broadcastTree(msg: { type: 'tree'; project: string; version: number; parents: string[] }) {
  const scoped = JSON.stringify(msg)
  const guest = JSON.stringify({ type: 'tree' })
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue
    const auth = clientState.get(client)?.auth
    client.send(auth && treeSignalFor(auth, msg) === msg ? scoped : guest)
  }
}

function sendParticipantsTo(ws: WebSocket, auth: RequestAuth, sessions: ActiveMewSession[]) {
  if (ws.readyState !== WebSocket.OPEN) return
  const state = clientState.get(ws)
  const activeSessions = auth.role !== 'guest' && !auth.mustChangePassword && state
    ? { selfId: state.session.id, sessions: sessions.map(session => session.project && !fileAccess(auth, session.project, session.path ?? '').view ? { ...session, path: null, workspaceLabel: null, project: null } : session) } : undefined
  ws.send(JSON.stringify({ type: 'participants', participants: computeParticipants(auth), activeSessions }))
}

function broadcastParticipants() {
  // Revalidate before sharing identities, including after logout/password changes.
  for (const state of clientState.values()) {
    const auth = state.getAuth()
    const nextAuth = auth.mustChangePassword ? { ...auth, role: 'guest' as const, email: null } : auth
    state.auth = nextAuth
  }
  const sessions = publicSessions()
  for (const [ws, state] of clientState) sendParticipantsTo(ws, state.auth, sessions)
}

function registerClient(ws: WebSocket, req: IncomingMessage, getAuth: () => RequestAuth) {
  clientState.set(ws, {
    path: null, color: FALLBACK_COLOR, auth: getAuth(), observedAt: Date.now(), alive: true, getAuth,
    session: {
      id: randomUUID(), email: null, displayName: null, connectedAt: Date.now(),
      ...clientDevice(req.headers['user-agent'] ?? ''),
      workspaceLabel: null, project: null, path: null, visible: true, agents: null,
    },
  })
  broadcastParticipants()
  ws.on('pong', () => { const state = clientState.get(ws); if (state) { state.alive = true; state.observedAt = Date.now() } })

  ws.on('message', (raw) => {
    let msg: { type?: string; path?: unknown; color?: unknown; project?: unknown; workspaceLabel?: unknown; visible?: unknown; runningAgents?: unknown }
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'focus' && (typeof msg.path === 'string' || msg.path === null)) {
      if (typeof msg.path === 'string' && msg.path.length > 4096) return
      const color = typeof msg.color === 'string' ? msg.color : FALLBACK_COLOR
      const prev = clientState.get(ws)
      if (!prev) return
      const focused = msg.path ? splitProjectPath(msg.path) : null
      const running = validRunningAgentCount(msg.runningAgents)
      clientState.set(ws, { ...prev, observedAt: Date.now(), path: msg.path || null, color, session: {
        ...prev.session,
        project: focused?.project ?? (typeof msg.project === 'string' ? msg.project.slice(0, 200) : null),
        path: focused?.relPath ?? null,
        workspaceLabel: typeof msg.workspaceLabel === 'string' ? msg.workspaceLabel.slice(0, 200) : null,
        visible: msg.visible !== false,
        agents: running === null ? null : { running, reportedAt: Date.now() },
      } })
      broadcastParticipants()
    }
  })

  ws.on('close', () => {
    const state = clientState.get(ws)
    if (state) endPresence(state.session.id, Math.min(Date.now(), state.observedAt + 60_000))
    clientState.delete(ws)
    broadcastParticipants()
  })
}

export function attachPresenceWebSocket(
  httpServer: HttpServer,
  opts: { getAuth?: (req: IncomingMessage) => RequestAuth } = {},
) {
  const clients = new Set<WebSocket>()
  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      const state = clientState.get(ws)
      if (!state?.alive) { ws.terminate(); continue }
      state.alive = false
      if (ws.readyState === WebSocket.OPEN) ws.ping()
    }
    broadcastParticipants()
  }, 30_000)
  heartbeat.unref()
  httpServer.once('close', () => {
    clearInterval(heartbeat)
    for (const ws of clients) ws.terminate()
  })
  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    // 이 경로가 아니면 손대지 않고 통과시킨다 — tmux·Vite HMR 웹소켓 업그레이드와 공존해야 함
    if (url.pathname !== WS_PATH) return
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws)
      ws.once('close', () => clients.delete(ws))
      registerClient(ws, req, () => opts.getAuth ? opts.getAuth(req) : OWNER_AUTH)
    })
  })
}

accessChanges.on('change', () => { broadcast({ type: 'permissions' }); broadcastParticipants() })
