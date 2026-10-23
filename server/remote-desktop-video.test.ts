import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_VIDEO, videoSettings, videoRate, videoOffer, videoModes, videoLevel } from '../native/remote-desktop/video-settings.mjs'
// @ts-expect-error Native sender policies run as JavaScript in the helper.
import { annexBNals, h264Packets, videoPacer } from '../native/remote-desktop/video-pacer.mjs'
// @ts-expect-error Native sender policies run as JavaScript in the helper.
import { videoAdaptation } from '../native/remote-desktop/video-adaptation.mjs'

const answer = (level = '34', high = true, extra = '') => `v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF ${high ? '102 103' : '103'}\r\na=recvonly\r\na=rtpmap:102 H264/90000\r\na=fmtp:102 profile-level-id=6400${level};packetization-mode=1;level-asymmetry-allowed=1${extra}\r\na=rtpmap:103 H264/90000\r\na=fmtp:103 profile-level-id=42e0${level};packetization-mode=1;level-asymmetry-allowed=1${extra}\r\n`
test('video settings are bounded and high FPS advertises the required H.264 level', () => {
  assert.deepEqual(videoSettings(), DEFAULT_VIDEO)
  for (const patch of [{ fps: 1000 }, { fps: '144' }, { resolution: '__proto__' }, { quality: 'lossless' }, { priority: 'unknown' }]) assert.throws(() => videoSettings({ ...DEFAULT_VIDEO, ...patch }))
  assert.equal(videoRate(DEFAULT_VIDEO), 6_000_000)
  assert.equal(videoRate({ resolution: '2160p', fps: 240, quality: 'high' }), 50_000_000)
  for (const [w, h, fps, expected] of [[1920,1080,144,52], [2560,1440,144,52], [2560,1440,165,60], [1920,1080,240,60], [3840,2160,144,61]]) assert.equal(videoLevel(w,h,fps), expected)
  assert.match(videoOffer({ ...DEFAULT_VIDEO, fps: 144 })[0].fmtp, /profile-level-id=640034/)
  const fast = videoOffer({ ...DEFAULT_VIDEO, fps: 240 })
  assert.deepEqual(fast.map(value => value.payload), [102,103,104,105])
  assert.match(fast[2].fmtp, /profile-level-id=640034/)
})
test('the receiver level, frame-size limits and accepted profiles bound all fallback modes', () => {
  const requested = { resolution: '1440p', fps: 144, quality: 'high' } as const
  assert.deepEqual(videoModes(answer(), requested)[0], { ...requested, priority: 'quality', width: 2560, height: 1440, bitrate: videoRate(requested), profile: 'high', payload: 102, level: 52 })
  assert.equal(videoModes(answer('33'), requested)[0].fps, 60)
  assert.equal(videoModes(answer('34', false), requested)[0].profile, 'baseline')
  const limited = videoModes(answer('34', true, ';max-fs=3600;max-mbps=108000'), requested)[0]
  assert.equal(limited.resolution, '720p'); assert.equal(limited.fps, 30)
  const fallback = answer('34',false).replaceAll('103','105')
  assert.equal(videoModes(fallback, { ...requested, resolution: '1080p', fps: 240 })[0].fps,165)
  for (const bad of ['v=0', answer().replace('video 9', 'video 0'), answer().replace('recvonly','inactive'), answer().replaceAll('packetization-mode=1','packetization-mode=0')]) assert.throws(() => videoModes(bad, requested))
})
const au = (...nals: Buffer[]) => Buffer.concat(nals.flatMap(nal => [Buffer.from([0,0,0,1]), nal]))
const sps = Buffer.from([0x67,100,0,52,1]), pps = Buffer.from([0x68,1]), idr = Buffer.from([0x65,1,2,3])
test('RTP fragmentation reconstructs the entire H.264 AU, with one marker and wrapped sequence', () => {
  const large = Buffer.alloc(5000, 7); large[0] = 0x65
  const nals = annexBNals(au(sps,pps,large)), packets = [...h264Packets(nals, { ssrc: 77, payload: 102, timestamp: 123456, sequence: { next: 65535 } })] as Buffer[]
  assert.ok(packets.every(packet => packet.length <= 1192 && packet.readUInt32BE(4) === 123456 && packet.readUInt32BE(8) === 77))
  assert.equal(packets[0].readUInt16BE(2), 65535); assert.equal(packets[1].readUInt16BE(2), 0)
  assert.equal(packets.filter(packet => packet[1] & 128).length, 1); assert.ok(packets.at(-1)![1] & 128)
  const fragmented = packets.slice(2)
  assert.ok(fragmented[0][13] & 128); assert.ok(fragmented.at(-1)![13] & 64)
  assert.deepEqual(Buffer.concat([Buffer.from([(fragmented[0][12] & 0xe0) | (fragmented[0][13] & 31)]), ...fragmented.map(packet => packet.subarray(14))]), large)
})
function pacerFixture(priority = 'speed', bitrate = 350000) {
  let time = 0, keys = 0, completed = 0, congested = 0
  const packets: { time: number; packet: Buffer }[] = [], timers = new Map<number, () => void>()
  const pacer = videoPacer({ ssrc: 9, bitrate, fps: 144, priority, now: () => time, send: (packet: Buffer) => { packets.push({ time, packet }); return true },
    keyframe: () => keys++, congested: () => congested++, schedule: (fn: () => void) => { const id = timers.size + 1; timers.set(id,fn); return id }, cancel: (id: number) => timers.delete(id) })
  return { pacer, packets, timers, frame: (data: Buffer, timestamp = 0) => pacer.frame({ data, timestamp }, () => completed++),
    advance(value: number) { time += value; const due = [...timers.values()]; timers.clear(); for (const fn of due) fn() }, counts: () => ({ keys, completed, congested }) }
}
test('pacing bounds bursts and frame age, discards the reference chain, then restores SPS/PPS at IDR', () => {
  const f = pacerFixture()
  f.frame(au(Buffer.from([0x41,1]))); assert.equal(f.packets.length,0)
  f.frame(au(sps,pps,idr)); assert.equal(f.counts().completed,2)
  const reference = Buffer.alloc(10000,7); reference[0] = 0x41
  f.frame(au(reference),7000)
  assert.ok(f.packets.filter(value => value.time === 0).length < 8, 'a large frame is not sent as an unbounded burst')
  f.advance(25); assert.equal(f.counts().congested,1); assert.equal(f.timers.size,0)
  const sent = f.packets.length
  f.frame(au(Buffer.from([0x41,1])),14000); assert.equal(f.packets.length,sent)
  f.frame(au(idr),21000)
  assert.deepEqual(f.packets.slice(sent).map(value => value.packet[12] & 31),[7,8,5])
  assert.equal(f.counts().completed,5)
  f.frame(au(reference),28000); f.pacer.close(); assert.equal(f.counts().completed,6); assert.equal(f.timers.size,0)
})
test('a keyframe also has a finite deadline and a mismatched encoded SPS never reaches RTP', () => {
  const large = Buffer.alloc(100000,2); large[0] = 0x65
  for (const priority of ['speed', 'quality']) {
    const f = pacerFixture(priority)
    f.frame(au(sps,pps,large)); f.advance(500)
    assert.equal(f.counts().completed, 0, 'an IDR can use the full 500ms recovery budget')
    f.advance(1)
    assert.equal(f.counts().completed,1); assert.equal(f.counts().congested,1); assert.equal(f.timers.size,0)
    f.pacer.close()
  }
  let unsupported = 0, sent = 0
  const p = videoPacer({ ssrc: 1, send: () => { sent++; return true }, keyframe() {}, unsupported: () => unsupported++ })
  p.configure({ payload: 103, fps: 60, bitrate: 6000000, profile: 'baseline', level: 42 })
  p.frame({ data: au(sps,pps,idr), timestamp: 0 })
  assert.equal(sent,0); assert.equal(unsupported,1); p.close()
})
test('frame boundaries cannot refill the pacing budget or leave an abandoned callback pending', () => {
  const f = pacerFixture()
  f.frame(au(sps,pps,idr))
  const small = Buffer.alloc(1000,2); small[0] = 0x41
  f.frame(au(small),1); f.frame(au(small),2)
  const sent = f.packets.length
  f.frame(au(small),3)
  assert.equal(f.packets.length,sent, 'credit must carry across access units')
  f.pacer.close(); assert.equal(f.counts().completed,4); assert.equal(f.timers.size,0)
})

