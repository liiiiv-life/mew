import test from 'node:test'
import assert from 'node:assert/strict'
import { DataChannelTransport } from './remote-transport.ts'
import { REMOTE_LIMITS, type RemoteFrame } from '../../shared/remote-access.ts'

class Wire extends EventTarget {
  readyState = 'open'
  bufferedAmount = 0
  frames: RemoteFrame[] = []
  send(data: string) { this.frames.push(JSON.parse(data)) }
  close() { this.readyState = 'closed' }
}
const request = (id: string): RemoteFrame => ({ type: 'request', id, method: 'POST', path: '/api/upload', headers: {} })
const chunk = (id: string): RemoteFrame => ({ type: 'chunk', id, data: Buffer.from('part').toString('base64') })
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 1))

test('forwarded upload end cannot overtake an earlier chunk waiting for RTC backpressure', async t => {
  const wire = new Wire(), transport = new DataChannelTransport(wire as never)
  t.after(() => transport.close())
  await transport.forward(request('upload'))
  wire.bufferedAmount = REMOTE_LIMITS.queue + 1
  const earlier = transport.forward(chunk('upload'))
  await tick()
  wire.bufferedAmount = 0
  const end = transport.forward({ type: 'end', id: 'upload' })
  await Promise.all([earlier, end])
  assert.deepEqual(wire.frames.map(frame => frame.type), ['request', 'chunk', 'end'])
})

test('forwarded active cancellation follows previous data and releases its slot only after sending cancel', async t => {
  const wire = new Wire(), transport = new DataChannelTransport(wire as never)
  t.after(() => transport.close())
  for (let i = 0; i < REMOTE_LIMITS.streams; i++) await transport.forward(request('active-' + i))
  const queued = transport.forward(request('next'))
  wire.bufferedAmount = REMOTE_LIMITS.queue + 1
  const earlier = transport.forward(chunk('active-0'))
  await tick()
  assert.equal(wire.frames.some(frame => frame.id === 'next'), false)
  wire.bufferedAmount = 0
  const cancelled = transport.forward({ type: 'cancel', id: 'active-0' })
  await Promise.all([earlier, cancelled, queued])
  assert.deepEqual(wire.frames.slice(REMOTE_LIMITS.streams).map(frame => [frame.id, frame.type]), [['active-0', 'chunk'], ['active-0', 'cancel'], ['next', 'request']])
})

test('cancelling a forwarded request before admission discards its queued body without sending', async t => {
  const wire = new Wire(), transport = new DataChannelTransport(wire as never)
  t.after(() => transport.close())
  for (let i = 0; i < REMOTE_LIMITS.streams; i++) await transport.forward(request('active-' + i))
  const queued = transport.forward(request('never-sent'))
  const body = transport.forward(chunk('never-sent'))
  await transport.forward({ type: 'cancel', id: 'never-sent' })
  await Promise.all([queued, body])
  await transport.forward({ type: 'cancel', id: 'active-0' })
  await transport.forward(request('replacement'))
  assert.equal(wire.frames.some(frame => frame.id === 'never-sent'), false)
  assert.equal(wire.frames.some(frame => frame.id === 'replacement'), true)
})

test('completed forwarded streams discard their queued final credit', async t => {
  const wire = new Wire(), transport = new DataChannelTransport(wire as never)
  t.after(() => transport.close())
  await transport.forward(request('completed'))
  const credit = transport.forward({ type: 'credit', id: 'completed' })
  transport.receive(new MessageEvent('message', { data: JSON.stringify({ type: 'end', id: 'completed' }) }))
  await credit
  assert.deepEqual(wire.frames.map(frame => frame.type), ['request'])
})

test('identity reload cancels previous app streams and sockets and drops requests queued for admission', async t => {
  const wire = new Wire(), transport = new DataChannelTransport(wire as never)
  t.after(() => transport.close())
  await transport.forward({ type: 'socket', id: 'socket', path: '/api/live/ws' })
  for (let i = 1; i < REMOTE_LIMITS.streams; i++) await transport.forward(request('old-' + i))
  const queued = transport.forward(request('queued'))
  await transport.resetForwarded()
  await queued
  assert.equal(wire.frames.some(frame => frame.id === 'queued'), false)
  assert.equal(wire.frames.filter(frame => frame.type === 'cancel').length, REMOTE_LIMITS.streams - 1)
  assert.ok(wire.frames.some(frame => frame.id === 'socket' && frame.type === 'close'))
  await transport.forward(request('new-account'))
  assert.equal(wire.frames.at(-1)?.id, 'new-account')
})
