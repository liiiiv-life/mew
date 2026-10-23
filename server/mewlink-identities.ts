import crypto from 'node:crypto'
import {
  mewlinkIdentityKey, parseMewlinkIdentity,
  type MewlinkIdentity, type MewlinkAccessRequest, type MewlinkIdentityLink,
  type MewlinkAccessStatus, type MewlinkAccessOverview,
} from '../shared/mewlink-identity.ts'
import {
  getUser, mutateAccountDirectory, readMewlinkDirectory, validateDisplayName, revokeAccountCredentials,
  type AccountDirectory, type AuthenticatedSession, type StoredMewlinkRequest, type MewlinkDirectory,
} from './auth.ts'
import { accessChanges, removeAccountAccess } from './access-policy.ts'

const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DENIED_RETRY_MS = 15 * 60 * 1000
const MAX_PENDING_REQUESTS = 256
const MAX_DECIDED_REQUESTS = 256

export class MewlinkAccessError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

function validatedIdentity(value: MewlinkIdentity): MewlinkIdentity {
  const identity = parseMewlinkIdentity(value)
  if (!identity) throw new MewlinkAccessError(400, '올바르지 않은 Mewlink 계정입니다')
  return identity
}

function linkFor(data: MewlinkDirectory, identity: MewlinkIdentity): MewlinkIdentityLink | undefined {
  const key = mewlinkIdentityKey(identity)
  return Object.values(data.mewlinkIdentities).find(link => mewlinkIdentityKey(link.identity) === key)
}

function requestFor(data: MewlinkDirectory, identity: MewlinkIdentity, now: number): StoredMewlinkRequest | undefined {
  const key = mewlinkIdentityKey(identity)
  return Object.values(data.mewlinkRequests)
    .filter(request => request.expiresAt > now && mewlinkIdentityKey(request.identity) === key)
    .sort((a, b) => b.requestedAt - a.requestedAt)[0]
}

function publicRequest(request: StoredMewlinkRequest): MewlinkAccessRequest {
  const { id, identity, requestedAt, status, accountId } = request
  return { id, identity: structuredClone(identity), requestedAt, status, ...(accountId ? { accountId } : {}) }
}

function pruneRequests(data: AccountDirectory, now: number, latestDecisionId?: string): void {
  for (const [id, request] of Object.entries(data.mewlinkRequests)) {
    if (request.expiresAt <= now) delete data.mewlinkRequests[id]
  }
  const decided = Object.values(data.mewlinkRequests).reverse().filter(request => request.status !== 'pending')
    .sort((a, b) => {
      if (a.id === latestDecisionId) return -1
      if (b.id === latestDecisionId) return 1
      return (b.decidedAt ?? b.requestedAt) - (a.decidedAt ?? a.requestedAt)
    })
  for (const request of decided.slice(MAX_DECIDED_REQUESTS)) delete data.mewlinkRequests[request.id]
}

/** A signed central identity alone grants nothing; only a current local owner approval does. */
export function resolveMewlinkSession(value: MewlinkIdentity): AuthenticatedSession | null {
  const identity = parseMewlinkIdentity(value)
  if (!identity) return null
  const link = linkFor(readMewlinkDirectory(), identity)
  if (!link) return null
  const user = getUser(link.accountId)
  if (!user) return null
  return {
    email: link.accountId, user: { ...user, mustChangePassword: false },
    authenticationMethod: 'mewlink', credentialId: link.id,
  }
}

export function getMewlinkAccessStatus(value: MewlinkIdentity | null): MewlinkAccessStatus {
  const identity = value && parseMewlinkIdentity(value)
  if (!identity) return { identity: null, state: 'unavailable' }
  const data = readMewlinkDirectory(), link = linkFor(data, identity)
  if (link && getUser(link.accountId)) return { identity, state: 'approved', accountId: link.accountId }
  const request = requestFor(data, identity, Date.now())
  const state = request?.status === 'pending' || request?.status === 'denied' ? request.status : 'unlinked'
  return { identity, state }
}

