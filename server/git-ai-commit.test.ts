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

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-git-ai-'))
process.env.MEW_DATA_DIR = path.join(temp, 'data')
process.env.MEW_WORKSPACE = temp
const { GitAiCommitStore, captureCommitChanges, parseCommitDraft } = await import('./git-ai-commit.ts')
const { runCommitDraft } = await import('./git-ai-commit-runner.ts')
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
  assert.throws(() => parseCommitDraft('{"title":"a\\nb","description":""}'))
  assert.throws(() => parseCommitDraft('done'))
  assert.deepEqual(parseCommitDraft('```json\n{"title":"fix: change","description":"body"}\n```'), { title: 'fix: change', description: 'body' })
})

test('jobs are idempotent, account/repository scoped and recoverable; drafts reject changed trees', async () => {
  const { cwd, git, store, manager, launches } = await fixture()
  const id = crypto.randomUUID()
  const [first, second] = await Promise.all([store.start(owner, cwd, id, preset), store.start(owner, cwd, crypto.randomUUID(), preset)])
  assert.equal(first.id, second.id); assert.equal(launches(), 1)
  assert.equal((await store.start(owner, cwd, id, preset)).id, id)
  assert.equal((await new GitAiCommitStore(manager, store.root).latest(owner, cwd))?.id, id)
  assert.equal(await store.latest('other', cwd), null)
  assert.throws(() => store.read('other', cwd, id))
  const directory = store.directory(owner, cwd, id)
  const input = JSON.parse(fs.readFileSync(path.join(directory, 'input.json'), 'utf8'))
  assert.equal(input.agentSet.modelId, preset.modelId)
  assert.match(input.prompt, /Do not execute commands/)
  const head = await git.revparse('HEAD'), index = await git.diff(['--cached'])
  const calls: string[] = []
  let listener: (event: AgentEvent) => void = () => {}
  await runCommitDraft(directory, async (runtime, actualCwd) => {
    assert.equal(runtime, preset.runtime); assert.equal(actualCwd, cwd)
    return {
      attach: callback => { listener = callback; return () => {} },
      setModel: async model => { calls.push(`model:${model}`) },
      runOnce: async () => { calls.push('prompt'); listener({ type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '{"title":"fix: draft","description":"Describe changes"}' } } }); return 'end_turn' },
      answerPermission: () => {}, cancel: () => {}, disposeAndWait: async () => { calls.push('disposed') },
    }
  })
  assert.deepEqual(calls, ['model:selected-model', 'prompt', 'disposed'])
  assert.equal((await store.draft(owner, cwd, id)).title, 'fix: draft')
  assert.equal(store.read(owner, cwd, id).state, 'completed')
  assert.equal(fs.existsSync(path.join(directory, 'input.json')), false)
  assert.equal(await git.revparse('HEAD'), head); assert.equal(await git.diff(['--cached']), index)
  fs.appendFileSync(path.join(cwd, 'new.txt'), 'changed again')
  await assert.rejects(store.draft(owner, cwd, id), /변경사항이 달라졌습니다/)
})

test('cancellation during initialize never sends a prompt; timeout and permission requests fail visibly', async () => {
  for (const scenario of ['cancel', 'timeout', 'permission', 'invalid', 'model-error'] as const) {
    const { cwd, store } = await fixture()
    const job = await store.start(owner, cwd, crypto.randomUUID(), preset)
    let prompts = 0, disposed = false, denied = false
    let listener: (event: AgentEvent) => void = () => {}
    const running = runCommitDraft(store.directory(owner, cwd, job.id), async () => {
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
    assert.equal((await post(base + query, { id, agentSetId: preset.id })).status, 202)
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
 newSession:async()=>({sessionId:'commit-only',models:{currentModelId:'default',availableModels:[{modelId:'selected-model',name:'Selected'}]}}),
 unstable_setSessionModel:async p=>{model=p.modelId;return {}},
 prompt:async({sessionId,prompt})=>{
 if(model!=='selected-model') throw Error('model not applied');
 if(!prompt.some(p=>p.text?.includes('new file'))) throw Error('missing diff');
 await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify({title:'feat: isolated draft',description:'From tmux'})}}});
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
    while (result.state === 'starting' || result.state === 'running') {
      assert.ok(Date.now() < deadline, `job timeout: ${result.output}`)
      await new Promise(resolve => setTimeout(resolve, 100))
      result = store.read(owner, cwd, job.id)
    }
    assert.equal(result.state, 'completed', result.error)
    assert.equal(result.result?.title, 'feat: isolated draft')
    assert.equal((await new GitAiCommitStore(manager, store.root).latest(owner, cwd))?.id, job.id)
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    try { execFileSync(tmux!, ['-L', socket, 'kill-server']) } catch { /* exited */ }
  }
})
