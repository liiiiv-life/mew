import './test-isolated-data.ts'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { gunzipSync } from 'node:zlib'
import { once } from 'node:events'
import express from 'express'
import { createTmuxManager } from '@mew/tmux-term/server'
import { AgentCommandStore, publicCommand } from './agent-commands.ts'
import { createAgentCommandRouter } from './agent-command-routes.ts'
import { setFeature } from './access-policy.ts'

const exec = promisify(execFile)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-cli-test-'))
const owner = 'cli-owner@example.test'
const scope = { runtime: 'codex', cwd: temp, sessionId: 'conversation-one' }
const fake = createTmuxManager({ cwd: temp })
let launches = 0
fake.startCommand = async () => { launches++ }
fake.list = async () => []
const store = new AgentCommandStore(fake, path.join(temp, 'records'))
const input = (command = 'printf hello') => ({ ...scope, id: crypto.randomUUID(), tab: 'tab-one', command, afterUserCount: 1 })
after(() => fs.rmSync(temp, { recursive: true, force: true }))

test('submission is verbatim, idempotent, scoped by owner and conversation, and recoverable on disk', async () => {
  const request = input('  printf "%s\\n" "$(pwd)"\nexit 7\n')
  const before = launches
  const record = await store.start(owner, request)
  await store.start(owner, request)
  assert.equal(launches - before, 1)
  assert.equal(record.command, request.command)
  assert.equal('owner' in record, false)
  assert.equal((await new AgentCommandStore(fake, store.root).list(owner, scope))[0].id, record.id)
  assert.deepEqual(await store.list('other@example.test', scope), [])
  assert.deepEqual(await store.list(owner, { ...scope, sessionId: 'new-conversation' }), [])
  assert.throws(() => store.read('other@example.test', record.id))
  await assert.rejects(store.start(owner, { ...request, command: 'different' }))
  await assert.rejects(store.start(owner, { ...input(), id: '../../escape' }))
  await assert.rejects(store.start(owner, { ...input(), command: '\0' }))
  await store.stopTab(owner, 'tab-one')
  assert.ok(fs.existsSync(path.join(store.directory(owner, record.id), 'stop')))
})

test('queued cancellation survives reload and retries without launching or becoming an execution record', async () => {
  const request = input('never run')
  const before = launches
  store.prepare(owner, request)
  store.stop(owner, request.id)
  store.stop(owner, request.id)
  const restored = new AgentCommandStore(fake, store.root)
  const record = (await restored.list(owner, scope)).find(item => item.id === request.id)!
  assert.equal(record.cancelledBeforeStart, true)
  assert.equal(record.archived, undefined)
  assert.equal(fs.existsSync(path.join(store.directory(owner, record.id), 'stop')), false)
  assert.equal((await restored.start(owner, request)).cancelledBeforeStart, true)
  assert.equal(launches, before, 'retrying the cancelled ID must not execute it')
  const legacy = { ...restored.read(owner, request.id) }
  delete legacy.cancelledBeforeStart
  assert.equal(publicCommand(legacy).cancelledBeforeStart, true, 'old cancelled bubbles are hidden on the next poll')
  assert.equal(publicCommand({ ...legacy, archived: true }).cancelledBeforeStart, undefined)
  assert.equal(publicCommand({ ...legacy, error: 'host exited' }).cancelledBeforeStart, undefined)
  assert.equal(publicCommand({ ...legacy, startedAt: legacy.startedAt - 1 }).cancelledBeforeStart, undefined)
})

