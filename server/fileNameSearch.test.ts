import test from 'node:test'
import assert from 'node:assert/strict'
import { rankFileNamePaths } from './fileNameSearch.ts'

test('파일명 ranking은 basename exact와 prefix를 깊은 경로보다 먼저 둔다', () => {
  const paths = ['src/deep/search-panel.test.ts', 'docs/search.md', 'search', 'src/SearchPanel.tsx']
  assert.deepEqual(rankFileNamePaths('search', paths, { caseSensitive: false }), [
    'search',
    'docs/search.md',
    'src/SearchPanel.tsx',
    'src/deep/search-panel.test.ts',
  ])
})

test('파일명 ranking은 한글·kebab subsequence와 대소문자를 지원한다', () => {
  assert.deepEqual(rankFileNamePaths('검계', ['문서/검색-계획.md', '문서/검색.md'], { caseSensitive: false }), ['문서/검색-계획.md'])
  assert.deepEqual(rankFileNamePaths('src/App*', ['src/app.ts', 'src/App.tsx'], { caseSensitive: true }), ['src/App.tsx'])
})

test('와일드카드는 확장자와 파일명 전체를 대조하며 정규식 문자를 리터럴로 취급한다', () => {
  const paths = ['bin/app.exe', 'app.EXE', 'bin/app.exe.bak', 'bin/exe.txt', 'setup.exe']
  assert.deepEqual(rankFileNamePaths('*.exe', paths, { caseSensitive: false }), ['app.EXE', 'bin/app.exe', 'setup.exe'])
  assert.deepEqual(rankFileNamePaths('*.exe', paths, { caseSensitive: true }), ['bin/app.exe', 'setup.exe'])
  assert.deepEqual(rankFileNamePaths('app*.exe', paths, { caseSensitive: false }), ['app.EXE', 'bin/app.exe'])
  assert.deepEqual(rankFileNamePaths('file?.txt', ['dir/file1.txt', 'file12.txt', 'file.txt', 'file😀.txt'], { caseSensitive: false }), ['dir/file1.txt', 'file😀.txt'])
  assert.deepEqual(rankFileNamePaths('a[1]*.txt', ['dir/a[1](x).txt', 'a1.txt'], { caseSensitive: false }), ['dir/a[1](x).txt'])
})

test('와일드카드는 경로·연속 별표·빈 매치·결과 상한을 지원한다', () => {
  const paths = ['src/App.tsx', 'src/deep/App.test.tsx', 'docs/App.tsx', 'src/App.tsx.bak']
  assert.deepEqual(rankFileNamePaths('src/**.tsx', paths, { caseSensitive: false }), ['src/App.tsx', 'src/deep/App.test.tsx'])
  assert.deepEqual(rankFileNamePaths('a*b?c*.txt', ['abXc.txt', 'aabYc-more.txt', 'abc.txt'], { caseSensitive: false }), ['aabYc-more.txt', 'abXc.txt'])
  assert.equal(rankFileNamePaths('*', paths, { caseSensitive: false }, 2).length, 2)
  assert.deepEqual(rankFileNamePaths('', paths, { caseSensitive: false }), [])
})
