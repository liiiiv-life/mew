import test from 'node:test'
import assert from 'node:assert/strict'
import { desktopInput } from './desktop-input.ts'

test('clipboard responses match requests and rejected/closed sessions do not retain waiters', async () => {
  const packets: { type: string; id: number }[] = []
  const input = desktopInput()
  input.connect('control', { readyState: 'open', bufferedAmount: 0, send: raw => packets.push(JSON.parse(raw)) })
  assert.throws(() => input.paste('x'.repeat(4097)), /invalid/)
  assert.throws(() => input.paste('\0'), /invalid/)
  assert.throws(() => input.paste('\u0001'.repeat(4096)), /invalid/)
  const first = input.readClipboard(), second = input.readClipboard()
  await assert.rejects(input.readClipboard(), /unavailable/)
  input.message(JSON.stringify({ type: 'clipboard', id: 99, text: 'stale' }))
  input.message(JSON.stringify({ type: 'clipboard', id: packets[1].id, text: '한글\ntext' }))
  assert.equal(await second, '한글\ntext')
  input.message(JSON.stringify({ type: 'clipboard', id: packets[0].id, error: true }))
  await assert.rejects(first, /unavailable/)
  const invalid = input.readClipboard()
  input.message(JSON.stringify({ type: 'clipboard', id: packets.at(-1)!.id, text: 'x'.repeat(4097) }))
  await assert.rejects(invalid, /unavailable/)
  const closing = input.readClipboard()
  input.close()
  await assert.rejects(closing, /closed/)
  await assert.rejects(input.readClipboard(), /unavailable/)
})
