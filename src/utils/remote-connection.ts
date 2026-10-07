import { scopedBrowserStorage, remoteStorageName } from '@mew/ui/browser-storage-scope'
import { SignJWT, exportJWK, generateKeyPair, importJWK, jwtVerify, type JWK } from 'jose'
import { REMOTE_LIMITS, REMOTE_PROTOCOL, sdpFingerprint } from '../../shared/remote-access.ts'
import { DataChannelTransport, setRemoteTransport } from './remote-transport.ts'
export function connectRemote(instance: string, onState: (state: string, error?: string) => void, options: { centralOrigin?: string; launch?: string } = {}) {
  const centralOrigin = options.centralOrigin ?? location.origin
  setRemoteTransport(null)
  if (typeof RTCPeerConnection === 'undefined' || !crypto.subtle) { onState('error', '이 브라우저는 안전한 원격 연결을 지원하지 않습니다. 최신 브라우저를 사용해 주세요.'); return () => {} }
  let stopped = false, authenticated = false, connection = '', ticket = '', privateKey: CryptoKey, claims: Record<string, any>, renew: ReturnType<typeof setInterval> | undefined
  const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] })
  const channel = peer.createDataChannel('mew-app', { ordered: true })
  const signal = new WebSocket(`${location.origin.replace('https:', 'wss:')}/central/signal?instance=${encodeURIComponent(instance)}`)
  const candidates: RTCIceCandidateInit[] = [], localCandidates: RTCIceCandidateInit[] = []
  const emit = (value: Record<string, unknown>) => { if (signal.readyState === WebSocket.OPEN) signal.send(JSON.stringify({ ...value, instance })) }
  const close = () => { if (stopped) return; stopped = true; clearTimeout(timeout); clearInterval(renew); setRemoteTransport(null)
    try { const storage = scopedBrowserStorage(); const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)); for (const key of keys) if (key && /^mew:(?:content:|agent-events:|agent-controls:|agent-input-histories$|tmux-input-histories$)/.test(key)) storage.removeItem(key); for (const name of ['mew-agent-history', 'mew-agent-scheduled-prompts']) indexedDB.deleteDatabase(remoteStorageName(name)) } catch { /* Storage may be unavailable. */ }
    channel.close(); peer.close(); signal.close() }
  const fail = (error = '기기와 직접 연결하지 못했습니다. 기기의 실행 상태와 네트워크를 확인해 주세요.') => { if (stopped) return; close(); onState('error', error) }
  const timeout = setTimeout(() => fail('직접 연결 시간이 초과됐습니다. 현재 네트워크에서 연결이 차단됐을 수 있습니다.'), 25_000)
  let queue = Promise.resolve(), offer = ''
  const prove = async () => {
    if (!ticket || channel.readyState !== 'open' || stopped) return
    const proof = await new SignJWT({ connection, challenge: claims.challenge, generation: claims.generation, fingerprint: claims.fingerprint }).setProtectedHeader({ alg: 'EdDSA' }).setIssuer('mew-browser').setAudience(instance).setSubject(claims.sub).setJti(crypto.randomUUID()).setIssuedAt().setExpirationTime('60s').sign(privateKey)
    channel.send(JSON.stringify({ type: 'authenticate', ticket, proof }))
  }
  signal.onmessage = event => {
    queue = queue.then(async () => {
      if (stopped) return
      const value = JSON.parse(event.data)
      if (value.type === 'challenge') {
        if (value.protocol !== REMOTE_PROTOCOL) throw new Error('호환되지 않는 서버 버전입니다.')
        onState('connecting')
        const keys = await generateKeyPair('EdDSA', { extractable: true }); privateKey = keys.privateKey as CryptoKey
        const description = await peer.createOffer(); await peer.setLocalDescription(description); offer = description.sdp!
        emit({ type: 'connect', instance, sdp: offer, publicKey: await exportJWK(keys.publicKey), ...(options.launch ? { launch: options.launch } : {}) }); return
      }
      if (value.type === 'error') throw new Error(value.code === 'offline' ? '기기가 오프라인입니다.' : value.code === 'rtc-unavailable' ? '기기의 원격 연결 구성 요소를 확인해 주세요.' : '원격 접속이 거부되거나 연결이 종료됐습니다.')
      if (value.type === 'ticket') {
        const keyResponse = await fetch('/central/key', { cache: 'no-store' }); if (!keyResponse.ok) throw new Error('접속 인증 키를 확인하지 못했습니다.')
        const centralKey = await keyResponse.json() as JWK
        const verified = await jwtVerify(value.ticket, await importJWK(centralKey, 'EdDSA'), { issuer: centralOrigin, audience: instance, algorithms: ['EdDSA'], maxTokenAge: '60s' })
        claims = verified.payload; if (claims.fingerprint !== sdpFingerprint(offer) || claims.connection !== value.connection || !claims.instanceKey) throw new Error('연결 증명이 일치하지 않습니다.')
        connection = value.connection; ticket = value.ticket
        for (const candidate of localCandidates) emit({ type: 'candidate', candidate }); localCandidates.length = 0
        await prove(); return
      }
      if (!claims || value.connection !== connection) throw new Error('연결 정보가 일치하지 않습니다.')
      if (value.type === 'answer') {
        const verified = await jwtVerify(value.proof, await importJWK(claims.instanceKey as JWK, 'EdDSA'), { issuer: 'mew-instance', audience: connection, algorithms: ['EdDSA'], maxTokenAge: '60s' })
        if (verified.payload.sub !== instance || verified.payload.challenge !== claims.challenge || verified.payload.generation !== claims.generation || verified.payload.fingerprint !== sdpFingerprint(value.sdp)) throw new Error('기기 연결 증명이 일치하지 않습니다.')
        await peer.setRemoteDescription({ type: 'answer', sdp: value.sdp }); for (const candidate of candidates) await peer.addIceCandidate(candidate); candidates.length = 0; return
      }
      if (value.type === 'candidate') { if (/ typ relay(?:\s|$)/.test(value.candidate.candidate)) throw new Error('직접 연결만 허용됩니다.'); if (peer.remoteDescription) await peer.addIceCandidate(value.candidate); else if (candidates.length < 128) candidates.push(value.candidate) }
    }).catch(error => fail(error instanceof Error ? error.message : undefined))
  }
  peer.onicecandidate = event => { if (!event.candidate || / typ relay(?:\s|$)/.test(event.candidate.candidate)) return; const candidate = event.candidate.toJSON(); if (connection) emit({ type: 'candidate', candidate }); else if (localCandidates.length < 128) localCandidates.push(candidate) }
  peer.onconnectionstatechange = () => { if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) fail() }
  signal.onerror = () => fail('중앙 서비스에 연결하지 못했습니다.')
  signal.onclose = () => fail('인증 연결이 종료됐습니다. 다시 연결해 주세요.')
  channel.onopen = () => { void prove().catch(() => fail()) }
  channel.addEventListener('message', event => {
    if (authenticated) return
    try {
      const value = JSON.parse(event.data)
      if (value.type !== 'authenticated' || value.protocol !== REMOTE_PROTOCOL) throw new Error('invalid-auth')
      authenticated = true; clearTimeout(timeout); setRemoteTransport(new DataChannelTransport(channel)); onState('connected')
      renew = setInterval(() => emit({ type: 'renew' }), REMOTE_LIMITS.renew); emit({ type: 'renew' })
    } catch { fail() }
  })
  channel.onclose = () => fail()
  return close
}
