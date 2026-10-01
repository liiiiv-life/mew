import dgram from 'node:dgram'
import { randomBytes } from 'node:crypto'
import { isIP } from 'node:net'

export const NAT_LEASE = 120
const MAX_LEASE = 300
export const publicV4 = value => {
  if (isIP(value) !== 4) return false
  const [a, b] = value.split('.').map(Number)
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19))
}
const v4 = bytes => [...bytes].join('.')
const v4Mapped = address => { const result = Buffer.alloc(16); result.writeUInt16BE(0xffff, 10); address.split('.').forEach((n, i) => { result[i + 12] = Number(n) }); return result }

/** Connected UDP accepts replies only from the OS-selected gateway. No multicast listener or daemon. */
export async function gatewayDatagram(route, data, { signal, port = 5351, timeout = 700, accept = () => true } = {}) {
  signal?.throwIfAborted()
  if (isIP(route.gateway) !== 4 || isIP(route.address) !== 4) throw new Error('Invalid gateway')
  const socket = dgram.createSocket('udp4')
  return new Promise((resolve, reject) => {
    let settled = false
    const done = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); socket.close(); if (error) reject(error); else resolve(value) }
    const abort = () => done(new Error('Mapping cancelled'))
    const timer = setTimeout(() => done(new Error('Gateway timeout')), timeout)
    socket.on('error', done)
    socket.on('message', packet => { if (packet.length <= 2048 && accept(packet)) done(null, packet) })
    signal?.addEventListener('abort', abort, { once: true })
    socket.bind(0, route.address, () => {
      if (settled) return
      try {
        socket.connect(port, route.gateway, () => {
          if (settled) return
          try { socket.send(data, error => { if (error) done(error) }) } catch (error) { done(error) }
        })
      } catch (error) { done(error) }
    })
    if (signal?.aborted) abort()
  })
}

/** RFC 6887 MAP; same nonce is retained for renewal/deletion, no THIRD_PARTY option. */
export async function pcpMap(route, internalPort, { exchange = gatewayDatagram, signal } = {}) {
  const nonce = randomBytes(12)
  let externalPort = internalPort
  const request = async lifetime => {
    const packet = Buffer.alloc(60); packet[0] = 2; packet[1] = 1; packet.writeUInt32BE(lifetime, 4); v4Mapped(route.address).copy(packet, 8)
    nonce.copy(packet, 24); packet[36] = 17; packet.writeUInt16BE(internalPort, 40); packet.writeUInt16BE(externalPort, 42)
    const reply = await exchange(route, packet, { signal: lifetime ? signal : undefined, accept: value => value.length >= 24 && value[0] === 2 && value[1] === 129 && (value[3] !== 0 || value.length >= 60 && value.subarray(24, 36).equals(nonce)) })
    if (reply[3] !== 0 || reply.length < 60 || reply[36] !== 17 || reply.readUInt16BE(40) !== internalPort) throw new Error('PCP unavailable')
    const lease = reply.readUInt32BE(4), address = reply.subarray(44, 60), port = reply.readUInt16BE(42)
    externalPort = port || externalPort
    return { address: address.subarray(0, 12).equals(v4Mapped('0.0.0.0').subarray(0, 12)) ? v4(address.subarray(12)) : '', port, lease }
  }
  const value = await request(NAT_LEASE)
  const close = async () => { await request(0).catch(() => {}) }
  if (!publicV4(value.address) || !value.port || value.lease < 1 || value.lease > MAX_LEASE) { await close(); throw new Error('No short public PCP lease') }
  return { ...value, protocol: 'pcp', async renew() { const next = await request(NAT_LEASE); if (next.address !== value.address || next.port !== value.port || next.lease < 1 || next.lease > MAX_LEASE) throw new Error('Mapping changed'); return next.lease }, close }
}

/** RFC 6886: only one UDP port of this host, short soft-state lease, never delete-all. */
export async function pmpMap(route, internalPort, { exchange = gatewayDatagram, signal } = {}) {
  const addressReply = await exchange(route, Buffer.from([0, 0]), { signal, accept: value => value.length >= 12 && value[0] === 0 && value[1] === 128 })
  if (addressReply.readUInt16BE(2) !== 0 || !publicV4(v4(addressReply.subarray(8, 12)))) throw new Error('No public NAT-PMP address')
  const address = v4(addressReply.subarray(8, 12))
  let externalPort = internalPort
  const request = async lifetime => {
    const packet = Buffer.alloc(12); packet[1] = 1; packet.writeUInt16BE(internalPort, 4); packet.writeUInt16BE(externalPort, 6); packet.writeUInt32BE(lifetime, 8)
    const reply = await exchange(route, packet, { signal: lifetime ? signal : undefined, accept: value => value.length >= 16 && value[0] === 0 && value[1] === 129 && value.readUInt16BE(8) === internalPort })
    if (reply.readUInt16BE(2) !== 0) throw new Error('NAT-PMP refused')
    externalPort = reply.readUInt16BE(10) || externalPort
    return { port: reply.readUInt16BE(10), lease: reply.readUInt32BE(12) }
  }
  const value = await request(NAT_LEASE), close = async () => { await request(0).catch(() => {}) }
  if (!value.port || value.lease < 1 || value.lease > MAX_LEASE) { await close(); throw new Error('No short NAT-PMP lease') }
  return { ...value, address, protocol: 'nat-pmp', async renew() { const next = await request(NAT_LEASE); if (next.port !== value.port || next.lease < 1 || next.lease > MAX_LEASE) throw new Error('Mapping changed'); return next.lease }, close }
}
