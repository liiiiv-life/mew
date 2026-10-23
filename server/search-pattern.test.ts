import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { compileSearchPattern, nonEmptySearchMatches } from './search-pattern.ts'

const regex = { regex: true, caseSensitive: false }

test('server search rejects unsupported patterns and compilation costs without a native fallback', () => {
  for (const query of ['(', 'a(?=b)', 'a(?!b)', '(?<=a)b', '(?<!a)b', '(a)\\1']) {
    assert.throws(() => compileSearchPattern(query, regex), SyntaxError, query)
  }
  assert.throws(() => compileSearchPattern('a'.repeat(2_001), regex), SyntaxError)
  assert.throws(() => compileSearchPattern('a{1000}'.repeat(20), regex), SyntaxError)
})

test('server search preserves Unicode offsets, empty-match progress and named capture groups', () => {
  const input = '😀한글 😀word'
  const matches = [...nonEmptySearchMatches(compileSearchPattern('(?<word>한글|word)', regex), input)]
  assert.deepEqual(matches.map(match => [match.index, match[0], match.groups?.word]), [[2, '한글', '한글'], [7, 'word', 'word']])
  const points = [...nonEmptySearchMatches(compileSearchPattern('.*?', regex), '😀a')]
  assert.deepEqual(points, [])
  assert.deepEqual([...nonEmptySearchMatches(compileSearchPattern('\\u{1F600}', regex), input)].map(match => match.index), [0, 5])
})

test('content, streaming, replacement and filename search bound ambiguous patterns in an isolated process', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-search-pattern-'))
  try {
    fs.mkdirSync(path.join(root, 'fixture'))
    fs.writeFileSync(path.join(root, 'fixture', 'input.txt'), 'a'.repeat(50_000) + '!')
    const code = `
      import assert from 'node:assert/strict'
      import { searchInProject, searchInProjectProgressively, replaceInFile } from './server/search.ts'
      import { rankFileNamePaths } from './server/fileNameSearch.ts'
      const opts = { regex: true, caseSensitive: false }
      const query = '(a+)+$'
      assert.deepEqual(searchInProject('fixture', ['input.txt'], query, opts).results, [])
      const received = []
      await searchInProjectProgressively('fixture', ['input.txt'], query, opts, result => received.push(result))
      assert.deepEqual(received, [])
      assert.equal(replaceInFile('fixture', 'input.txt', query, 'replacement', opts).count, 0)
      assert.deepEqual(rankFileNamePaths(query, ['a'.repeat(50_000) + '!'], opts), [])
      assert.equal(replaceInFile('fixture', 'input.txt', 'a*', 'x', opts).count, 1)
    `
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, MEW_WORKSPACE: root, MEW_DATA_DIR: path.join(root, 'data') },
      encoding: 'utf8', timeout: 5_000,
    })
    assert.ifError(child.error)
    assert.equal(child.status, 0, child.stderr)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
