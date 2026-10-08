import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DocumentBacklinkIndex } from './document-backlinks.ts'
import { DocumentLinkIndex } from './document-link-index.ts'
import { DocumentGraphIndex } from './document-graph.ts'

test('graph and backlinks share parses; real links, cross-project paths and parent exclusion', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-backlinks-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const docs = path.join(root, 'one'), other = path.join(root, 'two')
  await fs.mkdir(docs); await fs.mkdir(other)
  const target = path.join(docs, '한 글.md'), parent = path.join(docs, 'parent.md')
  await fs.writeFile(target, '---\ntitle: Target\n상위파일: parent.md\n---\n[self](%ED%95%9C%20%EA%B8%80.md)')
  await fs.writeFile(parent, '[child](%ED%95%9C%20%EA%B8%80.md)')
  await fs.writeFile(path.join(docs, 'metadata.md'), '---\ntitle: Metadata only\n상위파일: "한 글.md"\n---\nNo body link')
  await fs.writeFile(path.join(docs, 'reference.md'), '---\ntitle: Reference\n---\n[r][id]\n\n[id]: <%ED%95%9C%20%EA%B8%80.md#section>\n\n[[한 글|alias]]')
  const external = path.join(other, 'external.md')
  await fs.writeFile(external, `---\ntitle: External\n---\n[relative](<../one/한 글.md?x=1>) [absolute](${pathToFileURL(target).href})`)
  await fs.writeFile(path.join(other, 'fake.md'), '![image](../one/한%20글.md) `[code](../one/한%20글.md)`\n\n```md\n[code](../one/한%20글.md)\n```')
  const links = new DocumentLinkIndex(), index = new DocumentBacklinkIndex(links)
  const parsed = await links.read(target)
  const graph = new DocumentGraphIndex(links)
  await graph.read(docs, ['한 글.md', 'parent.md', 'reference.md', 'metadata.md'], () => true)
  assert.equal(await links.read(target), parsed, 'graph reused the same cached parse')
  const result = await index.read(target, [docs, other], () => true)
  assert.deepEqual(result.documents.map(doc => doc.title), ['External', 'Reference'])
  assert.equal(result.skipped, 0)
  assert.deepEqual(result.parents, [{path: parent, title:'parent'}])
  assert.deepEqual((await index.read(target, [docs, other], source => source !== parent)).parents, [], 'unreadable parents are not returned')
  assert.equal(await links.read(target), parsed, 'backlinks reused the same cached parse')
  assert.deepEqual((await index.read(target, [docs, other], source => source !== external)).documents.map(doc => doc.title), ['Reference'])
  await fs.writeFile(path.join(docs, 'reference.md'), '[other](parent.md)')
  links.invalidate([path.join(docs, 'reference.md')])
  assert.deepEqual((await index.read(target, [docs, other], () => true)).documents.map(doc => doc.title), ['External'])
  await fs.unlink(external)
  assert.deepEqual((await index.read(target, [docs, other], () => true)).documents, [])
  await fs.writeFile(target, '---\ntitle: Target\n상위파일: ["[Parent](parent.md)"]\n---\n')
  assert.deepEqual((await index.read(target, [docs], () => true)).documents, [], 'Markdown parent metadata is also excluded')
  await fs.writeFile(target, '---\ntitle: Target\n상위파일: []\n---\n')
  assert.deepEqual((await index.read(target, [docs], () => true)).documents.map(doc => path.basename(doc.path)), ['parent.md'])
})

test('new, renamed, denied and oversized documents never leave stale reverse edges', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-backlinks-changes-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const target = path.join(root, 'target.md'), source = path.join(root, 'source.md')
  await fs.writeFile(target, 'Target')
  const index = new DocumentBacklinkIndex()
  assert.deepEqual((await index.read(target, [root], () => true)).documents, [])
  await fs.writeFile(source, '[target](target.md)')
  assert.equal((await index.read(target, [root], () => true)).documents.length, 1)
  const renamed = path.join(root, 'renamed.md')
  await fs.rename(source, renamed)
  assert.deepEqual((await index.read(target, [root], () => true)).documents.map(doc => doc.path), [renamed])
  assert.deepEqual((await index.read(target, [root], file => file !== renamed)).documents, [])
  await fs.writeFile(path.join(root, 'large.md'), '[target](target.md)' + ' '.repeat(8 * 1024 * 1024))
  assert.equal((await index.read(target, [root], () => true)).skipped, 1)
})

test('parent navigation resolves external metadata without adding external search roots', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-parent-navigation-'))
  t.after(() => fs.rm(root, {recursive:true, force:true}))
  const docs = path.join(root, 'docs'); await fs.mkdir(docs)
  const target = path.join(docs, 'target.md'), parent = path.join(root, 'parent.md')
  await fs.writeFile(parent, '---\ntitle: External parent\n---\n')
  await fs.writeFile(target, '---\n상위파일: ["../parent.md", "../missing.md", "../parent.md"]\n---\n')
  const index = new DocumentBacklinkIndex()
  assert.deepEqual((await index.read(target, [docs], () => true)).parents, [{path:parent,title:'External parent'}])
  assert.deepEqual((await index.read(target, [docs], () => true, () => false)).parents, [])
})
