import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { PassThrough } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { residentDesktopHost } from './desktop-resident-host.ts'
import type { DesktopHostProcess } from './remote-desktop-host.ts'

function fixture() {
  const messages: { type: string; session?: string }[] = []
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() { child.emit('exit', 0); return true } })
  child.stdin.on('data', data => { for (const line of data.toString().trim().split('\n')) messages.push(JSON.parse(line)) })
  const emit = (value: unknown) => child.stdout.write(`MEW_DESKTOP ${JSON.stringify(value)}\n`)
  return { child: child as DesktopHostProcess, messages, emit }
}

test('prewarming is idle; native stop acknowledgement allows reuse and stale sessions are isolated', async () => {
  const native = fixture(); let launches = 0
  const pool = residentDesktopHost(async () => { launches++; setImmediate(() => native.emit({ type: 'ready' })); return native.child }, { heartbeatMs: 10 })
  try {
    await Promise.all([pool.warm(), pool.warm()]); await delay(25)
    assert.equal(launches, 1); assert.ok(native.messages.length > 0)
    assert.ok(native.messages.every(value => value.type === 'lease'), 'prewarming cannot select or capture a screen')
    const first = await pool.acquire(), received: string[] = []
    first.stdout.on('data', value => received.push(value.toString()))
    first.stdin.write('{"type":"init","iceServers":[]}\n')
    const id = native.messages.at(-1)!.session!
    assert.match(id, /^[a-f0-9]{32}$/)
    await assert.rejects(pool.acquire(), /leased/)
    native.emit({ type: 'offer', session: 'stale', sdp: 'v=0' }); assert.equal(received.length, 0)
    native.emit({ type: 'sources', session: id, screens: [] }); assert.equal(received.length, 1)
    const exited = once(first, 'exit'); first.stdin.end()
    assert.equal(native.messages.at(-1)!.type, 'stop')
    await assert.rejects(pool.acquire(), /leased/, 'closing does not free the lease before OS cleanup')
    native.emit({ type: 'stopped', session: id }); await exited
    const second = await pool.acquire(), next: string[] = []
    second.stdout.on('data', value => next.push(value.toString())); second.stdin.write('{"type":"init","iceServers":[]}\n')
    const secondId = native.messages.at(-1)!.session
    assert.notEqual(secondId, id); assert.equal(launches, 1)
    first.kill()
    assert.equal(launches, 1, 'a stale session cannot retire its replacement')
    native.emit({ type: 'offer', session: id, sdp: 'v=0' }); assert.equal(next.length, 0)
    native.emit({ type: 'sources', session: secondId, screens: [] }); assert.equal(next.length, 1)
    second.stdin.end(); native.emit({ type: 'stopped', session: secondId })
  } finally { pool.close() }
})

test('unacknowledged stop retires the host and waits out the old capture lease before relaunch', async () => {
  const hosts: ReturnType<typeof fixture>[] = []
  const pool = residentDesktopHost(async () => { const native = fixture(); hosts.push(native); setImmediate(() => native.emit({ type: 'ready' })); return native.child }, { stopMs: 10, quarantineMs: 100 })
  try {
    const first = await pool.acquire(); first.stdin.write('{"type":"init","iceServers":[]}\n')
    const exited = once(first, 'exit'); first.stdin.end(); await Promise.all([exited, delay(20)])
    const acquiring = pool.acquire(); await delay(30)
    assert.equal(hosts.length, 1, 'no replacement while old lease may be live')
    const replacement = await acquiring; assert.equal(hosts.length, 2)
    ;(hosts[0].child.stdout as PassThrough).write(Buffer.alloc(300 * 1024, 0xff))
    await assert.rejects(pool.acquire(), /leased/, 'late malformed output cannot retire the replacement')
    replacement.stdin.write('{"type":"init","iceServers":[]}\n')
    assert.equal(hosts[1].messages.at(-1)!.type, 'init')
  } finally { pool.close() }
})

test('process startup failure is retryable and server shutdown closes an idle host', async () => {
  const hosts: ReturnType<typeof fixture>[] = []
  const pool = residentDesktopHost(async () => { const native = fixture(); hosts.push(native); setImmediate(() => hosts.length === 1 ? native.child.emit('error', new Error('fixture')) : native.emit({ type: 'ready' })); return native.child })
  await assert.rejects(pool.warm())
  await pool.warm(); const exited = once(hosts[1].child, 'exit'); pool.close(); await exited
  await assert.rejects(pool.acquire(), /closed/)
})
