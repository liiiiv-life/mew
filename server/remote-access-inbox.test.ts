import test from 'node:test'
import assert from 'node:assert/strict'
import { remoteInbox } from './remote-access-inbox.ts'
import { REMOTE_LIMITS } from '../shared/remote-access.ts'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))
test('a thousand small IPC messages remain ordered behind authentication without exceeding the byte budget', async () => {
  let release!: () => void
  const authenticating = new Promise<void>(resolve => { release = resolve }), received: string[] = []
  const inbox = remoteInbox(async data => { if (!received.length) await authenticating; received.push(data) }, () => assert.fail('valid burst must not close the connection'))
  for (let i = 0; i < 1000; i++) assert.equal(inbox.push('message-' + i), true)
  assert.equal(received.length, 0)
  release(); await tick()
  assert.deepEqual(received, Array.from({ length: 1000 }, (_, i) => 'message-' + i))
  inbox.close()
})

test('the byte budget includes the currently processed frame and bounds multibyte data', async () => {
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const inbox = remoteInbox(async () => waiting, () => assert.fail('unprocessed valid input'))
  const data = 'é'.repeat(REMOTE_LIMITS.frame / 2)
  for (let i = 0; i < REMOTE_LIMITS.queue / REMOTE_LIMITS.frame; i++) assert.equal(inbox.push(data), true)
  assert.equal(inbox.push('x'), false)
  assert.equal(inbox.push(Buffer.from('x')), false)
  assert.equal(inbox.push('x'.repeat(REMOTE_LIMITS.frame + 1)), false)
  release(); await tick()
  assert.equal(inbox.push(data), true, 'draining releases the byte budget')
  inbox.close()
})

test('closing during authentication discards queued work and rejects new messages', async () => {
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve }), received: string[] = []
  const inbox = remoteInbox(async data => { received.push(data); await waiting }, () => assert.fail('closed queue'))
  assert.equal(inbox.push('authenticate'), true); assert.equal(inbox.push('write'), true)
  inbox.close(); release(); await tick()
  assert.deepEqual(received, ['authenticate'])
  assert.equal(inbox.push('write-again'), false)
})

test('processor failure closes once and discards following operations', async () => {
  let failed = 0
  const received: string[] = []
  const inbox = remoteInbox(async data => { received.push(data); throw new Error('invalid-auth') }, () => { failed++ })
  inbox.push('invalid'); inbox.push('write'); await tick()
  assert.equal(failed, 1); assert.deepEqual(received, ['invalid']); assert.equal(inbox.push('another-write'), false)
})

test('empty IPC frames cannot bypass the finite entry count', () => {
  const inbox = remoteInbox(async () => new Promise<void>(() => {}), () => assert.fail('pending'))
  assert.equal(inbox.push(''), true)
  for (let i = 0; i < 4096; i++) assert.equal(inbox.push(''), true)
  assert.equal(inbox.push(''), false)
  inbox.close()
})
