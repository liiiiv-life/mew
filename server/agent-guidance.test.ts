import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './dataDir.ts'
import { AGENT_GUIDANCE_PATH, ensureAgentGuidance, readAgentGuidance } from './agent-guidance.ts'
import { agentContextText } from './agent-context.ts'
import { describeAgentContext } from './project-context-text.ts'
import { defaultAgentSettings, writeProjectAgentSettings } from './project-agent-settings.ts'
import { readExternalFile, writeExternalFile } from './fsBrowse.ts'

test('shared guidance survives initialization and editor changes reach every project on the next request', () => {
  const a = path.join(DATA_DIR, 'a'), b = path.join(DATA_DIR, 'b')
  for (const root of [a, b]) fs.mkdirSync(root)
  const binding = (root: string) => ({ projectRoot: root, docsRoot: path.join(root, 'docs') })
  const preview = describeAgentContext(binding(a), defaultAgentSettings(), a)
  assert.match(preview, /You are working through mew/)
  assert.equal(fs.existsSync(AGENT_GUIDANCE_PATH), false, 'preview must not initialize state')
  agentContextText(binding(a), a)
  assert.match(readExternalFile(AGENT_GUIDANCE_PATH).content, /You are working through mew/)

  writeExternalFile(AGENT_GUIDANCE_PATH, 'Shared edited guidance')
  ensureAgentGuidance()
  assert.equal(readAgentGuidance(), 'Shared edited guidance', 'initialization preserves edits')
  writeProjectAgentSettings(a, { ...defaultAgentSettings(), instructions: 'Only project A' })
  for (const root of [a, b]) {
    const text = agentContextText(binding(root), root)
    assert.match(text, /Shared edited guidance/)
    assert.ok(text.includes(`Project root: ${JSON.stringify(root)}`))
    assert.equal(text.includes('Only project A'), root === a)
    assert.ok(!text.includes('You are working through mew'))
  }
  writeExternalFile(AGENT_GUIDANCE_PATH, '')
  assert.equal(readAgentGuidance(), '')
  assert.match(agentContextText(binding(b), b), /Project root:/)
  fs.unlinkSync(AGENT_GUIDANCE_PATH)
  fs.mkdirSync(AGENT_GUIDANCE_PATH)
  assert.throws(() => agentContextText(binding(b), b), 'read errors must not silently substitute the template')
  writeProjectAgentSettings(b, { ...defaultAgentSettings(), enabled: false })
  assert.equal(agentContextText(binding(b), b), '', 'disabled guidance does not read the file')
  fs.rmdirSync(AGENT_GUIDANCE_PATH)
  ensureAgentGuidance()
  assert.match(readAgentGuidance(), /You are working through mew/)
})