test('short timer delays preserve video throughput without unbounded RTP bursts', () => {
  const large = Buffer.alloc(100000, 7); large[0] = 0x65
  for (const bitrate of [6_000_000, 12_000_000]) for (const quantum of [1, 2, 4]) {
    const f = pacerFixture('quality', bitrate)
    f.frame(au(sps, pps, large))
    for (let time = 0; time < 500 && f.timers.size; time += quantum) f.advance(quantum)
    assert.equal(f.counts().completed, 1)
    assert.equal(f.counts().congested, 0)
    assert.ok(f.packets.at(-1)!.packet[1] & 128)
    const wireBytes = f.packets.reduce((sum, value) => sum + value.packet.length + 48, 0)
    const elapsed = f.packets.at(-1)!.time
    assert.ok(wireBytes * 8000 / elapsed >= bitrate, `${bitrate}bps must survive ${quantum}ms callback intervals`)
    const bursts = new Map<number, number>()
    for (const value of f.packets) bursts.set(value.time, (bursts.get(value.time) ?? 0) + value.packet.length + 48)
    const limit = Math.max(2 * 1240, bitrate * 1.15 / 8000 * 5)
    assert.ok([...bursts.values()].every(bytes => bytes <= limit), 'each wakeup has a finite wire-byte budget')
    assert.ok(elapsed > 0, 'a whole IDR cannot be sent at one instant')
    f.pacer.close()
  }
})
test('adaptation reacts within 200ms, tolerates a stable high RTT and never requests idle refreshes', () => {
  let time = 0, keys = 0
  const rates: number[] = [], a = videoAdaptation({ maximum: 24000000, change: (value: number) => rates.push(value), keyframe: () => keys++, now: () => time })
  const feedback = { loss: 0, delay: 10, decoded: true, rtt: 280, received: 0, decodedFrames: 0 }
  a.feedback(feedback); time = 200; a.feedback(feedback); assert.equal(keys,0); assert.deepEqual(rates,[])
  time = 400; a.feedback({ ...feedback, loss: .1, received: 20, decodedFrames: 20 }); assert.equal(a.rate(),19200000)
  time = 600; a.feedback({ ...feedback, received: 20, decodedFrames: 0 }); assert.equal(keys,1)
  time = 2000; a.feedback({ ...feedback, received: 20, decodedFrames: 20 }); assert.ok(a.rate() > 19200000)
  assert.throws(() => a.feedback({ ...feedback, delay: NaN })); assert.throws(() => a.feedback({ ...feedback, received: -1 }))
})

