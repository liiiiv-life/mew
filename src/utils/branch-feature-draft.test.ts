import test from 'node:test'
import assert from 'node:assert/strict'
import { setBrowserStorageScope } from '@mew/ui/browser-storage-scope'
import { readBranchFeatureDraft, writeBranchFeatureDraft, type SavedBranchFeatureDraft } from './branch-feature-draft.ts'

class MemoryStorage {
  values = new Map<string, string>()
  failReads = false
  failWrites = false
  get length() { return this.values.size }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  getItem(key: string) { if (this.failReads) throw new Error('storage unavailable'); return this.values.get(key) ?? null }
  setItem(key: string, value: string) { if (this.failWrites) throw new Error('storage full'); this.values.set(key, value) }
  removeItem(key: string) { if (this.failWrites) throw new Error('storage unavailable'); this.values.delete(key) }
  clear() { this.values.clear() }
}
function fixture(): SavedBranchFeatureDraft {
  const baseDraft = { title: '검색', notes: '원래 내용', validation: '', port: '5101', path: '/', review: 'pending' as const }
  return { branch: 'feat/search', draft: { ...baseDraft, notes: '보존할 초안', port: '0', path: '//아직 입력 중' }, baseDraft, baseRevision: 'a'.repeat(64) }
}

test('branch editor drafts restore without sharing account, workspace or remote instance state', t => {
  const storage = new MemoryStorage(), saved = fixture()
  const aliceProject = JSON.stringify(['alice@example.test', '/project'])
  const bobProject = JSON.stringify(['bob@example.test', '/project'])
  t.after(() => setBrowserStorageScope())
  setBrowserStorageScope(undefined, undefined, { sessionStorage: storage })
  writeBranchFeatureDraft(aliceProject, saved)
  assert.deepEqual(readBranchFeatureDraft(aliceProject), saved)
  assert.equal(readBranchFeatureDraft(bobProject), null)
  assert.equal(readBranchFeatureDraft(JSON.stringify(['alice@example.test', '/other-project'])), null)
  const read = readBranchFeatureDraft(aliceProject)!
  read.draft.notes = '읽은 객체의 변경'
  assert.equal(readBranchFeatureDraft(aliceProject)!.draft.notes, '보존할 초안')
  const multiline = { ...saved, draft: { ...saved.draft, notes: '\n'.repeat(10_000), validation: '\\'.repeat(10_000) }, baseDraft: { ...saved.baseDraft, notes: '\n'.repeat(10_000), validation: '\\'.repeat(10_000) } }
  writeBranchFeatureDraft('large-multiline', multiline)
  assert.deepEqual(readBranchFeatureDraft('large-multiline'), multiline)
  setBrowserStorageScope('alice@example.test', 'host-a', { sessionStorage: storage })
  assert.equal(readBranchFeatureDraft(aliceProject), null)
  writeBranchFeatureDraft(aliceProject, saved)
  setBrowserStorageScope('alice@example.test', 'host-b', { sessionStorage: storage })
  assert.equal(readBranchFeatureDraft(aliceProject), null)
  setBrowserStorageScope('bob@example.test', 'host-a', { sessionStorage: storage })
  assert.equal(readBranchFeatureDraft(aliceProject), null)
  setBrowserStorageScope('alice@example.test', 'host-a', { sessionStorage: storage })
  assert.deepEqual(readBranchFeatureDraft(aliceProject), saved)
  writeBranchFeatureDraft(aliceProject, null)
  assert.equal(readBranchFeatureDraft(aliceProject), null)
})

test('unreadable or invalid stored drafts never become editable state', t => {
  const storage = new MemoryStorage(), saved = fixture(), workspace = 'invalid-stored-draft'
  t.after(() => setBrowserStorageScope())
  setBrowserStorageScope('validation', 'host', { sessionStorage: storage })
  writeBranchFeatureDraft(workspace, saved)
  const key = storage.key(0)!
  for (const value of [null, [], {}, { ...saved, branch: '' }, { ...saved, baseRevision: 'bad' }, { ...saved, draft: { ...saved.draft, review: 'implemented' } }, { ...saved, draft: { ...saved.draft, notes: 'a'.repeat(10_001) } }, { ...saved, baseDraft: { ...saved.baseDraft, path: 123 } }]) {
    storage.setItem(key, JSON.stringify(value))
    assert.equal(readBranchFeatureDraft(workspace), null)
  }
  for (const raw of ['{broken', 'a'.repeat(300_001)]) {
    storage.setItem(key, raw)
    assert.equal(readBranchFeatureDraft(workspace), null)
  }
  storage.failReads = true
  assert.equal(readBranchFeatureDraft(workspace), null)
})

test('failed writes and removals preserve the latest scoped draft without restoring stale storage', t => {
  const storage = new MemoryStorage(), workspace = 'storage-failure', saved = fixture()
  t.after(() => setBrowserStorageScope())
  setBrowserStorageScope('alice', 'offline-host', { sessionStorage: storage })
  writeBranchFeatureDraft(workspace, saved)
  storage.failWrites = true
  const updated = { ...saved, draft: { ...saved.draft, notes: '저장 실패 중 작성한 내용' } }
  writeBranchFeatureDraft(workspace, updated)
  assert.deepEqual(readBranchFeatureDraft(workspace), updated)
  setBrowserStorageScope('bob', 'offline-host', { sessionStorage: storage })
  assert.equal(readBranchFeatureDraft(workspace), null)
  setBrowserStorageScope('alice', 'offline-host', { sessionStorage: storage })
  assert.deepEqual(readBranchFeatureDraft(workspace), updated)
  storage.failReads = true
  assert.deepEqual(readBranchFeatureDraft(workspace), updated)
  writeBranchFeatureDraft(workspace, null)
  assert.equal(readBranchFeatureDraft(workspace), null)
  storage.failReads = false
  assert.equal(readBranchFeatureDraft(workspace), null)
  storage.failWrites = false
  writeBranchFeatureDraft(workspace, updated)
  assert.deepEqual(readBranchFeatureDraft(workspace), updated)
  writeBranchFeatureDraft(workspace, null)
  assert.equal(readBranchFeatureDraft(workspace), null)
})
