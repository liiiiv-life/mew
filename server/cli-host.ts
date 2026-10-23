import './config.ts'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server } from 'node:http'
import type { UserRecord } from './auth.ts'
import type { RemoteStatus } from '../shared/remote-access.ts'

export type CliHostMessage =
  | { type: 'setup-needed' }
  | { type: 'owner-created'; email: string; password: string }
  | { type: 'ready'; url: string }
  | { type: 'remote-status'; status: RemoteStatus }
  | { type: 'error'; message: string }

export interface CliHostChannel {
  send(message: CliHostMessage): void
  onMessage(listener: (message: unknown) => void): () => void
}

export interface CliHostAuth {
  listUsers(): { email: string; record: Pick<UserRecord, 'role'> }[]
  getUser(email: string): Pick<UserRecord, 'role'> | null
  normalizeEmail(email: unknown): string
  isValidEmail(email: string): boolean
  generateTempPassword(): string
  hashPassword(password: string): string
  upsertUser(email: string, record: UserRecord): void
}

export interface CliHostRuntime {
  server: Pick<Server, 'listening' | 'address' | 'once' | 'off'>
  remoteAgent: { status(): RemoteStatus }
}

export interface CliHostOptions {
  auth: CliHostAuth
  channel: CliHostChannel
  loadRuntime(): Promise<CliHostRuntime>
  prepareWorkspace?(owner: string): void | Promise<void>
  ownerEmail?: string
  signal?: AbortSignal
  pollIntervalMs?: number
}

function cancelled(): Error {
  const error = new Error('mew 시작이 취소됐습니다.')
  error.name = 'AbortError'
  return error
}

function requestOwnerEmail(channel: CliHostChannel, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let removeMessage: () => void = () => {}
    const clean = () => {
      removeMessage()
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => { clean(); reject(cancelled()) }
    removeMessage = channel.onMessage(message => {
      if (!message || typeof message !== 'object') return
      const value = message as { type?: unknown; email?: unknown }
      if (value.type === 'setup-owner') { clean(); resolve(value.email) }
      if (value.type === 'setup-cancel') onAbort()
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) { onAbort(); return }
    try { channel.send({ type: 'setup-needed' }) } catch (error) { clean(); reject(error) }
  })
}

export async function ensureCliOwner(auth: CliHostAuth, channel: CliHostChannel, ownerEmail?: string, signal?: AbortSignal): Promise<string> {
  const findOwner = () => {
    const owners = auth.listUsers().filter(({ record }) => record.role === 'owner')
    return owners.find(({ email }) => email === auth.normalizeEmail(ownerEmail)) ?? owners[0]
  }
  const existing = findOwner()
  if (existing) return existing.email
  const rawEmail = ownerEmail ?? await requestOwnerEmail(channel, signal)
  if (signal?.aborted) throw cancelled()
  if (typeof rawEmail !== 'string') throw new Error('올바른 owner 이메일을 입력하세요.')
  const email = auth.normalizeEmail(rawEmail)
  if (!auth.isValidEmail(email)) throw new Error('올바른 owner 이메일을 입력하세요.')
  // 다른 관리 CLI가 설정을 마쳤거나 기존 계정이 있다면 비밀번호를 덮어쓰지 않는다.
  const concurrent = findOwner()
  if (concurrent) return concurrent.email
  if (auth.getUser(email)) throw new Error('이미 등록된 계정입니다. 다른 이메일을 쓰거나 기존 계정의 owner 역할을 설정하세요.')
  const password = auth.generateTempPassword(), now = Date.now()
  auth.upsertUser(email, {
    hash: auth.hashPassword(password), role: 'owner', mustChangePassword: true,
    createdAt: now, passwordChangedAt: now,
  })
  channel.send({ type: 'owner-created', email, password })
  return email
}

function publicHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return undefined
    return url.href
  } catch { return undefined }
}

/** Only the public status fields cross the launcher IPC channel, never registration keys or tokens. */
export function cliRemoteStatus(status: RemoteStatus): RemoteStatus {
  const url = publicHttpsUrl(status.url), registrationUrl = publicHttpsUrl(status.registrationUrl)
  return {
    enabled: status.enabled, state: status.state,
    ...(url ? { url } : {}),
    ...(registrationUrl ? { registrationUrl } : {}),
    ...(Number.isFinite(status.expiresAt) ? { expiresAt: status.expiresAt } : {}),
    ...(status.error ? { error: status.error } : {}),
  }
}

