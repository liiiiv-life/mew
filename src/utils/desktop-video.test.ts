import test from 'node:test'
import assert from 'node:assert/strict'
import { desktopVideoFeedback, desktopVideoAnswer } from './desktop-video.ts'

test('video feedback uses interval deltas, distinguishes idle from stalled decode, and omits unavailable timing', () => {
  const sample = desktopVideoFeedback()
  const initial = { id: 'video', packetsReceived: 100, packetsLost: 2, framesReceived: 10, framesDecoded: 10, jitterBufferDelay: 1, jitterBufferEmittedCount: 10, totalDecodeTime: .02 }
  assert.equal(sample(initial).received,0)
  const next = { ...initial, packetsReceived: 200, packetsLost: 3, framesReceived: 20, framesDecoded: 20, jitterBufferDelay: 1.1, jitterBufferEmittedCount: 20, totalDecodeTime: .05 }
  const value = sample(next,12)
  assert.equal(value.received,10); assert.equal(value.decodedFrames,10); assert.ok(Math.abs(value.delay - 10) < 1e-9); assert.ok(Math.abs(value.decode! - 3) < 1e-9); assert.equal(value.rtt,12)
  assert.equal(sample(next).received,0, 'an unchanged desktop has no new frames')
  assert.equal(sample({ ...next, framesReceived: 21 }).decodedFrames,0, 'new video without decoded progress is a stall')
  const missing = sample({ id: 'new', framesDecoded: 1 })
  assert.ok(!Object.hasOwn(missing,'decode')); assert.ok(!Object.hasOwn(missing,'rtt')); assert.ok(!Object.hasOwn(missing,'received'))
  assert.ok(Object.values(missing).every(value => typeof value !== 'number' || Number.isFinite(value)))
})

test('only a verified smooth decoder can raise an accepted H.264 receive level, without changing codec profiles', async () => {
  const sdp = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 103\r\na=recvonly\r\na=fmtp:103 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f\r\n'
  const settings = { resolution: '1080p', fps: 144, quality: 'high' } as const
  const configuration: MediaDecodingConfiguration[] = []
  const changed = await desktopVideoAnswer(sdp,settings,async value => { configuration.push(value); return { supported: true, smooth: true, powerEfficient: false } })
  assert.match(changed,/profile-level-id=42e034/); assert.equal(configuration.length,1)
  assert.equal(configuration[0].video!.width,1920); assert.equal(configuration[0].video!.framerate,144)
  for (const info of [{ supported: true, smooth: false, powerEfficient: true }, { supported: false, smooth: false, powerEfficient: false }]) assert.equal(await desktopVideoAnswer(sdp,settings,async () => info),sdp)
  assert.equal(await desktopVideoAnswer(sdp,settings,async () => { throw new Error('Unavailable') }),sdp)
  assert.equal(await desktopVideoAnswer(sdp.replace('level-asymmetry-allowed=1','level-asymmetry-allowed=0'),settings,async () => assert.fail()),sdp.replace('level-asymmetry-allowed=1','level-asymmetry-allowed=0'))
  const wrongProfile = sdp.replace('42e01f','4d001f')
  assert.equal(await desktopVideoAnswer(wrongProfile,settings,async () => assert.fail()),wrongProfile)
})

test('level-6 requests probe the highest mode of the accepted 5.2 fallback payload', async () => {
  const sdp = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 105\r\na=recvonly\r\na=fmtp:105 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f\r\n'
  const configuration: MediaDecodingConfiguration[] = []
  const changed = await desktopVideoAnswer(sdp,{ resolution: '1080p', fps: 240, quality: 'high' },async value => { configuration.push(value); return { supported: true, smooth: true, powerEfficient: false } })
  assert.match(changed,/profile-level-id=42e034/)
  assert.equal(configuration[0].video!.framerate,165)
  assert.equal(configuration.length,1)
})
