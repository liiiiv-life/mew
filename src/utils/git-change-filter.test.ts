import assert from 'node:assert/strict'
import test from 'node:test'
import { filterGitChanges } from './git-change-filter.ts'

const files = [
  { path: 'src/GitWorkbench.tsx', status: ' M' },
  { path: 'src/components/GitPanel.tsx', status: ' M' },
  { path: 'docs/질문.md', status: '??' },
  { path: 'file-1.ts', status: ' M' },
  { path: 'file-12.ts', status: ' M' },
  { path: 'literal[1].md', status: '??' },
  { path: 'new/name.md', previousPath: 'old/guide.md', status: 'R ' },
]
const paths = (query: string) => filterGitChanges(files, query).map(file => file.path)

test('change search handles empty input, case-insensitive path fragments and renamed paths', () => {
  assert.equal(filterGitChanges(files, '   '), files)
  assert.deepEqual(paths('  WORKBENCH  '), ['src/GitWorkbench.tsx'])
  assert.deepEqual(paths('src/components/'), ['src/components/GitPanel.tsx'])
  assert.deepEqual(paths('질문'), ['docs/질문.md'])
  assert.deepEqual(paths('old/guide'), ['new/name.md'])
  assert.deepEqual(paths('missing'), [])
})

test('wildcards match full paths or file names, with star retries and literal punctuation', () => {
  assert.deepEqual(paths('*.tsx'), ['src/GitWorkbench.tsx', 'src/components/GitPanel.tsx'])
  assert.deepEqual(paths('SRC/*PANEL.tsx'), ['src/components/GitPanel.tsx'])
  assert.deepEqual(paths('file-?.ts'), ['file-1.ts'])
  assert.deepEqual(paths('file-??.ts'), ['file-12.ts'])
  assert.deepEqual(paths('*i*t*.tsx'), ['src/GitWorkbench.tsx', 'src/components/GitPanel.tsx'])
  assert.deepEqual(paths('**'), files.map(file => file.path))
  assert.deepEqual(paths('literal[?].md'), ['literal[1].md'])
  assert.deepEqual(paths('old/*.md'), ['new/name.md'])
  assert.deepEqual(paths('Git*.ts'), [])
  assert.deepEqual(paths('docs/??.md'), ['docs/질문.md'])
  assert.equal(filterGitChanges([{ path: 'docs/😺.md', status: '??' }], 'docs/?.md').length, 1, 'question mark matches a Unicode character')
})
