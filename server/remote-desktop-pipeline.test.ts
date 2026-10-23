import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { on } from 'node:events'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
// @ts-expect-error Installed helpers use JavaScript directly.
import { videoPump } from '../native/remote-desktop/video-pump.mjs'
// @ts-expect-error Installed helpers use JavaScript directly.
import { videoPacer } from '../native/remote-desktop/video-pacer.mjs'
// @ts-expect-error Installed helpers use JavaScript directly.
import { videoAdaptation } from '../native/remote-desktop/video-adaptation.mjs'
// @ts-expect-error Installed Windows helper is tested with an FFI double.
import { windowsGpu } from '../native/remote-desktop/gpu-windows.mjs'

function clock() {
  let time = 0, serial = 0
  const timers = new Map<number, { at: number; run: () => void }>()
  return { now: () => time, timers,
    schedule(run: () => void, delay: number) { const id = ++serial; timers.set(id, { at: time + delay, run }); return id },
    cancel(id: number) { timers.delete(id) },
    advance(duration: number) {
      for (let end = time + duration; time < end;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) { time = end; break }
        time = next[1].at; timers.delete(next[0]); next[1].run()
      }
    },
  }
}
const au = (...nals: Buffer[]) => Buffer.concat(nals.flatMap(nal => [Buffer.from([0, 0, 0, 1]), nal]))
const sps = Buffer.from([0x67, 100, 0, 42]), pps = Buffer.from([0x68, 1])
const picture = (key: boolean, bytes: number) => { const data = Buffer.alloc(bytes, 7); data[0] = key ? 0x65 : 0x41; return data }

test('producer overlaps two frames, rejects duplicate/stale ACKs and cancels every scheduled poll', () => {
  const c = clock(), sent: { frameId: number; backpressureMs: number }[] = []
  let reads = 0
  const pump = videoPump({ ...c, read: () => { reads++; return { data: new Uint8Array(10) } }, write: (frame: typeof sent[number]) => sent.push(frame), failed: assert.fail })
  pump.start(); c.advance(2)
  assert.equal(sent.length, 2); assert.equal(c.timers.size, 0)
  c.advance(30); pump.ack(999); assert.equal(reads, 2)
  pump.ack(sent[0].frameId)
  assert.equal(sent.length, 3); assert.equal(sent[2].backpressureMs, 30)
  pump.ack(sent[0].frameId); assert.equal(sent.length, 3)
  pump.stop(); pump.ack(sent[1].frameId); c.advance(50); assert.equal(sent.length, 3)
  pump.start(); assert.equal(sent.length, 4)
  pump.ack(sent[2].frameId); assert.equal(sent.length, 4, 'an ACK from the previous run cannot grant a new credit')
  pump.stop(); assert.equal(c.timers.size, 0)
})

test('a large recovery keyframe blocks dependent production and synchronous ACKs cannot duplicate timers', () => {
  const c = clock(), sent: number[] = []
  const pump = videoPump({ ...c, read: () => ({ data: new Uint8Array(10), key: sent.length === 0 }),
    write(frame: { frameId: number }) { sent.push(frame.frameId); if (sent.length > 1) pump.ack(frame.frameId) }, failed: assert.fail })
  pump.start(); c.advance(400)
  assert.equal(sent.length, 1); assert.equal(c.timers.size, 0)
  pump.ack(sent[0]); assert.equal(sent.length, 2); assert.equal(c.timers.size, 1)
  c.advance(10); assert.equal(sent.length, 7); assert.equal(c.timers.size, 1)
  pump.stop(); assert.equal(c.timers.size, 0)
})

