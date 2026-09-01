import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, writeFileAtomic } from './dataDir.ts'

// 팀 배포(5000) 인증의 SSoT.
// - 사용자: .data/users.json — 내부 서버에서 usersCli.ts로만 등록/삭제하는 승인 리스트
// - 비밀번호: scrypt (Node 내장, per-user salt, 타이밍 안전 비교)
// - 세션: 서버측 저장 — 파일에는 토큰의 sha256만 남겨 파일이 유출돼도 세션 위조가 불가능하다
const USERS_FILE = path.join(DATA_DIR, 'users.json')
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json')

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

// scrypt 파라미터 (OWASP 권장 수준). 해시 문자열에 함께 기록하므로 나중에 올려도 기존 해시는 검증된다.
const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64
const SCRYPT_MAXMEM = 128 * 1024 * 1024

export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 256

export const ACCOUNT_ROLES = ['owner', 'manager', 'member'] as const
export type AccountRole = (typeof ACCOUNT_ROLES)[number]

export function isAccountRole(v: unknown): v is AccountRole {
  return typeof v === 'string' && (ACCOUNT_ROLES as readonly string[]).includes(v)
}

export interface UserRecord {
  hash: string
  /** owner: 역할 부여·계정 추가 포함 전권. manager: 터미널·에이전트 포함 전권(계정 관리 제외). member: 터미널·에이전트만 불가 */
  role: AccountRole
  mustChangePassword: boolean
  createdAt: number
  /** 이 시각 이전에 만든 세션은 전부 무효 — CLI reset·비밀번호 변경의 크로스 프로세스 세션 폐기 수단 */
  passwordChangedAt: number
  /** 화면에 쓰는 이름. 없으면 이메일의 @ 앞부분을 쓴다(기존 계정 호환). */
  displayName?: string
  /** 설정 화면에서 검증한 안전한 래스터 이미지 data URL. */
  avatarDataUrl?: string
}

export interface UserProfile {
  email: string
  displayName: string
  avatarDataUrl: string | null
}

/** role 필드가 없는 구버전 레코드(마이그레이션 이전 users.json)는 member로 취급한다 */
function normalizeRecord(record: UserRecord): UserRecord {
  return isAccountRole(record.role) ? record : { ...record, role: 'member' }
}

interface UsersFile {
  version: 1
  users: Record<string, UserRecord>
}

interface SessionRecord {
  email: string
  createdAt: number
  expiresAt: number
}

// ---------- 파일 유틸 ----------

// ---------- 비밀번호 ----------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, nStr, rStr, pStr, saltB64, keyB64] = parts
  const salt = Buffer.from(saltB64, 'base64')
  const expected = Buffer.from(keyB64, 'base64')
  try {
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
      maxmem: SCRYPT_MAXMEM,
    })
    return crypto.timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

// 존재하지 않는 이메일에도 같은 비용의 scrypt를 돌려 사용자 존재 여부를 응답 시간으로 노출하지 않는다
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'))

export function verifyAgainstDummy(password: string) {
  verifyPassword(password, DUMMY_HASH)
}