async function listeningUrl(server: CliHostRuntime['server'], signal?: AbortSignal): Promise<string> {
  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      const clean = () => {
        server.off('listening', onListening)
        server.off('error', onError)
        signal?.removeEventListener('abort', onAbort)
      }
      const onListening = () => { clean(); resolve() }
      const onError = (error: Error) => { clean(); reject(error) }
      const onAbort = () => { clean(); reject(cancelled()) }
      server.once('listening', onListening)
      server.once('error', onError)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
    })
  }
  if (signal?.aborted) throw cancelled()
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('mew의 로컬 접속 주소를 확인하지 못했습니다.')
  const host = address.address === '0.0.0.0' ? '127.0.0.1' : address.address === '::' ? '::1' : address.address
  return `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`
}

/** Dependencies are injectable so onboarding and readiness can be checked without starting mew. */
export async function startCliHost(options: CliHostOptions): Promise<{ close(): void }> {
  const { auth, channel, signal } = options
  const owner = await ensureCliOwner(auth, channel, options.ownerEmail, signal)
  if (signal?.aborted) throw cancelled()
  await options.prepareWorkspace?.(owner)
  if (signal?.aborted) throw cancelled()
  const runtime = await options.loadRuntime()
  channel.send({ type: 'ready', url: await listeningUrl(runtime.server, signal) })
  let previous = ''
  const reportStatus = () => {
    const status = cliRemoteStatus(runtime.remoteAgent.status()), current = JSON.stringify(status)
    if (previous !== current) { channel.send({ type: 'remote-status', status }); previous = current }
  }
  reportStatus()
  const interval = setInterval(reportStatus, options.pollIntervalMs ?? 1000)
  interval.unref()
  const close = () => {
    clearInterval(interval)
    runtime.server.off('close', close)
    signal?.removeEventListener('abort', close)
  }
  runtime.server.once('close', close)
  signal?.addEventListener('abort', close, { once: true })
  return { close }
}

async function main(): Promise<void> {
  if (!process.send) throw new Error('이 진입점은 mew CLI에서 실행해야 합니다.')
  const controller = new AbortController()
  let runtimeStarted = false
  let shutdownRuntime: (() => void) | undefined
  const stop = () => {
    if (runtimeStarted && shutdownRuntime) shutdownRuntime()
    else controller.abort()
  }
  const beforeStartSignal = () => controller.abort()
  process.once('SIGINT', beforeStartSignal)
  process.once('SIGTERM', beforeStartSignal)
  process.once('disconnect', stop)
  process.on('message', message => { if (message && typeof message === 'object' && (message as { type?: unknown }).type === 'shutdown') stop() })
  const channel: CliHostChannel = {
    send: message => {
      if (!process.connected || !process.send) throw new Error('mew CLI 연결이 종료됐습니다.')
      process.send(message, error => { if (error) stop() })
    },
    onMessage: listener => { process.on('message', listener); return () => { process.off('message', listener) } },
  }
  try {
    const { acquireInstanceLock } = await import('./instance-lock.ts')
    acquireInstanceLock()
    const auth = await import('./auth.ts')
    await startCliHost({
      auth, channel, ownerEmail: process.env.MEW_OWNER_EMAIL, signal: controller.signal,
      prepareWorkspace: async owner => {
        const { writeActiveWorkspace } = await import('./userUiState.ts')
        writeActiveWorkspace(owner, path.resolve(process.env.MEW_WORKSPACE ?? process.cwd()))
      },
      loadRuntime: async () => {
        runtimeStarted = true
        process.off('SIGINT', beforeStartSignal)
        process.off('SIGTERM', beforeStartSignal)
        // serve owns normal shutdown and optional desktop components stay lazy.
        const runtime = await import('./serve.ts')
        shutdownRuntime = runtime.shutdownServer
        if (controller.signal.aborted) shutdownRuntime()
        return runtime
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') process.exit(0)
    const message = error instanceof Error ? error.message : 'mew를 시작하지 못했습니다.'
    if (process.connected && process.send) {
      await new Promise<void>(resolve => {
        process.send!({ type: 'error', message } satisfies CliHostMessage, () => resolve())
      })
    }
    else console.error(message)
    process.exit(1)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(error => { console.error(error instanceof Error ? error.message : 'mew를 시작하지 못했습니다.'); process.exit(1) })
}