test('real worker transfers keep two independent buffers and use a comparable process clock', { timeout: 10000 }, async t => {
  const module = new URL('../native/remote-desktop/video-pump.mjs', import.meta.url).href
  const worker = new Worker(`const {parentPort}=require('node:worker_threads');
    import(${JSON.stringify(module)}).then(({videoPump})=>{
      const pump=videoPump({read:()=>({data:new Uint8Array(20),width:1920,height:1080}),
        write:frame=>{parentPort.postMessage(frame,[frame.data.buffer]);if(frame.data.byteLength)throw Error('Buffer was not transferred')},
        failed:error=>{throw error}});
      parentPort.on('message',id=>pump.ack(id));pump.start();
    });`, { eval: true })
  const messages = on(worker, 'message', { signal: t.signal })
  try {
    const first = (await messages.next()).value![0], second = (await messages.next()).value![0]
    assert.equal(first.data.byteLength, 20); assert.equal(second.data.byteLength, 20)
    assert.notEqual(first.data.buffer, second.data.buffer)
    const elapsed = performance.timeOrigin + performance.now() - first.producedAt
    assert.ok(elapsed >= 0 && elapsed < 10000, String(elapsed))
    worker.postMessage(first.frameId)
    const third = (await messages.next()).value![0]
    assert.ok(third.frameId > second.frameId); assert.equal(first.data.byteLength, 20)
  } finally { await messages.return?.(); await worker.terminate() }
})

test('pacer sends a queued reference only after its predecessor and releases both on expiry', () => {
  const c = clock(), packets: Buffer[] = []
  let completed = 0, keys = 0
  const pacer = videoPacer({ ...c, ssrc: 1, bitrate: 350000, priority: 'quality', fps: 60,
    send: (packet: Buffer) => { packets.push(packet); return true }, keyframe: () => keys++ })
  const push = (data: Buffer, timestamp: number) => pacer.frame({ data, timestamp }, () => completed++)
  push(au(sps, pps, picture(true, 10)), 0)
  push(au(picture(false, 10000)), 16667); push(au(picture(false, 100)), 33334)
  assert.equal(pacer.stats().pendingFrames, 2)
  assert.equal(completed, 1)
  c.advance(101)
  assert.equal(completed, 3); assert.equal(pacer.stats().drops, 2); assert.equal(c.timers.size, 0)
  const before = packets.length
  push(au(picture(false, 100)), 50001); assert.equal(packets.length, before)
  push(au(picture(true, 10)), 66668)
  assert.deepEqual(packets.slice(before).map(packet => packet[12] & 31), [7, 8, 5])
  assert.equal(keys, 1); assert.equal(completed, 5)
  pacer.close()
})

test('the queued frame retains its original deadline rather than receiving a fresh budget on promotion', () => {
  const c = clock()
  let completed = 0, markers = 0
  const pacer = videoPacer({ ...c, ssrc: 1, bitrate: 350000, priority: 'quality', fps: 60,
    send: (packet: Buffer) => { if (packet[1] & 128) markers++; return true }, keyframe() {} })
  for (const data of [au(sps, pps, picture(true, 10)), au(picture(false, 3000)), au(picture(false, 4000))]) pacer.frame({ data, timestamp: 0 }, () => completed++)
  c.advance(101)
  assert.equal(markers, 2, 'the second reference cannot extend its total waiting time past 100ms')
  assert.equal(completed, 3); assert.equal(pacer.stats().drops, 1)
  pacer.close()
})

test('closing and resetting a two-frame sender release every credit exactly once', () => {
  for (const operation of ['close', 'reset'] as const) {
    const c = clock()
    let completed = 0
    const pacer = videoPacer({ ...c, ssrc: 1, bitrate: 350000, send: () => true, keyframe() {} })
    pacer.frame({ data: au(sps, pps, picture(true, 100000)), timestamp: 0 }, () => completed++)
    pacer.frame({ data: au(picture(false, 1000)), timestamp: 16667 }, () => completed++)
    pacer[operation](); c.advance(1000); pacer.close()
    assert.equal(completed, 2); assert.equal(c.timers.size, 0)
  }
})

