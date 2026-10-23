import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, DataFileError, readJsonFile, writeFileAtomic } from './dataDir.ts'
import type { MewlinkAccessRequest, MewlinkIdentityLink } from '../shared/mewlink-identity.ts'
import { gitConnections } from './git-connections.ts'
import { gitProviders } from './git-providers.ts'

// 팀 배포(5000) 인증의 SSoT.
// - 계정·로그인 수단: .data/users.json — 로컬 owner 또는 CLI가 승인하는 계정 디렉터리
// - 비밀번호: scrypt (Node 내장, per-user salt, 타이밍 안전 비교)
// - 세션: 서버측 저장 — 파일에는 토큰의 sha256만 남겨 파일이 유출돼도 세션 위조가 불가능하다
const USERS_FILE = path.join(DATA_DIR, 'users.json')
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json')

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const TRUSTED_DEVICE_TTL_MS = 90 * 24 * 60 * 60 * 1000
const TRUSTED_DEVICE_RENEW_INTERVAL_MS = 24 * 60 * 60 * 1000

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
  /** Stable local account key. Legacy accounts retain their email key for existing settings and ACLs. */
  id?: string
  hasPassword?: boolean
  contactEmail?: string
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

interface LegacyUsersFile {
  version: 1
  users: Record<string, UserRecord>
}

export interface LocalAccountRecord {
  id: string
  role: AccountRole
  createdAt: number
  displayName?: string
  avatarDataUrl?: string
  contactEmail?: string
}

interface PasswordCredential {
  email: string
  hash: string
  mustChangePassword: boolean
  passwordChangedAt: number
}

export interface StoredMewlinkRequest extends MewlinkAccessRequest {
  expiresAt: number
  decidedAt?: number
}

/** Profile, credentials, and approved identities share one atomic transaction boundary. */
export interface AccountDirectory {
  version: 2
  accounts: Record<string, LocalAccountRecord>
  passwordCredentials: Record<string, PasswordCredential>
  mewlinkIdentities: Record<string, MewlinkIdentityLink>
  mewlinkRequests: Record<string, StoredMewlinkRequest>
}

export type MewlinkDirectory = Pick<AccountDirectory, 'mewlinkIdentities' | 'mewlinkRequests'>

