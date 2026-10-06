import { runAccountWorkspace } from './account-workspace.ts'
import type { Duplex } from 'node:stream'
import type express from 'express'
import { SHARED_MEMO_ROOM } from '../shared/shared-memo.ts'
import type { IncomingMessage } from 'node:http'
import type { AccountRole } from './auth.ts'
import { sessionFromRequest } from './authRoutes.ts'
import { canUse, fileAccess, unrestrictedFiles } from './access-policy.ts'
import type { Feature } from '../shared/access-policy.ts'

export type Role = AccountRole | 'guest'

export interface RequestAuth {
  role: Role
  email: string | null
  mustChangePassword: boolean
}

declare global {
  namespace Express {
    interface Request {
      auth?: RequestAuth
    }
  }
}

const ROLE_RANK: Record<Role, number> = { guest: 0, member: 1, manager: 2, owner: 3 }

export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min]
}

/** attachAuthContext를 거치지 않은 요청(있을 수 없지만) 대비 폴백 — guest로 취급해 안전한 쪽으로 */
export function authOf(req: express.Request): RequestAuth {
  return req.auth ?? { role: 'guest', email: null, mustChangePassword: false }
}

/** HTTP 미들웨어·WS authorize 공용 — 세션 쿠키를 role/이메일로 해석한다 (SSoT) */
export function resolveAuth(req: IncomingMessage): RequestAuth {
  const session = sessionFromRequest(req)
  if (!session) return { role: 'guest', email: null, mustChangePassword: false }
  return { role: session.user.role, email: session.email, mustChangePassword: session.user.mustChangePassword }
}

/** 팀 서버(5000) 전용 — 매 요청에 req.auth를 채운다. 임시 비밀번호 미변경 상태는 전면 차단(§2). */
export function attachAuthContext(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = resolveAuth(req)
  if (auth.mustChangePassword) {
    res.status(403).json({ error: '임시 비밀번호를 먼저 변경해야 합니다', code: 'must-change-password' })
    return
  }
  req.auth = auth
  next()
}

/**
 * 사이드바 트리를 거르지 않고 디스크에 있는 그대로 보는 역할 — 숨김 목록도 확장자 필터도 적용하지 않는다.
 * 이 역할별 표시 기본값과 실제 파일 접근 권한은 별개다.
 * 기능과 파일 권한은 docs/development/access-control.md를 따른다.
 */
export function seesEveryFile(role: Role): boolean {
  return role === 'owner' || role === 'manager'
}

export function requireRole(...roles: Role[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = authOf(req)
    if (!roles.includes(auth.role)) {
      res.status(403).json({ error: '권한이 없습니다' })
      return
    }
    next()
  }
}

export function requireAuthenticated(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (authOf(req).role === 'guest') {
    res.status(403).json({ error: '로그인이 필요합니다' })
    return
  }
  next()
}

export function requireFeature(feature: Feature) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!canUse(authOf(req), feature)) { res.status(403).json({ error: '이 기능을 사용할 권한이 없습니다' }); return }
    next()
  }
}

export function requireAnyFeature(...features: Feature[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!features.some(feature => canUse(authOf(req), feature))) { res.status(403).json({ error: '이 기능을 사용할 권한이 없습니다' }); return }
    next()
  }
}

export function authorizeFeature(feature: Feature) {
  return (req: IncomingMessage) => canUse(resolveAuth(req), feature)
}

// mustChangePassword 상태는 셸(tmux)·문서 편집(collab) 둘 다 전면 차단한다 — HTTP 쪽 attachAuthContext와
// 동일한 정책을 WS 업그레이드 경로에도 적용해 임시 비밀번호로 셸을 붙잡는 우회를 막는다.
// 5000(serve.ts)·4999(plugin.ts) 공용.
export function authorizeTmux(req: IncomingMessage): boolean {
  return canUse(resolveAuth(req), 'terminal')
}

export function authorizeCollab(req: IncomingMessage): boolean {
  const auth = resolveAuth(req), url = new URL(req.url ?? '', 'http://localhost')
  const room = url.searchParams.get('room') ?? '', index = room.indexOf(':')
  return canUse(auth, 'collaboration') && (room === SHARED_MEMO_ROOM || (index > 0 && fileAccess(auth, room.slice(0, index), room.slice(index + 1)).edit))
}

export function authorizeDatabase(req: IncomingMessage, project = 'docs'): boolean {
  return canUse(resolveAuth(req), 'database') && unrestrictedFiles(resolveAuth(req), project)
}

/** WebSocket authorization and setup resolve paths in the connecting account's root. */
export function withWorkspaceUpgrade(handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void) {
  return (req: IncomingMessage, socket: Duplex, head: Buffer) => runAccountWorkspace(resolveAuth(req).email, () => handler(req, socket, head))
}
