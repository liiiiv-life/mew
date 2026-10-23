import type { Server } from 'node:http'
import { isIP } from 'node:net'
import { fork, type ChildProcess } from 'node:child_process'
import express from 'express'
import { WebSocket } from 'ws'
import { calculateJwkThumbprint, type JWK } from 'jose'
import { REMOTE_LIMITS, REMOTE_PROTOCOL, type RemoteNetworkStatus, type RemoteStatus } from '../shared/remote-access.ts'
import { remoteKeyPair, signRemoteToken, verifyRemoteToken, randomId, validateOffer } from '../shared/remote-access-crypto.ts'
import { readRemoteRegistration, saveRemoteRegistration, type RemoteRegistration } from './remote-access-state.ts'
import { remoteDispatcher } from './remote-access-dispatch.ts'
import { remoteTicketInbox } from './remote-access-ticket-inbox.ts'
import { getUser } from './auth.ts'
import { createRemoteAuthentication } from './remote-authentication.ts'
import { parseMewlinkIdentity } from '../shared/mewlink-identity.ts'
import { authOf, requireRole } from './reqAuth.ts'
import { accessChanges, accessRevision } from './access-policy.ts'
import { createRemoteNetworkPreparation } from './remote-access-network.ts'
import { resolveRemoteAddress } from './remote-access-address.ts'
type VerifiedTicket = { ticket: string; identity: ReturnType<typeof parseMewlinkIdentity> }
type Negotiation = { subject: string; clientIp: string; authentication?: ReturnType<typeof createRemoteAuthentication>; challenge: string; generation: string; fingerprint: string; browserKey: JWK; sdp: string; candidate: Record<string, any>[]; expires: number; signalResume?: boolean; peer?: ChildProcess; dispatcher?: ReturnType<typeof remoteDispatcher>; ticket?: string; inbox?: ReturnType<typeof remoteTicketInbox<VerifiedTicket>> }
export function createRemoteAgent(server: Server, options: { network?: ReturnType<typeof createRemoteNetworkPreparation>; forkPeer?: () => ChildProcess } = {}) {
  let registration = readRemoteRegistration(), ws: WebSocket | undefined, retry: ReturnType<typeof setTimeout> | undefined, stopped = false, retryCount = 0
  let status: RemoteStatus = { enabled: !!registration, state: registration ? 'connecting' : 'disabled' }
  let pending: { origin: string; key: Awaited<ReturnType<typeof remoteKeyPair>>; code: string; challenge: string; email: string; expires: number } | undefined
  let polling = false, registering = false
  let registrationAttempt = 0
  const networkPreparation = options.network ?? createRemoteNetworkPreparation()
  let network: RemoteNetworkStatus = { state: 'checking' }, preparing: Promise<RemoteNetworkStatus> | undefined, networkVersion = 0
  let address: Awaited<ReturnType<typeof resolveRemoteAddress>> | undefined, addressError: string | undefined, addressChecked = 0, addressRequest: Promise<void> | undefined
  const refreshAddress = (force = false) => {
    if (!registration || stopped) return Promise.resolve()
    if (addressRequest) return addressRequest
    if (!force && Date.now() - addressChecked < 60_000) return Promise.resolve()
    const current = registration
    addressChecked = Date.now()
    addressRequest = resolveRemoteAddress(current.origin, current.owner, current.name).then(result => {
      if (registration === current && !stopped) { address = result; addressError = undefined }
    }).catch(() => {
      if (registration === current && !stopped) { address = undefined; addressError = '접속 주소를 확인하지 못했습니다. 새로고침해 주세요.' }
    }).finally(() => { addressRequest = undefined })
    return addressRequest
  }
  const snapshot = (): RemoteStatus => ({ ...status, network, ...(registration ? { ...address, deviceName: registration.name, dashboardUrl: address?.dashboardUrl ?? (registration.origin === 'https://mew.saens.kr' ? 'https://mew.run' : registration.origin), addressError } : {}) })
  const prepareNetwork = () => {
    if (preparing) return preparing
    networkVersion++
    network = { state: 'preparing' }
    preparing = networkPreparation.prepare().catch((): RemoteNetworkStatus => ({ state: 'unknown', reason: 'preparation-failed', error: '직접 연결 준비를 완료하지 못했습니다. 다시 시도해 주세요.' })).then(result => { network = result; return result }).finally(() => { preparing = undefined })
    return preparing
  }
  const negotiations = new Map<string, Negotiation>(), sends = new Map<string, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; connection: string }>()
  const emit = (value: unknown) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)) }
  function closeConnection(id: string) {
    const negotiation = negotiations.get(id); negotiations.delete(id)
    negotiation?.inbox?.close()
    negotiation?.dispatcher?.close()
    if (negotiation?.peer?.connected) negotiation.peer.send({ type: 'close' })
    const peer = negotiation?.peer
    if (peer) { const timer = setTimeout(() => { if (peer.exitCode === null) peer.kill() }, 4000); timer.unref(); peer.once('exit', () => clearTimeout(timer)) }
    for (const [key, waiter] of sends) if (waiter.connection === id) { sends.delete(key); clearTimeout(waiter.timer); waiter.reject(new Error('connection-closed')) }
  }
  const connectionAlive = (negotiation: Negotiation) => {
    return negotiation.expires > Date.now() && (negotiation.authentication?.ready() ?? true)
  }
  const check = () => { for (const [id, negotiation] of negotiations) { if (!connectionAlive(negotiation)) closeConnection(id); else negotiation.dispatcher?.revalidate() } }
  const interval = setInterval(check, 1000); interval.unref(); accessChanges.on('change', check)
  const sendData = (id: string, peer: ChildProcess, data: string) => new Promise<void>((resolve, reject) => {
    let pending = 0
    for (const waiter of sends.values()) if (waiter.connection === id) pending++
    if (!peer.connected || Buffer.byteLength(data) > REMOTE_LIMITS.frame || pending >= 64) { reject(new Error('send-limit')); return }
    const sendId = randomId(), timer = setTimeout(() => { sends.delete(sendId); reject(new Error('send-timeout')); closeConnection(id) }, 10_000); timer.unref()
    sends.set(sendId, { resolve, reject, timer, connection: id }); peer.send({ type: 'send', id: sendId, data }, error => { if (error) { clearTimeout(timer); sends.delete(sendId); reject(error) } })
  })
  function startPeer(connection: string, negotiation: Negotiation, currentRegistration: RemoteRegistration) {
    const peer = options.forkPeer?.() ?? fork(new URL('./remote-access-rtc.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { PATH: process.env.PATH }, execArgv: [] })
    negotiation.peer = peer
    let authenticated = false
    const active = () => !stopped && registration === currentRegistration && negotiations.get(connection) === negotiation && connectionAlive(negotiation)
    const alive = () => authenticated && active()
    const current = () => alive() ? negotiation.authentication?.current() ?? null : null
    negotiation.inbox = remoteTicketInbox<VerifiedTicket>(async (data, { ticket, identity }) => {
      const authentication = negotiation.authentication
      if (!authentication || !active()) return
      if (!authenticated) {
        const auth = JSON.parse(data)
        if (auth.type !== 'authenticate' || auth.ticket !== ticket) throw new Error('invalid-auth')
        const proof = await verifyRemoteToken(auth.proof, negotiation.browserKey, 'mew-browser', currentRegistration.instance)
        if (proof.sub !== negotiation.subject || proof.connection !== connection || proof.challenge !== negotiation.challenge || proof.generation !== negotiation.generation || proof.fingerprint !== negotiation.fingerprint) throw new Error('invalid-peer')
        if (auth.session !== undefined && (typeof auth.session !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(auth.session))) throw new Error('invalid-session')
        if (!active()) return
        authenticated = true
        const trustedDevice = authentication.resume(auth.session ?? null)
        if (trustedDevice) emit({ type: 'trusted-browser', connection, label: trustedDevice.label })
        negotiation.dispatcher = remoteDispatcher(server, { send: data => sendData(connection, peer, data), close: () => closeConnection(connection) }, current, currentRegistration.origin, {
          alive,
          sessionToken: authentication.sessionToken,
          setSessionToken: authentication.setSessionToken,
          identity: () => alive() ? identity : null,
          activateMewlink: authentication.activateMewlink,
          trustDevice: label => {
            const token = authentication.trustDevice(label)
            emit({ type: 'trusted-browser', connection, label })
            return token
          },
          clientIp: negotiation.clientIp,
          accessRevision,
        })
        await sendData(connection, peer, JSON.stringify({ type: 'authenticated', protocol: REMOTE_PROTOCOL })); return
      }
      await negotiation.dispatcher?.receive(data)
    }, () => closeConnection(connection))
    peer.on('message', message => {
      const msg = message as Record<string, any>
      if (!active()) return
      if (msg.type === 'network-status') {
        if (!['new', 'gathering', 'complete'].includes(msg.gathering) || !['host', 'srflx', 'public4', 'ipv6'].every(key => Number.isSafeInteger(msg[key]) && msg[key] >= 0 && msg[key] <= 256)) return
        status.connectivity = { gathering: msg.gathering, host: msg.host, srflx: msg.srflx, public4: msg.public4, ipv6: msg.ipv6, ...(typeof msg.mapping === 'string' && /^[a-z-]{1,32}$/.test(msg.mapping) ? { mapping: msg.mapping } : {}) }
        return
      }
      if (msg.type === 'sent') { const waiter = sends.get(msg.id); if (waiter) { sends.delete(msg.id); clearTimeout(waiter.timer); waiter.resolve() }; return }
      if (msg.type === 'answer') {
        let fingerprint: string
        try { fingerprint = validateOffer(msg.sdp) } catch { closeConnection(connection); return }
        void signRemoteToken(currentRegistration.privateKey, 'mew-instance', connection, currentRegistration.instance, { fingerprint, challenge: negotiation.challenge, generation: negotiation.generation }).then(proof => { if (active()) emit({ type: 'answer', connection, sdp: msg.sdp, proof }) }).catch(() => { if (active()) closeConnection(connection) }); return
      }
      if (msg.type === 'candidate') { emit({ ...msg, connection }); return }
      if (msg.type === 'error') { emit({ type: 'error', connection, code: 'rtc-unavailable' }); closeConnection(connection); return }
      if (msg.type === 'data' && !negotiation.inbox!.push(msg.data)) closeConnection(connection)
    })
    peer.on('error', () => { if (negotiations.get(connection) === negotiation) closeConnection(connection) }); peer.on('exit', () => { if (negotiations.get(connection) !== negotiation) return; emit({ type: 'error', connection, code: 'connection-closed' }); closeConnection(connection) })
    const ping = setInterval(() => { if (peer.connected) peer.send({ type: 'ping' }) }, 2000); ping.unref(); peer.once('exit', () => clearInterval(ping))
    peer.send({ type: 'start', sdp: negotiation.sdp, stun: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] })
    for (const candidate of negotiation.candidate) peer.send(candidate); negotiation.candidate = []
  }
  async function handle(value: Record<string, any>) {
    if (!registration) return
    if (value.type === 'challenge') {
      if (value.protocol !== REMOTE_PROTOCOL) throw new Error('version-mismatch')
      const currentRegistration = registration, socket = ws
      const proof = await signRemoteToken(currentRegistration.privateKey, 'mew-instance', `${currentRegistration.origin}/signal`, currentRegistration.instance, { nonce: value.nonce, ...(value.signalResume === true ? { signalResume: true, connections: [...negotiations].filter(([, negotiation]) => negotiation.signalResume && negotiation.dispatcher && connectionAlive(negotiation)).map(([id]) => id) } : {}) })
      if (!stopped && registration === currentRegistration && ws === socket) emit({ type: 'host', instance: currentRegistration.instance, proof })
      return
    }
    if (value.type === 'online') { status = { enabled: true, state: 'online' }; void refreshAddress(true); retryCount = 0; return }
    if (value.type === 'prepare') {
      if (value.authMode !== 'local') { emit({ type: 'error', connection: value.connection, code: 'local-auth-update-required' }); return }
      if (negotiations.size >= 8 || value.instance !== registration.instance || typeof value.subject !== 'string' || value.subject.length > 128 || typeof value.clientIp !== 'string' || value.clientIp.length > 64 || !isIP(value.clientIp) || typeof value.connection !== 'string' || negotiations.has(value.connection)) { emit({ type: 'error', connection: value.connection, code: 'local-permission-denied' }); return }
      const fingerprint = validateOffer(value.sdp)
      if (fingerprint !== value.fingerprint || value.browserKey?.kty !== 'OKP' || value.browserKey?.d) throw new Error('invalid-prepare')
      const negotiation: Negotiation = { subject: value.subject, clientIp: value.clientIp, challenge: randomId(), generation: randomId(), fingerprint, browserKey: value.browserKey, sdp: value.sdp, candidate: [], expires: Date.now() + REMOTE_LIMITS.ticket, signalResume: value.signalResume === true }
      negotiations.set(value.connection, negotiation)
      emit({ type: 'ready', connection: value.connection, challenge: negotiation.challenge, generation: negotiation.generation, fingerprint, browserKey: negotiation.browserKey })
      startPeer(value.connection, negotiation, registration)
      return
    }
    const negotiation = negotiations.get(value.connection)
    if (!negotiation) return
    if (value.type === 'end') { closeConnection(value.connection); return }
    if (value.type === 'lease') { if (!negotiation.dispatcher) return; if (typeof value.expires !== 'number' || value.expires > Date.now() + REMOTE_LIMITS.lease + 2000) throw new Error('invalid-lease'); negotiation.expires = Math.min(value.expires, Date.now() + REMOTE_LIMITS.lease); return }
    if (value.type === 'candidate') { if (negotiation.peer?.connected) negotiation.peer.send(value); else if (negotiation.candidate.length < 128) negotiation.candidate.push(value); return }
    if (value.type !== 'ticket' || negotiation.ticket || !connectionAlive(negotiation)) return
    const currentRegistration = registration
    const claims = await verifyRemoteToken(value.ticket, currentRegistration.centralKey, currentRegistration.origin, currentRegistration.instance)
    if (claims.authMode !== 'local' || claims.clientIp !== negotiation.clientIp || claims.sub !== negotiation.subject || claims.challenge !== negotiation.challenge || claims.generation !== negotiation.generation || claims.connection !== value.connection || claims.fingerprint !== negotiation.fingerprint || await calculateJwkThumbprint(claims.browserKey as JWK) !== await calculateJwkThumbprint(negotiation.browserKey)) throw new Error('invalid-ticket')
    negotiation.signalResume = negotiation.signalResume && claims.signalResume === true
    const identity = claims.identity === undefined ? null : parseMewlinkIdentity(claims.identity, currentRegistration.origin)
    if (claims.identity !== undefined && !identity) throw new Error('invalid-identity')
    const browserId = await calculateJwkThumbprint(negotiation.browserKey)
    if (stopped || registration !== currentRegistration || negotiations.get(value.connection) !== negotiation || !connectionAlive(negotiation)) return
    negotiation.authentication = createRemoteAuthentication(identity, browserId)
    negotiation.ticket = value.ticket
    if (!negotiation.inbox?.authorize({ ticket: value.ticket, identity })) closeConnection(value.connection)
  }
  function connect() {
    if (!registration || stopped) return
    status = { ...status, enabled: true, state: 'connecting' }
    const socket = new WebSocket(`${registration.origin.replace('https:', 'wss:')}/central/signal?instance=${encodeURIComponent(registration.instance)}`, { origin: registration.origin, maxPayload: REMOTE_LIMITS.signal })
    ws = socket
    const heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send('{"type":"heartbeat"}') }, 20_000)
    heartbeat.unref()
    socket.once('close', () => clearInterval(heartbeat))
    let queue = Promise.resolve()
    ws.on('message', raw => { queue = queue.then(() => { if (ws === socket && registration && !stopped) return handle(JSON.parse(raw.toString())) }).catch(() => socket.close()) })
    ws.on('error', () => { if (ws === socket && registration && !stopped) status = { ...status, state: 'offline', error: '중앙 서비스에 연결하지 못했습니다.' } })
    ws.on('close', code => { if (stopped || !registration || ws !== socket) return; for (const [id, negotiation] of negotiations) if (code === 1000 || !negotiation.signalResume || !negotiation.dispatcher || !connectionAlive(negotiation)) closeConnection(id); status = { ...status, state: 'offline' }; retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(retryCount++, 5)) + Math.random() * 1000); retry.unref() })
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
  router.get('/', async (req, res) => {
    await refreshAddress(req.query.refresh === '1')
    if (!preparing) {
      const version = networkVersion
      const result = await networkPreparation.check().catch((): RemoteNetworkStatus => ({ state: 'unknown', reason: 'check-failed' }))
      if (!preparing && version === networkVersion) network = result
    }
    res.json(snapshot())
  })
  router.post('/prepare-network', (_req, res) => {
    void prepareNetwork()
    res.status(202).json(snapshot())
  })
  async function register(email: string, attempt: number) {
    try {
      const result = await prepareNetwork()
      if (attempt !== registrationAttempt || stopped) return
      if (result.state !== 'ready' && result.state !== 'unknown') throw new Error(result.error || '직접 연결 준비를 완료하지 못했습니다. Windows 승인 상태를 확인한 뒤 다시 시도해 주세요.')
      const origin = new URL(process.env.MEW_REMOTE_ORIGIN ?? 'https://mew.run').origin
      if (!origin.startsWith('https://')) throw new Error('중앙 서비스는 HTTPS 주소가 필요합니다.')
      const key = await remoteKeyPair()
      if (attempt !== registrationAttempt || stopped) return
      const response = await fetch(`${origin}/central/registrations`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ publicKey: key.publicKey }), redirect: 'error', signal: AbortSignal.timeout(10_000) })
      if (!response.ok) throw new Error('중앙 서비스에서 등록을 시작하지 못했습니다.')
      const reg = await response.json() as { code: string; challenge: string; expires: number; registrationUrl: string }
      if (!/^[a-zA-Z0-9_-]{20,64}$/.test(reg.code) || !reg.challenge || reg.expires <= Date.now() || reg.expires > Date.now() + 310_000 || reg.registrationUrl !== `${origin}/register/${reg.code}`) throw new Error('등록 응답이 올바르지 않습니다.')
      if (attempt !== registrationAttempt || stopped) return
      pending = { origin, key, code: reg.code, challenge: reg.challenge, email, expires: reg.expires }
      status = { enabled: false, state: 'registering', registrationUrl: reg.registrationUrl, expiresAt: reg.expires }
    } catch (error) { if (attempt === registrationAttempt && !stopped) status = { enabled: false, state: 'error', error: error instanceof Error ? error.message : '등록을 시작하지 못했습니다.' } }
    finally { if (attempt === registrationAttempt) registering = false }
  }
  router.post('/register', (req, res) => {
    if (registration || pending || registering) return void res.status(409).json({ error: '기존 등록을 해제하거나 완료해 주세요.' })
    registering = true
    const attempt = ++registrationAttempt
    status = { enabled: false, state: 'registering' }
    void register(authOf(req).email!, attempt)
    res.status(202).json(snapshot())
  })
  router.all('/members', (_req, res) => { res.status(410).json({ error: '기기 접근은 로컬 mew 계정에서 관리합니다.' }) })
  router.delete('/', async (_req, res) => {
    const reg = registration
    registrationAttempt++; registering = false; pending = undefined; registration = null; address = undefined; addressError = undefined; addressChecked = 0; saveRemoteRegistration(null); clearTimeout(retry); for (const id of negotiations.keys()) closeConnection(id); ws?.close(); status = { enabled: false, state: 'disabled' }
    if (reg) try {
      const proof = await signRemoteToken(reg.privateKey, 'mew-instance', `${reg.origin}/revoke`, reg.instance, {})
      const response = await fetch(`${reg.origin}/central/instances/${reg.instance}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: reg.origin }, body: JSON.stringify({ proof }), signal: AbortSignal.timeout(10_000), redirect: 'error' })
      if (!response.ok && response.status !== 404) throw new Error('revoke-failed')
    } catch { status.error = '로컬 연결은 해제됐습니다. 중앙 대시보드에서도 기기를 삭제해 주세요.' }
    res.json(snapshot())
  })
  function close() { stopped = true; clearTimeout(retry); clearInterval(interval); clearInterval(pollTimer); accessChanges.off('change', check); for (const id of negotiations.keys()) closeConnection(id); ws?.terminate() }
  server.once('close', close)
  if (registration) connect()
  return { router, close, status: snapshot }
}