function fhdStream(serial: boolean) {
  const c = clock()
  let encoded = 0, displayed = 0, outstanding = 0, readyAt: number | undefined, submittedAt = -Infinity, peak = 0
  const pacer = videoPacer({ ...c, ssrc: 1, bitrate: 12_000_000, priority: 'quality', fps: 60,
    send: (packet: Buffer) => { if (packet[1] & 128) displayed++; return true }, keyframe() {} })
  const pump = videoPump({ ...c, failed: assert.fail,
    read() {
      if (serial && outstanding) return null
      if (readyAt !== undefined && c.now() >= readyAt) {
        readyAt = undefined
        const key = encoded++ === 0
        return { data: key ? au(sps, pps, picture(true, 25000)) : au(picture(false, 25000)), key, width: 1920, height: 1080, timestamp: Math.round(submittedAt * 1000) }
      }
      if (readyAt === undefined && c.now() >= submittedAt + 1000 / 60) { submittedAt = c.now(); readyAt = c.now() + 8 }
      return null
    },
    write(frame: { data: Buffer; timestamp: number; frameId: number }) {
      peak = Math.max(peak, ++outstanding)
      pacer.frame(frame, () => { outstanding--; pump.ack(frame.frameId) })
    },
  })
  pump.start(); c.advance(2000)
  const result = { frames: displayed, peak, drops: pacer.stats().drops }
  pump.stop(); pacer.close(); return result
}
test('FHD high-quality payloads retain their size while encoding overlaps network pacing', t => {
  const serial = fhdStream(true), overlap = fhdStream(false)
  assert.equal(overlap.drops, 0); assert.equal(serial.drops, 0)
  assert.ok(overlap.peak <= 2); assert.equal(serial.peak, 1)
  assert.ok(overlap.frames >= 115, JSON.stringify({ serial, overlap }))
  assert.ok(overlap.frames >= serial.frames * 1.1, JSON.stringify({ serial, overlap }))
  t.diagnostic(`Synthetic FHD60, 12Mbps, 25KB AU, 8ms encoder, 2 seconds: ${JSON.stringify({ serial, overlap })}`)
})

test('an RTT floor step reduces rate once, relearns a healthy plateau and restores FHD quality', () => {
  for (const priority of ['quality', 'speed']) {
    const c = clock(), rates: number[] = []
    const a = videoAdaptation({ maximum: 12_000_000, priority, now: c.now, change: (value: number) => rates.push(value), keyframe() {} })
    const sample = { loss: 0, delay: 10, decoded: true, received: 12, decodedFrames: 12, rtt: 10 }
    a.feedback(sample)
    for (let i = 0; i < 20; i++) { c.advance(200); a.feedback({ ...sample, rtt: 40 }) }
    assert.ok(Math.min(...rates) >= 9_600_000, JSON.stringify(rates))
    assert.equal(a.rate(), 12_000_000)
    for (let i = 0; i < 30; i++) { c.advance(200); a.feedback({ ...sample, rtt: 40, loss: .1 }) }
    assert.equal(a.rate(), 350000, 'persistent packet loss must still reduce the sender')
  }
})

test('growing RTT, receiver buffering and local overflows remain congestion signals', () => {
  for (const reason of ['rtt', 'buffer', 'local']) {
    const c = clock(), a = videoAdaptation({ maximum: 12_000_000, now: c.now, change() {}, keyframe() {} })
    const sample = { loss: 0, delay: 10, decoded: true, received: 12, decodedFrames: 12, rtt: 10 }
    a.feedback(sample)
    for (let i = 0; i < 20; i++) {
      c.advance(200)
      if (reason === 'local') a.congested()
      a.feedback({ ...sample, rtt: reason === 'rtt' ? 40 + i * 10 : 40, delay: reason === 'buffer' ? 100 : 10 })
    }
    assert.equal(a.rate(), 350000, reason)
  }
})

