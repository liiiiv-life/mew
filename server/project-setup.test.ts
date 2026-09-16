import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { applyProjectSetup, defaultAgentSettings, planProjectSetup, readProjectAgentSettings } from './project-setup.ts'
import { projectDocsDir, writeProjectAgentSettings } from './project-agent-settings.ts'

function fixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-setup-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

test('setup preview is read-only, apply preserves existing docs, and repeated setup is idempotent', t => {
  const root = fixture(t)
  fs.mkdirSync(path.join(root, 'notes'))
  fs.writeFileSync(path.join(root, 'notes/MOC.md'), 'existing canonical map')
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'existing instructions')
  fs.writeFileSync(path.join(root, 'README.md'), 'existing setup')
  const input = { projectRoot: root, settings: defaultAgentSettings('notes'), initDocs: true, exportAgents: true }
  const plan = planProjectSetup(input)
  assert.equal(fs.existsSync(path.join(root, '.mew')), false)
  assert.equal(plan.files.find(f => f.path === 'AGENTS.md')?.action, 'preserve')
  applyProjectSetup(input, plan.revision)
  assert.equal(fs.readFileSync(path.join(root, 'notes/MOC.md'), 'utf8'), 'existing canonical map')
  assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), 'existing instructions')
  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'existing setup')
  assert.equal(readProjectAgentSettings(root)?.docsDir, 'notes')
  assert.ok(planProjectSetup(input).files.every(f => f.action === 'preserve'))
  assert.equal(projectDocsDir(root, 'docs'), 'notes', 'project choice overrides global fallback')
})

test('setup rejects outside paths, symlinks, stale previews and corrupt settings without overwriting', t => {
  const root = fixture(t), outside = fixture(t)
  fs.mkdirSync(path.join(root, 'docs'))
  fs.symlinkSync(outside, path.join(root, 'linked'))
  for (const docsDir of ['../outside', outside, 'linked/notes', '.mew', '.git/docs', 'docs/../../outside']) {
    assert.throws(() => planProjectSetup({ projectRoot: root, settings: defaultAgentSettings(docsDir), initDocs: true }))
  }
  const input = { projectRoot: root, settings: defaultAgentSettings(), initDocs: true }
  const preview = planProjectSetup(input)
  fs.writeFileSync(path.join(root, 'docs/MOC.md'), 'created by another editor')
  assert.throws(() => applyProjectSetup(input, preview.revision), /미리보기/)
  fs.mkdirSync(path.join(root, '.mew'))
  fs.writeFileSync(path.join(root, '.mew/agent-context.json'), '{broken')
  assert.throws(() => planProjectSetup(input), /JSON/)
  assert.equal(fs.readFileSync(path.join(root, '.mew/agent-context.json'), 'utf8'), '{broken')
  assert.deepEqual(fs.readdirSync(outside), [])
})

test('CLI creates a new project only with apply and uses the same setup plan', t => {
  const parent = fixture(t), root = path.join(parent, 'new project')
  const cli = path.join(import.meta.dirname, 'project-setup-cli.ts')
  const args = [cli, '--project', root, '--create', '--init-docs', '--export-agents', '--docs', 'project notes']
  const preview = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }))
  assert.equal(preview.applied, false)
  assert.equal(fs.existsSync(root), false)
  const applied = JSON.parse(execFileSync(process.execPath, [...args, '--apply'], { encoding: 'utf8' }))
  assert.deepEqual(applied.files, preview.files)
  assert.equal(applied.applied, true)
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /project%20notes\/AGENT.md/)
  assert.equal(projectDocsDir(root), 'project notes')
  assert.equal(readProjectAgentSettings(root)?.enabled, true)
})

test('missing saved entrypoints remain reportable without preventing project opening', t => {
  const root = fixture(t)
  fs.mkdirSync(path.join(root, 'docs'))
  const settings = { ...defaultAgentSettings(), entrypoints: ['missing.md'] }
  writeProjectAgentSettings(root, settings)
  assert.equal(projectDocsDir(root), 'docs')
  assert.throws(() => planProjectSetup({ projectRoot: root, settings }), /파일을 찾을 수 없습니다/)
})
