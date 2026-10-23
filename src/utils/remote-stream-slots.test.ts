import test from 'node:test'
import assert from 'node:assert/strict'
import { RemoteStreamSlots } from './remote-stream-slots.ts'

test('separate pools unblock HTTP behind sixteen persistent sockets and preserve FIFO within each kind', async () => {
  const slots = new RemoteStreamSlots(), releases = await Promise.all(Array.from({ length: 16 }, () => slots.acquire(undefined, 'socket')))
  const order: string[] = []
  const sockets = ['socket-1', 'socket-2'].map(name => slots.acquire(undefined, 'socket').then(release => { order.push(name); return release }))
  const request = slots.acquire(undefined, 'request').then(release => { order.push('request'); return release })
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(order, [])
  slots.enableSeparate(); const releaseRequest = await request
  assert.deepEqual(order, ['request'])
  releases[0](); const first = await sockets[0]; assert.deepEqual(order, ['request', 'socket-1'])
  first(); const second = await sockets[1]; assert.deepEqual(order, ['request', 'socket-1', 'socket-2'])
  second(); releaseRequest(); for (const release of releases) release(); slots.close()
})
test('without a capability echo HTTP and WS keep the legacy shared sixteen limit', async () => {
  const slots = new RemoteStreamSlots(), releases = await Promise.all(Array.from({ length: 16 }, () => slots.acquire(undefined, 'socket')))
  const controller = new AbortController()
  let started = false
  const pending = slots.acquire(controller.signal, 'request').then(() => { started = true })
  await new Promise(resolve => setImmediate(resolve)); assert.equal(started, false)
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' })
  for (const release of releases) release(); slots.close()
})
test('a full socket waiting queue cannot reject a request with independent pool capacity', async () => {
  const slots = new RemoteStreamSlots(); slots.enableSeparate()
  const releases = await Promise.all(Array.from({ length: 16 }, () => slots.acquire(undefined, 'socket')))
  const controller = new AbortController()
  const waiting = Array.from({ length: 64 }, () => slots.acquire(controller.signal, 'socket').catch(error => error.name))
  const releaseRequest = await slots.acquire(undefined, 'request'); releaseRequest()
  controller.abort(); assert.deepEqual(await Promise.all(waiting), Array(64).fill('AbortError'))
  for (const release of releases) release(); slots.close()
})