export function requestMewlinkAccess(value: MewlinkIdentity): MewlinkAccessRequest {
  const identity = validatedIdentity(value), now = Date.now()
  const current = readMewlinkDirectory(), pending = requestFor(current, identity, now)
  if (linkFor(current, identity)) throw new MewlinkAccessError(409, '이미 승인된 Mewlink 계정입니다')
  // Repeated requests reuse the immutable approval snapshot without writing the account file.
  if (pending?.status === 'pending') return publicRequest(pending)
  return mutateAccountDirectory(data => {
    if (linkFor(data, identity)) throw new MewlinkAccessError(409, '이미 승인된 Mewlink 계정입니다')
    const existing = requestFor(data, identity, now)
    if (existing?.status === 'pending') return publicRequest(existing)
    if (existing?.status === 'denied' && now - (existing.decidedAt ?? existing.requestedAt) < DENIED_RETRY_MS) {
      throw new MewlinkAccessError(429, '접근 요청이 거절되었습니다. 15분 후 다시 요청하세요')
    }
    pruneRequests(data, now)
    for (const [id, request] of Object.entries(data.mewlinkRequests)) {
      if (mewlinkIdentityKey(request.identity) === mewlinkIdentityKey(identity)) delete data.mewlinkRequests[id]
    }
    if (Object.values(data.mewlinkRequests).filter(request => request.status === 'pending').length >= MAX_PENDING_REQUESTS) {
      throw new MewlinkAccessError(429, '대기 중인 접근 요청이 너무 많습니다. 나중에 다시 요청하세요')
    }
    const request: StoredMewlinkRequest = {
      id: crypto.randomBytes(16).toString('hex'), identity, requestedAt: now,
      expiresAt: now + REQUEST_TTL_MS, status: 'pending',
    }
    data.mewlinkRequests[request.id] = request
    return publicRequest(request)
  })
}

export function listMewlinkAccess(): MewlinkAccessOverview {
  const data = readMewlinkDirectory(), now = Date.now()
  return {
    requests: Object.values(data.mewlinkRequests).filter(request => request.expiresAt > now)
      .sort((a, b) => b.requestedAt - a.requestedAt).map(publicRequest),
    links: Object.values(data.mewlinkIdentities).filter(link => !!getUser(link.accountId))
      .sort((a, b) => b.linkedAt - a.linkedAt),
  }
}

function pendingRequest(data: AccountDirectory, id: string): StoredMewlinkRequest {
  if (!Object.hasOwn(data.mewlinkRequests, id)) throw new MewlinkAccessError(404, '접근 요청을 찾을 수 없습니다')
  const request = data.mewlinkRequests[id]
  if (request.status !== 'pending' || request.expiresAt <= Date.now()) throw new MewlinkAccessError(409, '처리되었거나 만료된 접근 요청입니다')
  return request
}

export interface ApproveMewlinkRequest {
  accountId?: unknown
  role?: unknown
  displayName?: unknown
}

export function approveMewlinkRequest(id: string, options: ApproveMewlinkRequest): MewlinkIdentityLink {
  const link = mutateAccountDirectory(data => {
    const request = pendingRequest(data, id)
    if (linkFor(data, request.identity)) throw new MewlinkAccessError(409, '이미 연결된 Mewlink 계정입니다')
    let accountId: string
    if (options.accountId !== undefined) {
      if (typeof options.accountId !== 'string' || !options.accountId || options.accountId.length > 254) throw new MewlinkAccessError(400, '연결할 mew 계정을 선택하세요')
      if (options.role !== undefined || options.displayName !== undefined) throw new MewlinkAccessError(400, '기존 계정 연결과 새 계정 생성을 동시에 요청할 수 없습니다')
      accountId = options.accountId
      if (!Object.hasOwn(data.accounts, accountId)) throw new MewlinkAccessError(404, '연결할 mew 계정을 찾을 수 없습니다')
    } else {
      const role = options.role ?? 'member'
      if (role !== 'member' && role !== 'manager') throw new MewlinkAccessError(400, '새 계정의 역할은 member 또는 manager로 선택하세요')
      const displayName = validateDisplayName(options.displayName ?? request.identity.displayName.slice(0, 50))
      if (!displayName) throw new MewlinkAccessError(400, '표시 이름은 1~50자로 입력하세요')
      accountId = `account_${crypto.randomBytes(16).toString('hex')}`
      data.accounts[accountId] = { id: accountId, role, displayName, createdAt: Date.now() }
    }
    const link: MewlinkIdentityLink = {
      id: crypto.randomBytes(16).toString('hex'), identity: structuredClone(request.identity), accountId, linkedAt: Date.now(),
    }
    data.mewlinkIdentities[link.id] = link
    request.status = 'approved'; request.accountId = accountId; request.decidedAt = link.linkedAt
    pruneRequests(data, link.linkedAt, request.id)
    return link
  })
  accessChanges.emit('change')
  return link
}

