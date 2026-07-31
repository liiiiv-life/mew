import express from 'express'
import type { IncomingMessage } from 'node:http'
import {
  clearLoginFailures,
  createSession,
  destroySession,
  getSession,
  getUser,
  hashPassword,
  isLoginBlocked,
  isValidEmail,
  normalizeEmail,
  registerLoginFailure,
  SESSION_TTL_MS,
  upsertUser,
  validateNewPassword,
  verifyAgainstDummy,
  verifyPassword,
  type AuthenticatedSession,
} from './auth.ts'

const COOKIE_NAME = 'mew_session'

// ---------- 요청 파싱 헬퍼 ----------

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

export function sessionTokenFromRequest(req: IncomingMessage): string | null {
  return parseCookies(req.headers.cookie)[COOKIE_NAME] ?? null
}

/** HTTP 라우트·WS 업그레이드 공용 — 쿠키의 세션 토큰을 검증한다 */
export function sessionFromRequest(req: IncomingMessage): AuthenticatedSession | null {
  return getSession(sessionTokenFromRequest(req))
}

const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function clientIp(req: express.Request): string {
  // cloudflared는 항상 localhost로 접속하므로, 소켓 주소가 loopback일 때만 헤더를 신뢰한다.
  // 그렇지 않으면 tailnet에서 직접 접속한 클라이언트가 이 헤더를 위조해 IP 레이트리밋을 우회할 수 있다.
  if (LOOPBACK_ADDRS.has(req.socket.remoteAddress ?? '')) {
    const cf = req.headers['cf-connecting-ip']
    if (typeof cf === 'string' && cf) return cf
    const xff = req.headers['x-forwarded-for']
    if (typeof xff === 'string' && xff) return xff.split(',')[0].trim()
  }
  return req.socket.remoteAddress ?? 'unknown'
}

function isSecureRequest(req: express.Request): boolean {
  return req.secure || req.headers['x-forwarded-proto'] === 'https'
}

function setSessionCookie(req: express.Request, res: express.Response, token: string) {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ]
  // 터널(https) 경유면 Secure — tailnet의 평문 http 직접 접속에서는 붙이면 쿠키가 저장되지 않는다
  if (isSecureRequest(req)) attrs.push('Secure')
  res.setHeader('Set-Cookie', attrs.join('; '))
}

function clearSessionCookie(req: express.Request, res: express.Response) {
  const attrs = [`${COOKIE_NAME}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0']
  if (isSecureRequest(req)) attrs.push('Secure')
  res.setHeader('Set-Cookie', attrs.join('; '))
}

// ---------- 미들웨어 ----------

/**
 * CSRF 방어: 브라우저는 크로스 사이트 요청에 반드시 Origin을 붙이므로, Origin이 있는데
 * Host와 다르면 차단한다. (세션 쿠키가 SameSite=Lax라 1차 방어는 이미 되고, 이건 심층 방어)
 */
export function checkOrigin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next()
    return
  }
  const origin = req.headers.origin
  if (origin) {
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      res.status(403).json({ error: '잘못된 Origin입니다' })
      return
    }
    if (originHost !== req.headers.host) {
      res.status(403).json({ error: '허용되지 않은 Origin입니다' })
      return
    }
  }
  next()
}

// ---------- 라우터 ----------

export function createAuthRouter() {
  const router = express.Router()
  router.use(express.json({ limit: '10kb' }))

  router.post('/login', (req, res) => {
    const { email: rawEmail, password } = (req.body ?? {}) as { email?: unknown; password?: unknown }
    const email = normalizeEmail(rawEmail)
    if (!isValidEmail(email) || typeof password !== 'string' || !password || password.length > 1024) {
      res.status(400).json({ error: '이메일과 비밀번호를 입력하세요' })
      return
    }
    const ip = clientIp(req)
    if (isLoginBlocked(ip, email)) {
      res.status(429).json({ error: '로그인 시도가 너무 많습니다 — 15분 후 다시 시도하세요' })
      return
    }
    const user = getUser(email)
    if (!user) {
      verifyAgainstDummy(password)
      registerLoginFailure(ip, email)
      res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' })
      return
    }
    if (!verifyPassword(password, user.hash)) {
      registerLoginFailure(ip, email)
      res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' })
      return
    }
    clearLoginFailures(ip, email)
    const token = createSession(email)
    setSessionCookie(req, res, token)
    res.json({ ok: true, email, role: user.role, mustChangePassword: user.mustChangePassword })
  })

  router.post('/logout', (req, res) => {
    destroySession(sessionTokenFromRequest(req))
    clearSessionCookie(req, res)
    res.json({ ok: true })
  })

  router.get('/me', (req, res) => {
    const session = sessionFromRequest(req)
    res.json({
      authenticated: session !== null,
      email: session?.email ?? null,
      role: session ? session.user.role : 'guest',
      mustChangePassword: session?.user.mustChangePassword ?? false,
    })
  })

  router.post('/change-password', (req, res) => {
    const session = sessionFromRequest(req)
    if (!session) {
      res.status(401).json({ error: '로그인이 필요합니다' })
      return
    }
    const { currentPassword, newPassword } = (req.body ?? {}) as { currentPassword?: unknown; newPassword?: unknown }
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      res.status(400).json({ error: '현재 비밀번호와 새 비밀번호를 입력하세요' })
      return
    }
    if (!verifyPassword(currentPassword, session.user.hash)) {
      res.status(403).json({ error: '현재 비밀번호가 올바르지 않습니다' })
      return
    }
    const policyError = validateNewPassword(newPassword, session.email)
    if (policyError) {
      res.status(400).json({ error: policyError })
      return
    }
    if (newPassword === currentPassword) {
      res.status(400).json({ error: '현재 비밀번호와 다른 비밀번호를 사용하세요' })
      return
    }
    // passwordChangedAt으로 다른 기기의 기존 세션을 전부 무효화하고, 이 기기는 새 토큰으로 교체
    upsertUser(session.email, {
      ...session.user,
      hash: hashPassword(newPassword),
      mustChangePassword: false,
      passwordChangedAt: Date.now(),
    })
    destroySession(sessionTokenFromRequest(req))
    const token = createSession(session.email)
    setSessionCookie(req, res, token)
    res.json({ ok: true })
  })

  return router
}
