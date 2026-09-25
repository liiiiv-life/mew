import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-skills-'))
process.env.MEW_DATA_DIR = path.join(temporary, 'data')
const { ensureCommitSkill, readCommitSkill, MEW_SKILLS_DIR, commitSkillGuidance } = await import('./mew-skills.ts')
const { listSkills } = await import('./skills.ts')
const { AgentHarnessStore } = await import('./agent-harness.ts')
const { commitPlanPrompt, captureCommitChanges } = await import('./git-ai-commit.ts')
const { default: simpleGit } = await import('simple-git')
after(() => fs.rmSync(temporary, { recursive: true, force: true }))

test('one editable Mew skill wins for all runtimes and supplies both slash and automatic commits', async () => {
  const cwd = path.join(temporary, 'project'), home = path.join(temporary, 'home')
  fs.mkdirSync(cwd); fs.mkdirSync(home)
  const git = simpleGit(cwd)
  await git.init()
  fs.mkdirSync(path.join(cwd, '.codex/skills/commit'), { recursive: true })
  fs.writeFileSync(path.join(cwd, '.codex/skills/commit/SKILL.md'), '---\nname: commit\n---\nOld duplicate')
  const file = ensureCommitSkill()
  const original = readCommitSkill().content
  const store = new AgentHarnessStore({ home, env: {}, mewSkillsDir: MEW_SKILLS_DIR })
  const inventory = await store.list(cwd, 'skills')
  const item = inventory.items.find(item => item.managed)!
  assert.equal(item.path, file)
  const detail = await store.detail(cwd, 'skills', item.id)
  const content = `${original}\nUse repository-specific scopes in every title.\n`
  await store.mutate({ cwd, kind: 'skills', action: 'save', id: item.id, revision: detail.revision, content })
  assert.equal(fs.readFileSync(ensureCommitSkill(), 'utf8'), content, 'seeding preserves edits')
  await assert.rejects(store.mutate({ cwd, kind: 'skills', action: 'save', id: item.id, revision: detail.revision, content: original }), /다른 곳/)
  for (const action of ['delete', 'move'] as const) {
    const target = inventory.locations.find(location => location.agent === 'codex')!
    await assert.rejects(store.mutate({ cwd, kind: 'skills', action, id: item.id, target: target.id, revision: detail.revision }), /이동·삭제/)
  }
  for (const runtime of ['codex', 'claude', 'hermes', 'cursor', 'prime', 'opencode', 'openclaw', 'antigravity', 'kimi']) {
    const commits = listSkills(cwd, runtime, home, {}).filter(skill => skill.name === 'commit')
    assert.equal(commits.length, 1)
    assert.equal(commits[0].path, file)
  }
  assert.ok(commitSkillGuidance().includes(file))
  fs.writeFileSync(path.join(cwd, 'change.txt'), 'change')
  const prompt = commitPlanPrompt({ id: 'test', name: 'Test', runtime: 'codex', modelId: '', role: '' }, await captureCommitChanges(cwd, ['change.txt']))
  assert.ok(prompt.includes(content))
  assert.equal((await store.list(cwd, 'mcp')).items.some(item => item.managed), false)
})
