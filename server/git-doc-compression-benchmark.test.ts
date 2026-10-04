import test from 'node:test'
import assert from 'node:assert/strict'
import { createTwoFilesPatch } from 'diff'
import { encodeEdit, decodeEdit, parseHunks, restoreDocument, packChanges, editOperations, restoreOperations } from './git-doc-compression-benchmark.ts'

test('exact document deltas retain negation, numeric changes, links and Markdown whitespace', () => {
  const examples: [string, string][] = [
    ['접근을 허용한다.\n', '접근을 허용하지 않는다.\n'],
    ['timeout >= 30\n', 'timeout > 300\n'],
    ['[안내](old.md#one)\n', '[안내](new.md#two)\n'],
    ['- one\n- two\n', '- one\n\n- two\n'],
    ['line  \nnext\n', 'line\nnext\n'],
    ['    nested code\n', 'nested code\n'],
    ['```sh\necho false\n```\n', '```sh\necho true\n```\n'],
    ['| key | value |\n| --- | --- |\n| allow | yes |\n', '| key | value |\n| --- | --- |\n| allow | no |\n'],
    ['<!-- mew:implementation:start -->\ntext\n', '<!-- mew:validation:start -->\ntext\n'],
    ['🌍 한글 é\r\n끝', '🌎 한글 é\r\n끝\n'],
    ['', '# New\n\nbody\n'],
    ['# Old\nbody', ''],
    ['\n', ''],
    ['old', 'old\n'],
    ['last\n', 'last'],
  ]
  for (const [before, after] of examples) {
    assert.deepEqual(decodeEdit(encodeEdit(before, after)), [before, after])
    assert.equal(restoreOperations(before, editOperations(before, after)), after)
    const hunks = parseHunks(createTwoFilesPatch('old', 'new', before, after, '', '', { context: 0 }))
    assert.equal(restoreDocument(before, hunks), after)
  }
})

test('multiple disjoint hunks reconstruct the full new document with unchanged surroundings', () => {
  const before = '# old\n\nunchanged\n\nallow\n\nuntouched\n\nend'
  const after = '# new\n\nunchanged\n\ndeny\n\nuntouched\n\nend\n'
  const hunks = parseHunks(createTwoFilesPatch('old', 'new', before, after, '', '', { context: 0 }))
  assert.ok(hunks.length >= 3)
  assert.equal(restoreDocument(before, hunks.map(h => ({ ...h, edit: encodeEdit(...decodeEdit(h.edit)) }))), after)
  assert.throws(() => restoreDocument('different\n', hunks))
})

test('one identical edit definition accounts for every file and retains file modes', () => {
  const before = 'A common and sufficiently long policy sentence with unchanged surrounding context. Access allowed.\n'
  const after = before.replace('Access allowed.', 'Access denied.')
  const hunks = parseHunks(createTwoFilesPatch('old', 'new', before, after, '', '', { context: 0 }))
  const files = Array.from({ length: 20 }, (_, id) => ({ path: `docs/정책 "${id}".md`, before, after, oldMode: '100644', newMode: id === 0 ? '100755' : '100644', hunks }))
  const packed = packChanges(files, true, true)
  assert.equal(packed.files.length, files.length)
  assert.equal(packed.definitions.length, 1)
  assert.deepEqual(packed.files[0].mode, ['100644', '100755'])
  assert.ok(packed.files.every(file => file.hunks[0].edit === 0))
  assert.ok(JSON.stringify(packed).length < JSON.stringify(packChanges(files, false, false)).length / 2)
})

test('deterministic mutations preserve insertions, deletions, repeated text and Unicode', () => {
  let seed = 20261004
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  const alphabet = ['허용', '금지', 'false', 'true', '  ', '\t', '\n', '🌏', '[x](a.md)', '``', '\r']
  for (let run = 0; run < 60; run++) {
    const before = Array.from({ length: 35 }, () => alphabet[next() % alphabet.length]).join('')
    const start = next() % (before.length + 1), end = start + next() % (before.length - start + 1)
    const after = before.slice(0, start) + alphabet[next() % alphabet.length] + before.slice(end)
    const edit = encodeEdit(before, after)
    assert.deepEqual(decodeEdit(edit), [before, after])
    assert.equal(restoreOperations(before, editOperations(before, after)), after)
    const hunks = parseHunks(createTwoFilesPatch('old', 'new', before, after, '', '', { context: 0 }))
    assert.equal(restoreDocument(before, hunks), after)
  }
})