export function denyMewlinkRequest(id: string): void {
  mutateAccountDirectory(data => {
    const request = pendingRequest(data, id)
    request.status = 'denied'; request.decidedAt = Date.now()
    pruneRequests(data, request.decidedAt, request.id)
  })
}

/** The caller must prove both the transport identity and its current password account. */
export function linkMewlinkToAccount(value: MewlinkIdentity, accountId: string, previousAccountId: unknown): MewlinkIdentityLink {
  const identity = validatedIdentity(value)
  if (previousAccountId !== null && (typeof previousAccountId !== 'string' || !previousAccountId || previousAccountId.length > 254)) {
    throw new MewlinkAccessError(400, '현재 연결 상태를 확인한 뒤 다시 시도하세요')
  }
  let removedAccountId: string | null = null
  const link = mutateAccountDirectory(data => {
    const credential = Object.hasOwn(data.passwordCredentials, accountId) ? data.passwordCredentials[accountId] : null
    if (!Object.hasOwn(data.accounts, accountId) || !credential?.hash || credential.mustChangePassword) {
      throw new MewlinkAccessError(403, '기존 이메일 계정으로 로그인한 뒤 연결하세요')
    }
    const existing = linkFor(data, identity)
    if (existing?.accountId === accountId) return existing
    if ((existing?.accountId ?? null) !== previousAccountId) {
      throw new MewlinkAccessError(409, 'Mewlink 연결 상태가 변경됐습니다. 다시 확인한 뒤 연결하세요')
    }
    const removePrevious = existing && !data.passwordCredentials[existing.accountId]?.hash
      && !Object.values(data.mewlinkIdentities).some(link => link.id !== existing.id && link.accountId === existing.accountId)
    if (removePrevious && data.accounts[existing.accountId]?.role === 'owner'
      && Object.values(data.accounts).filter(account => account.role === 'owner').length === 1) {
      throw new MewlinkAccessError(409, '마지막 owner 계정은 병합으로 삭제할 수 없습니다')
    }
    if (existing) delete data.mewlinkIdentities[existing.id]
    const link: MewlinkIdentityLink = {
      id: crypto.randomBytes(16).toString('hex'), identity, accountId, linkedAt: Date.now(),
    }
    data.mewlinkIdentities[link.id] = link
    for (const [id, request] of Object.entries(data.mewlinkRequests)) {
      if (mewlinkIdentityKey(request.identity) === mewlinkIdentityKey(identity)) delete data.mewlinkRequests[id]
    }
    if (removePrevious) {
      removedAccountId = existing.accountId
      delete data.accounts[removedAccountId]
      delete data.passwordCredentials[removedAccountId]
      for (const [id, request] of Object.entries(data.mewlinkRequests)) {
        if (request.accountId === removedAccountId) delete data.mewlinkRequests[id]
      }
    }
    return link
  })
  try {
    if (removedAccountId) {
      revokeAccountCredentials(removedAccountId)
      removeAccountAccess(removedAccountId)
    }
  } finally { accessChanges.emit('change') }
  return link
}

export function unlinkMewlinkIdentity(id: string): void {
  mutateAccountDirectory(data => {
    if (!Object.hasOwn(data.mewlinkIdentities, id)) throw new MewlinkAccessError(404, '연결된 Mewlink 계정을 찾을 수 없습니다')
    const link = data.mewlinkIdentities[id]
    delete data.mewlinkIdentities[id]
    for (const [requestId, request] of Object.entries(data.mewlinkRequests)) {
      if (mewlinkIdentityKey(request.identity) === mewlinkIdentityKey(link.identity)) delete data.mewlinkRequests[requestId]
    }
  })
  accessChanges.emit('change')
}