test('stable receiver buffering preserves bitrate and idle feedback cannot lower its baseline', () => {
  for (const delay of [45, 80]) {
    let time = 0, keys = 0
    const a = videoAdaptation({ maximum: 6_000_000, change() {}, keyframe: () => keys++, now: () => time })
    const feedback = { loss: 0, delay, decoded: true, rtt: 10, received: 12, decodedFrames: 12 }
    a.feedback({ ...feedback, delay: 0, received: 0, decodedFrames: 0 })
    for (let i = 0; i < 40; i++) {
      time += 200; a.feedback(feedback)
      time += 200; a.feedback({ ...feedback, delay: 0, received: 0, decodedFrames: 0 })
    }
    assert.equal(a.rate(), 6_000_000)
    assert.equal(keys, 0)
    time += 200; a.feedback({ ...feedback, delay: 0, decodedFrames: 0 })
    time += 200; a.feedback(feedback)
    assert.equal(a.rate(), 6_000_000, 'a decoder stall cannot lower the healthy buffer floor')
    assert.equal(keys, 1)
    time += 200; a.feedback({ ...feedback, delay: delay + 41 })
    assert.equal(a.rate(), 4_800_000, 'growing buffering still reduces bitrate promptly')
  }
})

test('receiver buffering adapts without optional frame counters and ignores idle zero deltas', () => {
  let time = 0
  const a = videoAdaptation({ maximum: 6_000_000, change() {}, keyframe() {}, now: () => time })
  const feedback = { loss: 0, delay: 45, decoded: true, rtt: 10 }
  a.feedback({ ...feedback, delay: 0 })
  for (let i = 0; i < 20; i++) {
    time += 200; a.feedback(feedback)
    time += 200; a.feedback({ ...feedback, delay: 0 })
  }
  assert.equal(a.rate(), 6_000_000, 'emitted video supplies a healthy baseline without frame counters')
  time += 200; a.feedback({ ...feedback, delay: 86 })
  assert.equal(a.rate(), 4_800_000, 'buffer growth remains a congestion signal without frame counters')
})

