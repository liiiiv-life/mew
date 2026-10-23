import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DATA_DIR } from './dataDir.ts'
import { AGENT_GUIDANCE_PATH, agentGuidanceSettings, updateAgentGuidance } from './agent-guidance.ts'
import { describeAgentContext } from './project-context-text.ts'
import { defaultAgentSettings } from './project-agent-settings.ts'
import { documentationLocale, documentationSkills, listDocumentationSkills, listDocumentationDependencies, readDocumentationDependencies, DOCUMENTATION_SKILLS_DIR, withDocumentationSkillGuidance } from './documentation-skills.ts'
import { guidanceOptions } from '../shared/agent-guidance.ts'
import { listSkills } from './skills.ts'
import { AgentHarnessStore } from './agent-harness.ts'

const project = path.join(DATA_DIR, 'documentation-project')
fs.mkdirSync(project)
const binding = { projectRoot: project, docsRoot: path.join(project, 'docs') }
const context = (locale?: string) => describeAgentContext(binding, defaultAgentSettings(), project, locale)

test('each response-language setting selects its source skill on the next request and preserves saved instructions', () => {
  fs.writeFileSync(AGENT_GUIDANCE_PATH, '# Keep handwritten instructions\n')
  for (const [locale, skill] of Object.entries(documentationSkills)) {
    const state = agentGuidanceSettings()
    const updated = updateAgentGuidance({ key: 'language', value: locale === 'zh-CN' ? 'zh' : locale, revision: state.revision })
    const prompt = context(locale === 'en' ? 'ko' : 'en')
    assert.match(prompt, new RegExp(`Default documentation source language: ${skill.language}`))
    assert.ok(prompt.includes(`$${skill.name}`))
    for (const other of Object.values(documentationSkills)) if (other.name !== skill.name) assert.ok(!prompt.includes(`$${other.name}`))
    assert.ok(prompt.includes('existing project/file language requirements take precedence'))
    assert.ok(prompt.includes('Keep handwritten instructions'))
    assert.equal(fs.readFileSync(AGENT_GUIDANCE_PATH, 'utf8'), updated.content)
  }
})

test('following mew language resolves every request locale, while missing locales and custom settings retain language choice', () => {
  fs.writeFileSync(AGENT_GUIDANCE_PATH, '# Custom rules\n')
  const state = agentGuidanceSettings()
  const updated = updateAgentGuidance({ key: 'language', value: 'mew', revision: state.revision })
  for (const [locale, skill] of Object.entries(documentationSkills)) assert.ok(context(locale).includes(`Default documentation source language: ${skill.language}`))
  for (const locale of [undefined, 'unsupported']) {
    const prompt = context(locale)
    assert.match(prompt, /follow the active response-language instructions/)
    for (const skill of Object.values(documentationSkills)) assert.ok(prompt.includes(`$${skill.name}`))
  }
  assert.equal(fs.readFileSync(AGENT_GUIDANCE_PATH, 'utf8'), updated.content)
  const custom = updated.content.replace(guidanceOptions.language.mew, 'Use each project’s chosen language.')
  fs.writeFileSync(AGENT_GUIDANCE_PATH, custom)
  assert.match(context('ko'), /Use each project’s chosen language/)
  assert.match(context('ko'), /Custom language instructions remain authoritative/)
  assert.equal(fs.readFileSync(AGENT_GUIDANCE_PATH, 'utf8'), custom)
  assert.equal(describeAgentContext(binding, { ...defaultAgentSettings(), enabled: false }, project, 'ko'), '')
})

test('language selection does not infer a setting from free text, duplicated markers, or custom block content', () => {
  const start = '<!-- mew:agent-setting:language -->', end = '<!-- /mew:agent-setting:language -->'
  const valid = `${start}\n${guidanceOptions.language.en}\n${end}`
  assert.equal(documentationLocale(valid), 'en')
  for (const damaged of [guidanceOptions.language.en, `${start}${guidanceOptions.language.en}`, `${valid}\n${valid}`, `${end}${start}`, `${start}Reply in English and preserve French files.${end}`]) {
    assert.equal(documentationLocale(damaged), undefined)
    assert.ok(withDocumentationSkillGuidance(damaged).startsWith(damaged))
  }
})

test('all runtimes expose four documentation skills, preserving project overrides and read-only packaged resources', async () => {
  const home = path.join(DATA_DIR, 'documentation-home')
  fs.mkdirSync(home)
  const packaged = [...listDocumentationSkills(), ...listDocumentationDependencies()]
  for (const runtime of ['codex', 'claude', 'hermes', 'cursor', 'prime', 'opencode', 'openclaw', 'antigravity', 'kimi']) {
    const inventory = listSkills(project, runtime, home, {})
    for (const skill of packaged) assert.equal(inventory.find(item => item.name === skill.name)?.path, skill.path)
  }
  const custom = path.join(project, '.codex/skills/english-technical-docs/SKILL.md')
  fs.mkdirSync(path.dirname(custom), { recursive: true })
  fs.writeFileSync(custom, '---\nname: english-technical-docs\ndescription: Project override\n---\nCustom editor')
  assert.equal(listSkills(project, 'codex', home, {}).find(item => item.name === 'english-technical-docs')?.path, custom)
  const store = new AgentHarnessStore({ home, env: {} })
  const inventory = await store.list(project, 'skills')
  const target = inventory.locations.find(location => location.agent === 'codex' && location.writable)!
  for (const skill of packaged) {
    const item = inventory.items.find(item => item.path === skill.path)!
    assert.ok(item)
    assert.equal(item.writable, false)
    const detail = await store.detail(project, 'skills', item.id)
    assert.ok(detail.files.includes('SKILL.md'))
    for (const action of ['save', 'move', 'delete'] as const) {
      await assert.rejects(store.mutate({ cwd: project, kind: 'skills', action, id: item.id, target: target.id, revision: detail.revision, content: detail.content }), /기본 스킬|읽기 전용/)
    }
  }
})

test('the wrappers route to intact pinned upstream skills, with complete locale editors and translation specialists', () => {
  const manifest = readDocumentationDependencies()
  const expected = { ko: ['korean-writing-reviewer', 'translating-korean'], en: ['writing-clearly-and-concisely', 'translating-core'], ja: ['yomiyasu', 'translating-japanese'], 'zh-CN': ['tech-doc-style-chinese', 'translating-chinese'] }
  for (const [locale, pair] of Object.entries(expected)) {
    const route = manifest.languages[locale as keyof typeof manifest.languages]
    assert.deepEqual([route.editor, route.translator], pair)
    const wrapper = fs.readFileSync(path.join(DOCUMENTATION_SKILLS_DIR, documentationSkills[locale as keyof typeof documentationSkills].name, 'SKILL.md'), 'utf8')
    assert.ok(wrapper.includes(route.editor))
    assert.ok(wrapper.includes(route.translator))
    for (const name of [route.editor, route.translator]) assert.ok(manifest.packages.some(entry => entry.name === name))
  }
  for (const name of [manifest.structure, ...Object.values(manifest.translation)]) assert.ok(manifest.packages.some(entry => entry.name === name))
  for (const dependency of manifest.packages) {
    assert.match(dependency.revision, /^[a-f0-9]{40}$/)
    assert.ok(dependency.files.some(file => file.path === 'LICENSE'))
    for (const file of dependency.files) {
      const bytes = fs.readFileSync(path.join(DOCUMENTATION_SKILLS_DIR, '.vendor', dependency.name, file.path))
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `${dependency.name}/${file.path} must preserve installed upstream bytes`)
    }
  }
})
