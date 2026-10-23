import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  cliRemoteStatus, ensureCliOwner, startCliHost,
  type CliHostAuth, type CliHostChannel, type CliHostMessage, type CliHostRuntime,
} from './cli-host.ts'
import type { UserRecord } from './auth.ts'
import type { RemoteStatus } from '../shared/remote-access.ts'

function authFixture(initial: Record<string, UserRecord> = {}) {
  const users = new Map(Object.entries(initial))
  let generated = 0
  const auth: CliHostAuth = {
    listUsers: () => [...users].map(([email, record]) => ({ email, record })),
    getUser: email => users.get(email) ?? null,
    normalizeEmail: email => String(email ?? '').trim().toLowerCase(),
    isValidEmail: email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    generateTempPassword: () => { generated++; return 'temporary-password' },
    hashPassword: () => 'stored-hash',
    upsertUser: (email, record) => { users.set(email, record) },
  }
  return { auth, users, generated: () => generated }
}

function channelFixture() {
  const emitter = new EventEmitter(), messages: CliHostMessage[] = []
  const channel: CliHostChannel = {
    send: message => { messages.push(message) },
    onMessage: listener => { emitter.on('message', listener); return () => { emitter.off('message', listener) } },
  }
  return { channel, messages, receive: (message: unknown) => { emitter.emit('message', message) }, emitter }
}

function runtimeFixture(listening = false) {
  const events = new EventEmitter()
  const server = Object.assign(events, {
    listening,
    address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 54321 }),
  })
  let status: RemoteStatus = { enabled: false, state: 'disabled' }
  const runtime: CliHostRuntime = {
    server: server as unknown as CliHostRuntime['server'],
    remoteAgent: { status: () => status },
  }
  return { runtime, server, events, setStatus: (next: RemoteStatus) => { status = next } }
}

const owner: UserRecord = {
  hash: 'existing-password-hash', role: 'owner', mustChangePassword: false,
  createdAt: 1, passwordChangedAt: 1,
}

test('CLI 첫 설정은 owner를 만들고 임시 비밀번호 변경 요구를 유지한다', async () => {
  const auth = authFixture(), channel = channelFixture()
  const setup = ensureCliOwner(auth.auth, channel.channel)
  assert.deepEqual(channel.messages, [{ type: 'setup-needed' }])
  channel.receive({ type: 'unrelated', email: 'wrong@example.com' })
  channel.receive({ type: 'setup-owner', email: '  Owner@Example.com  ' })
  await setup
  assert.equal(channel.emitter.listenerCount('message'), 0)
  assert.equal(auth.users.size, 1)
  const record = auth.users.get('owner@example.com')!
  assert.equal(record.role, 'owner')
  assert.equal(record.mustChangePassword, true)
  assert.equal(record.hash, 'stored-hash')
  assert.ok(record.createdAt > 0)
  assert.equal(record.passwordChangedAt, record.createdAt)
  assert.deepEqual(channel.messages[1], {
    type: 'owner-created', email: 'owner@example.com', password: 'temporary-password',
  })
  assert.equal(JSON.stringify([...auth.users]).includes('temporary-password'), false)
})

test('기존 owner가 있으면 입력·계정·비밀번호를 바꾸지 않는다', async () => {
  const auth = authFixture({ 'existing@example.com': owner }), channel = channelFixture()
  await ensureCliOwner(auth.auth, channel.channel, 'invalid-email')
  assert.deepEqual(channel.messages, [])
  assert.equal(auth.generated(), 0)
  assert.equal(auth.users.get('existing@example.com'), owner)
})

test('설정 중 다른 프로세스가 owner를 만들면 새 계정을 만들지 않는다', async () => {
  const auth = authFixture(), channel = channelFixture()
  const setup = ensureCliOwner(auth.auth, channel.channel)
  auth.users.set('existing@example.com', owner)
  channel.receive({ type: 'setup-owner', email: 'new@example.com' })
  await setup
  assert.equal(auth.users.size, 1)
  assert.equal(auth.generated(), 0)
  assert.deepEqual(channel.messages, [{ type: 'setup-needed' }])
})

test('owner 설정은 잘못된 이메일과 기존 member의 암묵적 승격을 거부한다', async () => {
  const member = { ...owner, role: 'member' as const }
  const auth = authFixture({ 'member@example.com': member }), channel = channelFixture()
  await assert.rejects(ensureCliOwner(auth.auth, channel.channel, 'bad-email'), /이메일/)
  await assert.rejects(ensureCliOwner(auth.auth, channel.channel, 'member@example.com'), /이미 등록된 계정/)
  assert.equal(auth.users.get('member@example.com'), member)
  assert.equal(auth.generated(), 0)
  assert.deepEqual(channel.messages, [])
})

