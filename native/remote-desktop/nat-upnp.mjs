import dgram from 'node:dgram'
import { randomBytes } from 'node:crypto'
import { publicV4, NAT_LEASE } from './nat-port-map.mjs'

// Bounded XML extraction; no DTD/entity expansion and only fixed IGD actions.
const text = (xml, tag) => {
  if (xml.length > 65536 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Invalid gateway XML')
  const match = new RegExp(`<(?:(?:[\\w-]+):)?${tag}(?:\\s[^>]*)?>([^<]*)<\\/(?:(?:[\\w-]+):)?${tag}\\s*>`).exec(xml)
  if (!match) throw new Error('Missing gateway field')
  return match[1].trim().replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name])
}
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char])
const localUrl = (value, route, base) => {
  const url = new URL(value, base)
  if (url.protocol !== 'http:' || url.hostname !== route.gateway || url.username || url.password) throw new Error('Gateway URL escaped local route')
  return url
}
async function body(response) {
  if (!response.ok || Number(response.headers.get('content-length')) > 65536) throw new Error('Gateway request failed')
  let size = 0; const chunks = []
  if (!response.body) throw new Error('Missing gateway body')
  for await (const chunk of response.body) { size += chunk.length; if (size > 65536) { await response.body.cancel().catch(() => {}); throw new Error('Gateway response too large') }; chunks.push(chunk) }
  return Buffer.concat(chunks).toString('utf8')
}
export async function upnpLocation(route, { signal, timeout = 900 } = {}) {
  signal?.throwIfAborted()
  const socket = dgram.createSocket('udp4')
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); socket.close(); if (error) reject(error); else resolve(value) }
    const abort = () => finish(new Error('Discovery cancelled'))
    const timer = setTimeout(() => finish(new Error('No IGD')), timeout)
    socket.on('error', finish)
    socket.on('message', (value, remote) => {
      if (remote.address !== route.gateway || value.length > 4096) return
      const location = /^location:\s*(\S+)\s*$/im.exec(value.toString())?.[1]
      if (location) { try { finish(null, localUrl(location, route).href) } catch { /* Ignore advertisements outside the selected router. */ } }
    })
    signal?.addEventListener('abort', abort, { once: true })
    socket.bind(0, route.address, () => {
      if (done) return
      try {
        socket.setMulticastTTL(1); socket.setMulticastInterface(route.address)
        const packet = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n\r\n')
        socket.send(packet, 1900, '239.255.255.250', error => { if (error) finish(error) })
      } catch (error) { finish(error) }
    })
    if (signal?.aborted) abort()
  })
}
export async function upnpMap(route, internalPort, { signal, discover = upnpLocation, fetcher = fetch } = {}) {
  const location = localUrl(await discover(route, { signal }), route)
  const request = async (url, options = {}) => {
    const timeout = AbortSignal.timeout(900), combined = options.cleanup ? timeout : signal ? AbortSignal.any([signal, timeout]) : timeout
    return body(await fetcher(localUrl(url, route, location), { ...options, redirect: 'error', signal: combined }))
  }
  const description = await request(location)
  if (/<!DOCTYPE|<!ENTITY/i.test(description)) throw new Error('Invalid gateway description')
  const services = description.match(/<(?:[\w-]+:)?service(?:\s[^>]*)?>[\s\S]*?<\/(?:[\w-]+:)?service\s*>/g) ?? []
  let service, control
  for (const entry of services) {
    let type
    try { type = text(entry, 'serviceType') } catch { continue }
    if (/^urn:schemas-upnp-org:service:(?:WANIPConnection:[12]|WANPPPConnection:1)$/.test(type)) { service = type; control = localUrl(text(entry, 'controlURL'), route, location); break }
  }
  if (!service || !control) throw new Error('No IGD connection service')
  const action = async (name, fields, cleanup = false) => request(control, {
    method: 'POST', cleanup, headers: { 'content-type': 'text/xml; charset="utf-8"', SOAPAction: `"${service}#${name}"` },
    body: `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${name} xmlns:u="${service}">${Object.entries(fields).map(([key, value]) => `<${key}>${escape(value)}</${key}>`).join('')}</u:${name}></s:Body></s:Envelope>`,
  })
  const address = text(await action('GetExternalIPAddress', {}), 'NewExternalIPAddress')
  if (!publicV4(address)) throw new Error('IGD has no public IPv4')
  const identity = { NewRemoteHost: '', NewExternalPort: internalPort, NewProtocol: 'UDP' }, descriptionToken = `mew-${internalPort}-${randomBytes(8).toString('hex')}`
  // Never replace an existing mapping. Unsupported query is refused, not interpreted as absence.
  const lookup = async (cleanup = false) => {
    try { return await action('GetSpecificPortMappingEntry', identity, cleanup) }
    catch { return undefined }
  }
  const query = async () => {
    const timeout = AbortSignal.timeout(900), combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    const envelope = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:GetSpecificPortMappingEntry xmlns:u="${service}">${Object.entries(identity).map(([key, value]) => `<${key}>${escape(value)}</${key}>`).join('')}</u:GetSpecificPortMappingEntry></s:Body></s:Envelope>`
    const response = await fetcher(control, { method: 'POST', headers: { 'content-type': 'text/xml', SOAPAction: `"${service}#GetSpecificPortMappingEntry"` }, body: envelope, redirect: 'error', signal: combined })
    if (response.ok) { await body(response); throw new Error('Port already mapped') }
    let size = 0, xml = ''; if (response.body) for await (const chunk of response.body) { size += chunk.length; if (size > 65536) throw new Error('Fault too large'); xml += Buffer.from(chunk).toString() }
    if (text(xml, 'errorCode') !== '714') throw new Error('Cannot prove mapping absence')
  }
  await query()
  const fields = { ...identity, NewInternalPort: internalPort, NewInternalClient: route.address, NewEnabled: 1, NewPortMappingDescription: descriptionToken, NewLeaseDuration: NAT_LEASE }
  let owned = false
  const verify = xml => xml && text(xml, 'NewInternalClient') === route.address && Number(text(xml, 'NewInternalPort')) === internalPort && text(xml, 'NewPortMappingDescription') === descriptionToken
  const close = async () => { const current = await lookup(true); if (verify(current)) await action('DeletePortMapping', identity, true).catch(() => {}); owned = false }
  try {
    // A lost response can still leave our entry on the router. Cleanup checks
    // its random ownership token even when AddPortMapping timed out.
    owned = true; await action('AddPortMapping', fields)
    const xml = await lookup(), lease = Number(text(xml ?? '', 'NewLeaseDuration'))
    if (!verify(xml) || !Number.isInteger(lease) || lease < 1 || lease > 300) throw new Error('No short owned IGD lease')
    return { address, port: internalPort, lease, protocol: 'upnp', async renew() {
      if (!owned || !verify(await lookup())) throw new Error('IGD mapping ownership changed')
      await action('AddPortMapping', fields)
      const current = await lookup(), renewed = Number(text(current ?? '', 'NewLeaseDuration'))
      if (!verify(current) || !Number.isInteger(renewed) || renewed < 1 || renewed > 300) throw new Error('IGD lease changed')
      return renewed
    }, close }
  } catch (error) { if (owned) await close().catch(() => {}); throw error }
}