test('loss and RTT growth still reduce bitrate and reconfiguration relearns receiver buffering', () => {
  let time = 0
  const a = videoAdaptation({ maximum: 6_000_000, change() {}, keyframe() {}, now: () => time })
  const feedback = { loss: 0, delay: 45, decoded: true, rtt: 10, received: 12, decodedFrames: 12 }
  a.feedback(feedback)
  time += 200; a.feedback({ ...feedback, loss: .1, delay: 0 })
  assert.equal(a.rate(), 4_800_000)
  time += 200; a.feedback(feedback)
  assert.equal(a.rate(), 4_800_000, 'lossy feedback cannot lower the healthy buffer floor')
  time += 200; a.feedback({ ...feedback, rtt: 40 })
  assert.equal(a.rate(), 3_840_000)
  a.configure(6_000_000)
  a.feedback({ ...feedback, delay: 100, rtt: 100 })
  assert.equal(a.rate(), 6_000_000, 'old delay and RTT floors do not survive reconfiguration')
  time += 200; a.feedback({ ...feedback, delay: 141, rtt: 100 })
  assert.equal(a.rate(), 4_800_000)
})

// @ts-expect-error Native sender runs in the installed JavaScript helper.
import { nativeDirect } from '../native/remote-desktop/native-direct.mjs'

test('legacy high quality opts into quality priority while explicit speed is preserved', () => {
  assert.equal(videoSettings({ ...DEFAULT_VIDEO, priority: undefined, quality: 'high' }).priority, 'quality')
  assert.equal(videoSettings({ ...DEFAULT_VIDEO, quality: 'high' }).priority, 'speed')
})

test('quality pacing completes a sharp frame on a slow link before releasing capture', () => {
  const f = pacerFixture('quality'), reference = Buffer.alloc(4000, 7); reference[0] = 0x41
  f.frame(au(sps, pps, idr))
  f.frame(au(reference), 7000)
  f.advance(25)
  assert.equal(f.counts().completed, 1, 'capture remains backpressured until the frame is sent')
  assert.equal(f.counts().congested, 0)
  for (let i = 0; i < 35 && f.timers.size; i++) f.advance(2)
  assert.equal(f.counts().completed, 2)
  assert.equal(f.counts().congested, 0)
  assert.ok(f.packets.at(-1)!.packet[1] & 128, 'the whole frame reaches its final RTP marker')
  assert.equal(f.timers.size, 0); f.pacer.close()
})

test('quality pacing drops stale reference frames after 100ms and restores the chain at an IDR', () => {
  const f = pacerFixture('quality'), reference = Buffer.alloc(10000, 7); reference[0] = 0x41
  f.frame(au(sps, pps, idr))
  f.frame(au(reference), 7000); f.advance(100)
  assert.equal(f.counts().completed, 1, 'a reference frame can use the full 100ms quality budget')
  assert.equal(f.counts().congested, 0)
  f.advance(1)
  assert.equal(f.counts().completed, 2)
  assert.equal(f.counts().congested, 1)
  assert.equal(f.timers.size, 0)
  const sent = f.packets.length
  f.frame(au(reference), 14000)
  assert.equal(f.packets.length, sent, 'dependent frames remain blocked after a partial reference was dropped')
  f.frame(au(idr), 21000)
  for (let i = 0; i < 10 && f.timers.size; i++) f.advance(2)
  assert.deepEqual(f.packets.slice(sent).map(value => value.packet[12] & 31), [7, 8, 5])
  assert.equal(f.counts().completed, 4)
  assert.equal(f.counts().congested, 1)
  f.pacer.close()
})