interface SessionRecord {
  email: string
  createdAt: number
  expiresAt: number
  trustedDevice?: {
    id: string
    label: string
    authenticationMethod: 'password' | 'mewlink'
    passwordChangedAt: number
    credentialId?: string
  }
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

let usersCache: AccountDirectory | null = null
let usersCacheStamp = ''

function emptyAccountDirectory(): AccountDirectory {
  return { version: 2, accounts: {}, passwordCredentials: {}, mewlinkIdentities: {}, mewlinkRequests: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function migrateUsers(value: unknown): AccountDirectory {
  const invalid = () => { throw new DataFileError('계정 상태 파일 형식이 올바르지 않습니다: users.json') }
  if (!isRecord(value)) return invalid()
  if (value.version === 2) {
    if (![value.accounts, value.passwordCredentials, value.mewlinkIdentities, value.mewlinkRequests].every(isRecord)) return invalid()
    const parsed = value as unknown as AccountDirectory
    for (const [id, account] of Object.entries(parsed.accounts)) {
      if (!isRecord(account) || account.id !== id || !id || id !== normalizeEmail(id)
        || !isAccountRole(account.role) || !Number.isFinite(account.createdAt) || account.createdAt < 0) return invalid()
    }
    for (const credential of Object.values(parsed.passwordCredentials)) {
      if (!isRecord(credential) || typeof credential.email !== 'string' || typeof credential.hash !== 'string'
        || typeof credential.mustChangePassword !== 'boolean' || !Number.isFinite(credential.passwordChangedAt)
        || credential.passwordChangedAt < 0) return invalid()
    }
    if (!Object.values(parsed.mewlinkIdentities).every(isRecord) || !Object.values(parsed.mewlinkRequests).every(isRecord)) return invalid()
    return parsed
  }
  if (value.version !== 1 || !isRecord(value.users)) return invalid()
  const parsed = value as unknown as LegacyUsersFile
  const directory = emptyAccountDirectory()
  for (const [email, raw] of Object.entries(parsed.users)) {
    if (!isRecord(raw) || typeof raw.hash !== 'string' || !Number.isFinite(raw.createdAt)) return invalid()
    const record = normalizeRecord(raw), id = normalizeEmail(email)
    directory.accounts[id] = accountProfile(id, record)
    directory.passwordCredentials[id] = {
      email: id, hash: record.hash, mustChangePassword: record.mustChangePassword,
      passwordChangedAt: record.passwordChangedAt,
    }
  }
  return directory
}

function loadUsers(): AccountDirectory {
  let stamp: string
  try {
    const stat = fs.statSync(USERS_FILE)
    stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    usersCache = null
    return emptyAccountDirectory()
  }
  if (usersCache && stamp === usersCacheStamp) return usersCache
  usersCache = migrateUsers(readJsonFile<unknown>(USERS_FILE))
  usersCacheStamp = stamp
  return usersCache
}

function saveUsers(data: AccountDirectory) {
  writeFileAtomic(USERS_FILE, JSON.stringify(data, null, 2) + '\n')
  usersCache = null
}

export function readAccountDirectory(): AccountDirectory {
  return structuredClone(loadUsers())
}

/** Authentication checks need only external identities, without copying every avatar or credential. */
export function readMewlinkDirectory(): MewlinkDirectory {
  const { mewlinkIdentities, mewlinkRequests } = loadUsers()
  return structuredClone({ mewlinkIdentities, mewlinkRequests })
}

/** Mutations are synchronous and save once; failed approvals cannot leave orphan accounts. */
export function mutateAccountDirectory<T>(update: (directory: AccountDirectory) => T): T {
  const data = readAccountDirectory()
  const result = update(data)
  saveUsers(data)
  return result
}

function accountProfile(id: string, record: UserRecord): LocalAccountRecord {
  return {
    id, role: isAccountRole(record.role) ? record.role : 'member', createdAt: record.createdAt,
    ...(record.displayName !== undefined ? { displayName: record.displayName } : {}),
    ...(record.avatarDataUrl !== undefined ? { avatarDataUrl: record.avatarDataUrl } : {}),
    ...(record.contactEmail !== undefined ? { contactEmail: record.contactEmail } : isValidEmail(id) ? { contactEmail: id } : {}),
  }
}

export function getUser(accountId: string): UserRecord | null {
  const data = loadUsers(), id = normalizeEmail(accountId)
  if (!Object.hasOwn(data.accounts, id)) return null
  const profile = data.accounts[id], credential = Object.hasOwn(data.passwordCredentials, id) ? data.passwordCredentials[id] : undefined
  return {
    ...profile, role: isAccountRole(profile.role) ? profile.role : 'member',
    hasPassword: !!credential?.hash, hash: credential?.hash ?? '',
    mustChangePassword: credential?.mustChangePassword ?? false,
    passwordChangedAt: credential?.passwordChangedAt ?? 0,
  }
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
  return Object.keys(loadUsers().accounts)
    .sort()
    .map((email) => ({ email, record: getUser(email)! }))
}

export function upsertUser(accountId: string, record: UserRecord) {
  mutateAccountDirectory(data => {
    const id = normalizeEmail(accountId), previous = Object.hasOwn(data.passwordCredentials, id) ? data.passwordCredentials[id] : undefined
    data.accounts[id] = accountProfile(id, record)
    // Role/profile changes cannot turn an identity-only account into a password account.
    if (record.hash || previous) data.passwordCredentials[id] = {
      email: previous?.email ?? record.contactEmail ?? id,
      hash: record.hash, mustChangePassword: record.mustChangePassword,
      passwordChangedAt: record.passwordChangedAt,
    }
  })
}

/** Revoke stored sessions and Git credentials, including after an atomic account merge. */
export function revokeAccountCredentials(accountId: string): void {
  const key = normalizeEmail(accountId)
  for (const provider of gitProviders) gitConnections.remove(key, provider.id, provider.host)
  ensureSessionsLoaded()
  let sessionsChanged = false
  for (const [hash, session] of sessions) {
    if (session.email === key) { sessions.delete(hash); sessionsChanged = true }
  }
  if (sessionsChanged) persistSessions()
}

export function removeUser(accountId: string): boolean {
  const key = normalizeEmail(accountId)
  if (!Object.hasOwn(loadUsers().accounts, key)) return false
  revokeAccountCredentials(key)
  return mutateAccountDirectory(data => {
    delete data.accounts[key]
    delete data.passwordCredentials[key]
    for (const [id, link] of Object.entries(data.mewlinkIdentities)) if (link.accountId === key) delete data.mewlinkIdentities[id]
    for (const [id, request] of Object.entries(data.mewlinkRequests)) if (request.accountId === key) delete data.mewlinkRequests[id]
    return true
  })
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
  authenticationMethod?: 'password' | 'mewlink'
  /** Pins a remote session to the exact owner-approved binding, including its revocation. */
  credentialId?: string
  trustedDevice?: { id: string; label: string }
}

export function validateRemoteDeviceLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const label = value.trim()
  const hasControl = Array.from(label).some(character => {
    const code = character.codePointAt(0) ?? 0
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
  })
  return label && label.length <= 120 && !hasControl ? label : null
}

/** A trusted token is usable only after the transport has proved possession of this browser key. */
export function createTrustedDeviceSession(session: AuthenticatedSession, browserKey: string, label: string, previousToken: string | null = null): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(browserKey) || !validateRemoteDeviceLabel(label) || session.user.mustChangePassword) throw new Error('invalid-trusted-device')
  if (session.authenticationMethod === 'mewlink' && !session.credentialId) throw new Error('invalid-trusted-identity')
  ensureSessionsLoaded()
  const token = crypto.randomBytes(32).toString('base64url'), now = Date.now()
  sessions.set(tokenHash(token), {
    email: session.email, createdAt: now, expiresAt: now + TRUSTED_DEVICE_TTL_MS,
    trustedDevice: {
      id: browserKey, label: validateRemoteDeviceLabel(label)!,
      authenticationMethod: session.authenticationMethod ?? 'password',
      passwordChangedAt: session.user.passwordChangedAt,
      ...(session.credentialId ? { credentialId: session.credentialId } : {}),
    },
  })
  if (previousToken) sessions.delete(tokenHash(previousToken))
  persistSessions()
  return token
}

