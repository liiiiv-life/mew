import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { GitHubAuth, GitHubAuthError } from './github-auth.ts'

function fixture(options: { missing?: boolean; environment?: boolean; setupFailure?: boolean; timeout?: number } = {}) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null as number | null, signalCode: null as string | null,
    kill(signal: string) { this.signalCode = signal; return true },
  })
  const calls: string[][] = []
  const closed: string[][] = []
  let launches = 0
  const store = new GitHubAuth(async (...args) => { closed.push(args) }, {
    launch: () => { launches++; return child as unknown as ChildProcess },
    run: async args => {
      calls.push(args)
      if (options.missing) return { ok: false, missing: true, output: '' }
      if (args[0] === 'auth') return { ok: !options.setupFailure, output: '' }
      return { ok: true, output: 'octocat\n' }
    },
    environmentToken: () => !!options.environment,
    timeout: options.timeout,
  })
  const exit = (code: number) => { child.exitCode = code; child.emit('close', code) }
  return { store, child, calls, closed, exit, launches: () => launches }
}

test('login resumes by owner, parses split code, never exposes raw CLI output, and configures Git', async () => {
  const f = fixture()
  const job = f.store.start('alice')
  assert.equal(f.store.start('alice').id, job.id)
  assert.equal(f.launches(), 1)
  f.child.stderr.write('! First copy your one-time co')
  f.child.stderr.write('de: ABCD-1234\nprivate token output must not escape\n')
  const waiting = await f.store.status('alice')
  assert.equal(waiting.job?.code, 'ABCD-1234')
  assert.equal(waiting.job?.state, 'waiting')
  assert.equal(JSON.stringify(waiting).includes('private token'), false)
  assert.equal(f.calls.length, 0)
  assert.equal(f.store.browserJob('alice', job.id), `github-${job.id}`)
  f.exit(0)
  await delay(0)
  const result = await f.store.status('alice')
  assert.equal(result.job?.state, 'complete')
  assert.equal(result.job?.code, null)
  assert.equal(result.login, 'octocat')
  assert.deepEqual(f.calls[0], ['auth', 'setup-git', '--hostname', 'github.com'])
  assert.deepEqual(f.closed, [['alice', `github-${job.id}`]])
})

test('another account cannot read approval codes, start a concurrent login, cancel or open the browser', async () => {
  const f = fixture()
  const job = f.store.start('alice')
  f.child.stderr.write('First copy your one-time code: ABCD-1234')
  const other = await f.store.status('bob')
  assert.equal(other.busy, true)
  assert.equal(other.job, null)
  assert.throws(() => f.store.start('bob'), (e: GitHubAuthError) => e.status === 409)
  assert.throws(() => f.store.stop('bob', job.id), (e: GitHubAuthError) => e.status === 404)
  assert.throws(() => f.store.browserJob('bob', job.id), (e: GitHubAuthError) => e.status === 404)
  f.store.stop('alice', job.id)
  f.exit(1)
})

test('cancel terminates the child, clears the code, and prevents setup even if the child exits successfully', async () => {
  const f = fixture()
  const job = f.store.start('alice')
  f.store.stop('alice', job.id)
  assert.equal(f.child.signalCode, 'SIGTERM')
  assert.throws(() => f.store.start('alice'), (e: GitHubAuthError) => e.status === 409)
  assert.throws(() => f.store.browserJob('alice', job.id))
  f.exit(0)
  assert.equal((await f.store.status('alice')).job?.state, 'cancelled')
  assert.equal(f.calls.some(args => args[0] === 'auth'), false)
  const retry = f.store.start('alice')
  assert.notEqual(retry.id, job.id)
  f.store.stop('alice', retry.id)
  f.exit(1)
})

test('CLI failure and Git setup failure remain failures and clean up browser sessions', async () => {
  const failed = fixture()
  failed.store.start('alice')
  failed.exit(1)
  const status = await failed.store.status('alice')
  assert.equal(status.job?.state, 'failed')
  assert.ok(status.job?.error)
  assert.equal(failed.calls.some(args => args[0] === 'auth'), false)
  const setup = fixture({ setupFailure: true })
  setup.store.start('alice'); setup.exit(0)
  await delay(0)
  assert.equal((await setup.store.status('alice')).job?.state, 'failed')
  assert.equal(setup.closed.length, 1)
})

test('missing CLI is distinguishable; process errors reveal no raw command output', async () => {
  const f = fixture({ missing: true })
  assert.equal((await f.store.status('alice')).available, false)
  f.store.start('alice')
  f.child.emit('error', Object.assign(new Error('secret command output'), { code: 'ENOENT' }))
  f.exit(1)
  const status = await f.store.status('alice')
  assert.match(status.job!.error!, /설치/)
  assert.equal(JSON.stringify(status).includes('secret command'), false)
})

test('environment tokens are reflected in status and cannot be silently overridden by login', async () => {
  const f = fixture({ environment: true })
  assert.equal((await f.store.status('alice')).environmentToken, true)
  assert.throws(() => f.store.start('alice'), /GH_TOKEN/)
  assert.equal(f.launches(), 0)
})

test('expiry terminates the child and closes the browser without treating it as successful', async () => {
  const f = fixture({ timeout: 5 })
  f.store.start('alice')
  await delay(20)
  const status = await f.store.status('alice')
  assert.equal(status.job?.state, 'failed')
  assert.match(status.job!.error!, /만료/)
  assert.equal(f.child.signalCode, 'SIGTERM')
  assert.equal(f.closed.length, 1)
  f.exit(0)
  assert.equal(f.calls.some(args => args[0] === 'auth'), false)
})
