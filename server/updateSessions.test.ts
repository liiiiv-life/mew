import './test-isolated-data.ts'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { createTmuxManager } from '@mew/tmux-term/server'
import { MEW_APP_ROOT, mewUpdateRunning } from './mewUpdate.ts'
import { readUpdateQueue, replaceUpdateSession, updateSessionName, updateWorkerCommand, writeUpdateQueue, type StoredUpdateQueue } from './updateSessions.ts'

const exec = promisify(execFile)
const pause = () => new Promise(resolve => setTimeout(resolve, 30))

test('completed retained Mew sessions do not block a later update and dead workers are interrupted', () => {
  const job = { state: 'succeeded' as const, startedAt: Date.now(), finishedAt: Date.now(), message: null, workerPid: process.pid }
  assert.equal(mewUpdateRunning(job, true), false)
  assert.equal(mewUpdateRunning({ ...job, state: 'running' }, true), true)
  assert.equal(mewUpdateRunning({ ...job, state: 'running' }, false), false)
  assert.equal(mewUpdateRunning({ ...job, state: 'running', workerPid: 2_147_483_647 }, true), false)
  assert.equal(mewUpdateRunning({ ...job, state: 'queued', startedAt: Date.now() - 31_000 }, true), false)
})

test('reusing a retained session replaces the finished shell before launching the next worker', async () => {
  const calls: string[] = []
  await replaceUpdateSession({
    list: async () => [{ name: 'mewcmd-old', createdAt: 1, attached: false, windows: 1 }],
    kill: async name => { calls.push(`kill ${name}`) },
    startCommand: async name => { calls.push(`start ${name}`) },
  }, 'mewcmd-old', 'fixture', '/tmp')
  assert.deepEqual(calls, ['kill mewcmd-old', 'start mewcmd-old'])
  assert.notEqual(updateSessionName(['agent:a']), updateSessionName(['agent:b']))
  assert.equal(updateSessionName(['system:a', 'system:b']), 'mewcmd-updates-system')
})

test('an isolated tmux worker streams a serial batch, survives the caller and retains failures for a new process', { skip: process.platform === 'win32' }, async t => {
  try { await exec('tmux', ['-V']) } catch { t.skip('tmux is unavailable'); return }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-update-session-'))
  const previousState = process.env.XDG_STATE_HOME
  const previousNamespace = process.env.MEW_MULTIPLEXER_NAMESPACE
  const previousMultiplexer = process.env.MEW_MULTIPLEXER
  process.env.XDG_STATE_HOME = directory
  process.env.MEW_MULTIPLEXER_NAMESPACE = `mew-update-test-${process.pid}`
  process.env.MEW_MULTIPLEXER = 'tmux'
  const namespace = process.env.MEW_MULTIPLEXER_NAMESPACE
  const manager = createTmuxManager({ cwd: MEW_APP_ROOT })
  const session = updateSessionName(['system:first', 'system:second'])
  const queue: StoredUpdateQueue = {
    job: { running: true, items: ['first', 'second'].map(id => ({ id: `system:${id}`, state: 'queued', error: null, session })) },
    startedAt: Date.now(), workerPid: null,
    selected: [
      { id: 'system:first', label: 'first fixture', category: 'system', command: { cmd: process.execPath, args: ['-e', 'console.log("fixture first live"); setTimeout(() => process.exit(7), 400)'] } },
      { id: 'system:second', label: 'second fixture', category: 'system', command: { cmd: process.execPath, args: ['-e', 'console.log("fixture second complete")'] } },
    ],
    sessions: { 'system:first': session, 'system:second': session },
  }
  try {
    writeUpdateQueue(queue)
    // The launcher process exits immediately after creating tmux; the worker must finish independently.
    const launchScript = `import { createTmuxManager } from '@mew/tmux-term/server'; await createTmuxManager({cwd:${JSON.stringify(MEW_APP_ROOT)}}).startCommand(${JSON.stringify(session)},${JSON.stringify(updateWorkerCommand(path.join(MEW_APP_ROOT, 'server/runUpdates.ts')))},${JSON.stringify(MEW_APP_ROOT)})`
    await exec(process.execPath, ['--input-type=module', '-e', launchScript], { cwd: MEW_APP_ROOT, env: process.env })
    const deadline = Date.now() + 10_000
    while (!(await manager.capture(session, 100)).includes('fixture first live') && Date.now() < deadline) await pause()
    assert.equal(readUpdateQueue()?.job.running, true)
    assert.equal(readUpdateQueue()?.job.items[1].state, 'queued')
    while (readUpdateQueue()?.job.running && Date.now() < deadline) await pause()
    const completed = readUpdateQueue()!
    assert.equal(completed.job.running, false)
    assert.deepEqual(completed.job.items.map(row => row.state), ['failed', 'succeeded'])
    assert.match(completed.job.items[0].error!, /fixture first live/)
    assert.equal((await manager.list()).some(row => row.name === session), true)
    const transcript = await manager.capture(session, 100)
    assert.match(transcript, /fixture first live/)
    assert.match(transcript, /fixture second complete/)
    assert.ok(transcript.indexOf('fixture first live') < transcript.indexOf('fixture second complete'))
    const restored = await exec(process.execPath, ['--input-type=module', '-e', "import { readUpdateQueue } from './server/updateSessions.ts'; process.stdout.write(JSON.stringify(readUpdateQueue()?.job))"], { cwd: MEW_APP_ROOT, env: process.env })
    assert.deepEqual(JSON.parse(restored.stdout), completed.job)
    const mode = (await fs.stat(path.join(directory, 'mew', 'dependency-update-job.json'))).mode & 0o777
    assert.equal(mode, 0o600)
    writeUpdateQueue({ ...completed, job: { running: true, items: [{ id: 'system:first', state: 'running', error: null, session }] }, workerPid: 2_147_483_647 })
    assert.equal(readUpdateQueue()!.job.items[0].state, 'failed')
    assert.equal((await manager.list()).some(row => row.name === session), true)
  } finally {
    await exec('tmux', ['-L', namespace, 'kill-server']).catch(() => {})
    if (previousState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previousState
    if (previousNamespace === undefined) delete process.env.MEW_MULTIPLEXER_NAMESPACE; else process.env.MEW_MULTIPLEXER_NAMESPACE = previousNamespace
    if (previousMultiplexer === undefined) delete process.env.MEW_MULTIPLEXER; else process.env.MEW_MULTIPLEXER = previousMultiplexer
    await fs.rm(directory, { recursive: true, force: true })
  }
})
