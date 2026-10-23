import test from 'node:test'
import assert from 'node:assert/strict'
import { demoFetch } from './transport.ts'
import { DemoWorkspaceStore } from './workspace-store.ts'
import type { BranchFeatureSnapshot } from '../../shared/branch-features.ts'

const patch = (workspace: string, value: unknown): RequestInit => ({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace, ...value as object }) })
const snapshot = async (store: DemoWorkspaceStore) => {
  const response = await demoFetch(store, `/api/features/branches?workspace=${encodeURIComponent(store.workspaceInfo().path)}`)
  assert.equal(response.status, 200)
  return response.json() as Promise<BranchFeatureSnapshot>
}

test('demo branch features show worktrees and keep previews explicitly unavailable without changing documents', async () => {
  const store = new DemoWorkspaceStore(), before = store.repositoryEntries()
  const value = await snapshot(store)
  assert.equal(value.currentBranch, 'main')
  assert.equal(value.baseBranch, 'main')
  assert.equal(value.canPreview, false)
  assert.equal(value.branches.find(branch => branch.branch === 'main')?.worktreePath, store.workspacePath)
  const search = value.branches.find(branch => branch.branch === 'feat/search')!
  assert.equal(search.previewPort, 5101)
  assert.equal(search.previewStatus, 'stopped')
  assert.match(search.worktreePath!, /\.worktrees\/search$/)
  assert.deepEqual(store.repositoryEntries(), before)
  assert.deepEqual(store.gitWorkingTree().files, [])
  const saved = await demoFetch(store, '/api/features/branches', patch(store.workspacePath, { branch: 'feat/search', title: '새 검색', notes: '검색 결과 수정', validation: '결과 목록 확인', review: 'verified', previewPort: 5200, previewPath: '/search?q=hello' }))
  assert.equal(saved.status, 200)
  const item = ((await saved.json()) as BranchFeatureSnapshot).branches.find(branch => branch.branch === 'feat/search')!
  assert.equal(item.title, '새 검색')
  assert.equal(item.review, 'verified')
  assert.equal(item.previewPort, 5200)
  assert.equal(item.previewStatus, 'stopped')
  assert.equal((await snapshot(store)).branches.find(branch => branch.branch === 'feat/search')?.validation, '결과 목록 확인')
  assert.deepEqual(store.repositoryEntries(), before)
  store.reset()
  assert.equal((await snapshot(store)).branches.find(branch => branch.branch === 'feat/search')?.title, '검색 개선')
})

test('demo branch edits reject invalid previews and stay isolated across workspaces', async () => {
  const store = new DemoWorkspaceStore()
  for (const value of [{ branch: 'missing' }, { branch: 'feat/search', previewPort: 65536 }, { branch: 'feat/search', previewPath: '//evil.test' }, { branch: 'feat/search', previewPath: '/%2e%2e/api' }]) {
    const response = await demoFetch(store, '/api/features/branches', patch(store.workspacePath, value))
    assert.ok(response.status >= 400)
  }
  await demoFetch(store, '/api/features/branches', patch(store.workspacePath, { branch: 'feat/search', title: '첫 프로젝트 검색' }))
  store.createDirectory('Second'); store.seedProject(`${store.workspacePath}/Second`); store.openWorkspace(`${store.workspacePath}/Second`)
  assert.equal((await snapshot(store)).branches.find(branch => branch.branch === 'feat/search')?.title, '검색 개선')
  store.setBranch('feat/new', true)
  assert.equal((await snapshot(store)).branches.find(branch => branch.branch === 'feat/new')?.current, true)
  assert.equal((await demoFetch(store, '/api/features/branches', patch(store.workspacePath, { branch: 'feat/search', title: 'stale' }))).status, 409)
})
