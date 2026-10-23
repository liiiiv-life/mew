import './test-isolated-data.ts'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import express from 'express'
import type { BranchFeatureSnapshot } from '../shared/branch-features.ts'
import { setFeature, setFileRule } from './access-policy.ts'
import { branchFeatureCli } from './branch-feature-cli.ts'
import { BranchFeatureError, readBranchFeatures, updateBranchFeature } from './branch-features.ts'
import { createFeatureRouter } from './feature-routes.ts'
import { FeatureService } from './feature-service.ts'
import { FeatureStore } from './features.ts'
import { pathsForWorkspace, workspaceContext } from './paths.ts'
import type { RequestAuth } from './reqAuth.ts'

function fixture(t: test.TestContext, initialize = true) {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-branch-features-')))
  const cwd = path.join(temporary, 'project')
  fs.mkdirSync(cwd)
  const git = (...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (initialize) {
    git('init', '-b', 'main'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture')
    fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'initial\n')
    git('add', 'tracked.txt'); git('commit', '-m', 'Initial version')
    git('branch', 'feat/feature')
  }
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  return { temporary, cwd, git }
}

test('all local branches, detached worktrees and unusual worktree paths are read without checking out', async t => {
  const { temporary, cwd, git } = fixture(t)
  git('branch', 'feature-without-worktree')
  const linked = path.join(temporary, 'feature worktree 한글')
  git('worktree', 'add', linked, 'feat/feature')
  git('worktree', 'add', '--detach', path.join(temporary, 'detached'))
  const before = git('status', '--porcelain=v1')
  const result = await readBranchFeatures(cwd)
  assert.equal(result.isGitRepository, true)
  assert.equal(result.currentBranch, 'main')
  assert.equal(result.baseBranch, 'main')
  assert.deepEqual(result.branches.map(item => item.branch).sort(), ['feat/feature', 'feature-without-worktree', 'main'])
  const main = result.branches.find(item => item.branch === 'main')!
  assert.equal(main.current, true); assert.equal(main.isBase, true)
  assert.equal(main.commit?.hash, git('rev-parse', 'HEAD'))
  assert.equal(main.commit?.subject, 'Initial version')
  assert.match(main.commit!.committedAt, /^\d{4}-/)
  const feature = result.branches.find(item => item.branch === 'feat/feature')!
  assert.equal(feature.worktreePath, linked)
  assert.deepEqual(feature.worktreePaths, [linked])
  assert.equal(feature.current, false)
  assert.equal(result.branches.find(item => item.branch === 'feature-without-worktree')!.dirty, null)
  assert.equal(git('status', '--porcelain=v1'), before)
  assert.equal(git('branch', '--show-current'), 'main')
})

test('dirty counts distinguish staged, unstaged, renamed and untracked paths', async t => {
  const { cwd, git } = fixture(t)
  git('switch', 'feat/feature')
  fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'staged\n'); git('add', 'tracked.txt')
  fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'unstaged\n')
  fs.mkdirSync(path.join(cwd, 'new directory'))
  fs.writeFileSync(path.join(cwd, 'new directory', 'untracked.txt'), 'untracked')
  let branch = (await readBranchFeatures(cwd)).branches.find(item => item.current)!
  assert.deepEqual(branch.dirty, { staged: 1, unstaged: 1, untracked: 1 })
  git('commit', '-m', 'Stage change')
  git('mv', 'tracked.txt', 'renamed.txt')
  branch = (await readBranchFeatures(cwd)).branches.find(item => item.current)!
  assert.deepEqual(branch.dirty, { staged: 1, unstaged: 1, untracked: 1 })
})

test('base discovery uses recorded origin HEAD locally and leaves ambiguous main/master unresolved', async t => {
  const { cwd, git } = fixture(t)
  git('branch', 'master')
  assert.equal((await readBranchFeatures(cwd)).baseBranch, null)
  git('branch', 'trunk')
  git('update-ref', 'refs/remotes/origin/trunk', 'HEAD')
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
  assert.equal((await readBranchFeatures(cwd)).baseBranch, 'trunk')
  assert.equal((await readBranchFeatures(cwd)).branches.find(item => item.branch === 'trunk')!.isBase, true)
})

