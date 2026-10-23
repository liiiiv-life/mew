import rtc from 'node-datachannel'
import { isIP } from 'node:net'
import { nativeConnectivity } from '../native/remote-desktop/native-connectivity.mjs'
import { publicV4 } from '../native/remote-desktop/nat-port-map.mjs'
import { createWslLoopbackCandidate } from './remote-access-ice.ts'
const loopbackCandidate = createWslLoopbackCandidate()
const FRAME = 32 * 1024, QUEUE = 512 * 1024
let peer, channel, nat, pending = [], queue = Promise.resolve(), closing = false, finalized = false, disconnected
const emit = value => { if (process.connected) process.send(value) }
let gathering = 'gathering', mapping
const counts = { host: 0, srflx: 0, public4: 0, ipv6: 0 }
const report = () => { if (!closing) emit({ type: 'network-status', gathering, ...counts, ...(mapping ? { mapping } : {}) }) }
function close() {
  if (closing) return
  closing = true; clearInterval(watchdog); clearTimeout(disconnected)
  const finalize = () => {
    if (finalized) return
    finalized = true
    try { rtc.cleanup() } finally { process.disconnect?.() }
  }
  try { channel?.close() } catch {}
  try { peer?.close() } catch {}
  if (!nat) finalize()
  else {
    const timer = setTimeout(finalize, 3500)
    Promise.resolve().then(() => nat.close()).catch(() => {}).finally(() => { clearTimeout(timer); finalize() })
  }
}
let heartbeat = Date.now()
const watchdog = setInterval(() => { if (Date.now() - heartbeat > 10_000) close() }, 1000)
process.on('disconnect', close)
process.on('SIGTERM', close)
process.on('message', value => {
  try {
    if (closing) return
    if (value.type === 'ping') { heartbeat = Date.now(); return }
    if (value.type === 'close') { close(); return }
    if (value.type === 'start' && !peer) {
      if (!Array.isArray(value.stun) || value.stun.some(url => typeof url !== 'string' || !/^stun:[a-zA-Z0-9.:-]+$/.test(url))) throw new Error('invalid-stun')
      peer = new rtc.PeerConnection('mew-app', {
        iceServers: value.stun, maxMessageSize: FRAME, enableIceTcp: true, mtu: 1280,
        portRangeBegin: 55000, portRangeEnd: 55031,
      })
      nat = nativeConnectivity({
        emit: (candidate, mid) => {
          if (closing) return
          counts.srflx++; report()
          emit({ type: 'candidate', candidate: { candidate, sdpMid: mid } })
        },
        status: state => { mapping = state; report() },
      })
      peer.onLocalDescription((sdp, type) => { if (!closing && type === 'answer') emit({ type: 'answer', sdp }) })
      peer.onLocalCandidate((candidate, mid) => {
        if (closing || / typ relay(?:\s|$)/.test(candidate)) return
        const fields = candidate.trim().split(/\s+/), type = fields[7], address = fields[4] ?? ''
        if (type === 'host') counts.host++
        if (type === 'srflx') counts.srflx++
        if (publicV4(address)) counts.public4++
        if (isIP(address) === 6 && !/^(?:fe[89ab]|f[cd]|::)/i.test(address)) counts.ipv6++
        emit({ type: 'candidate', candidate: { candidate, sdpMid: mid } })
        const loopback = loopbackCandidate(candidate, mid)
        if (loopback) emit({ type: 'candidate', candidate: loopback })
        report()
        if (type === 'host' && fields[2]?.toLowerCase() === 'udp') nat.candidate(candidate, mid)
      })
      peer.onGatheringStateChange?.(state => { gathering = state === 'complete' ? 'complete' : 'gathering'; report() })
      peer.onStateChange(state => {
        if (closing) return
        if (state === 'disconnected') { disconnected ??= setTimeout(close, 15_000); return }
        if (state === 'connected') { nat.connected(); clearTimeout(disconnected); disconnected = undefined; return }
        if (['failed', 'closed'].includes(state)) close()
      })
      peer.onDataChannel(dc => {
        if (closing || channel || dc.getLabel() !== 'mew-app') { dc.close(); return }
        channel = dc
        channel.onOpen(() => { if (!closing) { nat.connected(); emit({ type: 'open' }) } })
        channel.onClosed(close)
        channel.onError(close)
        channel.onMessage(data => { if (closing) return; if (typeof data !== 'string' || Buffer.byteLength(data) > FRAME) return void close(); emit({ type: 'data', data }) })
      })
      peer.setRemoteDescription(value.sdp, 'offer')
      for (const candidate of pending) peer.addRemoteCandidate(candidate.candidate, candidate.sdpMid ?? '0')
      pending = []; return
    }
    if (value.type === 'candidate') { if (typeof value.candidate?.candidate !== 'string' || value.candidate.candidate.length > 4096 || / typ relay(?:\s|$)/.test(value.candidate.candidate)) throw new Error('invalid-candidate'); if (peer) peer.addRemoteCandidate(value.candidate.candidate, value.candidate.sdpMid ?? '0'); else if (pending.length < 128) pending.push(value.candidate); return }
    if (value.type === 'send') {
      if (typeof value.data !== 'string' || Buffer.byteLength(value.data) > FRAME) throw new Error('frame-limit')
      queue = queue.then(async () => {
        const deadline = Date.now() + 10_000
        while (channel?.isOpen() && channel.bufferedAmount() > QUEUE) { if (Date.now() > deadline) throw new Error('slow-peer'); await new Promise(resolve => setTimeout(resolve, 10)) }
        if (!channel?.isOpen()) throw new Error('send-failed')
        // A false return accepts the frame into libdatachannel's send queue.
        channel.sendMessage(value.data)
        emit({ type: 'sent', id: value.id })
      }).catch(close)
    }
  } catch { emit({ type: 'error' }); close() }
})