test('jitter around a new RTT plateau cannot repeatedly cut FHD quality', () => {
  const c = clock(), rates: number[] = []
  const a = videoAdaptation({ maximum: 12_000_000, now: c.now, change: (rate: number) => rates.push(rate), keyframe() {} })
  const sample = { loss: 0, delay: 10, decoded: true, received: 12, decodedFrames: 12, rtt: 10 }
  a.feedback(sample)
  for (let i = 0; i < 40; i++) { c.advance(200); a.feedback({ ...sample, rtt: 40 + i % 2 * 6 }) }
  assert.ok(Math.min(...rates) >= 7_680_000)
  assert.equal(a.rate(), 12_000_000)
})

test('quality recovery is bounded, time-based and never accelerated by idle feedback', () => {
  const times: number[] = []
  for (const interval of [200, 250, 400]) {
    const c = clock(), a = videoAdaptation({ maximum: 12_000_000, now: c.now, change() {}, keyframe() {} })
    for (let i = 0; i < 30; i++) { c.advance(200); a.congested() }
    const began = c.now()
    while (a.rate() < 12_000_000 && c.now() - began < 15000) {
      c.advance(interval); a.feedback({ loss: 0, delay: 10, rtt: 5, decoded: true, received: 12, decodedFrames: 12 })
    }
    times.push(c.now() - began)
    assert.equal(a.rate(), 12_000_000); assert.ok(c.now() - began < 10000)
    a.congested(); const low = a.rate()
    c.advance(10000); a.feedback({ loss: 0, delay: 0, decoded: true, received: 0, decodedFrames: 0 })
    assert.equal(a.rate(), low)
  }
  assert.ok(Math.max(...times) - Math.min(...times) <= 500, JSON.stringify(times))
})

