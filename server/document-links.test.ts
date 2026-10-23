import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { documentLinkErrors } from './document-links.ts'

function fixture(t: { after(fn: () => void): void }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-document-links-'))
  fs.mkdirSync(path.join(root, 'docs'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

test('checks repository links, encoded paths, reference links and frontmatter parents', t => {
  const root = fixture(t)
  fs.writeFileSync(path.join(root, 'docs', '문서 이름.md'), '# Target')
  fs.writeFileSync(path.join(root, 'README.md'), '[문서](docs/문서%20이름.md#heading)\n[문서][guide]\n[guide]: <docs/문서 이름.md>\n[Web](https://example.com)\n[Heading](#heading)')
  fs.writeFileSync(path.join(root, 'docs', 'child.md'), '---\n상위파일:\n  - "문서 이름.md"\n  - "missing-parent.md"\n---\n[문서](문서 이름.md)\n[Missing](missing.md)')
  assert.deepEqual(documentLinkErrors(root), [
    'docs/child.md: missing-parent.md: missing target',
    'docs/child.md: missing.md: missing target',
  ])
})

test('rejects parent workspace dependencies, absolute paths and symlink escapes', t => {
  const root = fixture(t)
  fs.symlinkSync(os.tmpdir(), path.join(root, 'docs', 'outside'))
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '[Parent](../AGENTS.md)\n[Absolute](/tmp)\n[File](file:///tmp)\n[Windows](C:\\workspace\\rules.md)\n[Link](docs/outside)')
  const errors = documentLinkErrors(root)
  assert.equal(errors.length, 5)
  assert.ok(errors.some(error => error.includes('../AGENTS.md: outside repository')))
  assert.ok(errors.some(error => error.includes('symlink target outside repository')))
})

test('ignores example links in code and comments and excludes hidden and archive documents', t => {
  const root = fixture(t)
  fs.writeFileSync(path.join(root, 'README.md'), '````md\n[Example](missing.md)\n```\n[Example](also-missing.md)\n````\n`[Example](missing.md)`\n<!-- [Example](missing.md) -->')
  for (const directory of ['.vendor', 'archives']) {
    fs.mkdirSync(path.join(root, 'docs', directory))
    fs.writeFileSync(path.join(root, 'docs', directory, 'source.md'), '[Source](missing.md)')
  }
  assert.deepEqual(documentLinkErrors(root, true), [])
})

test('checks history only when requested and does not require a MOC', t => {
  const root = fixture(t)
  fs.mkdirSync(path.join(root, 'docs', 'history'))
  fs.writeFileSync(path.join(root, 'docs', 'history', 'old.md'), '[Source](missing.md)')
  assert.deepEqual(documentLinkErrors(root), [])
  assert.deepEqual(documentLinkErrors(root, true), ['docs/history/old.md: missing.md: missing target'])
})
