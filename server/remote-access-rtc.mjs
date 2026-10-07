import rtc from 'node-datachannel'
const FRAME = 32 * 1024, QUEUE = 512 * 1024
let peer, channel, pending = [], queue = Promise.resolve(), closing = false
const emit = value => { if (process.connected) process.send(value) }
function close() {
  if (closing) return
  closing = true; clearInterval(watchdog)
  try { channel?.close(); peer?.close(); rtc.cleanup() } finally { process.disconnect?.() }
}
let heartbeat = Date.now()
const watchdog = setInterval(() => { if (Date.now() - heartbeat > 10_000) close() }, 1000)
process.on('disconnect', close)
process.on('message', value => {
  try {
    if (value.type === 'ping') { heartbeat = Date.now(); return }
    if (value.type === 'close') { close(); return }
    if (value.type === 'start' && !peer) {
      if (!Array.isArray(value.stun) || value.stun.some(url => typeof url !== 'string' || !/^stun:[a-zA-Z0-9.:-]+$/.test(url))) throw new Error('invalid-stun')
      peer = new rtc.PeerConnection('mew-app', { iceServers: value.stun, maxMessageSize: FRAME, enableIceTcp: true, mtu: 1280 })
      peer.onLocalDescription((sdp, type) => { if (type === 'answer') emit({ type: 'answer', sdp }) })
      peer.onLocalCandidate((candidate, mid) => { if (!/ typ relay(?:\s|$)/.test(candidate)) emit({ type: 'candidate', candidate: { candidate, sdpMid: mid } }) })
      peer.onStateChange(state => { if (['failed', 'closed', 'disconnected'].includes(state)) close() })
      peer.onDataChannel(dc => {
        if (channel || dc.getLabel() !== 'mew-app') { dc.close(); return }
        channel = dc
        channel.onOpen(() => emit({ type: 'open' }))
        channel.onClosed(close)
        channel.onError(close)
        channel.onMessage(data => { if (typeof data !== 'string' || Buffer.byteLength(data) > FRAME) return void close(); emit({ type: 'data', data }) })
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
        if (!channel?.isOpen() || !channel.sendMessage(value.data)) throw new Error('send-failed')
        emit({ type: 'sent', id: value.id })
      }).catch(close)
    }
  } catch { emit({ type: 'error' }); close() }
})
