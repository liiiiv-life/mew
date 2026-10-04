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
import { guidanceOptions } from '../shared/agent-guidance.ts'

test('shared guidance survives initialization and editor changes reach every project on the next request', () => {
  const a = path.join(DATA_DIR, 'a'), b = path.join(DATA_DIR, 'b')
  for (const root of [a, b]) fs.mkdirSync(root)
  const binding = (root: string) => ({ projectRoot: root, docsRoot: path.join(root, 'docs') })
  const preview = describeAgentContext(binding(a), defaultAgentSettings(), a)
  assert.match(preview, /You are working through mew/)
  assert.match(preview, /Do not add source comments solely for commit summaries/)
  assert.match(preview, /git-change-intent-cli\.ts.*--cwd/)
  assert.match(preview, /JSON on stdin/)
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

test('legacy guidance migrates without changing its content, and Markdown takes precedence', () => {
  fs.rmSync(AGENT_GUIDANCE_PATH, { force: true })
  const legacy = path.join(DATA_DIR, 'agent-guidance.txt')
  fs.writeFileSync(legacy, 'My instructions\n\nKeep this formatting.\n')
  assert.equal(readAgentGuidance(), 'My instructions\n\nKeep this formatting.')
  assert.equal(fs.existsSync(AGENT_GUIDANCE_PATH), false)
  ensureAgentGuidance()
  assert.equal(fs.readFileSync(AGENT_GUIDANCE_PATH, 'utf8'), fs.readFileSync(legacy, 'utf8'))
  fs.writeFileSync(AGENT_GUIDANCE_PATH, '')
  assert.equal(readAgentGuidance(), '')
  ensureAgentGuidance()
  assert.equal(readAgentGuidance(), '')
  fs.rmSync(legacy)
})

test('settings preserve handwritten instructions, parse editor changes and reject stale writes', async () => {
  const { agentGuidanceSettings, updateAgentGuidance, GuidanceError } = await import('./agent-guidance.ts')
  const original = '# My instructions\n\nDo not deploy.\n'
  fs.writeFileSync(AGENT_GUIDANCE_PATH, original)
  let state = agentGuidanceSettings()
  assert.equal(state.settings.language, 'inherit')
  const stale = state.revision
  state = updateAgentGuidance({ key: 'language', value: 'ko', revision: state.revision })
  assert.ok(state.content.startsWith(original))
  assert.match(readAgentGuidance(), /Respond to the user in Korean/)
  assert.throws(() => updateAgentGuidance({ key: 'commit', value: 'always', revision: stale }), GuidanceError)
  state = updateAgentGuidance({ key: 'commit', value: 'always', revision: state.revision })
  assert.equal(state.settings.language, 'ko')
  const custom = state.content.replace('Respond to the user in Korean.', 'Use the language chosen for each project.')
  writeExternalFile(AGENT_GUIDANCE_PATH, custom, state.content)
  assert.throws(() => writeExternalFile(AGENT_GUIDANCE_PATH, 'stale', state.content), GuidanceError)
  state = agentGuidanceSettings()
  assert.equal(state.settings.language, 'custom')
  state = updateAgentGuidance({ key: 'detail', value: 'concise', revision: state.revision })
  assert.match(state.content, /Use the language chosen for each project/)
  state = updateAgentGuidance({ key: 'commit', value: 'inherit', revision: state.revision })
  assert.equal(state.settings.commit, 'inherit')
  assert.doesNotMatch(state.content, /After each completed change/)
  assert.throws(() => updateAgentGuidance({ key: '__proto__', value: 'always', revision: state.revision }), GuidanceError)
  for (const broken of [
    '<!-- mew:agent-setting:language -->Missing end',
    '<!-- mew:agent-setting:language -->x<!-- /mew:agent-setting:language --><!-- mew:agent-setting:language -->y<!-- /mew:agent-setting:language -->',
    '<!-- mew:agent-setting:language --><!-- mew:agent-setting:commit -->x<!-- /mew:agent-setting:language --><!-- /mew:agent-setting:commit -->',
  ]) {
    fs.writeFileSync(AGENT_GUIDANCE_PATH, broken)
    state = agentGuidanceSettings()
    assert.throws(() => updateAgentGuidance({ key: 'detail', value: 'detailed', revision: state.revision }), GuidanceError)
    assert.equal(fs.readFileSync(AGENT_GUIDANCE_PATH, 'utf8'), broken)
  }
})

test('subagent preferences preserve other guidance and reach each project without runtime configuration changes', async () => {
  const { agentGuidanceSettings, updateAgentGuidance } = await import('./agent-guidance.ts')
  const original = '# Shared instructions\n\nKeep handwritten guidance.\n'
  fs.writeFileSync(AGENT_GUIDANCE_PATH, original)
  let state = agentGuidanceSettings()
  assert.equal(state.settings.subagents, 'inherit')
  assert.equal(state.content, original, 'existing guidance is not opted into delegation')
  state = updateAgentGuidance({ key: 'language', value: 'ko', revision: state.revision })
  for (const value of ['automatic', 'explicit', 'never'] as const) {
    state = updateAgentGuidance({ key: 'subagents', value, revision: state.revision })
    assert.equal(state.settings.subagents, value)
    assert.equal(state.settings.language, 'ko')
    assert.ok(state.content.startsWith(original))
    for (const name of ['subagent-a', 'subagent-b']) {
      const root = path.join(DATA_DIR, name)
      fs.mkdirSync(root, { recursive: true })
      const context = agentContextText({ projectRoot: root, docsRoot: path.join(root, 'docs') }, root)
      assert.ok(context.includes(guidanceOptions.subagents[value]))
      for (const other of ['automatic', 'explicit', 'never'] as const) {
        if (other !== value) assert.ok(!context.includes(guidanceOptions.subagents[other]))
      }
    }
  }
  const custom = state.content.replace(guidanceOptions.subagents.never, 'Delegate research only.')
  writeExternalFile(AGENT_GUIDANCE_PATH, custom, state.content)
  state = agentGuidanceSettings()
  assert.equal(state.settings.subagents, 'custom')
  state = updateAgentGuidance({ key: 'detail', value: 'concise', revision: state.revision })
  assert.match(state.content, /Delegate research only\./)
  state = updateAgentGuidance({ key: 'subagents', value: 'inherit', revision: state.revision })
  assert.equal(state.settings.subagents, 'inherit')
  assert.doesNotMatch(state.content, /mew:agent-setting:subagents|Delegate research only/)
  assert.equal(state.settings.language, 'ko')
})
