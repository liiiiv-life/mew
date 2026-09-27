import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import express from 'express'
import simpleGit from 'simple-git'
import { createTmuxManager } from '@mew/tmux-term/server'
import type { AgentEvent } from './agentAcp.ts'
import type { GitCommitPlan } from '../shared/git-ai-commit.ts'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-git-ai-'))
process.env.MEW_DATA_DIR = path.join(temp, 'data')
process.env.MEW_WORKSPACE = temp
const { GitAiCommitStore, captureCommitChanges, parseCommitPlan } = await import('./git-ai-commit.ts')
const { runAutomaticCommit } = await import('./git-ai-commit-runner.ts')
const { createGitAiCommitRouter } = await import('./git-ai-commit-routes.ts')
const { writeSets } = await import('./agentSets.ts')
const { setFeature } = await import('./access-policy.ts')
const owner = 'git-ai@example.test'
const preset = { id: crypto.randomUUID(), name: '커밋 작성', runtime: 'codex', modelId: 'selected-model', role: 'Write concise Korean commit messages.' }
after(() => fs.rmSync(temp, { recursive: true, force: true }))

async function fixture() {
  const cwd = fs.mkdtempSync(path.join(temp, 'repo-'))
  const git = simpleGit(cwd)
  await git.init(); await git.addConfig('user.name', 'Test'); await git.addConfig('user.email', owner)
  fs.writeFileSync(path.join(cwd, 'file.txt'), 'before\n')
  await git.add('-A'); await git.commit('initial')
  fs.writeFileSync(path.join(cwd, 'file.txt'), 'after\n')
  fs.writeFileSync(path.join(cwd, 'new.txt'), 'new file\n')
  const manager = createTmuxManager({ cwd })
  let launches = 0
  manager.startCommand = async () => { launches++ }
  manager.list = async () => []
  const store = new GitAiCommitStore(manager, path.join(temp, 'jobs'))
  return { cwd, git, store, manager, launches: () => launches }
}

test('snapshot includes tracked, untracked, renamed and unborn changes without staging or committing', async () => {
  const { cwd, git } = await fixture()
  await git.raw(['mv', 'file.txt', 'renamed.txt'])
  const head = await git.revparse('HEAD'), index = await git.diff(['--cached'])
  const snapshot = await captureCommitChanges(cwd)
  assert.match(snapshot.text, /after/); assert.match(snapshot.text, /new file/); assert.match(snapshot.text, /renamed.txt/)
  assert.equal(await git.revparse('HEAD'), head); assert.equal(await git.diff(['--cached']), index)
  const unborn = fs.mkdtempSync(path.join(temp, 'unborn-'))
  const fresh = simpleGit(unborn); await fresh.init()
  fs.writeFileSync(path.join(unborn, 'first.txt'), 'staged\n'); await fresh.add('-A')
  fs.writeFileSync(path.join(unborn, 'first.txt'), 'newest\n')
  const first = await captureCommitChanges(unborn)
  assert.match(first.text, /newest/); assert.match(first.text, /staged/)
  assert.throws(() => parseCommitPlan('{"commits":[{"title":"bad","description":"","files":["other"]}],"skipped":[]}', ['file.txt']))
  assert.throws(() => parseCommitPlan('{"commits":[],"skipped":[]}', ['file.txt']))
  assert.throws(() => parseCommitPlan('done', []))
})

const plan: GitCommitPlan = { commits: [
  { title: 'fix: update file', description: 'Tracked change', files: ['file.txt'] },
  { title: 'feat: add new file', description: '', files: ['new.txt'] },
], skipped: [] }
async function execute(store: InstanceType<typeof GitAiCommitStore>, cwd: string, id: string, output = plan, before?: () => Promise<void>) {
  let listener: (event: AgentEvent) => void = () => {}
  await runAutomaticCommit(store.directory(owner, cwd, id), async (runtime, actualCwd) => {
    assert.equal(runtime, preset.runtime); assert.equal(actualCwd, cwd)
    return {
      attach: callback => { listener = callback; return () => {} },
      setModel: async model => { assert.equal(model, 'selected-model') },
      runOnce: async prompt => {
        assert.match(prompt, /mew-commit-plan/)
        await before?.()
        listener({ type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(output) } } })
        return 'end_turn'
      },
      answerPermission: () => {}, cancel: () => {}, disposeAndWait: async () => {},
    }
  })
  return store.read(owner, cwd, id)
}

