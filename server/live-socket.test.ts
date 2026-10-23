import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocket } from 'ws'
import { attachLiveWebSocket, type LiveSource } from './live-socket.ts'
import { accessChanges } from './access-policy.ts'
import { LIVE_WS_PATH, type LiveMessage } from '../shared/live-updates.ts'

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out waiting for a live update'); await delay(10) }
}
test('live scopes share reads, send no idle payloads, patch changed fields and resync new listeners', async t => {
  const server = http.createServer()
  let value = { commits: 'large-history'.repeat(80_000), workingTree: { files: ['a.ts'] }, removable: true }, reads = 0, activeReads = 0, maximumReads = 0
  const source: LiveSource = { key: 'same-scope', interval: 25, allowed: () => true, async read() {
    reads++; maximumReads = Math.max(maximumReads, ++activeReads)
    await delay(5); activeReads--; return structuredClone(value)
  } }
  attachLiveWebSocket(server, () => source)
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const clients: WebSocket[] = []
  t.after(async () => { clients.forEach(ws => ws.terminate()); await new Promise<void>(resolve => server.close(() => resolve())) })
  const connect = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}${LIVE_WS_PATH}`); clients.push(ws)
    const frames: LiveMessage[] = []; ws.on('message', raw => frames.push(JSON.parse(raw.toString())))
    await once(ws, 'open'); return { ws, frames }
  }
  const first = await connect(), second = await connect()
  const subscribe = (ws: WebSocket, id: string) => ws.send(JSON.stringify({ type: 'subscribe', id, resource: { kind: 'git', project: '.workspace', path: '' } }))
  subscribe(first.ws, 'one'); subscribe(second.ws, 'two')
  await until(() => first.frames.length === 1 && second.frames.length === 1)
  const initialReads = reads
  await delay(180)
  assert.ok(reads >= initialReads + 3, 'the server continues checking')
  assert.equal(maximumReads, 1, 'subscribers share one sequential check')
  assert.equal(first.frames.length, 1, 'unchanged large payload is never resent')
  assert.equal(second.frames.length, 1)
  value.workingTree = { files: ['a.ts', 'b.ts'] }
  delete (value as Partial<typeof value>).removable
  await until(() => first.frames.length === 2 && second.frames.length === 2)
  const patch = first.frames[1]; assert.equal(patch.type, 'patch')
  if (patch.type === 'patch') { assert.deepEqual(patch.value, { workingTree: value.workingTree }); assert.deepEqual(patch.removed, ['removable']); assert.equal(patch.base, 1) }
  assert.ok(Buffer.byteLength(JSON.stringify(patch)) < 250, 'history is absent from the changed-file update')
  const third = await connect(); subscribe(third.ws, 'three')
  await until(() => third.frames.length === 1)
  assert.equal(third.frames[0].type, 'snapshot')
  if (third.frames[0].type === 'snapshot') assert.deepEqual(third.frames[0].value, value)
  assert.equal(first.frames.length, 2, 'new subscribers do not replay data to old subscribers')
  first.ws.send(JSON.stringify({ type: 'unsubscribe', id: 'one' })); second.ws.send(JSON.stringify({ type: 'unsubscribe', id: 'two' })); third.ws.send(JSON.stringify({ type: 'unsubscribe', id: 'three' }))
  await delay(60); const stopped = reads; await delay(100)
  assert.equal(reads, stopped, 'last unsubscribe stops the timer')
})

test('revocation discards an in-flight snapshot and repeated read errors remain quiet until recovery', async t => {
  const server = http.createServer()
  let allowed = true, failing = false, finish: (() => void) | undefined, hold = false
  const source: LiveSource = { key: 'private', interval: 20, allowed: () => allowed, async read() {
    if (hold) await new Promise<void>(resolve => { finish = resolve })
    if (failing) throw new Error('fixture read failure')
    return { private: 'account-only' }
  } }
  attachLiveWebSocket(server, () => source)
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}${LIVE_WS_PATH}`)
  const frames: LiveMessage[] = []; ws.on('message', raw => frames.push(JSON.parse(raw.toString())))
  t.after(async () => { finish?.(); ws.terminate(); await new Promise<void>(resolve => server.close(() => resolve())) })
  await once(ws, 'open')
  failing = true; ws.send(JSON.stringify({ type: 'subscribe', id: 'private', resource: {} }))
  await until(() => frames.length === 1); await delay(100); assert.equal(frames.length, 1)
  failing = false; await until(() => frames.length === 2); assert.equal(frames[1].type, 'snapshot')
  hold = true; await until(() => !!finish)
  allowed = false; accessChanges.emit('change'); finish!()
  await until(() => frames.length === 3); await delay(80)
  assert.equal(frames[2].type, 'error'); assert.equal(frames.length, 3, 'in-flight data cannot escape revocation')
})