function windowsFixture(version = 5) {
  let status = 0, produced = false
  const rates: number[] = []
  const ffi = { load: () => ({ func: (signature: string) => (...args: unknown[]) => {
    const name = signature.match(/(mew_gpu_\w+)\(/)![1]
    if (name === 'mew_gpu_abi') return version
    if (name === 'mew_gpu_create') return {}
    if (name === 'mew_gpu_error') return 0x80070005
    if (name === 'mew_gpu_bitrate') { rates.push(Number(args[1])); return status }
    if (name === 'mew_gpu_current') { const out = args[1] as Buffer; out.writeInt32LE(1920, 12); out.writeInt32LE(1080, 16) }
    if (name === 'mew_gpu_poll') {
      if (produced) return 0
      produced = true
      const out = args[3] as Buffer
      assert.equal(out.length, 40)
      out.writeInt32LE(1920, 4); out.writeInt32LE(1080, 8); out.writeBigInt64LE(16667n, 16)
      out.writeInt32LE(5000, 24); out.writeInt32LE(2000, 28); out.writeUInt32LE(63, 32); out.writeInt32LE(12_000_000, 36)
      return 10
    }
    return 0
  } }) }
  return { gpu: () => windowsGpu(ffi, '/fixture'), rates, fail(value: number) { status = value } }
}
test('Windows rejects stale ABI, exposes stage timings and propagates encoder control failures', () => {
  assert.throws(() => windowsFixture(4).gpu(), /다시 준비/)
  const f = windowsFixture(), gpu = f.gpu()
  const screen = gpu.start('gpu:0', 12_000_000)
  assert.equal(screen.width, 1920); assert.equal(screen.height, 1080)
  gpu.bitrate(12_000_000); assert.equal(f.rates.length, 0, 'initial configuration must not redundantly set live bitrate')
  const frame = gpu.next()
  assert.equal(frame.encodeMs, 5); assert.equal(frame.captureMs, 2); assert.equal(frame.encoderOptions, 63); assert.equal(frame.encoderBitrate, 12_000_000)
  f.fail(-1); assert.throws(() => gpu.bitrate(6_000_000), /80070005/)
  f.fail(1); assert.throws(() => gpu.bitrate(6_000_000), /80070005/, 'nonzero status must never be treated as an applied bitrate')
  f.fail(0); gpu.bitrate(6_000_000); gpu.bitrate(6_000_000)
  assert.equal(f.rates.length, 3)
  gpu.stop(); gpu.close()
})

test('viewer diagnostics deliver FHD sender and receiver stages and stop with the connection', { skip: !domBrowserExecutable() }, async () => {
  const entry = `export {connectDesktop} from ${JSON.stringify(path.resolve(import.meta.dirname, '../src/utils/desktop-connection.ts'))}`
  const bundle = await build({ input: 'virtual:diagnostics', plugins: [{ name: 'diagnostics', resolveId: id => id === 'virtual:diagnostics' ? id : undefined,
    load: id => id === 'virtual:diagnostics' ? entry : undefined }], write: false, platform: 'browser', output: { format: 'iife', name: 'Desktop' } })
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage()
    await page.route('http://localhost:48975/**', route => route.fulfill(new URL(route.request().url()).pathname === '/api/remote-desktop/status'
      ? { json: { ready: true } } : { contentType: 'text/html', body: '<html></html>' }))
    await page.goto('http://localhost:48975/')
    await page.addScriptTag({ content: `
      window.samples=[];
      window.WebSocket=class {
        static OPEN=1;readyState=1;bufferedAmount=0;
        constructor(){queueMicrotask(()=>{for(const value of [{type:'config',iceServers:[]},{type:'offer',sdp:'fixture',native:true}])this.onmessage({data:JSON.stringify(value)})})}
        send(){}close(){this.readyState=3}
      };
      window.RTCPeerConnection=class {
        async setRemoteDescription(){this.remoteDescription={};queueMicrotask(()=>{
          const motion={label:'motion',readyState:'open',bufferedAmount:0,send(){},close(){}};
          const control={...motion,label:'control'};this.ondatachannel({channel:motion});this.ondatachannel({channel:control});
          control.onmessage({data:JSON.stringify({type:'video-status',resolution:'1080p',fps:60,quality:'high',priority:'quality',width:1920,height:1080,
            bitrate:12000000,profile:'high',payload:102,level:42,queueMs:5,drops:0,pendingFrames:1,encodeMs:8,captureMs:2,encoderOptions:63})});
          motion.onopen();control.onopen();
        })}
        async createAnswer(){return {type:'answer',sdp:'fixture'}}async setLocalDescription(value){this.localDescription=value}
        async getStats(){return new Map([['video',{id:'video',type:'inbound-rtp',kind:'video',frameWidth:1920,frameHeight:1080,framesDecoded:60,
          framesDropped:2,packetsReceived:100,packetsLost:0,bytesReceived:20000,totalDecodeTime:.12,jitterBufferDelay:.6,jitterBufferEmittedCount:60,
          freezeCount:0,timestamp:performance.now()}]])}
        getReceivers(){return []}close(){}
      };
    ` })
    await page.addScriptTag({ content: bundle.output.find(value => value.type === 'chunk')!.code })
    await page.evaluate(`window.connection=Desktop.connectDesktop({state(){},screens(){},stream(){},relative(){},stats(){},diagnostics(value){window.samples.push(value)}})`)
    await page.waitForFunction('window.samples.length>0')
    const value = await page.evaluate('window.samples[0]') as { sender: { width: number; encodeMs: number; captureMs: number }; receiver: { height: number; totalDecodeSeconds: number; droppedFrames: number } }
    assert.equal(value.sender.width, 1920); assert.equal(value.sender.encodeMs, 8); assert.equal(value.sender.captureMs, 2)
    assert.equal(value.receiver.height, 1080); assert.equal(value.receiver.totalDecodeSeconds, .12); assert.equal(value.receiver.droppedFrames, 2)
    const count = await page.evaluate('window.connection.close();window.samples.length')
    await page.waitForTimeout(250)
    assert.equal(await page.evaluate('window.samples.length'), count)
  } finally { await browser.close() }
})