test('HTTP requires both agent and terminal features and cannot read another account archive', async () => {
  const record = await store.start(owner, input())
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.auth = { role: 'manager', email: String(req.headers['x-account'] ?? owner), mustChangePassword: false }
    next()
  })
  app.use('/commands', createAgentCommandRouter(store))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/commands`
  try {
    const query = `?${new URLSearchParams(scope)}`
    assert.equal((await fetch(base + query)).status, 200)
    setFeature(owner, 'terminal', false)
    assert.equal((await fetch(base + query)).status, 403)
    assert.equal((await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input()) })).status, 403)
    setFeature(owner, 'terminal', true)
    setFeature(owner, 'agent', false)
    assert.equal((await fetch(base + query)).status, 403)
    setFeature(owner, 'agent', true)
    assert.equal((await fetch(`${base}/${record.id}/archive`, { headers: { 'x-account': 'other@example.test' } })).status, 400)
    assert.equal((await fetch(`${base}/${record.id}/stop`, { method: 'POST', headers: { 'x-account': 'other@example.test' } })).status, 400)
  } finally { server.closeAllConnections(); server.close() }
})

let tmuxBin: string | undefined
try { tmuxBin = execFileSync('which', ['tmux'], { encoding: 'utf8' }).trim() } catch { /* optional integration dependency */ }

test('real tmux: immediate output, failure, terminal interaction, cancellation, archive before cleanup', { skip: !tmuxBin, timeout: 40_000 }, async () => {
  const socket = `mew-cli-test-${crypto.randomBytes(8).toString('hex')}`
  const bin = path.join(temp, 'bin')
  fs.mkdirSync(bin)
  // Every tmux call, including the independent runner's cleanup, uses an isolated test server.
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\nexec '${tmuxBin}' -L '${socket}' "$@"\n`, { mode: 0o700 })
  const previousPath = process.env.PATH
  process.env.PATH = `${bin}:${previousPath}`
  const real = createTmuxManager({ cwd: temp })
  const realStore = new AgentCommandStore(real, path.join(temp, 'real-records'))
  const waitFor = async (predicate: () => Promise<boolean>) => {
    const deadline = Date.now() + 12_000
    while (!await predicate()) {
      assert.ok(Date.now() < deadline, 'command did not reach expected state')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  const finished = async (id: string) => {
    await waitFor(async () => realStore.read(owner, id).state !== 'running')
    const record = realStore.read(owner, id)
    await waitFor(async () => !(await real.list()).some(session => session.name === record.session))
    assert.equal(record.archived, true)
    return { record, output: gunzipSync(fs.readFileSync(path.join(realStore.directory(owner, id), 'output.gz'))).toString() }
  }
  try {
    const fast = await realStore.start(owner, input('printf "한글 first\\n"; printf "last\\n" >&2'))
    const first = await finished(fast.id)
    assert.equal(first.record.state, 'completed')
    assert.match(first.output, /한글 first/)
    assert.match(first.output, /last/)
    const failed = await realStore.start(owner, input('printf "failure output\\n"; exit 7'))
    const failure = await finished(failed.id)
    assert.equal(failure.record.state, 'failed')
    assert.equal(failure.record.exitCode, 7)
    const interactive = await realStore.start(owner, input('test -t 0 && printf "TTY ready\\n"; read answer; printf "answer=%s\\n" "$answer"'))
    await waitFor(async () => (await real.capture(interactive.session)).includes('TTY ready'))
    await real.sendInput(interactive.session, 'hello terminal')
    assert.match((await finished(interactive.id)).output, /answer=hello terminal/)
    const stopped = await realStore.start(owner, input('printf "before stop\\n"; sleep 30'))
    await waitFor(async () => (await real.capture(stopped.session)).includes('before stop'))
    realStore.stop(owner, stopped.id)
    const interruption = await finished(stopped.id)
    assert.equal(interruption.record.state, 'interrupted')
    assert.match(interruption.output, /before stop/)
    const large = await realStore.start(owner, input('head -c 600000 /dev/zero | tr "\\0" x; printf "END"'))
    const big = await finished(large.id)
    assert.equal(big.output.length, 600003)
    assert.equal(big.record.previewTruncated, true)
    assert.ok(fs.statSync(path.join(realStore.directory(owner, large.id), 'preview.txt')).size <= 512 * 1024)
    // Reading through a fresh store emulates an HTTP server restart without rerunning the command.
    assert.equal((await new AgentCommandStore(real, realStore.root).list(owner, scope)).length, 5)
  } finally {
    await exec(tmuxBin!, ['-L', socket, 'kill-server']).catch(() => {})
    process.env.PATH = previousPath
  }
})