test('setup 취소와 종료 신호는 계정을 쓰지 않고 IPC 구독을 정리한다', async () => {
  for (const cancellation of ['message', 'signal'] as const) {
    const auth = authFixture(), channel = channelFixture(), controller = new AbortController()
    const setup = ensureCliOwner(auth.auth, channel.channel, undefined, controller.signal)
    if (cancellation === 'message') channel.receive({ type: 'setup-cancel' })
    else controller.abort()
    await assert.rejects(setup, { name: 'AbortError' })
    assert.equal(auth.users.size, 0)
    assert.equal(channel.emitter.listenerCount('message'), 0)
  }
})

test('CLI는 실제 listening 이벤트 이후 주소를 알리고 등록 상태 변화를 전달한다', async () => {
  const auth = authFixture({ 'existing@example.com': owner }), channel = channelFixture(), fixture = runtimeFixture()
  let loadCount = 0
  const started = startCliHost({
    auth: auth.auth, channel: channel.channel,
    loadRuntime: async () => { loadCount++; return fixture.runtime }, pollIntervalMs: 10,
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(loadCount, 1)
  assert.deepEqual(channel.messages, [])
  fixture.server.listening = true
  fixture.events.emit('listening')
  const host = await started
  try {
    assert.deepEqual(channel.messages, [
      { type: 'ready', url: 'http://127.0.0.1:54321' },
      { type: 'remote-status', status: { enabled: false, state: 'disabled' } },
    ])
    fixture.setStatus({ enabled: false, state: 'registering', registrationUrl: 'https://mew.example/register/public-code', expiresAt: 123 })
    await new Promise(resolve => setTimeout(resolve, 30))
    fixture.setStatus({ enabled: true, state: 'online', url: 'https://mew.example/person/device' })
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.deepEqual(channel.messages.slice(2), [
      { type: 'remote-status', status: { enabled: false, state: 'registering', registrationUrl: 'https://mew.example/register/public-code', expiresAt: 123 } },
      { type: 'remote-status', status: { enabled: true, state: 'online', url: 'https://mew.example/person/device' } },
    ])
    fixture.events.emit('close')
    const count = channel.messages.length
    fixture.setStatus({ enabled: false, state: 'disabled' })
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(channel.messages.length, count)
  } finally { host.close() }
})

test('이미 listening인 서버를 재사용하고 바인딩 실패를 ready로 오인하지 않는다', async () => {
  const auth = authFixture({ 'existing@example.com': owner }), channel = channelFixture(), ready = runtimeFixture(true)
  const host = await startCliHost({ auth: auth.auth, channel: channel.channel, loadRuntime: async () => ready.runtime })
  host.close()
  assert.equal(channel.messages[0]?.type, 'ready')
  const failing = runtimeFixture(), failedChannel = channelFixture()
  const started = startCliHost({ auth: auth.auth, channel: failedChannel.channel, loadRuntime: async () => failing.runtime })
  await new Promise(resolve => setImmediate(resolve))
  failing.events.emit('error', new Error('listen failed'))
  await assert.rejects(started, /listen failed/)
  assert.deepEqual(failedChannel.messages, [])
  assert.equal(failing.events.listenerCount('listening'), 0)
})

test('현재 workspace 준비는 선택한 기존 owner만 대상으로 서버 import 전에 수행한다', async () => {
  const auth = authFixture({
    'first@example.com': owner,
    'selected@example.com': { ...owner },
    'member@example.com': { ...owner, role: 'member' },
  })
  const channel = channelFixture(), fixture = runtimeFixture(true), calls: string[] = []
  const host = await startCliHost({
    auth: auth.auth, channel: channel.channel, ownerEmail: ' Selected@Example.com ',
    prepareWorkspace: email => { calls.push(`workspace:${email}`) },
    loadRuntime: async () => { calls.push('runtime'); return fixture.runtime },
  })
  host.close()
  assert.deepEqual(calls, ['workspace:selected@example.com', 'runtime'])
  assert.equal(auth.users.size, 3)
  assert.equal(auth.generated(), 0)
  assert.equal(auth.users.get('first@example.com'), owner)
})

test('CLI 상태에는 공개 주소만 전달하고 등록 키·토큰은 포함하지 않는다', () => {
  const status = {
    enabled: true, state: 'online' as const, url: 'https://mew.example/person/device',
    privateKey: { d: 'secret-key' }, token: 'secret-token',
  }
  assert.deepEqual(cliRemoteStatus(status), {
    enabled: true, state: 'online', url: 'https://mew.example/person/device',
  })
  for (const url of ['http://mew.example/device', 'https://user:secret@mew.example/device', 'https://mew.example/device?token=secret', 'invalid']) {
    assert.deepEqual(cliRemoteStatus({ enabled: true, state: 'online', url }), { enabled: true, state: 'online' })
  }
})
