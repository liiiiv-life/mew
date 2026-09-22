import '../test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { attachCollabAgents } from '../collabAgent.ts'
import { DATA_DIR } from '../dataDir.ts'
import { LocalE5Embeddings } from './embeddings.ts'
import { RagIndex } from './index.ts'

test('RAG loads after the real collaboration DOM setup; cached-model smoke test indexes and rebuilds Docs', { timeout: 30_000 }, async () => {
  const globals = globalThis as unknown as Record<string, unknown>
  attachCollabAgents()
  const deadline = Date.now() + 5000
  while (!globals.document && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(globals.document)
  assert.equal(globals.self, globals.window, 'the server DOM must expose the matching window.self')
  const { env, pipeline } = await import('@huggingface/transformers')
  assert.equal(typeof pipeline, 'function', 'the real package must load after collaboration initializes the DOM')
  assert.equal(env.useFSCache, true)

  // Opt-in real inference never downloads a model or indexes a user's documents.
  const cache = process.env.MEW_RAG_TEST_MODEL_CACHE
  if (!cache) return
  env.allowRemoteModels = false
  const workspace = path.join(DATA_DIR, 'workspace'), docs = path.join(workspace, 'docs')
  fs.mkdirSync(docs, { recursive: true })
  fs.writeFileSync(path.join(docs, 'search.md'), '# 문서 검색\nRAG는 Docs 문서를 색인하고 관련 원문을 찾습니다.')
  const embedding = new LocalE5Embeddings(undefined, cache)
  const index = new RagIndex(workspace, embedding, DATA_DIR)
  const initial = await index.ensureProject('docs', ['search.md'], true)
  assert.equal(initial.files, 1); assert.ok(initial.chunks > 0)
  const vector = await embedding.embedQuery('문서 검색')
  assert.equal(vector.length, 384); assert.ok(vector.every(Number.isFinite))
  const search = await index.search('docs', ['search.md'], '문서 검색')
  assert.equal(search.results[0]?.path, 'search.md')
  const rebuilt = await index.ensureProject('docs', ['search.md'], true)
  assert.equal(rebuilt.files, 1); assert.equal(rebuilt.chunks, initial.chunks)
})
