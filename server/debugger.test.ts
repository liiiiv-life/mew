import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DapConnection } from './debugger-dap.ts'
import { defaultDebugConfig } from '../shared/debugger.ts'

function frame(message: unknown) { const bytes = Buffer.from(JSON.stringify(message)); return Buffer.concat([Buffer.from(`Content-Length: ${bytes.length}\r\n\r\n`), bytes]) }
async function waitFor(check: () => boolean, timeout = 5000) { const end = Date.now() + timeout; while (!check()) { assert.ok(Date.now() < end, 'condition timed out'); await new Promise(resolve => setTimeout(resolve, 20)) } }

test('DAP framing handles split UTF-8, coalesced events and errors', async () => {
  const input = new PassThrough(), output = new PassThrough(), client = new DapConnection(input, output)
  const events: string[] = []; client.onEvent = message => events.push(message.body!.output)
  const payload = Buffer.concat([frame({ seq: 1, type: 'event', event: 'output', body: { output: '한글 🐈' } }), frame({ seq: 2, type: 'event', event: 'output', body: { output: 'second' } })])
  for (const byte of payload) input.write(Buffer.from([byte]))
  assert.deepEqual(events, ['한글 🐈', 'second'])
  const pending = client.request('missing', {}, 10)
  await assert.rejects(pending, /시간 초과/)
  const second = client.request('closed')
  input.write('Content-Length: 999999999\r\n\r\n')
  await assert.rejects(second, /길이/)
  client.dispose()
})

test('debug sessions configure before launch, inspect and preserve account/project settings', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-debugger-test-'))
  t.after(() => fs.rm(temp, { recursive: true, force: true }))
  process.env.MEW_DATA_DIR = temp
  const { DebugSession, saveDebugConfig, debugConfig, newDebugSession } = await import('./debugger.ts')
  const config = { ...defaultDebugConfig('custom', temp), command: process.execPath, args: [new URL('./fixtures/debug-adapter.cjs', import.meta.url).pathname], breakpoints: [{ file: 'main.js', line: 3, enabled: true }, { file: 'main.js', line: 4, enabled: true }], watches: ['counter'] }
  await saveDebugConfig('first@example.test', temp, config)
  assert.equal(debugConfig('second@example.test', temp).breakpoints.length, 0)
  assert.equal(debugConfig('first@example.test', path.join(temp, 'other')).watches.length, 0)
  const session = newDebugSession('first@example.test', temp)
  t.after(() => session.stop())
  await session.start()
  await waitFor(() => session.snapshot.frames.length === 1)
  assert.equal(session.snapshot.state, 'stopped')
  assert.equal(session.snapshot.breakpoints[0].verified, true)
  assert.equal(session.snapshot.breakpoints.length, 2, 'one breakpoint event preserves other breakpoints')
  assert.equal(session.snapshot.breakpoints[0].message, 'updated breakpoint')
  assert.throws(() => newDebugSession('first@example.test', temp), /이미/)
  const scopes = await session.command('scopes', { frameId: 1 })
  const variables = await session.command('variables', { variablesReference: scopes.scopes[0].variablesReference })
  assert.equal(variables.variables[0].value, '1')
  const revision = session.snapshot.stopRevision!
  await session.command('next')
  await waitFor(() => session.snapshot.state === 'stopped' && session.snapshot.stopRevision! > revision)
  assert.equal((await session.command('evaluate', { expression: 'counter', frameId: 1 })).result, '2')
  await saveDebugConfig('first@example.test', temp, { ...config, breakpoints: [] })
  assert.equal(session.snapshot.breakpoints.length, 0)
  assert.deepEqual(debugConfig('first@example.test', temp).watches, ['counter'])
  await session.stop()
  assert.equal(session.snapshot.state, 'terminated')
  await assert.rejects(session.command('continue'), /세션/)
  const probe = new DebugSession(config, temp)
  await probe.start(true)
  assert.equal(probe.snapshot.state, 'terminated')
})

test('invalid configs cannot overwrite persisted breakpoints', async () => {
  const { validateDebugConfig } = await import('./debugger.ts')
  const config = defaultDebugConfig()
  assert.throws(() => validateDebugConfig({ ...config, args: ['ok', 1] }), /형식/)
  assert.throws(() => validateDebugConfig({ ...config, breakpoints: [{ file: 'x', line: 0, enabled: true }] }), /형식/)
  assert.throws(() => validateDebugConfig({ ...config, port: 65536 }), /형식/)
})

test('real js-debug adapter supports child sessions, breakpoints, stack and evaluation', { skip: !process.env.MEW_TEST_JS_DEBUG, timeout: 120000 }, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-real-debugger-'))
  t.after(() => fs.rm(temp, { recursive: true, force: true }))
  const { DebugSession } = await import('./debugger.ts')
  const program = path.join(temp, 'main.cjs')
  await fs.writeFile(program, 'let counter = 1;\nsetInterval(() => {\n  counter++;\n  console.log(counter);\n}, 100);\n')
  const config = { ...defaultDebugConfig('js-debug', temp), command: process.execPath, args: [process.env.MEW_TEST_JS_DEBUG!, '0', '127.0.0.1'], configuration: { type: 'pwa-node', program, cwd: temp, console: 'internalConsole' }, breakpoints: [{ file: program, line: 4, enabled: true }], watches: ['counter'] }
  const session = new DebugSession(config, temp)
  t.after(() => session.stop())
  await session.start()
  await waitFor(() => session.snapshot.state === 'stopped' && session.snapshot.frames.length > 0, 15000)
  assert.ok(session.snapshot.frames.some(f => f.source?.path === program))
  assert.ok(session.snapshot.breakpoints.some(b => b.verified && b.file === program))
  const frame = session.snapshot.frames[0]
  const evaluated = await session.command('evaluate', { expression: 'counter', frameId: frame.id, context: 'watch' })
  assert.equal(evaluated.result, '2')
  const scopes = await session.command('scopes', { frameId: frame.id })
  assert.ok(scopes.scopes.length > 0)
  const revision = session.snapshot.stopRevision!
  await session.command('continue')
  await waitFor(() => session.snapshot.state === 'stopped' && session.snapshot.stopRevision! > revision)
  await session.update({ ...config, breakpoints: [] })
  await session.command('continue')
  await session.command('pause')
  await waitFor(() => session.snapshot.state === 'stopped' && session.snapshot.frames.length > 0)
  await session.stop()
  assert.equal(session.snapshot.state, 'terminated')
})

test('adapter startup failures report exit code and drained stderr', async t => {
  const { DebugSession } = await import('./debugger.ts')
  const config = { ...defaultDebugConfig('custom', os.tmpdir()), transport: 'tcp' as const, command: process.execPath, args: ['-e', "process.stderr.write('fixture startup failed\\n'); process.exit(7)"] }
  const session = new DebugSession(config, os.tmpdir())
  t.after(() => session.stop())
  await assert.rejects(session.start(true), /종료 코드 7.*\nfixture startup failed/)
  assert.equal(session.snapshot.state, 'error')
  assert.match(session.snapshot.reason, /fixture startup failed/)
})
