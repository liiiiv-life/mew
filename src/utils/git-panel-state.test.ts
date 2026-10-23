import assert from 'node:assert/strict'
import test from 'node:test'
import { gitRepositoryTab, restoreGitPanel } from './git-panel-state.ts'

const root = { ...gitRepositoryTab('.workspace', ''), label: '현재 프로젝트' }
const current = { tabs: [root], activeId: root.id }

test('old child and Documents selections migrate to the current root without drafts', () => {
  const docs = gitRepositoryTab('docs', ''), child = gitRepositoryTab('.workspace', 'tools/mew')
  assert.deepEqual(restoreGitPanel({ tabs: [docs, child, { ...root, draft: 'private draft' }], activeId: child.id }), current)
})

test('first use and malformed saved state always open the current root', () => {
  assert.deepEqual(restoreGitPanel({ tabs: [null, 'mew:git:old', { project: 'unknown', path: '' }, { project: 'docs', path: '../secret' }], activeId: 'missing' }), current)
  assert.deepEqual(restoreGitPanel(null), current)
  assert.deepEqual(restoreGitPanel({ tabs: [], activeId: null }), current)
})