test('both priorities adapt encoder and network bitrate while quality tolerates more buffer growth', async () => {
  for (const priority of ['quality', 'speed']) {
    let time = 0, message: (raw: string) => void = () => {}, sent: Record<string, unknown> | undefined
    const rates: number[] = []
    class Video { addH264Codec() {} addSSRC() {} setBitrate() {} }
    class Handler { addToChain() {} }
    const rtc = { Video, RtpPacketizationConfig: Handler, RtcpSrReporter: Handler, RtcpNackResponder: Handler,
      PeerConnection: class {
        addTrack() { return { setMediaHandler() {}, onOpen() {}, onError() {}, onMessage() {}, isOpen: () => true, sendMessageBinary: () => true } }
        createDataChannel(label: string) { return { onOpen() {}, onMessage(fn: (raw: string) => void) { if (label === 'control') message = fn }, onClosed() {}, onError() {}, isOpen: () => true, sendMessage(raw: string) { sent = JSON.parse(raw) }, close() {} } }
        onLocalDescription() {} onLocalCandidate() {} onStateChange() {} setLocalDescription() {} close() {}
      } }
    const settings = videoSettings({ ...DEFAULT_VIDEO, quality: 'high', priority }), maximum = videoRate(settings)
    const direct = nativeDirect(rtc, { settings, iceServers: [], autoNat: false, emit() {}, input() {}, keyframe() {}, bitrate: (rate: number) => rates.push(rate), fail: (error: Error) => { throw error }, now: () => time })
    direct.configure({ ...settings, bitrate: maximum, payload: 102, profile: 'high', level: 42 })
    const feedback = { type: 'feedback', decoded: true, received: 20, decodedFrames: 20, loss: 0, delay: 100, rtt: 100 }
    message(JSON.stringify({ ...feedback, delay: 10 }))
    time = 200; message(JSON.stringify({ ...feedback, delay: 70 }))
    assert.equal(sent!.bitrate, priority === 'quality' ? maximum : maximum * .8, 'quality tolerates a larger buffer increase')
    assert.equal(rates.at(-1), sent!.bitrate)
    time = 400; message(JSON.stringify(feedback))
    assert.equal(sent!.bitrate, priority === 'quality' ? maximum * .8 : maximum * .64, 'both priorities react to excessive buffering')
    assert.equal(rates.at(-1), sent!.bitrate)
    time = 600; message(JSON.stringify({ ...feedback, loss: .1 }))
    assert.ok(Number(sent!.bitrate) < maximum, 'both priorities adapt the network send budget')
    assert.equal(rates.at(-1), sent!.bitrate)
    await direct.close()
  }
})

test('receiver feedback waits for an in-flight IDR and resumes recovery after completion or expiry', async t => {
  for (const expires of [false, true]) await t.test(expires ? 'expired IDR' : 'completed IDR', async context => {
    let time = 0, keys = 0, completed = 0, markers = 0, message: (raw: string) => void = () => {}
    context.mock.method(performance, 'now', () => time)
    context.mock.timers.enable({ apis: ['setTimeout'] })
    class Video { addH264Codec() {} addSSRC() {} setBitrate() {} }
    class Handler { addToChain() {} }
    const rtc = { Video, RtpPacketizationConfig: Handler, RtcpSrReporter: Handler, RtcpNackResponder: Handler,
      PeerConnection: class {
        addTrack() { return { setMediaHandler() {}, onOpen() {}, onError() {}, onMessage() {}, isOpen: () => true,
          sendMessageBinary(packet: Buffer) { if (packet[1] & 128) markers++; return true } } }
        createDataChannel(label: string) { return { onOpen() {}, onMessage(fn: (raw: string) => void) { if (label === 'control') message = fn }, onClosed() {}, onError() {}, isOpen: () => true, sendMessage() {}, close() {} } }
        onLocalDescription() {} onLocalCandidate() {} onStateChange() {} setLocalDescription() {} close() {}
      } }
    const settings = videoSettings({ ...DEFAULT_VIDEO, quality: 'high', priority: 'quality' })
    const direct = nativeDirect(rtc, { settings, iceServers: [], autoNat: false, emit() {}, input() {}, keyframe: () => keys++, bitrate() {}, fail: (error: Error) => { throw error }, now: () => time })
    try {
      direct.configure({ ...settings, bitrate: 350000, payload: 102, profile: 'high', level: 52 })
      const large = Buffer.alloc(expires ? 100000 : 25000, 7); large[0] = 0x65
      direct.frame({ data: au(sps, pps, large), timestamp: 0 }, () => completed++)
      const feedback = () => message(JSON.stringify({ type: 'feedback', decoded: true, received: 20, decodedFrames: 0, loss: 0, delay: 0, rtt: 10 }))
      const advance = (until: number) => { while (time < until) { time++; context.mock.timers.tick(1) } }
      feedback(); advance(200); feedback(); advance(400); feedback()
      assert.equal(completed, 0, 'the large IDR still occupies the sender')
      assert.equal(keys, 0, 'feedback must not queue another IDR while this IDR is being sent')
      advance(expires ? 501 : 500)
      assert.equal(completed, 1, 'completion and expiry both release capture')
      assert.equal(markers, expires ? 0 : 1)
      assert.equal(keys, expires ? 1 : 0, 'an expired IDR still requests immediate recovery')
      advance(800); feedback()
      assert.equal(keys, expires ? 2 : 1, 'decoder stalls can request recovery again once the IDR leaves the sender')
    } finally { await direct.close() }
  })
})