test('jobs create logical commits, preserve unrelated stage, are idempotent and recoverable', async () => {
  const { cwd, git, store, manager, launches } = await fixture()
  fs.writeFileSync(path.join(cwd, 'excluded.txt'), 'staged unrelated')
  await git.add('excluded.txt')
  fs.appendFileSync(path.join(cwd, 'excluded.txt'), ' plus working changes')
  const index = await git.diff(['--cached', '--', 'excluded.txt'])
  const id = crypto.randomUUID()
  const [first, second] = await Promise.all([store.start(owner, cwd, id, preset, ['file.txt', 'new.txt']), store.start(owner, cwd, crypto.randomUUID(), preset, ['file.txt'])])
  assert.equal(first.id, second.id); assert.equal(launches(), 1)
  assert.equal((await store.start(owner, cwd, id, preset)).id, id)
  assert.equal((await new GitAiCommitStore(manager, store.root).latest(owner, cwd))?.id, id)
  assert.equal(await store.latest('other', cwd), null)
  assert.throws(() => store.read('other', cwd, id))
  const result = await execute(store, cwd, id)
  assert.equal(result.state, 'completed', result.error)
  assert.equal(result.result!.commits.length, 2)
  const history = await git.log()
  assert.deepEqual(history.all.slice(0, 2).map(c => c.message), ['feat: add new file', 'fix: update file'])
  for (const commit of result.result!.commits) {
    assert.deepEqual((await git.raw(['diff-tree', '--no-commit-id', '--name-only', '-r', commit.hash])).trim().split('\n'), commit.files)
  }
  assert.equal(await git.diff(['--cached', '--', 'excluded.txt']), index)
  assert.match(fs.readFileSync(path.join(cwd, 'excluded.txt'), 'utf8'), /working changes/)
  assert.equal(fs.existsSync(path.join(store.directory(owner, cwd, id), 'input.json')), false)
})

test('selected snapshots exclude other files and reject tree, HEAD or index changes before committing', async () => {
  for (const kind of ['working', 'index', 'head', 'binary'] as const) {
    const { cwd, git, store } = await fixture()
    if (kind === 'binary') fs.writeFileSync(path.join(cwd, 'new.txt'), Buffer.from([0, 1, 2]))
    const head = await git.revparse('HEAD')
    const job = await store.start(owner, cwd, crypto.randomUUID(), preset, ['file.txt', 'new.txt'])
    const result = await execute(store, cwd, job.id, plan, async () => {
      if (kind === 'working') fs.appendFileSync(path.join(cwd, 'file.txt'), 'changed again')
      if (kind === 'binary') fs.writeFileSync(path.join(cwd, 'new.txt'), Buffer.from([0, 1, 3]))
      if (kind === 'index') await git.add('file.txt')
      if (kind === 'head') await git.commit('other commit', { '--allow-empty': null })
    })
    assert.equal(result.state, 'failed')
    assert.match(result.error!, /달라졌습니다/)
    assert.equal(result.result?.commits.length, 0)
    if (kind !== 'head') assert.equal(await git.revparse('HEAD'), head)
  }
  const { cwd, git, store } = await fixture()
  await git.add('new.txt')
  const index = await git.diff(['--cached'])
  const snapshot = await captureCommitChanges(cwd, ['file.txt'])
  assert.doesNotMatch(snapshot.text, /new file|new\.txt/)
  await assert.rejects(captureCommitChanges(cwd, []), /선택/)
  await assert.rejects(captureCommitChanges(cwd, ['missing.txt']), /달라졌습니다/)
  const job = await store.start(owner, cwd, crypto.randomUUID(), preset, ['file.txt'])
  const result = await execute(store, cwd, job.id, { commits: [plan.commits[0]], skipped: [] }, async () => { fs.appendFileSync(path.join(cwd, 'new.txt'), 'unselected edit') })
  assert.equal(result.state, 'completed', result.error)
  assert.equal(await git.diff(['--cached']), index)
})

