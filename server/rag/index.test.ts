import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { RagIndex } from './index.ts'
import type { EmbeddingProvider } from './types.ts'

class FakeEmbedding implements EmbeddingProvider {
  fail = false
  readonly id = 'fake-v1'
  readonly dimensions = 3

  private vector(text: string): number[] {
    const lower = text.toLowerCase()
    const raw = [Number(lower.includes('moc')), Number(lower.includes('history') || lower.includes('과거')), 0.1]
    const norm = Math.hypot(...raw)
    return raw.map((value) => value / norm)
  }

  async embedPassages(texts: string[]): Promise<number[][]> {
    if (this.fail) throw new Error('model unavailable')
    return texts.map((text) => this.vector(text))
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.vector(text)
  }
}

test('current 기본 검색·history opt-in·증분 갱신', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-rag-workspace-'))
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-rag-data-'))
  const docs = path.join(workspace, '.mew', 'docs')
  fs.mkdirSync(docs, { recursive: true })
  fs.writeFileSync(path.join(docs, 'MOC.md'), '## Current\n- [현재](current.md)\n\n## History / raw\n- [과거](old.md)\n')
  fs.writeFileSync(path.join(docs, 'current.md'), '# MOC 구조\n현재 라우터 결정')
  fs.writeFileSync(path.join(docs, 'old.md'), '# history\n과거 단일 목록')
  const files = ['MOC.md', 'current.md', 'old.md']
  try {
    const embedding = new FakeEmbedding()
    const index = new RagIndex(workspace, embedding, data)
    const current = await index.search('docs', files, 'MOC', false)
    assert.ok(current.results.length > 0)
    assert.ok(current.results.every((result) => result.tier === 'current'))

    assert.deepEqual(index.documents('docs', ['current.md']).map(file => file.path), ['current.md'])
    assert.equal(index.status('docs').engine, 'LanceDB')
    const other = new RagIndex(workspace, new FakeEmbedding(), data)
    await Promise.all([index.search('docs', files, 'MOC'), other.search('docs', files, 'history')])
    assert.equal(other.status('docs').indexedFiles, 3)

    embedding.fail = true
    await assert.rejects(index.ensureProject('docs', files, true), /model unavailable/)
    embedding.fail = false
    const preserved = await index.search('docs', files, 'MOC')
    assert.ok(preserved.results.length > 0, 'a failed rebuild must preserve the previous index')
    assert.equal(preserved.updatedFiles, 0)

    const history = await index.search('docs', files, 'history', true)
    assert.ok(history.results.some((result) => result.path === 'old.md'))

    fs.writeFileSync(path.join(docs, 'current.md'), '# MOC 구조\n현재 라우터 결정 변경')
    const updated = await index.search('docs', files, 'MOC', false)
    assert.equal(updated.updatedFiles, 1)
    assert.match(updated.results.find((result) => result.path === 'current.md')?.text ?? '', /변경/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
    fs.rmSync(data, { recursive: true, force: true })
  }
})
