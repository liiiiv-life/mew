import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import dgram from 'node:dgram'
import { EventEmitter, once } from 'node:events'
import { networkInterfaces } from 'node:os'
import { isIP } from 'node:net'
import { Script } from 'node:vm'
import rtc from 'node-datachannel'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const { nativeConnectivity } = await import(new URL('../native/remote-desktop/native-connectivity.mjs', import.meta.url).href)
const { publicV4 } = await import(new URL('../native/remote-desktop/nat-port-map.mjs', import.meta.url).href)
const chrome = domBrowserExecutable()
const addresses = Object.values(networkInterfaces()).flat().filter(value => value?.family === 'IPv4' && !value.internal && /^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/.test(value.address)).map(value => value!.address)

test('Mewlink native/browser connects through an isolated mapped UDP socket and deletes its lease', { skip: !chrome || !addresses.length, timeout: 20_000 }, async t => {
  let mapped = 0, removed = 0, packets = 0
  const events: Record<string, any>[] = [], received: string[] = []
  const strip = (sdp: string) => sdp.split(/\r?\n/).filter(line => !line.startsWith('a=candidate:') && !line.startsWith('a=end-of-candidates')).join('\r\n')
  async function map(route: { address: string }, port: number) {
    const outside = dgram.createSocket('udp4'), flows = new Map<string, { socket: dgram.Socket; ready: Promise<void> }>()
    let closed = false
    outside.bind(0, '127.0.0.1'); await once(outside, 'listening'); mapped++
    outside.on('message', (packet, sender) => {
      if (closed) return
      const key = `${sender.address}:${sender.port}`
      let flow = flows.get(key)
      if (!flow) {
        const socket = dgram.createSocket('udp4')
        const ready = new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.bind(0, route.address, () => socket.connect(port, route.address, resolve)) })
        socket.on('message', value => { if (!closed) { packets++; outside.send(value, sender.port, sender.address) } })
        flow = { socket, ready }; flows.set(key, flow)
      }
      const current = flow
      void current.ready.then(() => { if (!closed) { packets++; current.socket.send(packet) } }).catch(() => {})
    })
    return {
      address: '127.0.0.1', port: outside.address().port, lease: 120, renew: async () => 120,
      async close() {
        if (closed) return
        closed = true
        await Promise.allSettled([...flows.values()].map(value => value.ready))
        await Promise.all([new Promise<void>(resolve => outside.close(() => resolve())), ...[...flows.values()].map(value => new Promise<void>(resolve => value.socket.close(() => resolve())))])
        removed++
      },
    }
  }
  const child = Object.assign(new EventEmitter(), {
    connected: true,
    send(this: EventEmitter, value: Record<string, any>) {
      if (value.type === 'answer') events.push({ ...value, sdp: strip(value.sdp) })
      if (value.type === 'candidate' && value.candidate.candidate.startsWith('candidate:mew')) events.push(value)
      if (value.type === 'data') { received.push(value.data); this.emit('message', { type: 'send', id: 'fixture', data: 'fixture-response' }) }
    },
    disconnect(this: EventEmitter & { connected: boolean }) { this.connected = false; this.emit('disconnect') },
  })
  const source = fs.readFileSync(new URL('./remote-access-rtc.mjs', import.meta.url), 'utf8').replace(/^import .+\n/gm, '')
  new Script(source, { filename: 'remote-access-rtc.mjs' }).runInNewContext({
    rtc, isIP, publicV4, createWslLoopbackCandidate: () => () => undefined,
    nativeConnectivity: (options: { emit(candidate: string, mid: string): void; status(state: string): void }) => nativeConnectivity({ ...options, delayMs: 0, routes: async () => addresses.map(address => ({ address, gateway: '192.168.50.1' })), map: [map] }),
    process: child, Buffer, Date, setTimeout, clearTimeout, setInterval, clearInterval,
  })
  t.after(async () => {
    const disconnected = child.connected ? once(child, 'disconnect') : Promise.resolve()
    child.emit('message', { type: 'close' }); await disconnected
  })
  const server = http.createServer(async (request, response) => {
    if (request.url === '/events') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(events.splice(0))); return }
    if (request.url === '/signal') {
      let data = ''; for await (const chunk of request) data += chunk
      const value = JSON.parse(data)
      if (value.type === 'start') value.sdp = strip(value.sdp)
      child.emit('message', value); response.end('{}'); return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end(`<script>
      window.received='';window.failure='';const peer=new RTCPeerConnection({iceServers:[]}),channel=peer.createDataChannel('mew-app'),pending=[];
      const send=value=>fetch('/signal',{method:'POST',body:JSON.stringify(value)});
      peer.onicecandidate=event=>{if(event.candidate)send({type:'candidate',candidate:event.candidate.toJSON()})};
      peer.onconnectionstatechange=()=>{if(peer.connectionState==='failed')window.failure='ICE failed'};
      channel.onopen=()=>channel.send('fixture-request');channel.onmessage=event=>window.received=event.data;
      let busy=false;setInterval(async()=>{if(busy)return;busy=true;try{for(const value of await(await fetch('/events')).json()){
        if(value.type==='answer'){await peer.setRemoteDescription({type:'answer',sdp:value.sdp});for(const candidate of pending)await peer.addIceCandidate(candidate);pending.length=0}
        if(value.type==='candidate'){if(peer.remoteDescription)await peer.addIceCandidate(value.candidate);else pending.push(value.candidate)}
      }}catch(error){window.failure=error.message}finally{busy=false}},10);
      (async()=>{const offer=await peer.createOffer();await peer.setLocalDescription(offer);await send({type:'start',sdp:offer.sdp,stun:[]})})();
    </script>`)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))
  const browser = await chromium.launch({ executablePath: chrome!, chromiumSandbox: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`)
  await page.waitForFunction('window.received || window.failure', null, { timeout: 10_000 })
  assert.equal(await page.evaluate('window.failure'), '')
  assert.equal(await page.evaluate('window.received'), 'fixture-response')
  assert.deepEqual(received, ['fixture-request'])
  assert.ok(mapped > 0)
  assert.ok(packets > 0)
  const disconnected = once(child, 'disconnect')
  child.emit('message', { type: 'close' }); await disconnected
  assert.equal(removed, mapped)
})
