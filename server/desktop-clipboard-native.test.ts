import test from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error Native helper JavaScript is tested without loading OS libraries.
import { windowsClipboard } from '../native/remote-desktop/clipboard-windows.mjs'
// @ts-expect-error Native helper JavaScript is tested with a fake RTC peer.
import { nativeDirect } from '../native/remote-desktop/native-direct.mjs'

test('Windows text clipboard reads bounded UTF-16 and always unlocks/closes OS handles', () => {
  const calls: string[] = []
  let text = '한글\ntext', unavailable = false
  const koffi = { load: () => ({ func: (signature: string) => {
    const name = signature.match(/(\w+)\(/)![1]
    return () => { calls.push(name); if (name === 'GetClipboardData' && unavailable) return 0; if (name === 'GlobalSize') return Buffer.byteLength(text + '\0', 'utf16le'); return 1 }
  } }), decode: (_pointer: unknown, _type: unknown, length: number) => {
    assert.ok(length <= 8194)
    return Buffer.from(text + '\0', 'utf16le').subarray(0, length)
  } }
  const clipboard = windowsClipboard(koffi)
  assert.equal(clipboard.read(), text)
  assert.deepEqual(calls, ['OpenClipboard', 'GetClipboardData', 'GlobalSize', 'GlobalLock', 'GlobalUnlock', 'CloseClipboard'])
  text = 'x'.repeat(4097)
  assert.throws(() => clipboard.read(), /too large/)
  assert.deepEqual(calls.slice(-2), ['GlobalUnlock', 'CloseClipboard'])
  unavailable = true
  assert.equal(clipboard.read(), '')
  assert.ok(!calls.includes('GlobalFree'), 'Windows retains ownership of read clipboard memory')
})

test('native clipboard replies only on reliable control, bounds text and drops replies after closing', async () => {
  const handlers = new Map<string, (raw: string) => void>(), replies: Record<string, unknown>[] = [], failures: unknown[] = []
  let read: () => Promise<string> = async () => 'remote 텍스트'
  class Config { timestamp = 0; addToChain() {} }
  const rtc = {
    Video: class { addH264Codec() {} addSSRC() {} setBitrate() {} }, RtpPacketizationConfig: Config,
    H264RtpPacketizer: class { addToChain() {} }, RtcpSrReporter: Config, RtcpNackResponder: Config,
    PeerConnection: class {
      addTrack() { return { setMediaHandler() {}, onOpen() {}, onError() {}, onMessage() {} } }
      createDataChannel(label: string) { return { onOpen() {}, onClosed() {}, onError() {}, onMessage(fn: (raw: string) => void) { handlers.set(label, fn) }, isOpen: () => true, sendMessage(raw: string) { replies.push(JSON.parse(raw)) }, close() {} } }
      onLocalDescription() {} onLocalCandidate() {} onStateChange() {} setLocalDescription() {} close() {}
    },
  }
  const direct = nativeDirect(rtc, { iceServers: [], autoNat: false, emit() {}, keyframe() {}, bitrate() {}, input() { assert.fail('clipboard request leaked into input') }, fail: (e: unknown) => failures.push(e), readClipboard: () => read() })
  const request = (id: number) => handlers.get('control')!(JSON.stringify({ type: 'clipboard-read', id }))
  const settle = () => new Promise(resolve => setImmediate(resolve))
  request(1); await settle()
  assert.deepEqual(replies, [{ type: 'clipboard', id: 1, text: 'remote 텍스트' }])
  read = async () => 'x'.repeat(4097)
  request(2); await settle()
  assert.deepEqual(replies.at(-1), { type: 'clipboard', id: 2, error: true })
  read = async () => { throw new Error('OS permission denied') }
  request(3); await settle()
  assert.deepEqual(replies.at(-1), { type: 'clipboard', id: 3, error: true })
  let finish!: (text: string) => void
  read = () => new Promise(resolve => { finish = resolve })
  request(4); await settle(); request(5)
  await direct.close(); finish('late'); await settle()
  assert.equal(replies.length, 3)
  assert.deepEqual(failures, [])
})
