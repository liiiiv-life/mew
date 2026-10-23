import assert from 'node:assert/strict'
import test from 'node:test'
import { remoteTicketInbox } from './remote-access-ticket-inbox.ts'
import { REMOTE_LIMITS } from '../shared/remote-access.ts'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))

test('early channel authentication waits for a verified ticket and keeps subsequent requests ordered', async () => {
  const received: [string, string][] = []
  const inbox = remoteTicketInbox<{ ticket: string }>(async (data, value) => { received.push([data, value.ticket]) }, () => assert.fail('valid authentication'))
  assert.equal(inbox.push('authenticate'), true)
  assert.equal(inbox.push('request'), true)
  await tick()
  assert.deepEqual(received, [])
  assert.equal(inbox.authorize({ ticket: 'verified-ticket' }), true)
  assert.equal(inbox.authorize({ ticket: 'replacement-ticket' }), false)
  await tick()
  assert.deepEqual(received, [['authenticate', 'verified-ticket'], ['request', 'verified-ticket']])
  inbox.close()
})

test('early data stays within the existing byte and frame limits while ticket verification is pending', async () => {
  const inbox = remoteTicketInbox(async () => assert.fail('unverified data'), () => assert.fail('bounded data'))
  for (let index = 0; index < REMOTE_LIMITS.queue / REMOTE_LIMITS.frame; index++) assert.equal(inbox.push('x'.repeat(REMOTE_LIMITS.frame)), true)
  assert.equal(inbox.push('x'), false)
  assert.equal(inbox.push('x'.repeat(REMOTE_LIMITS.frame + 1)), false)
  assert.equal(inbox.push(new Uint8Array()), false)
  inbox.close()
  await tick()
})

test('empty early frames cannot bypass the queue entry limit', async () => {
  const inbox = remoteTicketInbox(async () => assert.fail('unverified data'), () => assert.fail('bounded data'))
  for (let index = 0; index < 4097; index++) assert.equal(inbox.push(''), true)
  assert.equal(inbox.push(''), false)
  inbox.close()
  await tick()
})

test('closing before ticket verification releases the waiter, drops pending data, and rejects late authorization', async () => {
  const received: string[] = []
  const inbox = remoteTicketInbox(async data => { received.push(data) }, () => assert.fail('closed queue'))
  inbox.push('authenticate')
  inbox.push('request')
  inbox.close()
  assert.equal(inbox.authorize({ ticket: 'late-ticket' }), false)
  assert.equal(inbox.push('late-data'), false)
  await tick()
  assert.deepEqual(received, [])
})

test('closing immediately after verification prevents a queued authentication callback from starting', async () => {
  const inbox = remoteTicketInbox(async () => assert.fail('closed authentication'), () => assert.fail('closed queue'))
  inbox.push('authenticate')
  inbox.authorize({ ticket: 'verified-ticket' })
  inbox.close()
  await tick()
})

test('failed authentication closes the gate once and discards queued work', async () => {
  const received: string[] = []
  let failures = 0
  const inbox = remoteTicketInbox(async data => { received.push(data); throw new Error('invalid-authentication') }, () => { failures++ })
  inbox.push('authenticate')
  inbox.push('request')
  inbox.authorize({ ticket: 'verified-ticket' })
  await tick()
  assert.equal(failures, 1)
  assert.deepEqual(received, ['authenticate'])
  assert.equal(inbox.push('late-request'), false)
  assert.equal(inbox.authorize({ ticket: 'late-ticket' }), false)
})
