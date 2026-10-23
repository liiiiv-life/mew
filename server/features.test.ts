import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { FeatureStore, validateFeatureReport } from './features.ts'
import { featureRows } from '../shared/features.ts'
import { featureAgentInstructions } from './feature-agent-instructions.ts'
import { featureCli } from './feature-cli.ts'
const set = { id: crypto.randomUUID(), name: 'Builder', role: 'Build carefully', runtime: 'codex', modelId: '' }
const request = (title = 'Login') => ({ id: crypto.randomUUID(), title, content: 'Allow users to sign in', agentSetId: set.id })
const assign = { action: 'new', title: 'Login', content: 'Allow users to sign in', reason: 'Independent feature' }
function fixture(t: test.TestContext) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-features-')))
  const workspace = path.join(root, 'project'); fs.mkdirSync(workspace)
  const store = new FeatureStore(path.join(root, 'state'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, workspace, store }
}
test('feature lifecycle preserves identity, user edits, manual review and complete history', async t => {
  const { store, workspace } = fixture(t), input = request()
  const job = await store.request(workspace, 'owner', input, set)
  assert.equal((await store.request(workspace, 'owner', input, set)).id, job.id)
  await assert.rejects(store.request(workspace, 'owner', { ...input, title: 'Different' }, set), /요청 ID/)
  assert.equal((await store.claim(workspace))?.id, job.id)
  assert.equal(await store.claim(workspace), null)
  const feature = await store.assign(workspace, job.id, assign)
  assert.equal(feature.status, 'implementing')
  assert.equal((await store.assign(workspace, job.id, assign)).id, feature.id)
  await store.report(workspace, job.id, { summary: 'Implemented login', validation: 'unit tests pass', files: [], commits: [] })
  assert.equal(store.read(workspace).features[0].status, 'implementing', 'report alone is not completion')
  await store.finish(workspace, job.id, 'completed')
  const implemented = store.read(workspace).features[0]
  assert.equal(implemented.status, 'implemented')
  const verified = await store.judge(workspace, implemented.id, implemented.version, 'verified')
  const same = await store.edit(workspace, verified.id, verified)
  assert.equal(same.version, verified.version, 'unchanged saves do not turn orange')
  const edited = await store.edit(workspace, verified.id, { ...verified, content: 'Also support password recovery' })
  assert.equal(edited.status, 'changed')
  await assert.rejects(store.judge(workspace, edited.id, verified.version, 'needs-fix'), /다른 변경/)
  const next = await store.request(workspace, 'owner', { ...request(), targetId: edited.id, expectedVersion: edited.version }, set)
  await store.claim(workspace)
  await assert.rejects(store.assign(workspace, next.id, assign), /수정 대상/)
  const updating = await store.assign(workspace, next.id, { ...assign, action: 'update', featureId: edited.id, version: edited.version })
  const during = await store.edit(workspace, updating.id, { ...updating, title: 'Login with recovery' })
  const manuallyVerified = await store.judge(workspace, during.id, during.version, 'verified')
  await store.report(workspace, next.id, { summary: 'Updated login', files: [], commits: [] })
  await store.finish(workspace, next.id, 'completed')
  assert.deepEqual(store.read(workspace).features[0], manuallyVerified, 'old completion cannot erase newer edits or review')
  assert.equal(store.read(workspace).features.length, 1)
  assert.equal(store.read(workspace).runs.length, 2)
})
test('hierarchy, sorting, stale queued targets and missing reports are guarded', async t => {
  const { store, workspace } = fixture(t)
  const first = await store.request(workspace, 'owner', request('Parent'), set); await store.claim(workspace)
  const parent = await store.assign(workspace, first.id, { ...assign, title: 'Parent' })
  await store.finish(workspace, first.id, 'completed')
  assert.equal(store.read(workspace).runs[0].state, 'failed')
  assert.equal(store.read(workspace).features[0].status, 'changed')
  const childJob = await store.request(workspace, 'owner', { ...request('Child'), parentId: parent.id }, set); await store.claim(workspace)
  await assert.rejects(store.assign(workspace, childJob.id, assign), /상위 기능/)
  const child = await store.assign(workspace, childJob.id, { ...assign, action: 'child', parentId: parent.id, title: 'Child' })
  const currentParent = store.read(workspace).features[0]
  await assert.rejects(store.edit(workspace, parent.id, { ...currentParent, parentId: child.id }), /하위 기능/)
  await store.finish(workspace, childJob.id, 'cancelled')
  const queued = await store.request(workspace, 'owner', { ...request(), targetId: parent.id, expectedVersion: currentParent.version }, set)
  const newer = await store.edit(workspace, parent.id, { ...currentParent, title: 'Updated parent' })
  await store.claim(workspace)
  await assert.rejects(store.assign(workspace, queued.id, { ...assign, action: 'update', featureId: parent.id, version: newer.version }), /다른 변경/)
  assert.equal(store.read(workspace).features[0].title, 'Updated parent')
  const features = store.read(workspace).features
  assert.deepEqual(featureRows(features, 'name').map(row => [row.feature.id, row.depth]), [[parent.id, 0], [child.id, 1]])
  assert.equal(featureRows(features, 'updated', new Set([parent.id])).length, 1)
  const other = { ...newer, id: 'other', parentId: null, title: 'AAA', updatedAt: '2026-01-02', createdAt: '2025-01-01' }
  const tree = [{ ...newer, updatedAt: '2026-01-01', createdAt: '2026-01-01' }, { ...child, updatedAt: '2026-01-03' }, other]
  assert.deepEqual(featureRows(tree, 'updated').map(row => row.feature.id), [parent.id, child.id, 'other'])
  assert.equal(featureRows(tree, 'created')[0].feature.id, 'other')
})
test('reports require real files and commits within their project, including deletions', t => {
  const { workspace, root } = fixture(t)
  const git = (...args: string[]) => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-q'); fs.writeFileSync(path.join(workspace, 'login.ts'), 'export const login = true')
  git('add', 'login.ts'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'Add login')
  const hash = git('rev-parse', 'HEAD'), report = { summary: 'Implemented', files: ['login.ts'], commits: [{ repository: '', hash }] }
  assert.equal(validateFeatureReport(workspace, report).commits[0].subject, 'Add login')
  for (const file of ['../escape', '/tmp/escape', 'missing.ts']) assert.throws(() => validateFeatureReport(workspace, { ...report, files: [file] }))
  fs.writeFileSync(path.join(root, 'outside'), 'private'); fs.symlinkSync(path.join(root, 'outside'), path.join(workspace, 'escape'))
  assert.throws(() => validateFeatureReport(workspace, { ...report, files: ['escape'] }))
  assert.throws(() => validateFeatureReport(workspace, { ...report, commits: [{ repository: '', hash: '000000000' }] }))
  fs.unlinkSync(path.join(workspace, 'login.ts')); git('add', 'login.ts'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'Remove login')
  assert.equal(validateFeatureReport(workspace, { ...report, commits: [{ repository: '', hash: git('rev-parse', 'HEAD') }] }).files[0], 'login.ts')
})
test('common CLI and independent processes share the same atomic feature store', async t => {
  const { store, workspace } = fixture(t)
  const jobs = await Promise.all(Array.from({ length: 8 }, (_, index) => store.request(workspace, 'owner', request(`Feature ${index}`), set)))
  assert.equal(store.read(workspace).runs.length, 8)
  const job = (await store.claim(workspace))!
  const args = [store.directory, workspace, job.id]
  await featureCli([...args, 'assign'], () => JSON.stringify(assign))
  const feature = store.read(workspace).features[0]
  const cli = path.join(import.meta.dirname, 'feature-cli.ts')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args, 'report'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let error = ''; child.stderr.on('data', chunk => { error += chunk }); child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(error)))
    child.stdin.end(JSON.stringify({ summary: 'From a separate agent process', files: [], commits: [] }))
  })
  const latest = await store.edit(workspace, feature.id, { ...feature, content: 'A newer requirement' })
  await store.finish(workspace, job.id, 'completed')
  assert.equal(store.read(workspace).features[0].status, 'changed')
  assert.equal(store.read(workspace).features[0].version, latest.version)
  assert.match(featureAgentInstructions(store.directory, workspace, jobs[0]), /feature-cli\.ts/)
  assert.match(featureAgentInstructions(store.directory, workspace, jobs[0]), /mew-feature-request/)
})