test('metadata and CLI registration are shared across worktrees and concurrent saves preserve independent fields', async t => {
  const { temporary, cwd, git } = fixture(t)
  const linked = path.join(temporary, 'feature')
  git('worktree', 'add', linked, 'feat/feature')
  assert.deepEqual(JSON.parse(await branchFeatureCli(['--cwd', linked], JSON.stringify({ previewPort: 5101, previewPath: '/login?q=1', validation: 'unit tests passed', title: 'Login' }))), { ok: true, branch: 'feat/feature' })
  await Promise.all([
    updateBranchFeature(cwd, { branch: 'feat/feature', notes: 'Working on login' }),
    updateBranchFeature(linked, { branch: 'main', title: 'Stable' }),
    updateBranchFeature(linked, { branch: 'feat/feature', review: 'needs-fix' }),
  ])
  const result = await readBranchFeatures(cwd)
  const branch = result.branches.find(item => item.branch === 'feat/feature')!
  assert.equal(branch.title, 'Login'); assert.equal(branch.previewPort, 5101); assert.equal(branch.previewPath, '/login?q=1')
  assert.equal(branch.validation, 'unit tests passed'); assert.equal(branch.notes, 'Working on login'); assert.equal(branch.review, 'needs-fix')
  assert.equal(result.branches.find(item => item.branch === 'main')!.title, 'Stable')
  assert.equal(fs.existsSync(path.join(cwd, '.git', 'mew-branch-features.json')), true)
  assert.equal(git('status', '--porcelain=v1'), '')
})

test('manual review expires after another edit to the same dirty file or a new commit', async t => {
  const { cwd, git } = fixture(t)
  git('switch', 'feat/feature')
  fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'first edit\n')
  await updateBranchFeature(cwd, { branch: 'feat/feature', review: 'verified' })
  const current = async () => (await readBranchFeatures(cwd)).branches.find(item => item.current)!
  assert.equal((await current()).review, 'verified')
  fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'later edit\n')
  assert.deepEqual((await current()).dirty, { staged: 0, unstaged: 1, untracked: 0 })
  assert.equal((await current()).review, 'pending')
  await updateBranchFeature(cwd, { branch: 'feat/feature', notes: 'Still reviewing' })
  assert.equal((await current()).review, 'pending', 'editing metadata must not restore a stale review')
  git('add', 'tracked.txt'); git('commit', '-m', 'New revision')
  assert.equal((await current()).review, 'pending')
  await updateBranchFeature(cwd, { branch: 'feat/feature', review: 'verified' })
  assert.equal((await current()).review, 'verified')
  git('commit', '--allow-empty', '-m', 'Another revision')
  assert.equal((await current()).review, 'pending')
})

test('review saves reject stale code revisions before applying any metadata', async t => {
  const { cwd } = fixture(t)
  const before = (await readBranchFeatures(cwd)).branches.find(item => item.current)!
  assert.match(before.revision, /^[a-f0-9]{64}$/)
  fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'new code\n')
  await assert.rejects(updateBranchFeature(cwd, { branch: 'main', expectedRevision: before.revision, review: 'verified', title: 'Must not save' }), error => error instanceof BranchFeatureError && error.status === 409)
  const after = (await readBranchFeatures(cwd)).branches.find(item => item.current)!
  assert.notEqual(before.revision, after.revision)
  assert.equal(after.review, 'pending'); assert.equal(after.title, 'main')
  await updateBranchFeature(cwd, { branch: 'main', expectedRevision: after.revision, review: 'verified' })
  assert.equal((await readBranchFeatures(cwd)).branches.find(item => item.current)!.review, 'verified')
})

test('configured port liveness is independent from reported validation and manual review', async t => {
  const { cwd } = fixture(t)
  let connections = 0
  const server = net.createServer(socket => { connections++; socket.end() })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { if (server.listening) server.close() })
  const port = (server.address() as net.AddressInfo).port
  await updateBranchFeature(cwd, { branch: 'feat/feature', previewPort: port, validation: 'Not tested yet' })
  assert.equal(connections, 0, 'saving metadata never probes a port')
  let branch = (await readBranchFeatures(cwd)).branches.find(item => item.branch === 'feat/feature')!
  assert.equal(branch.previewStatus, 'unknown'); assert.equal(connections, 0, 'users without preview permission never probe a port')
  const accepted = once(server, 'connection')
  branch = (await readBranchFeatures(cwd, { canEdit: false, canPreview: true })).branches.find(item => item.branch === 'feat/feature')!
  assert.equal(branch.previewStatus, 'running'); assert.equal(branch.review, 'pending'); assert.equal(branch.validation, 'Not tested yet')
  await accepted
  assert.ok(connections > 0)
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  branch = (await readBranchFeatures(cwd, { canEdit: false, canPreview: true })).branches.find(item => item.branch === 'feat/feature')!
  assert.equal(branch.previewStatus, 'stopped')
  await updateBranchFeature(cwd, { branch: 'feat/feature', previewPort: null })
  assert.equal((await readBranchFeatures(cwd)).branches.find(item => item.branch === 'feat/feature')!.previewStatus, 'unconfigured')
})

