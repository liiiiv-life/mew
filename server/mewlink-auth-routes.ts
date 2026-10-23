import express from 'express'
import { remoteContext } from './remote-access-context.ts'
import { requireRole } from './reqAuth.ts'
import {
  MewlinkAccessError, getMewlinkAccessStatus, requestMewlinkAccess,
  listMewlinkAccess, approveMewlinkRequest, denyMewlinkRequest, unlinkMewlinkIdentity, resolveMewlinkSession,
  linkMewlinkToAccount,
} from './mewlink-identities.ts'

function routeErrors(action: (req: express.Request, res: express.Response) => void): express.RequestHandler {
  return (req, res, next) => {
    try { action(req, res) } catch (error) {
      if (error instanceof MewlinkAccessError) res.status(error.status).json({ error: error.message })
      else next(error)
    }
  }
}

/** These endpoints accept identity only from the verified in-process P2P transport. */
export function createMewlinkAuthRouter() {
  const router = express.Router()
  router.use(express.json({ limit: '2kb' }))
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.get('/', routeErrors((req, res) => {
    const context = remoteContext(req)
    const identity = context && (context.alive?.() ?? true) ? context.identity?.() ?? null : null
    res.json(getMewlinkAccessStatus(identity))
  }))
  router.post('/request', routeErrors((req, res) => {
    const context = remoteContext(req)
    const identity = context && (context.alive?.() ?? true) ? context.identity?.() ?? null : null
    if (!identity) { res.status(401).json({ error: 'Mewlink에 로그인한 연결에서 요청하세요' }); return }
    const request = requestMewlinkAccess(identity)
    res.json({ ...getMewlinkAccessStatus(identity), ok: true, request })
  }))
  router.post('/login', routeErrors((req, res) => {
    const context = remoteContext(req)
    const identity = context && (context.alive?.() ?? true) ? context.identity?.() ?? null : null
    if (!identity || !context?.activateMewlink) { res.status(401).json({ error: 'Mewlink에 로그인한 연결에서 접속하세요' }); return }
    const session = resolveMewlinkSession(identity)
    if (!session) { res.status(403).json({ error: 'mew 관리자의 접근 승인이 필요합니다' }); return }
    context.activateMewlink()
    res.setHeader('x-mew-session', '')
    res.json({ ok: true, email: session.email, role: session.user.role, mustChangePassword: false })
  }))
  router.post('/link', routeErrors((req, res) => {
    const context = remoteContext(req)
    const identity = context && (context.alive?.() ?? true) ? context.identity?.() ?? null : null
    if (!identity) { res.status(401).json({ error: 'Mewlink에 로그인한 연결에서 연결하세요' }); return }
    const session = context!.current()
    if (!session) { res.status(401).json({ error: '기존 이메일 계정으로 로그인한 뒤 연결하세요' }); return }
    if (session.authenticationMethod === 'mewlink' || !session.user.hash || session.user.mustChangePassword) {
      res.status(403).json({ error: '기존 이메일 계정으로 로그인한 뒤 연결하세요' }); return
    }
    const connect = () => linkMewlinkToAccount(identity, session.email, req.body?.previousAccountId)
    const link = context!.updateAccountAccess ? context!.updateAccountAccess(connect) : connect()
    res.json({ ok: true, link })
  }))
  return router
}

export function createMewlinkAdminRouter() {
  const router = express.Router()
  router.use(requireRole('owner'), express.json({ limit: '2kb' }))
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.get('/', routeErrors((_req, res) => { res.json(listMewlinkAccess()) }))
  router.post('/requests/:id/approve', routeErrors((req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) { res.status(400).json({ error: '계정 연결 정보를 입력하세요' }); return }
    res.json({ ok: true, link: approveMewlinkRequest(String(req.params.id), req.body) })
  }))
  router.post('/requests/:id/deny', routeErrors((req, res) => { denyMewlinkRequest(String(req.params.id)); res.json({ ok: true }) }))
  router.delete('/links/:id', routeErrors((req, res) => { unlinkMewlinkIdentity(String(req.params.id)); res.json({ ok: true }) }))
  return router
}