test('plans reject duplicates and missing files, and preserve explicit skipped files', async () => {
  assert.throws(() => parseCommitPlan(JSON.stringify({ commits: [plan.commits[0], plan.commits[0]], skipped: [] }), ['file.txt']), /중복/)
  const { cwd, git, store } = await fixture()
  const job = await store.start(owner, cwd, crypto.randomUUID(), preset)
  const output = { commits: [plan.commits[0]], skipped: [{ file: 'new.txt', reason: '검토 필요' }] }
  const result = await execute(store, cwd, job.id, output)
  assert.equal(result.state, 'completed', result.error)
  assert.deepEqual(result.result!.skipped, output.skipped)
  assert.deepEqual((await git.status()).not_added, ['new.txt'])
})

test('automatic commits support unborn repositories, renames, deletions and literal filenames', async () => {
  const { cwd, git, store } = await fixture()
  await git.raw(['mv', 'file.txt', 'renamed.txt'])
  const strange = 'literal[1]*.txt'
  fs.writeFileSync(path.join(cwd, strange), 'literal content')
  const job = await store.start(owner, cwd, crypto.randomUUID(), preset, ['renamed.txt', strange])
  const result = await execute(store, cwd, job.id, { commits: [
    { title: 'refactor: rename', description: '', files: ['renamed.txt'] },
    { title: 'feat: literal path', description: '', files: [strange] },
  ], skipped: [] })
  assert.equal(result.state, 'completed', result.error)
  assert.equal((await git.status()).files.some(file => file.path === 'renamed.txt'), false)
  fs.unlinkSync(path.join(cwd, strange))
  const deletion = await store.start(owner, cwd, crypto.randomUUID(), preset, [strange])
  assert.equal((await execute(store, cwd, deletion.id, { commits: [{ title: 'chore: remove', description: '', files: [strange] }], skipped: [] })).state, 'completed')
  const fresh = fs.mkdtempSync(path.join(temp, 'fresh-'))
  const unborn = simpleGit(fresh); await unborn.init(); await unborn.addConfig('user.name', 'Test'); await unborn.addConfig('user.email', owner)
  fs.writeFileSync(path.join(fresh, 'file.txt'), 'first')
  fs.writeFileSync(path.join(fresh, 'new.txt'), 'second')
  const first = await store.start(owner, fresh, crypto.randomUUID(), preset)
  const created = await execute(store, fresh, first.id)
  assert.equal(created.state, 'completed', created.error)
  assert.equal((await unborn.log()).total, 2)
})

test('partial failure and cancellation keep committed hashes; hook-time edits stay uncommitted', async () => {
  for (const scenario of ['failure', 'cancel', 'edit'] as const) {
    const { cwd, git, store } = await fixture()
    const job = await store.start(owner, cwd, crypto.randomUUID(), preset)
    const directory = store.directory(owner, cwd, job.id)
    if (scenario === 'failure') {
      fs.writeFileSync(path.join(cwd, '.git/hooks/pre-commit'), '#!/bin/sh\nif git diff --cached --name-only | grep -q new.txt; then exit 1; fi\n', { mode: 0o700 })
    } else if (scenario === 'cancel') {
      fs.writeFileSync(path.join(cwd, '.git/hooks/post-commit'), `#!/bin/sh\ntouch '${directory}/stop'\n`, { mode: 0o700 })
    } else {
      fs.writeFileSync(path.join(cwd, '.git/hooks/pre-commit'), '#!/bin/sh\nprintf "late edit\\n" >> file.txt\n', { mode: 0o700 })
    }
    const result = await execute(store, cwd, job.id, scenario === 'edit' ? { commits: [plan.commits[0]], skipped: [{ file: 'new.txt', reason: 'not part of change' }] } : plan)
    assert.equal(result.state, scenario === 'edit' ? 'completed' : scenario === 'cancel' ? 'cancelled' : 'failed', result.error)
    assert.equal(result.result!.commits.length, 1)
    assert.equal((await git.log()).total, 2)
    assert.equal(await git.diff(['--cached']), '', 'failed or cancelled groups never stage new files')
    if (scenario === 'edit') {
      assert.equal(await git.show(['HEAD:file.txt']), 'after\n')
      assert.match(await git.diff(), /late edit/)
    }
  }
})

