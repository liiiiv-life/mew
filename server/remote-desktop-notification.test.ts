import test from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error Native helper modules run as JavaScript in the Windows host/Electron.
import { connectionNotice } from '../native/remote-desktop/connection-notice.mjs'
// @ts-expect-error Native helper modules run as JavaScript in the Windows host.
import { nativeDirect } from '../native/remote-desktop/native-direct.mjs'

test('host notification waits for visible video and both channels, once per session', () => {
  let shown = 0, dismissed = 0
  const show = () => { shown++; return () => { dismissed++ } }
  const first = connectionNotice(show)
  first.opened('control'); first.opened('control'); first.ready()
  assert.equal(shown, 0, 'duplicate channel events cannot stand in for motion readiness')
  first.opened('motion')
  assert.equal(shown, 1)
  first.ready(); first.opened('motion'); first.ready()
  assert.equal(shown, 1)
  first.close(); first.close(); first.ready()
  assert.equal(dismissed, 1)
  const next = connectionNotice(show)
  next.opened('motion'); next.opened('control')
  assert.equal(shown, 1, 'transport readiness alone cannot announce a visible screen')
  next.ready(); next.close()
  assert.equal(shown, 2, 'a fresh session can announce itself again')
  assert.equal(dismissed, 2)
})

test('failed/closed sessions never notify, and unsupported OS notifications do not fail the session', () => {
  let shown = 0
  const failed = connectionNotice(() => { shown++ })
  failed.opened('motion'); failed.opened('control'); failed.close(); failed.ready()
  assert.equal(shown, 0)
  const unsupported = connectionNotice(() => { shown++; throw new Error('Notification service unavailable') })
  assert.doesNotThrow(() => { unsupported.opened('motion'); unsupported.opened('control'); unsupported.ready(); unsupported.ready(); unsupported.close() })
  assert.equal(shown, 1, 'a failing OS notifier is not retried on repeated acknowledgements')
})

function nativeFixture(show: () => unknown) {
  const channels = new Map<string, { open?: () => void; message?: (raw: string) => void }>()
  const inputs: unknown[] = [], failures: unknown[] = []
  class Video { addH264Codec() {} addSSRC() {} setBitrate() {} }
  class Packetizer { addToChain() {} }
  class Config { timestamp = 0 }
  const rtc = {
    Video, RtpPacketizationConfig: Config, H264RtpPacketizer: Packetizer,
    RtcpSrReporter: Config, RtcpNackResponder: Config,
    PeerConnection: class {
      addTrack() { return { setMediaHandler() {}, onOpen() {}, onError() {}, onMessage() {}, isOpen: () => true, sendMessageBinary: () => true } }
      createDataChannel(label: string) {
        const handlers: { open?: () => void; message?: (raw: string) => void } = {}
        channels.set(label, handlers)
        return { onOpen: (fn: () => void) => { handlers.open = fn }, onMessage: (fn: (raw: string) => void) => { handlers.message = fn }, onClosed() {}, onError() {} }
      }
      onLocalDescription() {} onLocalCandidate() {} onStateChange() {} setLocalDescription() {} close() {}
    },
  }
  const direct = nativeDirect(rtc, { iceServers: [], emit() {}, input: (value: unknown) => inputs.push(value), keyframe() {}, bitrate() {}, fail: (error: unknown) => failures.push(error), connected: show })
  return { direct, channels, inputs, failures }
}

test('native control readiness is consumed locally, cannot inject input and is ignored after close', () => {
  let shown = 0, dismissed = 0
  const fixture = nativeFixture(() => { shown++; return () => { dismissed++ } })
  fixture.channels.get('control')!.open!()
  fixture.channels.get('control')!.message!(JSON.stringify({ type: 'viewer-ready' }))
  assert.equal(shown, 0)
  fixture.channels.get('motion')!.open!()
  assert.equal(shown, 1)
  fixture.channels.get('control')!.message!(JSON.stringify({ type: 'viewer-ready' }))
  assert.deepEqual(fixture.inputs, [])
  assert.deepEqual(fixture.failures, [])
  fixture.direct.close()
  fixture.channels.get('control')!.message!(JSON.stringify({ type: 'viewer-ready' }))
  assert.equal(shown, 1)
  assert.equal(dismissed, 1)
})

test('an OS notifier exception never turns an acknowledged native connection into an input error', () => {
  const fixture = nativeFixture(() => { throw new Error('Shell unavailable') })
  fixture.channels.get('motion')!.open!(); fixture.channels.get('control')!.open!()
  fixture.channels.get('control')!.message!(JSON.stringify({ type: 'viewer-ready' }))
  assert.deepEqual(fixture.failures, [])
  fixture.direct.close()
})
