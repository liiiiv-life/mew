import { SignJWT, exportJWK, generateKeyPair, importJWK, jwtVerify, type JWK } from 'jose'
import { REMOTE_LIMITS, REMOTE_PROTOCOL, REMOTE_TOKEN_CLOCK_TOLERANCE, sdpFingerprint } from '../../shared/remote-access.ts'
import { DataChannelTransport, setRemoteTransport } from './remote-transport.ts'
import { parseRemoteBootstrap, remoteBootstrapUrl, type RemoteBootstrapContext, type RemoteConnectionTarget } from '../../shared/remote-bootstrap.ts'

type ConnectionObserver = (state: string, error?: string) => void
type ConnectionCredentials = { session?: string; keyPair: CryptoKeyPair }
type ConnectionOptions = { centralOrigin?: string; ticketIssuers?: string[]; launch?: string; session?: string; keyPair?: CryptoKeyPair }
type Bootstrap = {
  target: RemoteConnectionTarget
  identity?: boolean
  credentials: Promise<ConnectionCredentials | null>
  received(): void
  accept(context: RemoteBootstrapContext): void
  cancel(): void
}

export function connectRemote(instance: string, onState: ConnectionObserver, options: ConnectionOptions = {}) {
  return createRemoteConnection(instance, onState, options)
}

export function bootstrapRemoteConnection(target: RemoteConnectionTarget, options: { identity?: boolean } = {}) {
  let accept!: (context: RemoteBootstrapContext) => void, reject!: (error: Error) => void
  let resume!: (credentials: ConnectionCredentials | null) => void
  let observer: ConnectionObserver | undefined, started = false, closed = false, received = false
  const context = new Promise<RemoteBootstrapContext>((resolve, fail) => { accept = resolve; reject = fail })
  const credentials = new Promise<ConnectionCredentials | null>(resolve => { resume = resolve })
  const close = createRemoteConnection('', (state, message) => {
    if (observer) observer(state, message)
    else if (['error', 'denied', 'revoked'].includes(state)) {
      closed = true
      reject(Object.assign(new Error(message ?? '중앙 서비스에 연결하지 못했습니다.'), { state, legacyFallback: !received && state === 'error' }))
    }
  }, {}, {
    target, identity: options.identity, credentials, received() { received = true },
    accept(value) { received = true; accept(value) },
    cancel() { closed = true; resume(null); queueMicrotask(() => reject(new Error('연결 준비가 취소됐습니다.'))) },
  })
  return {
    context,
    start(onState: ConnectionObserver, value: ConnectionCredentials) {
      if (started || closed) throw new Error('이미 사용했거나 종료된 연결입니다.')
      started = true; observer = onState; resume(value)
      return close
    },
    close,
  }
}

