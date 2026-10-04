import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DocumentPages } from './document-pages.ts'
import { documentPageLabel, rewritePageLinks, pageRepresentative } from '../shared/document-pages.ts'

function fixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-pages-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (file: string, body: string) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), body) }
  const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
  return { root, write, read, pages: new DocumentPages(root) }
}

test('document page labels present slug paths as natural names', () => {
  assert.equal(documentPageLabel('development/document-pages.md'), 'Document Pages')
  assert.equal(documentPageLabel('configuration/api-reference.md'), 'API Reference')
  assert.equal(documentPageLabel('features/mewcat-assistant.md'), 'Mewcat Assistant')
  assert.equal(documentPageLabel('MOC.md'), '')
  assert.equal(documentPageLabel('Docs/my API Notes.md'), 'my API Notes')
  assert.equal(documentPageLabel('Docs/한글 문서.md'), '한글 문서')
})

test('first child promotes a leaf, rebases links and preserves parent body; last child demotes it', t => {
  const { root, write, read, pages } = fixture(t)
  write('dev.md', '# Dev\n[asset](assets/file.png) [target](other.md#part)\n')
  write('MOC.md', '[dev](dev.md)\n'); write('other.md', 'Other')
  const created = pages.create('dev.md', 'access-control')
  assert.equal(created.path, 'dev/access-control.md')
  assert.deepEqual(created.moves, [{ from: 'dev.md', to: 'dev/_dev.md' }])
  assert.equal(fs.existsSync(path.join(root, 'dev.md')), false)
  assert.equal(read('dev/_dev.md'), '# Dev\n[asset](../assets/file.png) [target](../other.md#part)\n')
  assert.equal(read('MOC.md'), '[dev](dev/_dev.md)\n')
  pages.create('dev', 'nested')
  pages.create('dev/nested.md', 'child')
  assert.equal(fs.existsSync(path.join(root, 'dev/nested/_nested.md')), true)
  pages.delete('dev/nested')
  const deleted = pages.delete(created.path)
  assert.deepEqual(deleted.moves, [{ from: 'dev/_dev.md', to: 'dev.md' }])
  assert.equal(fs.existsSync(path.join(root, 'dev')), false)
  assert.equal(read('dev.md'), '# Dev\n[asset](assets/file.png) [target](other.md#part)\n')
  assert.equal(read('MOC.md'), '[dev](dev.md)\n')
})

test('legacy folder opens its MOC without mutation; modifying it normalizes the representative', t => {
  const { root, write, read, pages } = fixture(t)
  write('development/MOC.md', '# Development\n[access](access.md)\n')
  write('development/access.md', '[parent](MOC.md)')
  write('MOC.md', '[development](development/MOC.md)')
  assert.equal(pageRepresentative('development', [{ name: 'MOC.md', type: 'file' }])!.name, 'MOC.md')
  const result = pages.create('development', 'new')
  assert.equal(fs.existsSync(path.join(root, 'development/MOC.md')), false)
  assert.equal(read('development/_development.md'), '# Development\n[access](access.md)\n')
  assert.equal(read('development/access.md'), '[parent](_development.md)')
  assert.equal(read('MOC.md'), '[development](development/_development.md)')
  assert.equal(result.moves[0].from, 'development/MOC.md')
  const renamed = pages.rename('development', 'dev')
  assert.equal(renamed.path, 'dev/_dev.md')
  assert.equal(read('dev/_dev.md'), '# Development\n[access](access.md)\n')
  assert.equal(read('dev/access.md'), '[parent](_dev.md)')
  assert.equal(read('MOC.md'), '[development](dev/_dev.md)')
})

test('collisions, denied destinations, archives and path escapes leave source files intact', t => {
  const { root, write, read, pages } = fixture(t)
  write('dev.md', 'Keep'); write('dev/other.md', 'Other')
  assert.throws(() => pages.create('dev.md', 'child'))
  assert.equal(read('dev.md'), 'Keep')
  assert.throws(() => pages.create('../dev.md', 'child'))
  write('archives/old.md', 'Immutable')
  assert.throws(() => pages.create('archives/old.md', 'child'))
  write('private.md', 'Private')
  const denied = new DocumentPages(root, rel => !rel.startsWith('private/'))
  assert.throws(() => denied.create('private.md', 'child'))
  assert.equal(read('private.md'), 'Private')
  assert.equal(fs.readdirSync(root).some(name => name.startsWith('.page-operation-')), false)
})

test('link rewriting respects code/frontmatter, references, spaces and nested paths', () => {
  const content = '---\nexample: "[x](dev.md)"\n---\n[dev](dev.md#h) ![asset](<media/img one.png>)\n\n```md\n[dev](dev.md)\n```\n\n`[dev](dev.md)`\n\n[ref]: dev.md "title"\n'
  const result = rewritePageLinks(content, 'index.md', 'index.md', [{ from: 'dev.md', to: 'dev/_dev.md' }])
  assert.ok(result.includes('[dev](dev/_dev.md#h)'))
  assert.ok(result.includes('[ref]: dev/_dev.md "title"'))
  assert.ok(result.includes('`[dev](dev.md)`'))
  assert.ok(result.includes('example: "[x](dev.md)"'))
  assert.ok(result.includes('```md\n[dev](dev.md)\n```'))
  const moved = rewritePageLinks('[asset](<media/img one.png>)', 'dev.md', 'dev/_dev.md', [])
  assert.equal(moved, '[asset](<../media/img%20one.png>)')
  assert.equal(rewritePageLinks('[[dev#part|Dev]] `[[dev]]`', 'index.md', 'index.md', [{ from: 'dev.md', to: 'dev/_dev.md' }]), '[[dev/_dev.md#part|Dev]] `[[dev]]`')
})

