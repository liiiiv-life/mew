import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { encodePatch, decodeParts, packDiffChunks, parseCoverageNotes } from './git-commit-packets.ts'

test('exact encoding preserves negation, Markdown context, CRLF, EOF markers and split Unicode lines', () => {
  const common = '사용자와 공유하는 긴 문장과 경로 [안내](../docs/index.md)를 유지한다. '.repeat(15)
  const cases = [
    `Path: "한글.md"\n@@ -1 +1 @@\n-${common}허용한다.\r\n+${common}허용하지 않는다.\r\n unchanged context\n`,
    '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-before\n\\ No newline at end of file\n+after\n\\ No newline at end of file\n',
    '+반복🙂\r\n'.repeat(30) + '+FINAL_SENTINEL',
    '🙂'.repeat(24_000),
  ]
  for (const text of cases) assert.equal(decodeParts(encodePatch(text)), text)
  assert.ok(JSON.stringify(encodePatch(cases[0])).length < cases[0].length * 0.7)
  assert.ok(JSON.stringify(encodePatch(cases[2])).length < cases[2].length * 0.3)
  for (let seed = 0; seed < 100; seed++) {
    const text = Array.from({ length: 100 }, (_, i) => `${['+', '-', ' ', '@', '\\'][((seed * 17 + i * 23) % 5)]}${'🙂\t\r한글"'.repeat((seed + i) % 8)}${i % 7 ? '\n' : ''}`).join('')
    assert.equal(decodeParts(encodePatch(text)), text)
  }
})

test('packet capacity splits complete unique evidence while shared replacements use dictionary references', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-packets-'))
  try {
    const common = 'identical shared explanation '.repeat(40)
    const chunks = Array.from({ length: 30 }, (_, id) => {
      const file = path.join(directory, `${id}.txt`)
      fs.writeFileSync(file, `Path: "${id}.md"\n@@ -1 +1 @@\n-${common}allowed\n+${common}denied\n`)
      return { id, file, paths: [`${id}.md`] }
    })
    const packets = packDiffChunks(chunks, 6000)
    assert.equal(packets.length, 1)
    assert.ok(packets[0].definitions.length)
    for (const packet of packets) for (const source of packet.sources) {
      const decoded = decodeParts(source.parts.map(part => typeof part === 'number' ? packet.definitions[part] : part))
      assert.equal(decoded, fs.readFileSync(chunks[source.id].file, 'utf8'))
    }
    for (const chunk of chunks) fs.writeFileSync(chunk.file, `Path: "${chunk.id}.md"\n@@ -0,0 +1,25 @@\n${Array.from({ length: 25 }, (_, i) => `+shared added requirement ${i}\n`).join('')}`)
    const additions = packDiffChunks(chunks, 6000)
    assert.equal(additions.length, 1)
    assert.ok(additions[0].definitions.length, 'repeated new content shares definitions across different filenames')
    for (const source of additions[0].sources) assert.equal(decodeParts(source.parts.map(part => typeof part === 'number' ? additions[0].definitions[part] : part)), fs.readFileSync(chunks[source.id].file, 'utf8'))
    for (const chunk of chunks) fs.writeFileSync(chunk.file, `unique ${chunk.id}\n${Array.from({ length: 50 }, (_, i) => `+distinct ${chunk.id}-${i}\n`).join('')}`)
    const split = packDiffChunks(chunks, 3000)
    assert.ok(split.length > 1)
    assert.deepEqual(split.flatMap(packet => packet.sources.map(source => source.id)), chunks.map(chunk => chunk.id))
    assert.ok(split.every(packet => JSON.stringify(packet).length <= 3000))
    assert.throws(() => packDiffChunks(chunks, 10))
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('evidence notes require exact coverage, preserve long valid summaries and reject malformed uncertainty', () => {
  const output = { changes: [{ sources: [0, 1], summary: 'valid long evidence '.repeat(500), uncertainties: ['intent unresolved'] }] }
  assert.deepEqual(parseCoverageNotes(JSON.stringify(output), [0, 1]), output.changes)
  assert.throws(() => parseCoverageNotes(JSON.stringify(output), [0, 1, 2]))
  assert.throws(() => parseCoverageNotes(JSON.stringify(output), [0]))
  assert.throws(() => parseCoverageNotes(JSON.stringify({ changes: [...output.changes, ...output.changes] }), [0, 1]))
  assert.throws(() => parseCoverageNotes('{"changes":[{"sources":[0],"summary":"x","uncertainties":[3]}]}', [0]))
})