function createRemoteConnection(instance: string, onState: ConnectionObserver, options: ConnectionOptions, bootstrap?: Bootstrap) {
  const centralOrigin = options.centralOrigin ?? location.origin
  let ticketIssuers = options.ticketIssuers ?? centralOrigin, session = options.session
  setRemoteTransport(null)
  if (typeof RTCPeerConnection === 'undefined' || !crypto.subtle) { onState('error', '이 브라우저는 안전한 원격 연결을 지원하지 않습니다. 최신 브라우저를 사용해 주세요.'); return () => {} }
  let stopped = false, authenticated = false, connection = '', ticket = '', privateKey: CryptoKey, claims: Record<string, any>, renew: ReturnType<typeof setInterval> | undefined, disconnected: ReturnType<typeof setTimeout> | undefined, timeout: ReturnType<typeof setTimeout> | undefined
  let signalResume = false, signalInterrupted = false, signalAttempt = 0, connectSentAt = 0, leaseDeadline = 0, resumeNonce = '', resumeSentAt = 0
  let recoveringSignal: WebSocket | undefined
  let signalRetry: ReturnType<typeof setTimeout> | undefined, signalTimeout: ReturnType<typeof setTimeout> | undefined, leaseTimeout: ReturnType<typeof setTimeout> | undefined
  const renewals = new Map<string, number>()
  const keyRequest = new AbortController()
  // Fetch the trusted origin's key during negotiation instead of adding a round trip after the ticket.
  let centralKey: Promise<{ key: JWK } | { error: unknown }> | undefined = bootstrap ? undefined : fetch('/central/key', { cache: 'no-store', signal: keyRequest.signal }).then(async response => {
    if (!response.ok) throw new Error('접속 인증 키를 확인하지 못했습니다.')
    return { key: await response.json() as JWK }
  }).catch((error: unknown) => ({ error }))
  const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] })
  const channel = peer.createDataChannel('mew-app', { ordered: true })
  let signal = new WebSocket(bootstrap ? remoteBootstrapUrl(location.origin, bootstrap.target, bootstrap.identity) : `${location.origin.replace('https:', 'wss:')}/central/signal?instance=${encodeURIComponent(instance)}&role=browser`)
  const candidates: RTCIceCandidateInit[] = [], localCandidates: RTCIceCandidateInit[] = []
  const emit = (value: Record<string, unknown>) => {
    if (signal.readyState !== WebSocket.OPEN) return
    if (value.type === 'renew' && signalInterrupted) return
    if (value.type === 'renew' && signalResume) {
      const request = crypto.randomUUID()
      renewals.set(request, performance.now())
      while (renewals.size > 8) renewals.delete(renewals.keys().next().value!)
      value = { ...value, request }
    }
    signal.send(JSON.stringify({ ...value, instance }))
  }
  const resume = () => { if (authenticated && !stopped && document.visibilityState === 'visible') emit({ type: 'renew' }) }
  const close = () => { if (stopped) return; if (authenticated && signalResume) emit({ type: 'end' }); stopped = true; keyRequest.abort(); bootstrap?.cancel(); clearTimeout(timeout); clearTimeout(disconnected); clearTimeout(signalRetry); clearTimeout(signalTimeout); clearTimeout(leaseTimeout); clearInterval(renew); renewals.clear(); document.removeEventListener('visibilitychange', resume); window.removeEventListener('pageshow', resume); window.removeEventListener('online', resume); setRemoteTransport(null)
    channel.close(); peer.close(); signal.close() }
  const fail = (error = '기기와 직접 연결하지 못했습니다. 기기의 실행 상태와 네트워크를 확인해 주세요.', state = 'error') => { if (stopped) return; close(); onState(state, error) }
  const authorizeLease = (remaining: unknown, sentAt: number) => {
    if (typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0 || remaining > REMOTE_LIMITS.lease) throw new Error('연결 유효 시간을 확인하지 못했습니다.')
    // Count from the request start, so network latency and clock skew cannot extend authorization.
    leaseDeadline = sentAt + remaining - 1000
    clearTimeout(leaseTimeout)
    leaseTimeout = setTimeout(() => fail('인증 연결을 복구하지 못했습니다. 다시 연결해 주세요.'), Math.max(0, leaseDeadline - performance.now()))
  }
  const interruptSignal = (socket: WebSocket, normal = false) => {
    if (stopped || socket !== signal) return
    if (normal || !authenticated || !signalResume || leaseDeadline <= performance.now()) { fail('인증 연결이 종료됐습니다. 다시 연결해 주세요.'); return }
    signalInterrupted = true
    clearTimeout(signalTimeout)
    if (signalRetry !== undefined) return
    signalRetry = setTimeout(() => {
      signalRetry = undefined
      if (stopped || leaseDeadline <= performance.now()) return
      const previous = signal, socket = new WebSocket(`${location.origin.replace('https:', 'wss:')}/central/signal?instance=${encodeURIComponent(instance)}&role=browser`)
      signal = socket; recoveringSignal = socket; resumeNonce = ''; previous.close(4000, 'signaling-interrupted')
      bindSignal(socket)
      signalTimeout = setTimeout(() => { interruptSignal(socket); socket.close(4000, 'signaling-interrupted') }, Math.min(8000, Math.max(0, leaseDeadline - performance.now())))
    }, Math.min(4000, 250 * 2 ** Math.min(signalAttempt++, 4)))
  }
  timeout = setTimeout(() => fail('직접 연결 시간이 초과됐습니다. 현재 네트워크에서 연결이 차단됐을 수 있습니다.'), 25_000)
  let queue = Promise.resolve(), offer = '', challenged = false
  // Local preparation can overlap the signaling handshake; send only after its challenge.
  const preparation = Promise.all([bootstrap ? bootstrap.credentials.then(value => value?.keyPair) : options.keyPair ?? generateKeyPair('EdDSA', { extractable: false }), (async () => {
    const description = await peer.createOffer()
    if (stopped) return null
    await peer.setLocalDescription(description)
    return description
  })()]).then(async ([pair, description]) => {
    if (stopped || !description || !pair) return null
    privateKey = pair.privateKey as CryptoKey
    offer = description.sdp!
    return { publicKey: await exportJWK(pair.publicKey) }
  }).then(value => ({ value }), (error: unknown) => ({ error }))
  const prove = async () => {
    if (!ticket || channel.readyState !== 'open' || stopped) return
    const proof = await new SignJWT({ connection, challenge: claims.challenge, generation: claims.generation, fingerprint: claims.fingerprint }).setProtectedHeader({ alg: 'EdDSA' }).setIssuer('mew-browser').setAudience(instance).setSubject(claims.sub).setJti(crypto.randomUUID()).setIssuedAt().setExpirationTime('60s').sign(privateKey)
    if (stopped || channel.readyState !== 'open') return
    channel.send(JSON.stringify({ type: 'authenticate', ticket, proof, ...(session ? { session } : {}) }))
  }
  const receiveSignal = (socket: WebSocket, event: MessageEvent) => {
    queue = queue.then(async () => {
      if (stopped || socket !== signal || signalInterrupted && socket !== recoveringSignal) return
      const value = JSON.parse(event.data)
      if (value.type === 'challenge') {
        if (value.protocol !== REMOTE_PROTOCOL) throw new Error('호환되지 않는 서버 버전입니다.')
        if (signalInterrupted) {
          if (!value.signalResume || typeof value.nonce !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(value.nonce) || resumeNonce) throw new Error('인증 연결을 복구하지 못했습니다.')
          resumeNonce = value.nonce
          const proof = await new SignJWT({ instance, nonce: resumeNonce, connection, generation: claims.generation, fingerprint: claims.fingerprint }).setProtectedHeader({ alg: 'EdDSA' }).setIssuer('mew-browser').setAudience(`${location.origin}/signal-resume`).setSubject(claims.sub).setJti(crypto.randomUUID()).setIssuedAt().setExpirationTime('60s').sign(privateKey)
          if (stopped || socket !== signal) return
          resumeSentAt = performance.now()
          emit({ type: 'resume', connection, proof }); return
        }
        if (challenged) throw new Error('중복된 연결 요청입니다.')
        challenged = true
        onState('connecting')
        if (bootstrap) {
          if (value.context !== undefined) bootstrap.received()
          if (typeof value.nonce !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(value.nonce)) throw new Error('연결 증명을 확인하지 못했습니다.')
          const context = parseRemoteBootstrap(value.context, location.origin)
          if ('instance' in bootstrap.target && context.instance !== bootstrap.target.instance) throw new Error('연결 기기가 일치하지 않습니다.')
          instance = context.instance; ticketIssuers = context.ticketIssuers
          centralKey = Promise.resolve({ key: context.publicKey })
          bootstrap.accept(context)
          const credentials = await bootstrap.credentials
          if (stopped || !credentials) return
          session = credentials.session
        }
        const prepared = await preparation
        if (stopped) return
        if ('error' in prepared) throw prepared.error
        if (!prepared.value) return
        connectSentAt = performance.now()
        emit({ type: 'connect', instance, sdp: offer, publicKey: prepared.value.publicKey, serverRenewal: true, signalResume: value.signalResume === true, ...(bootstrap ? { nonce: value.nonce } : options.launch ? { launch: options.launch } : {}) }); return
      }
      if (value.type === 'error') {
        if (value.code === 'access-revoked') { fail('이 브라우저의 접근 권한이 해제됐습니다. 다시 인증해 주세요.', 'revoked'); return }
        if (['forbidden', 'unauthorized', 'permission-denied', 'not-allowed', 'session-expired'].includes(value.code)) { fail('접근 권한을 다시 확인해 주세요.', 'denied'); return }
        throw new Error(value.code === 'offline' ? '기기가 오프라인입니다.' : value.code === 'rtc-unavailable' ? '기기의 원격 연결 구성 요소를 확인해 주세요.' : '원격 접속이 거부되거나 연결이 종료됐습니다.')
      }
      if (value.type === 'ticket') {
        const result = await centralKey
        if (stopped) return
        if (!result) throw new Error('접속 인증 키를 확인하지 못했습니다.')
        if ('error' in result) throw result.error
        const verified = await jwtVerify(value.ticket, await importJWK(result.key, 'EdDSA'), { issuer: ticketIssuers, audience: instance, algorithms: ['EdDSA'], maxTokenAge: '60s', clockTolerance: REMOTE_TOKEN_CLOCK_TOLERANCE })
        claims = verified.payload; if (claims.fingerprint !== sdpFingerprint(offer) || claims.connection !== value.connection || !claims.instanceKey) throw new Error('연결 증명이 일치하지 않습니다.')
        if (claims.authMode !== 'local') throw new Error('중앙 서비스를 업데이트한 뒤 다시 연결해 주세요.')
        connection = value.connection; ticket = value.ticket
        if (claims.signalResume === true) { signalResume = true; authorizeLease(claims.leaseRemaining, connectSentAt) }
        for (const candidate of localCandidates) emit({ type: 'candidate', candidate }); localCandidates.length = 0
        await prove(); return
      }
      if (value.type === 'renew' && value.connection === connection) { if (authenticated) emit({ type: 'renew' }); return }
      if (!claims || value.connection !== connection) throw new Error('연결 정보가 일치하지 않습니다.')
      if (value.type === 'lease' && signalResume) {
        const sentAt = renewals.get(value.request)
        if (sentAt === undefined || signalInterrupted) throw new Error('연결 갱신 증명을 확인하지 못했습니다.')
        renewals.delete(value.request); authorizeLease(value.remaining, sentAt); return
      }
      if (value.type === 'resumed' && signalResume && signalInterrupted) {
        if (value.nonce !== resumeNonce || !resumeNonce) throw new Error('연결 복구 증명을 확인하지 못했습니다.')
        // Reattachment restores the same lease; only a subsequent verified renewal may extend it.
        const deadline = leaseDeadline
        authorizeLease(value.remaining, resumeSentAt)
        leaseDeadline = Math.min(deadline, leaseDeadline)
        clearTimeout(leaseTimeout); leaseTimeout = setTimeout(() => fail('인증 연결을 복구하지 못했습니다. 다시 연결해 주세요.'), Math.max(0, leaseDeadline - performance.now()))
        signalInterrupted = false; recoveringSignal = undefined; signalAttempt = 0; clearTimeout(signalTimeout); clearTimeout(signalRetry); signalRetry = undefined
        renewals.clear(); emit({ type: 'renew' }); return
      }
      if (value.type === 'answer') {
        const verified = await jwtVerify(value.proof, await importJWK(claims.instanceKey as JWK, 'EdDSA'), { issuer: 'mew-instance', audience: connection, algorithms: ['EdDSA'], maxTokenAge: '60s', clockTolerance: REMOTE_TOKEN_CLOCK_TOLERANCE })
        if (verified.payload.sub !== instance || verified.payload.challenge !== claims.challenge || verified.payload.generation !== claims.generation || verified.payload.fingerprint !== sdpFingerprint(value.sdp)) throw new Error('기기 연결 증명이 일치하지 않습니다.')
        await peer.setRemoteDescription({ type: 'answer', sdp: value.sdp }); for (const candidate of candidates) await peer.addIceCandidate(candidate); candidates.length = 0; return
      }
      if (value.type === 'candidate') { if (/ typ relay(?:\s|$)/.test(value.candidate.candidate)) throw new Error('직접 연결만 허용됩니다.'); if (peer.remoteDescription) await peer.addIceCandidate(value.candidate); else if (candidates.length < 128) candidates.push(value.candidate) }
    }).catch(error => fail(error?.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && error?.claim === 'iat' && error?.reason === 'check_failed' ? '접속 기기와 mew 컴퓨터의 시간이 맞지 않습니다. 두 기기의 날짜와 시간을 자동으로 동기화한 뒤 다시 연결해 주세요.' : error instanceof Error ? error.message : undefined))
  }
  peer.onicecandidate = event => { if (!event.candidate || / typ relay(?:\s|$)/.test(event.candidate.candidate)) return; const candidate = event.candidate.toJSON(); if (connection) emit({ type: 'candidate', candidate }); else if (localCandidates.length < 128) localCandidates.push(candidate) }
  peer.onconnectionstatechange = () => {
    if (stopped) return
    if (peer.connectionState === 'disconnected') {
      if (disconnected !== undefined) return
      disconnected = setTimeout(() => fail('기기와의 연결이 복구되지 않았습니다. 다시 연결해 주세요.'), 15_000)
      if (authenticated) onState('reconnecting')
      return
    }
    if (peer.connectionState === 'connected') {
      const recovering = disconnected !== undefined
      clearTimeout(disconnected); disconnected = undefined
      if (recovering && authenticated) { resume(); onState('connected') }
      return
    }
    if (['failed', 'closed'].includes(peer.connectionState)) fail()
  }
  function bindSignal(socket: WebSocket) {
    socket.onmessage = event => receiveSignal(socket, event)
    socket.onerror = () => interruptSignal(socket)
    socket.onclose = event => interruptSignal(socket, event?.code === 1000)
  }
  bindSignal(signal)
  channel.onopen = () => { void prove().catch(() => fail()) }
  channel.addEventListener('message', event => {
    if (stopped || authenticated) return
    try {
      const value = JSON.parse(event.data)
      if (value.type !== 'authenticated' || value.protocol !== REMOTE_PROTOCOL) throw new Error('invalid-auth')
      authenticated = true; clearTimeout(timeout); setRemoteTransport(new DataChannelTransport(channel)); onState('connected')
      renew = setInterval(() => emit({ type: 'renew' }), REMOTE_LIMITS.renew); emit({ type: 'renew' })
    } catch { fail() }
  })
  channel.onclose = () => fail()
  document.addEventListener('visibilitychange', resume)
  window.addEventListener('pageshow', resume)
  window.addEventListener('online', resume)
  return close
}
