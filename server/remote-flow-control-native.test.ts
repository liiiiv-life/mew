import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import http from 'node:http'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { WebSocketServer } from 'ws'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { remoteDispatcher } from './remote-access-dispatch.ts'
import type { AuthenticatedSession } from './auth.ts'

test('native RTC keeps interactive traffic responsive across two bridges during large WS and CPU-throttled mixed streams', { skip: !domBrowserExecutable(), timeout: 45_000 }, async t => {
  const bundle = await build({ input: new URL('../src/utils/remote-transport.ts', import.meta.url).pathname, write: false, platform: 'browser', output: { format: 'iife', name: 'Remote' } })
  const code = bundle.output.find(item => item.type === 'chunk')!.code
  const signalEvents: unknown[] = [], acknowledgements = new Map<string, () => void>()
  const helper = fork(new URL('./remote-access-rtc.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] })
  const heartbeat = setInterval(() => { if (helper.connected) helper.send({ type: 'ping' }) }, 2000)
  t.after(() => { clearInterval(heartbeat); if (helper.connected) helper.send({ type: 'close' }); helper.kill() })
  const sockets = new WebSocketServer({ noServer: true })
  t.after(() => { for (const ws of sockets.clients) ws.terminate(); sockets.close() })
  const app = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://fixture')
    if (url.pathname === '/api/bulk') { res.end(Buffer.alloc(Number(url.searchParams.get('size')), 120)); return }
    if (url.pathname === '/api/small') { res.end('healthy'); return }
    if (url.pathname === '/events') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(signalEvents.splice(0))); return }
    if (url.pathname === '/signal') { let raw = ''; req.on('data', value => { raw += value }); req.on('end', () => { helper.send(JSON.parse(raw)); res.end('{}') }); return }
    res.setHeader('Content-Type', 'text/html'); res.end(`<div id="root"></div><script>${code}</script><script>
const peer=new RTCPeerConnection({iceServers:[]}),channel=peer.createDataChannel('mew-app',{ordered:true});const signal=value=>fetch('/signal',{method:'POST',body:JSON.stringify(value)});
peer.onicecandidate=e=>{if(e.candidate)signal({type:'candidate',candidate:e.candidate.toJSON()})};
channel.onopen=()=>{window.transport=new Remote.DataChannelTransport(channel);for(let i=0;i<2;i++){const previous=window.transport,c=new MessageChannel(),wire=new EventTarget();wire.readyState='open';wire.bufferedAmount=0;wire.send=raw=>c.port1.postMessage(raw);wire.close=()=>{wire.readyState='closed';c.port1.close();c.port2.close()};c.port1.onmessage=e=>wire.dispatchEvent(new MessageEvent('message',{data:e.data}));c.port2.onmessage=e=>previous.forward(JSON.parse(e.data)).catch(e=>window.failure=e.message);previous.channel.addEventListener('message',e=>c.port2.postMessage(e.data));c.port1.start();c.port2.start();window.transport=new Remote.DataChannelTransport(wire)}window.ready=true};
window.poll=setInterval(async()=>{for(const v of await(await fetch('/events')).json()){if(v.type==='answer')await peer.setRemoteDescription({type:'answer',sdp:v.sdp});if(v.type==='candidate')await peer.addIceCandidate(v.candidate)}},10);
(async()=>{const offer=await peer.createOffer();await peer.setLocalDescription(offer);await signal({type:'start',sdp:offer.sdp,stun:[]})})();
window.probe=async({bytes,parallel,httpBulk})=>{const pulse=window.transport.socket('/api/presence?pulse=20'),latencies=[],http=[],raf=[];let last=0,active=true;await new Promise((r,j)=>{pulse.onopen=r;pulse.onclose=j});pulse.onmessage=e=>latencies.push(Date.now()-JSON.parse(e.data).at);const frame=t=>{if(!active)return;if(last)raf.push(t-last);last=t;requestAnimationFrame(frame)};requestAnimationFrame(frame);const small=(async()=>{while(active){const t=performance.now();const response=await window.transport.fetch('/api/small');await response.text();http.push(performance.now()-t);await new Promise(r=>setTimeout(r,50))}})();const started=performance.now();const large=Array.from({length:parallel},async()=>{const ws=window.transport.socket('/api/agent/ws?size='+bytes);await new Promise((r,j)=>{ws.onopen=r;ws.onclose=j});const size=await new Promise((r,j)=>{ws.onmessage=e=>r(e.data.length);ws.onclose=j;ws.send('start')});ws.close();return size});if(httpBulk)large.push((async()=>{const response=await window.transport.fetch('/api/bulk?size='+bytes);return(await response.arrayBuffer()).byteLength})());const sizes=await Promise.all(large);active=false;await small;pulse.close();const stats=a=>{a.sort((a,b)=>a-b);return{count:a.length,p95:a[Math.floor((a.length-1)*.95)]||0,max:a.at(-1)||0}};return{elapsed:performance.now()-started,sizes,pulse:stats(latencies),http:stats(http),raf:stats(raf)}};
</script>`)
  })
  app.on('upgrade', (req, socket, head) => sockets.handleUpgrade(req, socket, head, ws => {
    const url = new URL(req.url!, 'http://fixture'), pulse = Number(url.searchParams.get('pulse')), size = Number(url.searchParams.get('size'))
    const timer = pulse ? setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ at: Date.now() })) }, pulse) : undefined
    ws.on('close', () => clearInterval(timer)); ws.on('message', () => ws.send(Buffer.alloc(size, 120), { binary: false }))
  }))
  app.listen(0, '127.0.0.1'); await once(app, 'listening'); t.after(() => new Promise<void>(resolve => app.close(() => resolve())))
  const origin = `http://127.0.0.1:${(app.address() as { port: number }).port}`
  const owner: AuthenticatedSession = { email: 'owner@example.test', user: { hash: '', role: 'owner', mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 } }
  const dispatcher = remoteDispatcher(app, { send: data => new Promise<void>((resolve, reject) => { const id = crypto.randomUUID(); acknowledgements.set(id, resolve); helper.send({ type: 'send', id, data }, error => { if (error) reject(error) }) }), close: () => {} }, () => owner, origin)
  t.after(() => dispatcher.close())
  helper.on('message', message => { const value = message as { type: string; id?: string; data?: string }; if (value.type === 'data') void dispatcher.receive(value.data!); else if (value.type === 'sent') { acknowledgements.get(value.id!)?.(); acknowledgements.delete(value.id!) } else if (['answer', 'candidate'].includes(value.type)) signalEvents.push(value) })
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true }); t.after(() => browser.close())
  const page = await browser.newPage(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(origin); await page.waitForFunction('window.ready', { timeout: 8000 }); await page.evaluate('clearInterval(window.poll)')
  type Result = { elapsed: number; sizes: number[]; pulse: { count: number; p95: number; max: number }; http: { count: number; p95: number; max: number }; raf: { p95: number; max: number } }
  const probe = (bytes: number, parallel: number, httpBulk: boolean) => page.evaluate(input => (globalThis as unknown as { probe(input: unknown): Promise<Result> }).probe(input), { bytes, parallel, httpBulk })
  const large = await probe(22_531_219, 1, false)
  assert.deepEqual(large.sizes, [22_531_219]); assert.ok(large.pulse.count > 10)
  assert.ok(large.pulse.p95 < 150, JSON.stringify(large)); assert.ok(large.http.p95 < 200, JSON.stringify(large))
  t.diagnostic(`native 22.5MB / two ports: ${JSON.stringify(large)}`)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const throttled = await probe(4 * 1024 * 1024, 2, true)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await cdp.detach()
  assert.deepEqual(throttled.sizes, Array(3).fill(4 * 1024 * 1024)); assert.ok(throttled.pulse.count > 10)
  assert.ok(throttled.pulse.p95 < 200, JSON.stringify(throttled)); assert.ok(throttled.http.p95 < 250, JSON.stringify(throttled))
  assert.deepEqual(errors, []); t.diagnostic(`native 4x CPU / two WS + HTTP: ${JSON.stringify(throttled)}`)
})
