import '../test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../dataDir.ts'
import { readRagSettings, saveRagSettings, parseRagSettings, ragEnabled } from './settings.ts'
import { describeAgentContext } from '../project-context-text.ts'
import { defaultAgentSettings } from '../project-agent-settings.ts'
import { ragCli } from './cli.ts'

test('shared RAG preferences reach every project, respect project opt-out and environment override', async () => {
  delete process.env.MEW_RAG_ENABLED
  assert.deepEqual(readRagSettings(), { enabled: true, agentGuidance: true, environmentDisabled: false })
  const settingsFile = path.join(DATA_DIR, 'rag-settings.json')
  for (const name of ['alpha', "beta'$(touch must-not-run)"]) {
    const root = path.join(DATA_DIR, name), docsRoot = path.join(root, 'docs')
    fs.mkdirSync(docsRoot, { recursive: true })
    const binding = { projectRoot: root, docsRoot }
    const text = () => describeAgentContext(binding, defaultAgentSettings(), root)
    saveRagSettings({ enabled: true, agentGuidance: true })
    assert.match(text(), /Local RAG is available/)
    assert.ok(text().includes(root.replace(/'/g, "'\\''")), 'the command must shell-quote project paths')
    assert.equal(describeAgentContext(binding, { ...defaultAgentSettings(), enabled: false }, root), '')
    saveRagSettings({ enabled: true, agentGuidance: false })
    assert.doesNotMatch(text(), /Local RAG is available/)
    assert.equal(ragEnabled(), true)
    saveRagSettings({ enabled: false, agentGuidance: true })
    assert.equal(ragEnabled(), false)
    assert.doesNotMatch(text(), /Local RAG is available/)
    await assert.rejects(ragCli([DATA_DIR, root, docsRoot], JSON.stringify({ query: 'test', project: 'docs' })), /disabled/)
  }
  saveRagSettings({ enabled: true, agentGuidance: true })
  process.env.MEW_RAG_ENABLED = '0'
  assert.equal(readRagSettings().environmentDisabled, true)
  assert.equal(ragEnabled(), false)
  delete process.env.MEW_RAG_ENABLED
  assert.throws(() => parseRagSettings({ enabled: 'false', agentGuidance: true }))
  fs.writeFileSync(settingsFile, '{broken')
  assert.throws(() => saveRagSettings({ enabled: true, agentGuidance: true }))
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), '{broken')
})
