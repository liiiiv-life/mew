import assert from 'node:assert/strict'
import test from 'node:test'
import { gitRepositoryTab, restoreGitPanel } from './git-panel-state.ts'

test('repository identity includes scope and restores order without file virtual tabs or drafts', () => {
  const workspace = gitRepositoryTab('.workspace', ''), docs = gitRepositoryTab('docs', '')
  assert.notEqual(workspace.id, docs.id)
  assert.deepEqual(restoreGitPanel({ tabs: [docs, { ...workspace, label: 'stale label', draft: 'private draft' }, docs], activeId: workspace.id }), { tabs: [docs, workspace], activeId: workspace.id })
})

test('malformed state cannot restore arbitrary scopes or paths and selects a surviving tab', () => {
  const tab = gitRepositoryTab('.workspace', 'tools/mew')
  assert.deepEqual(restoreGitPanel({ tabs: [null, 'mew:git:old', { project: 'unknown', path: '' }, { project: 'docs', path: '../secret' }, { project: '.workspace', path: '/tmp' }, tab], activeId: 'missing' }), { tabs: [tab], activeId: tab.id })
  assert.deepEqual(restoreGitPanel(null), { tabs: [], activeId: null })
})