test('moving the last child into a leaf promotes its destination and demotes its old parent', t => {
  const { root, write, read, pages } = fixture(t)
  write('dev/_dev.md', '[child](child.md)'); write('dev/child.md', '[parent](_dev.md) [target](../notes.md)')
  write('notes.md', 'Notes'); write('index.md', '[parent](dev/_dev.md) [child](dev/child.md) [notes](notes.md)')
  const result = pages.move('dev/child.md', 'notes.md')
  assert.equal(result.path, 'notes/child.md')
  assert.equal(fs.existsSync(path.join(root, 'dev')), false)
  assert.equal(read('dev.md'), '[child](notes/child.md)')
  assert.equal(read('notes/child.md'), '[parent](../dev.md) [target](_notes.md)')
  assert.equal(read('index.md'), '[parent](dev.md) [child](notes/child.md) [notes](notes/_notes.md)')
})

test('copying a parent keeps the original links and renames its copied representative', t => {
  const { write, read, pages } = fixture(t)
  write('dev/_dev.md', '[child](child.md) [external](../other.md)')
  write('dev/child.md', '[parent](_dev.md)'); write('other.md', '[original](dev/_dev.md)')
  const result = pages.move('dev', '', true)
  assert.equal(result.path, 'dev copy/_dev copy.md')
  assert.equal(read(result.path), '[child](child.md) [external](../other.md)')
  assert.equal(read('dev copy/child.md'), '[parent](_dev%20copy.md)')
  assert.equal(read('other.md'), '[original](dev/_dev.md)')
  const next = pages.move('dev', '', true)
  assert.equal(next.path, 'dev copy 2/_dev copy 2.md')
})

test('moving a legacy parent normalizes its representative and prevents recursive destinations', t => {
  const { write, read, pages } = fixture(t)
  write('dev/MOC.md', '[child](child.md)'); write('dev/child.md', '[parent](MOC.md)')
  write('notes/_notes.md', 'Notes'); write('index.md', '[dev](dev/MOC.md)')
  assert.throws(() => pages.move('dev', 'dev/child.md'))
  const result = pages.move('dev', 'notes')
  assert.equal(result.path, 'notes/dev/_dev.md')
  assert.equal(read(result.path), '[child](child.md)')
  assert.equal(read('notes/dev/child.md'), '[parent](_dev.md)')
  assert.equal(read('index.md'), '[dev](notes/dev/_dev.md)')
})

test('a disk failure during link writes restores the complete promotion', t => {
  const { root, write, read, pages } = fixture(t)
  write('dev.md', '[other](other.md)'); write('other.md', '[dev](dev.md)')
  const original = fs.writeFileSync
  let fail = true
  t.mock.method(fs, 'writeFileSync', (...args: Parameters<typeof fs.writeFileSync>) => {
    if (fail && String(args[0]) === path.join(root, 'other.md')) { fail = false; throw new Error('simulated disk failure') }
    return original(...args)
  })
  assert.throws(() => pages.create('dev.md', 'child'), /simulated disk failure/)
  assert.equal(read('dev.md'), '[other](other.md)')
  assert.equal(read('other.md'), '[dev](dev.md)')
  assert.equal(fs.existsSync(path.join(root, 'dev')), false)
})

test('representative conflicts discovered after a directory move or copy restore all original content', t => {
  const { root, write, read, pages } = fixture(t)
  write('dev/_dev.md', 'Parent'); write('dev/_renamed.md', 'Existing child'); write('dev/_dev copy.md', 'Copy conflict')
  assert.throws(() => pages.rename('dev', 'renamed'))
  assert.equal(read('dev/_dev.md'), 'Parent')
  assert.equal(read('dev/_renamed.md'), 'Existing child')
  assert.equal(fs.existsSync(path.join(root, 'renamed')), false)
  assert.throws(() => pages.move('dev', '', true))
  assert.equal(read('dev/_dev copy.md'), 'Copy conflict')
  assert.equal(fs.existsSync(path.join(root, 'dev copy')), false)
})


test('natural page names survive promotion, rename and demotion with valid encoded links', t => {
  const { write, read, pages } = fixture(t)
  write('my API Notes.md', '# Notes'); write('MOC.md', '[notes](<my API Notes.md#intro>)')
  const child = pages.create('my API Notes.md', '한글 가이드 (초안)')
  assert.equal(child.path, 'my API Notes/한글 가이드 (초안).md')
  pages.rename('my API Notes', '한글 API (홈)')
  assert.equal(read('MOC.md'), '[notes](<%ED%95%9C%EA%B8%80%20API%20%28%ED%99%88%29/_%ED%95%9C%EA%B8%80%20API%20%28%ED%99%88%29.md#intro>)')
  pages.delete('한글 API (홈)/한글 가이드 (초안).md')
  assert.equal(read('한글 API (홈).md'), '# Notes')
  assert.equal(read('MOC.md'), '[notes](<%ED%95%9C%EA%B8%80%20API%20%28%ED%99%88%29.md#intro>)')
})