test('cancellation during initialize never sends a prompt; timeout and permission requests fail visibly', async () => {
  for (const scenario of ['cancel', 'timeout', 'permission', 'invalid', 'model-error'] as const) {
    const { cwd, store } = await fixture()
    const job = await store.start(owner, cwd, crypto.randomUUID(), preset)
    let prompts = 0, disposed = false, denied = false
    let listener: (event: AgentEvent) => void = () => {}
    const running = runAutomaticCommit(store.directory(owner, cwd, job.id), async () => {
      if (scenario === 'cancel') await new Promise(resolve => setTimeout(resolve, 350))
      return {
        attach: callback => { listener = callback; return () => {} },
        setModel: async () => { if (scenario === 'model-error') throw new Error('unknown model') },
        runOnce: async () => {
          prompts++
          if (scenario === 'permission') listener({ type: 'permission', id: 'permission', toolCall: { toolCallId: 'tool', title: 'write' }, options: [] })
          if (scenario === 'invalid') return 'end_turn'
          return new Promise<string>(() => {})
        },
        answerPermission: (_id, option) => { denied = option === null }, cancel: () => {}, disposeAndWait: async () => { disposed = true },
      }
    }, 600)
    if (scenario === 'cancel') store.stop(owner, cwd, job.id)
    await running
    const result = store.read(owner, cwd, job.id)
    assert.equal(result.state, scenario === 'cancel' ? 'cancelled' : 'failed')
    assert.equal(result.result, undefined); assert.ok(result.error); assert.ok(disposed)
    if (scenario === 'cancel' || scenario === 'model-error') assert.equal(prompts, 0)
    if (scenario === 'permission') assert.ok(denied)
  }
})

test('structured ACP startup and model errors preserve the phase and detailed cause without committing', async () => {
  for (const phase of ['start', 'model'] as const) {
    const { cwd, git, store } = await fixture()
    const head = await git.revparse('HEAD')
    const job = await store.start(owner, cwd, crypto.randomUUID(), preset)
    const error = { code: -32603, message: 'Internal error', data: { details: 'Unsupported format of modelId: selected-model. Expected: modelId[effort].' } }
    let disposed = false
    await runAutomaticCommit(store.directory(owner, cwd, job.id), async () => {
      if (phase === 'start') throw error
      return {
        attach: () => () => {},
        setModel: async () => { throw error },
        runOnce: async () => { assert.fail('must not prompt after a model error') },
        answerPermission: () => {}, cancel: () => {}, disposeAndWait: async () => { disposed = true },
      }
    })
    const result = store.read(owner, cwd, job.id)
    assert.equal(result.state, 'failed')
    assert.match(result.error!, phase === 'start' ? /에이전트 준비/ : /모델 설정/)
    assert.match(result.error!, /Unsupported format of modelId/)
    assert.match(result.output, /modelId\[effort\]/)
    assert.doesNotMatch(result.error!, /\[object Object\]/)
    assert.equal(await git.revparse('HEAD'), head)
    assert.equal(await git.diff(['--cached']), '')
    assert.equal(disposed, phase === 'model')
    assert.equal(fs.existsSync(path.join(cwd, '.git', 'mew-ai-commit.lock')), false)
  }
})