/** 비밀번호 정책 위반이면 사용자에게 보여줄 메시지를, 통과하면 null을 반환 */
export function validateNewPassword(password: string, email: string): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다`
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `비밀번호는 ${PASSWORD_MAX_LENGTH}자 이하여야 합니다`
  }
  if (password.toLowerCase() === email.toLowerCase()) {
    return '이메일과 같은 비밀번호는 쓸 수 없습니다'
  }
  return null
}

/** 임시 비밀번호 — 헷갈리는 문자(0/O, 1/l/I)를 뺀 알파벳으로 생성 */
export function generateTempPassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 16; i++) out += alphabet[crypto.randomInt(alphabet.length)]
  return out
}

export function normalizeEmail(email: unknown): string {
  return String(email ?? '').trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
}

// ---------- 사용자 저장소 ----------
// CLI(별도 프로세스)가 파일을 고치는 즉시 서버에도 반영돼야 하므로 mtime이 바뀌면 다시 읽는다.

let usersCache: UsersFile | null = null
let usersCacheMtime = -1

function loadUsers(): UsersFile {
  let mtime = -1
  try {
    mtime = fs.statSync(USERS_FILE).mtimeMs
  } catch {
    usersCache = null
    return { version: 1, users: {} }
  }
  if (usersCache && mtime === usersCacheMtime) return usersCache
  const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')) as UsersFile
  usersCache = parsed
  usersCacheMtime = mtime
  return parsed
}

function saveUsers(data: UsersFile) {
  writeFileAtomic(USERS_FILE, JSON.stringify(data, null, 2) + '\n')
  usersCache = null
}

export function getUser(email: string): UserRecord | null {
  const record = loadUsers().users[normalizeEmail(email)]
  return record ? normalizeRecord(record) : null
}

function fallbackDisplayName(email: string): string {
  return email.split('@')[0] || email
}

/** 비밀번호 해시·역할을 빼고 협업 화면에 내보내도 되는 사용자 정보만 만든다. */
export function userProfile(email: string, record: UserRecord): UserProfile {
  return {
    email,
    displayName: record.displayName?.trim() || fallbackDisplayName(email),
    avatarDataUrl: record.avatarDataUrl ?? null,
  }
}

export function validateDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  const hasControl = Array.from(name).some((char) => {
    const code = char.codePointAt(0) ?? 0
    return code <= 0x1f || code === 0x7f
  })
  if (!name || name.length > 50 || hasControl) return null
  return name
}

const AVATAR_DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/
const MAX_AVATAR_BYTES = 512 * 1024

/** SVG는 data URL 안에서도 스크립트 표면이 되므로 정지 래스터 포맷만 받는다. */
export function validateAvatarDataUrl(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const matched = AVATAR_DATA_URL.exec(value)
  if (!matched) return undefined
  try {
    return Buffer.from(matched[2], 'base64').length <= MAX_AVATAR_BYTES ? value : undefined
  } catch {
    return undefined
  }
}

export function listUsers(): { email: string; record: UserRecord }[] {
  const { users } = loadUsers()
  return Object.keys(users)
    .sort()
    .map((email) => ({ email, record: normalizeRecord(users[email]) }))
}

export function upsertUser(email: string, record: UserRecord) {
  const data = loadUsers()
  data.users[normalizeEmail(email)] = record
  saveUsers(data)
}

export function removeUser(email: string): boolean {
  const data = loadUsers()
  const key = normalizeEmail(email)
  if (!(key in data.users)) return false
  delete data.users[key]
  saveUsers(data)
  return true
}

// ---------- 세션 저장소 ----------

const sessions = new Map<string, SessionRecord>()
let sessionsLoaded = false

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function ensureSessionsLoaded() {
  if (sessionsLoaded) return
  sessionsLoaded = true
  try {
    const parsed = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8')) as Record<string, SessionRecord>
    const now = Date.now()
    for (const [hash, rec] of Object.entries(parsed)) {
      if (rec.expiresAt > now) sessions.set(hash, rec)
    }
  } catch {
    // 파일이 없거나 깨졌으면 빈 상태에서 시작 — 로그인만 다시 하면 된다
  }
}

function persistSessions() {
  ensureSessionsLoaded()
  writeFileAtomic(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2) + '\n')
}

/** 로그인 성공 시 호출 — 원본 토큰은 이 반환값으로 한 번만 노출된다 */
export function createSession(email: string): string {
  ensureSessionsLoaded()
  const token = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  sessions.set(tokenHash(token), {
    email: normalizeEmail(email),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  })
  persistSessions()
  return token
}

export interface AuthenticatedSession {
  email: string
  user: UserRecord
}

/** 토큰 검증 — 만료·사용자 삭제·비밀번호 변경(passwordChangedAt) 시 모두 무효 처리 */
export function getSession(token: string | null): AuthenticatedSession | null {
  if (!token) return null
  ensureSessionsLoaded()
  const hash = tokenHash(token)
  const rec = sessions.get(hash)
  if (!rec) return null
  if (rec.expiresAt <= Date.now()) {
    sessions.delete(hash)
    persistSessions()
    return null
  }
  const user = getUser(rec.email)
  if (!user || rec.createdAt < user.passwordChangedAt) {
    sessions.delete(hash)
    persistSessions()
    return null
  }
  return { email: rec.email, user }
}

export function destroySession(token: string | null) {
  if (!token) return
  ensureSessionsLoaded()
  if (sessions.delete(tokenHash(token))) persistSessions()
}

// ---------- 로그인 레이트리밋 (브루트포스 방어) ----------

const RATE_WINDOW_MS = 15 * 60 * 1000
const RATE_MAX_FAILURES = 10

const loginFailures = new Map<string, { count: number; windowStart: number }>()

function pruneFailures(now: number) {
  for (const [key, rec] of loginFailures) {
    if (now - rec.windowStart > RATE_WINDOW_MS) loginFailures.delete(key)
  }
}

export function isLoginBlocked(ip: string, email: string): boolean {
  const now = Date.now()
  pruneFailures(now)
  for (const key of [`ip:${ip}`, `email:${email}`]) {
    const rec = loginFailures.get(key)
    if (rec && rec.count >= RATE_MAX_FAILURES) return true
  }
  return false
}

export function registerLoginFailure(ip: string, email: string) {
  const now = Date.now()
  for (const key of [`ip:${ip}`, `email:${email}`]) {
    const rec = loginFailures.get(key)
    if (!rec || now - rec.windowStart > RATE_WINDOW_MS) {
      loginFailures.set(key, { count: 1, windowStart: now })
    } else {
      rec.count++
    }
  }
}

export function clearLoginFailures(ip: string, email: string) {
  loginFailures.delete(`ip:${ip}`)
  loginFailures.delete(`email:${email}`)
}
