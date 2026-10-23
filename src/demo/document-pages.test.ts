import assert from 'node:assert/strict'
import test from 'node:test'
import { demoFetch } from './transport.ts'
import { DemoWorkspaceStore } from './workspace-store.ts'
import type { DocumentPageMutation } from '../../shared/document-pages.ts'

async function mutate(store: DemoWorkspaceStore, action: string, fields: Record<string, unknown>): Promise<DocumentPageMutation> {
  const response = await demoFetch(store, `/api/docs/pages/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'docs', ...fields }) })
  assert.equal(response.status, 200, await response.clone().text())
  return response.json()
}

test('Documents creates an editable file reflected in search, explorer and Git', async () => {
  const store = new DemoWorkspaceStore()
  const created = await mutate(store, 'create', { path: '', name: '나의 메모' })
  assert.equal(created.path, '나의 메모.md')
  assert.match(store.readFile(created.path, 'docs').content, /title: "나의 메모"/)
  store.writeFile(created.path, '# 직접 쓴 메모\n', 'docs')
  assert.ok(store.tree('docs').some(node => node.path === created.path))
  const search = await demoFetch(store, '/api/search?q=직접&project=docs').then(response => response.json())
  assert.ok(search.results.some((file: { path: string }) => file.path === created.path))
  assert.ok(store.gitWorkingTree().files.some(file => file.path === 'docs/나의 메모.md' && file.status === '?'))
})

test('a child promotes its parent, preserves incoming links and demotes after deletion', async () => {
  const store = new DemoWorkspaceStore()
  store.writeFile('reference.md', '[Welcome](welcome.md)\n', 'docs')
  const created = await mutate(store, 'create', { path: 'welcome.md', name: 'Child' })
  assert.equal(created.path, 'welcome/Child.md')
  assert.deepEqual(created.moves, [{ from: 'welcome.md', to: 'welcome/_welcome.md' }])
  assert.match(store.readFile('reference.md', 'docs').content, /welcome\/_welcome\.md/)
  assert.match(store.readFile('welcome/_welcome.md', 'docs').content, /\.\.\/guides\/first-steps\.md/)
  const removed = await mutate(store, 'delete', { path: created.path })
  assert.deepEqual(removed.moves, [{ from: 'welcome/_welcome.md', to: 'welcome.md' }])
  assert.match(store.readFile('reference.md', 'docs').content, /\(welcome\.md\)/)
  assert.ok(!store.tree('docs').some(node => node.path === 'welcome'))
})

test('parent rename and copies keep representatives, children and relative links connected', async () => {
  const store = new DemoWorkspaceStore()
  await mutate(store, 'create', { path: 'welcome.md', name: 'Child' })
  store.writeFile('welcome/Child.md', '[Parent](_welcome.md)\n', 'docs')
  const renamed = await mutate(store, 'rename', { path: 'welcome/_welcome.md', name: 'Guide' })
  assert.equal(renamed.path, 'Guide/_Guide.md')
  assert.match(store.readFile('Guide/Child.md', 'docs').content, /\(_Guide\.md\)/)
  const copied = await mutate(store, 'copy', { path: 'Guide', destination: '' })
  assert.equal(copied.path, 'Guide copy/_Guide copy.md')
  assert.match(store.readFile('Guide copy/Child.md', 'docs').content, /\(_Guide%20copy\.md\)/)
  assert.match(store.readFile('Guide/Child.md', 'docs').content, /\(_Guide\.md\)/)
})

test('move promotes its destination and demotes an emptied source parent', async () => {
  const store = new DemoWorkspaceStore()
  await mutate(store, 'create', { path: 'welcome.md', name: 'Child' })
  store.writeFile('design.md', '# Design\n', 'docs')
  const moved = await mutate(store, 'move', { path: 'welcome/Child.md', destination: 'design.md' })
  assert.equal(moved.path, 'design/Child.md')
  assert.ok(store.readFile('welcome.md', 'docs'))
  assert.ok(store.readFile('design/_design.md', 'docs'))
  assert.deepEqual(moved.moves, [
    { from: 'design.md', to: 'design/_design.md' },
    { from: 'welcome/Child.md', to: 'design/Child.md' },
    { from: 'welcome/_welcome.md', to: 'welcome.md' },
  ])
})

test('conflicts and invalid paths leave the workspace untouched; unique creates choose another name', async () => {
  const store = new DemoWorkspaceStore()
  await mutate(store, 'create', { path: '', name: 'Notes' })
  const before = store.repositoryEntries(), revision = store.revision
  for (const fields of [{ path: '', name: 'Notes' }, { path: 'welcome.md', name: '../escape' }, { path: '../', name: 'Outside' }]) {
    const response = await demoFetch(store, '/api/docs/pages/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'docs', ...fields }) })
    assert.ok(response.status >= 400)
    assert.deepEqual(store.repositoryEntries(), before)
    assert.equal(store.revision, revision)
  }
  const unique = await mutate(store, 'create', { path: '', name: 'Notes.md', unique: true })
  assert.equal(unique.path, 'Notes 2.md')
})