test('inline edits atomically persist full specifications and queue idempotent work against the saved version', async t => {
  const { store, workspace } = fixture(t)
  const initial = await store.request(workspace, 'owner', request(), set); await store.claim(workspace)
  await store.assign(workspace, initial.id, assign)
  await store.report(workspace, initial.id, { summary: 'Old implementation', validation: 'Old checks', files: [], commits: [] })
  await store.finish(workspace, initial.id, 'completed')
  const base = store.read(workspace).features[0]
  const edit = { title: 'Login with retries', content: '- API timeout: 60s\n- retries: 3', parentId: null, summary: 'Retry on timeouts', validation: 'Check retry exhaustion' }
  const input = { ...request(), title: edit.title, content: edit.content, targetId: base.id, expectedVersion: base.version, edit }
  const run = await store.request(workspace, 'owner', input, set)
  const saved = store.read(workspace).features[0]
  assert.equal(run.targetVersion, saved.version)
  assert.equal(saved.report?.summary, edit.summary)
  assert.equal(saved.status, 'changed')
  assert.equal(run.edit?.before.summary, 'Old implementation')
  assert.deepEqual(run.edit?.after, edit)
  assert.equal((await store.request(workspace, 'owner', input, set)).id, run.id)
  assert.equal(store.read(workspace).runs.length, 2)
  await assert.rejects(store.request(workspace, 'owner', { ...input, edit: { ...edit, summary: 'Different' } }, set), /같은 요청 ID/)
  await assert.rejects(store.request(workspace, 'owner', { ...input, id: crypto.randomUUID(), expectedVersion: saved.version, edit: { ...edit, summary: 'Another edit' } }, set), /이미 대기/)
  assert.deepEqual(store.read(workspace).features[0], saved)
  await store.claim(workspace)
  await store.assign(workspace, run.id, { action: 'update', featureId: saved.id, version: saved.version, title: saved.title, content: saved.content, reason: 'Inline edit' })
  assert.match(featureAgentInstructions(store.directory, workspace, run), /Retry on timeouts/)
  await store.report(workspace, run.id, { summary: 'Retries implemented', validation: 'Tests passed', files: [], commits: [] })
  await store.finish(workspace, run.id, 'completed')
  assert.equal(store.read(workspace).features[0].status, 'implemented')
  assert.equal(store.read(workspace).runs[0].report?.summary, 'Old implementation')
  const latest = store.read(workspace).features[0], before = fs.readFileSync(path.join(workspace, latest.documentPath!), 'utf8')
  await assert.rejects(store.request(workspace, 'owner', { ...input, id: crypto.randomUUID() }, set), /다른 변경/)
  await assert.rejects(store.request(workspace, 'owner', { ...input, id: crypto.randomUUID(), expectedVersion: latest.version, edit: { ...edit, parentId: latest.id } }, set), /순환/)
  assert.equal(fs.readFileSync(path.join(workspace, latest.documentPath!), 'utf8'), before)
  assert.equal(store.read(workspace).runs.length, 2)
})