/** 토큰 검증 — 만료·사용자 삭제·비밀번호 변경(passwordChangedAt) 시 모두 무효 처리 */
export function getSession(token: string | null, browserKey?: string): AuthenticatedSession | null {
  if (!token) return null
  ensureSessionsLoaded()
  const hash = tokenHash(token)
  const rec = sessions.get(hash)
  if (!rec) return null
  if (rec.trustedDevice && rec.trustedDevice.id !== browserKey) return null
  if (rec.expiresAt <= Date.now()) {
    sessions.delete(hash)
    persistSessions()
    return null
  }
  const user = getUser(rec.email)
  if (!user || rec.createdAt < user.passwordChangedAt || (rec.trustedDevice && rec.trustedDevice.passwordChangedAt !== user.passwordChangedAt)) {
    sessions.delete(hash)
    persistSessions()
    return null
  }
  const device = rec.trustedDevice
  if (device?.authenticationMethod === 'mewlink') {
    const data = loadUsers()
    const link = device.credentialId && Object.hasOwn(data.mewlinkIdentities, device.credentialId) ? data.mewlinkIdentities[device.credentialId] : null
    if (!link || link.accountId !== rec.email) {
      sessions.delete(hash)
      persistSessions()
      return null
    }
    renewTrustedSession(rec)
    return { email: rec.email, user: { ...user, mustChangePassword: false }, authenticationMethod: 'mewlink', credentialId: device.credentialId, trustedDevice: { id: device.id, label: device.label } }
  }
  if (device) renewTrustedSession(rec)
  return { email: rec.email, user, authenticationMethod: 'password', ...(device ? { trustedDevice: { id: device.id, label: device.label } } : {}) }
}

function renewTrustedSession(record: SessionRecord) {
  const now = Date.now()
  if (record.expiresAt <= now + TRUSTED_DEVICE_TTL_MS - TRUSTED_DEVICE_RENEW_INTERVAL_MS) {
    record.expiresAt = now + TRUSTED_DEVICE_TTL_MS
    persistSessions()
  }
}

/** Active connections renew at most once daily; a successful key-proven resume also resets inactivity. */
export function resumeRemoteSession(token: string, browserKey?: string): AuthenticatedSession | null {
  const session = getSession(token, browserKey)
  if (session?.trustedDevice) {
    sessions.get(tokenHash(token))!.expiresAt = Date.now() + TRUSTED_DEVICE_TTL_MS
    persistSessions()
  }
  return session
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
