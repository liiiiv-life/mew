import type { Server } from 'node:http'
import { fork, type ChildProcess } from 'node:child_process'
import express from 'express'
import { WebSocket } from 'ws'
import { calculateJwkThumbprint, type JWK } from 'jose'
import { REMOTE_LIMITS, REMOTE_PROTOCOL, type RemoteStatus } from '../shared/remote-access.ts'
import { remoteKeyPair, signRemoteToken, verifyRemoteToken, randomId, validateOffer } from '../shared/remote-access-crypto.ts'
import { readRemoteRegistration, saveRemoteRegistration } from './remote-access-state.ts'
import { remoteDispatcher } from './remote-access-dispatch.ts'
import { getUser, type AuthenticatedSession } from './auth.ts'
import { authOf, requireRole } from './reqAuth.ts'
import { accessChanges } from './access-policy.ts'
type Negotiation = { subject: string; challenge: string; generation: string; fingerprint: string; browserKey: JWK; sdp: string; candidate: Record<string, any>[]; expires: number; peer?: ChildProcess; dispatcher?: ReturnType<typeof remoteDispatcher> }
export function createRemoteAgent(server: Server) {
  let registration = readRemoteRegistration(), ws: WebSocket | undefined, retry: ReturnType<typeof setTimeout> | undefined, stopped = false, retryCount = 0
  let status: RemoteStatus = { enabled: !!registration, state: registration ? 'connecting' : 'disabled' }
  let pending: { origin: string; key: Awaited<ReturnType<typeof remoteKeyPair>>; code: string; challenge: string; email: string; expires: number } | undefined
  let polling = false, registering = false
  let registrationAttempt = 0
  const negotiations = new Map<string, Negotiation>(), sends = new Map<string, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; connection: string }>()
  const emit = (value: unknown) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)) }
  const accountFor = (subject: string): AuthenticatedSession | null => {
    const email = registration?.accounts[subject], user = email ? getUser(email) : null
    return user && !user.mustChangePassword ? { email: email!, user } : null
  }
  function closeConnection(id: string) {
    const negotiation = negotiations.get(id); negotiations.delete(id)
    negotiation?.dispatcher?.close()
    if (negotiation?.peer?.connected) negotiation.peer.send({ type: 'close' })
    const peer = negotiation?.peer
    if (peer) { const timer = setTimeout(() => { if (peer.exitCode === null) peer.kill() }, 1500); timer.unref(); peer.once('exit', () => clearTimeout(timer)) }
    for (const [key, waiter] of sends) if (waiter.connection === id) { sends.delete(key); clearTimeout(waiter.timer); waiter.reject(new Error('connection-closed')) }
  }
  const check = () => { for (const [id, negotiation] of negotiations) if (negotiation.expires < Date.now() || !accountFor(negotiation.subject)) closeConnection(id) }
  const interval = setInterval(check, 1000); interval.unref(); accessChanges.on('change', check)
  const sendData = (id: string, peer: ChildProcess, data: string) => new Promise<void>((resolve, reject) => {
    if (!peer.connected || Buffer.byteLength(data) > REMOTE_LIMITS.frame || sends.size > 64) { reject(new Error('send-limit')); return }
    const sendId = randomId(), timer = setTimeout(() => { sends.delete(sendId); reject(new Error('send-timeout')); closeConnection(id) }, 10_000); timer.unref()
    sends.set(sendId, { resolve, reject, timer, connection: id }); peer.send({ type: 'send', id: sendId, data }, error => { if (error) { clearTimeout(timer); sends.delete(sendId); reject(error) } })
  })
  async function handle(value: Record<string, any>) {
    if (!registration) return
    if (value.type === 'challenge') { if (value.protocol !== REMOTE_PROTOCOL) throw new Error('version-mismatch'); emit({ type: 'host', instance: registration.instance, proof: await signRemoteToken(registration.privateKey, 'mew-instance', `${registration.origin}/signal`, registration.instance, { nonce: value.nonce }) }); return }
    if (value.type === 'online') { status = { enabled: true, state: 'online', url: `${registration.origin}/${registration.owner}/${registration.name}` }; retryCount = 0; return }
    if (value.type === 'prepare') {
      if (negotiations.size >= 8 || value.instance !== registration.instance || !accountFor(value.subject) || typeof value.connection !== 'string' || negotiations.has(value.connection)) { emit({ type: 'error', connection: value.connection, code: 'local-permission-denied' }); return }
      const fingerprint = validateOffer(value.sdp)
      if (fingerprint !== value.fingerprint || value.browserKey?.kty !== 'OKP' || value.browserKey?.d) throw new Error('invalid-prepare')
      const negotiation: Negotiation = { subject: value.subject, challenge: randomId(), generation: randomId(), fingerprint, browserKey: value.browserKey, sdp: value.sdp, candidate: [], expires: Date.now() + REMOTE_LIMITS.ticket }
      negotiations.set(value.connection, negotiation)
      emit({ type: 'ready', connection: value.connection, challenge: negotiation.challenge, generation: negotiation.generation, fingerprint, browserKey: negotiation.browserKey }); return
    }
    const negotiation = negotiations.get(value.connection)
    if (!negotiation) return
    if (value.type === 'end') { closeConnection(value.connection); return }
    if (value.type === 'lease') { if (!negotiation.dispatcher) return; if (typeof value.expires !== 'number' || value.expires > Date.now() + REMOTE_LIMITS.lease + 2000) throw new Error('invalid-lease'); negotiation.expires = Math.min(value.expires, Date.now() + REMOTE_LIMITS.lease); return }
    if (value.type === 'candidate') { if (negotiation.peer?.connected) negotiation.peer.send(value); else if (negotiation.candidate.length < 128) negotiation.candidate.push(value); return }
    if (value.type !== 'ticket' || negotiation.peer || negotiation.expires < Date.now()) return
    const claims = await verifyRemoteToken(value.ticket, registration.centralKey, registration.origin, registration.instance)
    if (claims.sub !== negotiation.subject || claims.challenge !== negotiation.challenge || claims.generation !== negotiation.generation || claims.connection !== value.connection || claims.fingerprint !== negotiation.fingerprint || await calculateJwkThumbprint(claims.browserKey as JWK) !== await calculateJwkThumbprint(negotiation.browserKey)) throw new Error('invalid-ticket')
    const peer = fork(new URL('./remote-access-rtc.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { PATH: process.env.PATH }, execArgv: [] })
    negotiation.peer = peer
    let authenticated = false, receiving = Promise.resolve(), authenticating = false, queued = 0
    const current = () => { if (!authenticated || negotiations.get(value.connection) !== negotiation || negotiation.expires <= Date.now()) return null; return accountFor(negotiation.subject) }
    peer.on('message', message => {
      const msg = message as Record<string, any>
      if (negotiations.get(value.connection) !== negotiation) return
      if (msg.type === 'sent') { const waiter = sends.get(msg.id); if (waiter) { sends.delete(msg.id); clearTimeout(waiter.timer); waiter.resolve() }; return }
      if (msg.type === 'answer') {
        const fingerprint = validateOffer(msg.sdp)
        void signRemoteToken(registration!.privateKey, 'mew-instance', value.connection, registration!.instance, { fingerprint, challenge: negotiation.challenge, generation: negotiation.generation }).then(proof => emit({ type: 'answer', connection: value.connection, sdp: msg.sdp, proof })).catch(() => closeConnection(value.connection)); return
      }
      if (msg.type === 'candidate') { emit({ ...msg, connection: value.connection }); return }
      if (msg.type === 'error') { emit({ type: 'error', connection: value.connection, code: 'rtc-unavailable' }); closeConnection(value.connection); return }
      if (msg.type !== 'data') return
      if (++queued > 128 || typeof msg.data !== 'string' || Buffer.byteLength(msg.data) > REMOTE_LIMITS.frame) { closeConnection(value.connection); return }
      receiving = receiving.then(async () => {
        if (!authenticated) {
          if (authenticating) throw new Error('duplicate-auth')
          authenticating = true
          const auth = JSON.parse(msg.data)
          if (auth.type !== 'authenticate' || auth.ticket !== value.ticket) throw new Error('invalid-auth')
          const proof = await verifyRemoteToken(auth.proof, negotiation.browserKey, 'mew-browser', registration!.instance)
          if (proof.sub !== negotiation.subject || proof.connection !== value.connection || proof.challenge !== negotiation.challenge || proof.generation !== negotiation.generation || proof.fingerprint !== negotiation.fingerprint) throw new Error('invalid-peer')
          authenticated = true
          negotiation.dispatcher = remoteDispatcher(server, { send: data => sendData(value.connection, peer, data), close: () => closeConnection(value.connection) }, current, registration!.origin)
          await sendData(value.connection, peer, JSON.stringify({ type: 'authenticated', protocol: REMOTE_PROTOCOL })); return
        }
        await negotiation.dispatcher?.receive(msg.data)
      }).catch(() => closeConnection(value.connection)).finally(() => { queued-- })
    })
    peer.on('error', () => closeConnection(value.connection)); peer.on('exit', () => { emit({ type: 'error', connection: value.connection, code: 'connection-closed' }); closeConnection(value.connection) })
    const ping = setInterval(() => { if (peer.connected) peer.send({ type: 'ping' }) }, 2000); ping.unref(); peer.once('exit', () => clearInterval(ping))
    peer.send({ type: 'start', sdp: negotiation.sdp, stun: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] })
    for (const candidate of negotiation.candidate) peer.send(candidate); negotiation.candidate = []
  }
  function connect() {
    if (!registration || stopped) return
    status = { ...status, enabled: true, state: 'connecting' }
    const socket = new WebSocket(`${registration.origin.replace('https:', 'wss:')}/central/signal`, { origin: registration.origin, maxPayload: REMOTE_LIMITS.signal })
    ws = socket
    let queue = Promise.resolve()
    ws.on('message', raw => { queue = queue.then(() => { if (ws === socket && registration && !stopped) return handle(JSON.parse(raw.toString())) }).catch(() => socket.close()) })
    ws.on('error', () => { if (ws === socket && registration && !stopped) status = { ...status, state: 'offline', error: '중앙 서비스에 연결하지 못했습니다.' } })
    ws.on('close', () => { if (stopped || !registration || ws !== socket) return; for (const id of negotiations.keys()) closeConnection(id); status = { ...status, state: 'offline' }; retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(retryCount++, 5)) + Math.random() * 1000); retry.unref() })
    ws.on('open', () => { ws?.ping() })
  }
  async function poll() {
    if (!pending || polling) return
    if (pending.expires < Date.now()) { pending = undefined; status = { enabled: false, state: 'error', error: '등록 요청이 만료됐습니다.' }; return }
    polling = true
    try {
      const p = pending, proof = await signRemoteToken(p.key.privateKey, 'mew-instance', `${p.origin}/register`, await calculateJwkThumbprint(p.key.publicKey), { challenge: p.challenge, code: p.code })
      const response = await fetch(`${p.origin}/central/registrations/${p.code}/poll`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: p.origin }, body: JSON.stringify({ proof }), signal: AbortSignal.timeout(10_000), redirect: 'error' })
      if (!response.ok) throw new Error('등록을 확인하지 못했습니다.')
      const result = await response.json() as { pending?: boolean; instance: { id: string; owner: string; name: string }; publicKey: JWK; receipt: string }
      if (result.pending || pending !== p) return
      const receipt = await verifyRemoteToken(result.receipt, result.publicKey, p.origin, 'mew-registration')
      if (receipt.code !== p.code || receipt.challenge !== p.challenge || receipt.key !== await calculateJwkThumbprint(p.key.publicKey) || receipt.sub !== result.instance.id || receipt.owner !== result.instance.owner || receipt.name !== result.instance.name || !getUser(p.email) || getUser(p.email)?.role !== 'owner') throw new Error('등록 응답이 올바르지 않습니다.')
      if (pending !== p || stopped) return
      registration = { origin: p.origin, instance: result.instance.id, owner: result.instance.owner, name: result.instance.name, ...p.key, centralKey: result.publicKey, accounts: { [result.instance.owner]: p.email } }
      saveRemoteRegistration(registration); pending = undefined; connect()
    } catch (error) { status = { ...status, error: error instanceof Error ? error.message : '등록을 확인하지 못했습니다.' } }
    finally { polling = false }
  }
  const pollTimer = setInterval(() => { void poll() }, 3000); pollTimer.unref()
  const router = express.Router(); router.use(requireRole('owner')); router.use(express.json({ limit: '8kb' }))
  router.get('/', (_req, res) => res.json(status))
  router.post('/register', async (req, res) => {
    if (registration || pending || registering) return void res.status(409).json({ error: '기존 등록을 해제하거나 완료해 주세요.' })
    registering = true
    const attempt = ++registrationAttempt
    try {
      const origin = new URL(process.env.MEW_REMOTE_ORIGIN ?? 'https://mew.saens.kr').origin
      if (!origin.startsWith('https://')) throw new Error('중앙 서비스는 HTTPS 주소가 필요합니다.')
      const key = await remoteKeyPair()
      const response = await fetch(`${origin}/central/registrations`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ publicKey: key.publicKey }), redirect: 'error', signal: AbortSignal.timeout(10_000) })
      if (!response.ok) throw new Error('중앙 서비스에서 등록을 시작하지 못했습니다.')
      const reg = await response.json() as { code: string; challenge: string; expires: number; registrationUrl: string }
      if (!/^[a-zA-Z0-9_-]{20,64}$/.test(reg.code) || !reg.challenge || reg.expires <= Date.now() || reg.expires > Date.now() + 310_000 || reg.registrationUrl !== `${origin}/register/${reg.code}`) throw new Error('등록 응답이 올바르지 않습니다.')
      if (attempt !== registrationAttempt || stopped) throw new Error('등록 요청이 취소됐습니다.')
      pending = { origin, key, code: reg.code, challenge: reg.challenge, email: authOf(req).email!, expires: reg.expires }
      status = { enabled: false, state: 'registering', registrationUrl: reg.registrationUrl, expiresAt: reg.expires }; res.json(status)
    } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : '등록을 시작하지 못했습니다.' }) }
    finally { registering = false }
  })
  router.get('/members', (_req, res) => { res.json(Object.fromEntries(Object.entries(registration?.accounts ?? {}).filter(([subject]) => subject !== registration?.owner))) })
  router.put('/members', async (req, res) => {
    const reg = registration, { subject, email, enabled } = req.body ?? {}
    if (!reg || typeof subject !== 'string' || !/^[a-zA-Z0-9_-]{20,64}$/.test(subject) || typeof enabled !== 'boolean' || subject === reg.owner || (enabled && (typeof email !== 'string' || !getUser(email)))) return void res.status(400).json({ error: '중앙 계정 ID와 기존 로컬 계정을 확인해 주세요.' })
    // Revoke local authority before a network request; a failed request cannot restore it.
    if (!enabled) { delete reg.accounts[subject]; saveRemoteRegistration(reg); check() }
    try {
      const proof = await signRemoteToken(reg.privateKey, 'mew-instance', `${reg.origin}/members`, reg.instance, { subject, enabled })
      const response = await fetch(`${reg.origin}/central/members`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: reg.origin }, body: JSON.stringify({ instance: reg.instance, subject, enabled, proof }), signal: AbortSignal.timeout(10_000), redirect: 'error' })
      if (!response.ok || registration !== reg) throw new Error('멤버 권한을 반영하지 못했습니다.')
      if (enabled) { reg.accounts[subject] = email; saveRemoteRegistration(reg); check() }
      res.json(reg.accounts)
    } catch { res.status(502).json({ error: '중앙 정책을 반영하지 못했습니다. 권한 회수는 로컬에 즉시 적용됐습니다.' }) }
  })
  router.delete('/', async (_req, res) => {
    const reg = registration
    registrationAttempt++; pending = undefined; registration = null; saveRemoteRegistration(null); clearTimeout(retry); for (const id of negotiations.keys()) closeConnection(id); ws?.close(); status = { enabled: false, state: 'disabled' }
    if (reg) try {
      const proof = await signRemoteToken(reg.privateKey, 'mew-instance', `${reg.origin}/revoke`, reg.instance, {})
      const response = await fetch(`${reg.origin}/central/instances/${reg.instance}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: reg.origin }, body: JSON.stringify({ proof }), signal: AbortSignal.timeout(10_000), redirect: 'error' })
      if (!response.ok && response.status !== 404) throw new Error('revoke-failed')
    } catch { status.error = '로컬 연결은 해제됐습니다. 중앙 대시보드에서도 기기를 삭제해 주세요.' }
    res.json(status)
  })
  function close() { stopped = true; clearTimeout(retry); clearInterval(interval); clearInterval(pollTimer); accessChanges.off('change', check); for (const id of negotiations.keys()) closeConnection(id); ws?.terminate() }
  server.once('close', close)
  if (registration) connect()
  return { router, close, status: () => status }
}
