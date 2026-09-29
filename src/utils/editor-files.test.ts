import test from 'node:test'
import assert from 'node:assert/strict'
import { editorFile, editorTabPath, mergeEditorTabs } from './editor-files.ts'

const state = (id: string, paths: string[]) => ({
  panes: [{ id, tabs: paths.map(path => ({ path, preview: false, viewMode: 'plain' as const })), activePath: paths[0] ?? null }],
  layout: { kind: 'leaf' as const, pane: id }, focusedPaneId: id,
})

test('Documents and root names have separate identities and retain API scopes', () => {
  assert.equal(editorTabPath('.workspace', 'README.md'), 'README.md')
  assert.equal(editorTabPath('docs', 'README.md'), 'mew:file:docs/README.md')
  assert.deepEqual(editorFile(editorTabPath('docs', 'folder/한글.md')), { project: 'docs', path: 'folder/한글.md' })
  assert.deepEqual(editorFile('README.md'), { project: '.workspace', path: 'README.md' })
  assert.equal(editorTabPath('docs', 'README.md', 'docs'), 'README.md', 'guest scope remains unchanged')
})

test('legacy tabs merge once without losing pane IDs, view modes or same-named files', () => {
  const root = state('main', ['README.md'])
  const docs = state('main', ['README.md', 'MOC.md'])
  const merged = mergeEditorTabs(root, docs)!
  assert.deepEqual(merged.panes[0].tabs.map(tab => tab.path), ['README.md', 'mew:file:docs/README.md', 'mew:file:docs/MOC.md'])
  assert.equal(merged.panes[0].activePath, 'README.md')
  assert.deepEqual(merged.layout, root.layout)
  const closed = { ...merged, panes: root.panes }
  assert.equal(mergeEditorTabs(closed, docs), closed, 'closed legacy tabs must not return after reload')
})

test('Documents-only and split legacy states retain pane identities used by docking', () => {
  const docs = state('moved-docs', ['README.md'])
  const only = mergeEditorTabs(state('main', []), docs)!
  assert.equal(only.focusedPaneId, 'moved-docs')
  assert.deepEqual(only.layout, docs.layout)
  assert.equal(only.panes[0].activePath, 'mew:file:docs/README.md')
  const merged = mergeEditorTabs(state('main', ['main.ts']), docs)!
  assert.deepEqual(merged.panes.map(pane => pane.id), ['main', 'moved-docs'])
})
