import test from 'node:test'
import assert from 'node:assert/strict'
import { rankFileNamePaths } from './fileNameSearch.ts'

test('파일명 ranking은 basename exact와 prefix를 깊은 경로보다 먼저 둔다', () => {
  const paths = ['src/deep/search-panel.test.ts', 'docs/search.md', 'search', 'src/SearchPanel.tsx']
  assert.deepEqual(rankFileNamePaths('search', paths, { regex: false, caseSensitive: false }), [
    'search',
    'docs/search.md',
    'src/SearchPanel.tsx',
    'src/deep/search-panel.test.ts',
  ])
})

test('파일명 ranking은 한글·kebab subsequence와 정규식·대소문자를 지원한다', () => {
  assert.deepEqual(rankFileNamePaths('검계', ['문서/검색-계획.md', '문서/검색.md'], { regex: false, caseSensitive: false }), ['문서/검색-계획.md'])
  assert.deepEqual(rankFileNamePaths('^src/App', ['src/app.ts', 'src/App.tsx'], { regex: true, caseSensitive: true }), ['src/App.tsx'])
})
