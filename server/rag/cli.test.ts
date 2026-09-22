import '../test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DATA_DIR } from '../dataDir.ts'

test('real CLI uses captured data and custom Documents paths without requiring a model for an empty project', () => {
  const workspace = path.join(DATA_DIR, "project with 'quotes'"), docs = path.join(workspace, 'knowledge')
  fs.mkdirSync(docs, { recursive: true })
  fs.mkdirSync(path.join(workspace, 'docs'))
  fs.writeFileSync(path.join(workspace, 'docs/wrong.md'), 'The configured Documents directory must win.')
  const args = [fileURLToPath(new URL('./cli.ts', import.meta.url)), DATA_DIR, workspace, docs]
  const result = spawnSync(process.execPath, args, { input: JSON.stringify({ query: 'test', project: 'docs' }), encoding: 'utf8', timeout: 15_000, env: { ...process.env, MEW_RAG_ENABLED: '1' } })
  assert.equal(result.status, 0, result.stderr)
  const response = JSON.parse(result.stdout)
  assert.equal(response.root, docs)
  assert.deepEqual(response.results, [])
  assert.equal(response.indexedFiles, 0)
  assert.equal(fs.existsSync(path.join(DATA_DIR, 'rag/models')), false)
  const nonDocs = spawnSync(process.execPath, args, { input: JSON.stringify({ query: 'test', project: '.workspace' }), encoding: 'utf8', timeout: 15_000 })
  assert.equal(nonDocs.status, 1)
  assert.match(nonDocs.stderr, /scope must be docs/)
  const disabled = spawnSync(process.execPath, args, { input: JSON.stringify({ query: 'test', project: 'docs' }), encoding: 'utf8', timeout: 15_000, env: { ...process.env, MEW_RAG_ENABLED: '0' } })
  assert.equal(disabled.status, 1)
  assert.match(disabled.stderr, /disabled/)
})