test('HTTP requires Git + agent capabilities and validates workspace and ownership', async () => {
  const { cwd, store } = await fixture()
  writeSets([preset])
  const app = express(); app.use(express.json())
  app.use((req, _res, next) => { req.auth = { role: 'manager', email: String(req.headers['x-account'] ?? owner), mustChangePassword: false }; next() })
  app.use('/ai', createGitAiCommitRouter(store))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/ai`
  const query = `?${new URLSearchParams({ project: path.basename(cwd), workspace: temp })}`
  const post = (url: string, body: unknown, account = owner) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-account': account }, body: JSON.stringify(body) })
  try {
    for (const feature of ['git', 'agent'] as const) {
      setFeature(owner, feature, false)
      assert.equal((await fetch(base + query)).status, 403)
      assert.equal((await post(base + query, {})).status, 403)
      setFeature(owner, feature, true)
    }
    assert.equal((await fetch(base + '?project=.workspace&workspace=wrong')).status, 400)
    assert.equal((await post(base + query, { id: crypto.randomUUID(), agentSetId: 'missing' })).status, 400)
    const id = crypto.randomUUID()
    assert.equal((await post(base + query, { id, agentSetId: preset.id })).status, 400)
    assert.equal((await post(base + query, { id, agentSetId: preset.id, files: ['file.txt'] })).status, 202)
    assert.equal((await post(base + `/${id}/stop` + query, {}, 'other@example.test')).status, 400)
    assert.equal((await post(base + `/${id}/stop` + query, {})).status, 200)
  } finally { server.close(); await once(server, 'close') }
})

test('failed launch and lost tmux are recoverable and remove the temporary diff input', async () => {
  const { cwd, store, manager } = await fixture()
  manager.startCommand = async () => { throw new Error('tmux unavailable') }
  const failed = await store.start(owner, cwd, crypto.randomUUID(), preset)
  assert.equal(failed.state, 'failed'); assert.match(failed.error!, /tmux unavailable/)
  assert.equal(fs.existsSync(path.join(store.directory(owner, cwd, failed.id), 'input.json')), false)
  manager.startCommand = async () => {}
  const lost = await store.start(owner, cwd, crypto.randomUUID(), preset)
  const directory = store.directory(owner, cwd, lost.id)
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({ ...lost, startedAt: Date.now() - 20_000 }))
  assert.equal((await store.latest(owner, cwd))?.state, 'failed')
  assert.equal(fs.existsSync(path.join(directory, 'input.json')), false)
})

let tmux: string | undefined
try { tmux = execFileSync('which', ['tmux'], { encoding: 'utf8' }).trim() } catch { /* optional */ }
test('real isolated tmux runs a separate ACP session and saves the result without a live browser', { skip: !tmux, timeout: 30_000 }, async () => {
  const { cwd } = await fixture()
  const socket = `mew-git-ai-test-${crypto.randomBytes(6).toString('hex')}`
  const bin = path.join(temp, 'bin'); fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\nexec '${tmux}' -L '${socket}' "$@"\n`, { mode: 0o700 })
  const adapter = path.join(temp, 'fake-acp.mjs')
  fs.writeFileSync(adapter, `
import {AgentSideConnection,ndJsonStream,PROTOCOL_VERSION} from ${JSON.stringify(import.meta.resolve('@agentclientprotocol/sdk'))};
import {Readable,Writable} from 'node:stream';
let model='';
new AgentSideConnection(conn=>({
 initialize:async()=>({protocolVersion:PROTOCOL_VERSION,agentCapabilities:{}}),
 newSession:async()=>({sessionId:'commit-only',models:{currentModelId:'default[medium]',availableModels:[{modelId:'selected-model[medium]',name:'Selected'}]}}),
 unstable_setSessionModel:async p=>{model=p.modelId;return {}},
 prompt:async({sessionId,prompt})=>{
 if(model!=='selected-model[medium]') throw Error('legacy preset model not resolved');
 if(!prompt.some(p=>p.text?.includes('new file'))) throw Error('missing diff');
 await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify({commits:[{title:'feat: isolated commit',description:'From tmux',files:['file.txt','new.txt']}],skipped:[]})}}});
 return {stopReason:'end_turn'};
 },cancel:async()=>{}
}),ndJsonStream(Writable.toWeb(process.stdout),Readable.toWeb(process.stdin)));
`)
  const saved = { PATH: process.env.PATH, MEW_AGENT_CODEX_CMD: process.env.MEW_AGENT_CODEX_CMD, MEW_AGENT_CODEX_ARGS: process.env.MEW_AGENT_CODEX_ARGS, MEW_AGENT_MEMORY_SCOPE: process.env.MEW_AGENT_MEMORY_SCOPE }
  Object.assign(process.env, { PATH: `${bin}:${saved.PATH}`, MEW_AGENT_CODEX_CMD: process.execPath, MEW_AGENT_CODEX_ARGS: adapter, MEW_AGENT_MEMORY_SCOPE: 'off' })
  try {
    const manager = createTmuxManager({ cwd }), store = new GitAiCommitStore(manager, path.join(temp, 'real-jobs'))
    const job = await store.start(owner, cwd, crypto.randomUUID(), preset)
    const deadline = Date.now() + 20_000
    let result = job
    while (result.state === 'starting' || result.state === 'running' || result.state === 'committing') {
      assert.ok(Date.now() < deadline, `job timeout: ${result.output}`)
      await new Promise(resolve => setTimeout(resolve, 100))
      result = store.read(owner, cwd, job.id)
    }
    assert.equal(result.state, 'completed', result.error)
    assert.equal(result.result?.commits[0]?.title, 'feat: isolated commit')
    assert.equal((await new GitAiCommitStore(manager, store.root).latest(owner, cwd))?.id, job.id)
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    try { execFileSync(tmux!, ['-L', socket, 'kill-server']) } catch { /* exited */ }
  }
})