test('invalid metadata, removed branches and malformed stdin are rejected before modifying stored state', async t => {
  const { cwd, git } = fixture(t)
  await updateBranchFeature(cwd, { branch: 'feat/feature', title: 'Keep this' })
  for (const invalid of [
    { previewPort: 0 }, { previewPort: 65536 }, { previewPort: '5101' }, { previewPort: 1.5 },
    { previewPath: 'http://other.test' }, { previewPath: '//other.test' }, { previewPath: '/\\other.test' }, { previewPath: '/\nheader' },
    { previewPath: '/../api' }, { previewPath: '/%2e%2e/api' }, { previewPath: '/%2fother' }, { previewPath: '/%5cother' }, { previewPath: '/%00' }, { previewPath: '/%xx' },
    { review: 'passed' }, { title: 'x'.repeat(201) }, { notes: false }, { validation: '\0' },
    { expectedRevision: 'invalid' },
  ]) await assert.rejects(updateBranchFeature(cwd, { branch: 'feat/feature', ...invalid }), BranchFeatureError)
  await assert.rejects(branchFeatureCli(['--cwd', cwd], '{'), /JSON/)
  await assert.rejects(branchFeatureCli(['--invalid'], '{}'), /사용법/)
  await assert.rejects(updateBranchFeature(cwd, { branch: 'missing', title: 'No' }), /존재/)
  assert.equal((await readBranchFeatures(cwd)).branches.find(item => item.branch === 'feat/feature')!.title, 'Keep this')
  git('branch', '-D', 'feat/feature')
  await assert.rejects(updateBranchFeature(cwd, { branch: 'feat/feature', title: 'No' }), /존재/)
  assert.equal((await readBranchFeatures(cwd)).branches.length, 1)
})

test('non-Git and unborn repositories produce explicit empty states', async t => {
  const { cwd, git } = fixture(t, false)
  assert.deepEqual(await readBranchFeatures(cwd), { workspace: cwd, isGitRepository: false, baseBranch: null, currentBranch: null, branches: [], canEdit: false, canPreview: false })
  await assert.rejects(updateBranchFeature(cwd, { branch: 'main', title: 'No' }), /Git 저장소/)
  git('init', '-b', 'main')
  const result = await readBranchFeatures(cwd)
  assert.equal(result.isGitRepository, true); assert.equal(result.currentBranch, 'main'); assert.deepEqual(result.branches, [])
})

test('branch routes enforce workspace, agent, Git and complete file permissions and preserve read-only access', async t => {
  const { cwd, temporary } = fixture(t)
  const email = `branches-${path.basename(temporary)}@example.test`
  let auth: RequestAuth = { role: 'member', email, mustChangePassword: false }
  const executor = new FeatureService(new FeatureStore(path.join(temporary, 'legacy-state')))
  const app = express(); app.use(express.json())
  app.use((req, _res, next) => { req.auth = auth; workspaceContext.run(pathsForWorkspace(cwd, email), next) })
  app.use('/api/features', createFeatureRouter(executor))
  const server = http.createServer(app)
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))
  const origin = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`
  const read = (workspace = cwd) => fetch(`${origin}/api/features/branches?workspace=${encodeURIComponent(workspace)}`)
  const save = (body: Record<string, unknown>) => fetch(`${origin}/api/features/branches`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace: cwd, branch: 'feat/feature', title: 'Route edit', ...body }) })
  assert.equal((await read()).status, 403)
  setFeature(email, 'agent', true)
  assert.equal((await read()).status, 403)
  setFeature(email, 'git', true)
  assert.equal((await read('stale-workspace')).status, 409)
  let result = await read(); assert.equal(result.status, 200)
  let snapshot = await result.json() as BranchFeatureSnapshot
  assert.equal(snapshot.canEdit, true); assert.equal(snapshot.canPreview, false)
  setFeature(email, 'portPreview', true)
  result = await save({ validation: 'manual check' }); assert.equal(result.status, 200)
  snapshot = await result.json() as BranchFeatureSnapshot
  assert.equal(snapshot.branches.find(item => item.branch === 'feat/feature')!.title, 'Route edit'); assert.equal(snapshot.canPreview, true)
  await workspaceContext.run(pathsForWorkspace(cwd, email), async () => {
    setFileRule(email, '.workspace', '', 'view')
    result = await read(); assert.equal(result.status, 200); assert.equal(((await result.json()) as BranchFeatureSnapshot).canEdit, false)
    assert.equal((await save({})).status, 403)
    setFileRule(email, '.workspace', 'private', 'deny')
    assert.equal((await read()).status, 403)
  })
  auth = { role: 'guest', email: null, mustChangePassword: false }
  assert.equal((await read()).status, 403)
})
