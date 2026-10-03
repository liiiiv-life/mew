import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { connectDocuments, documentLinks, DocumentGraphIndex } from './document-graph.ts'

const doc = (name: string, links: string[] = []) => ({ node: { path: name, title: name, group: '' }, links })

test('graph parses actual links, references and wiki links without code/image/frontmatter edges', () => {
  const content = '---\ntitle: "My doc"\nexample: "[fake](frontmatter.md)"\n---\n[a](<space name.md#heading>) [r][ref] ![image](image.md) `[[code]]`\n\n```md\n[fake](fence.md)\n```\n\n[ref]: folder/next.md "Title"\n\n[[Wiki#heading|label]] [unicode](%ED%95%9C%EA%B8%80.md)'
  const parsed = documentLinks(content)
  assert.equal(parsed.title, 'My doc')
  assert.deepEqual(parsed.links, ['space%20name.md#heading', 'folder/next.md', 'wiki:Wiki#heading', '%ED%95%9C%EA%B8%80.md'])
  const graph = connectDocuments([doc('start.md', parsed.links), doc('space name.md'), doc('folder/next.md'), doc('Wiki.md'), doc('한글.md')])
  assert.deepEqual(graph.edges, [[0, 1], [0, 2], [0, 3], [0, 4]])
})

test('graph resolves relative/root links, deduplicates directed edges and rejects escapes/unknowns', () => {
  const graph = connectDocuments([
    doc('a/start.md', ['../end.md#one', '../end.md?x=1', '/end.md', '../../escape.md', 'https://host/end.md', 'mailto:a@b', '#self', 'start.md', '%ZZ', 'missing.md', 'wiki:duplicate']),
    doc('end.md', ['a/start.md']), doc('x/duplicate.md'), doc('y/duplicate.md'), doc('alone.md'),
  ])
  assert.deepEqual(graph.edges, [[0, 1], [1, 0]])
  assert.equal(graph.nodes.length, 5, 'unlinked documents are present')
})

test('incremental graph handles edits/deletes, access projection, workspace handoff and symlink escapes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-graph-index-'))
  try {
    await fs.mkdir(path.join(root, 'docs'))
    const dir = path.join(root, 'docs'), files = ['start.md', 'private.md', 'next.md']
    await fs.writeFile(path.join(dir, 'start.md'), '[private](private.md) [next](next.md)')
    await fs.writeFile(path.join(dir, 'private.md'), '---\ntitle: Secret title\n---\n[back](start.md)')
    await fs.writeFile(path.join(dir, 'next.md'), '---\ntitle: Public title\n---')
    await fs.writeFile(path.join(root, 'outside.md'), 'outside secret')
    await fs.symlink(path.join(root, 'outside.md'), path.join(dir, 'escape.md'))
    const index = new DocumentGraphIndex()
    assert.equal((await index.read(dir, files, () => true)).edges.length, 3)
    const limited = await index.read(dir, [...files, 'escape.md'], rel => rel !== 'private.md')
    assert.deepEqual(limited.nodes.map(node => node.path), ['next.md', 'start.md'])
    assert.deepEqual(limited.edges, [[1, 0]])
    await fs.writeFile(path.join(dir, 'start.md'), '[self](start.md)')
    index.invalidate(['start.md'])
    assert.deepEqual((await index.read(dir, files, rel => rel !== 'private.md')).edges, [])
    await fs.unlink(path.join(dir, 'next.md'))
    assert.equal((await index.read(dir, ['start.md'], () => true)).nodes.length, 1)
    await fs.mkdir(path.join(root, 'other'))
    await fs.writeFile(path.join(root, 'other', 'start.md'), '---\ntitle: Other workspace\n---')
    assert.equal((await index.read(path.join(root, 'other'), ['start.md'], () => true)).nodes[0].title, 'Other workspace')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
