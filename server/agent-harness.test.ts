import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { AgentHarnessStore, HarnessError } from './agent-harness.ts'
import { createAgentHarnessRouter } from './agent-harness-routes.ts'
import { parseConfig, patchConfig } from './harness-config.ts'
import { listSkills } from './skills.ts'

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-harness-'))
  const home = path.join(directory, 'home'), cwd = path.join(directory, 'project')
  fs.mkdirSync(home); fs.mkdirSync(cwd)
  const store = new AgentHarnessStore({ home, env: {} })
  const write = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text) }
  const skill = (file: string, name = 'demo') => write(file, `---\nname: ${name}\ndescription: |\n  A multi-line\n  description.\n---\n# Instructions\n`)
  return { directory, home, cwd, store, write, skill, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) }
}

test('discovers scopes, duplicate names, global common, runtime and package-owned skills without exposing MCP secrets', async () => {
  const f = fixture()
  try {
    f.skill(path.join(f.home, '.agents/skills/demo/SKILL.md'))
    f.skill(path.join(f.home, '.codex/skills/.system/system/SKILL.md'), 'system')
    f.skill(path.join(f.cwd, '.codex/skills/demo/SKILL.md'))
    f.skill(path.join(f.cwd, 'apps/web/.claude/skills/demo/SKILL.md'))
    f.skill(path.join(f.cwd, 'node_modules/ignored/.agents/skills/hidden/SKILL.md'))
    f.skill(path.join(f.home, '.codex/plugins/cache/vendor/plugin/1.0/skills/packaged/SKILL.md'), 'packaged')
    fs.symlinkSync(path.join(f.home, '.agents/skills/demo'), path.join(f.cwd, '.codex/skills/linked'))
    const inventory = await f.store.list(f.cwd, 'skills')
    assert.equal(inventory.items.length, 6)
    assert.equal(new Set(inventory.items.map(item => item.id)).size, 6)
    assert.equal(inventory.scopes.length, 3)
    assert.match(inventory.items[0].description, /multi-line\ndescription/)
    assert.equal(inventory.items.filter(item => !item.writable).length, 3)
    f.write(path.join(f.home, '.claude.json'), JSON.stringify({ oauth: 'private-account', mcpServers: { sample: { command: 'node', env: { TOKEN: 'private-token' } } } }))
    const mcp = await f.store.list(f.cwd, 'mcp')
    assert.doesNotMatch(JSON.stringify(mcp), /private-token|private-account/)
    const detail = await f.store.detail(f.cwd, 'mcp', mcp.items[0].id)
    assert.match(detail.content, /private-token/)
    assert.doesNotMatch(detail.content, /private-account/)
  } finally { f.cleanup() }
})

test('skill moves retain assets and stale revisions, collisions and links cannot delete or overwrite data', async () => {
  const f = fixture()
  try {
    const source = path.join(f.cwd, '.codex/skills/demo')
    f.skill(path.join(source, 'SKILL.md'))
    f.write(path.join(source, 'scripts/run.sh'), '#!/bin/sh\necho hello\n')
    fs.chmodSync(path.join(source, 'scripts/run.sh'), 0o755)
    const inventory = await f.store.list(f.cwd, 'skills'), item = inventory.items[0]
    const target = inventory.locations.find(location => location.scope === 'global' && location.agent === 'codex')!
    let detail = await f.store.detail(f.cwd, 'skills', item.id)
    f.write(path.join(source, 'scripts/run.sh'), 'external edit')
    await assert.rejects(f.store.mutate({ cwd: f.cwd, kind: 'skills', action: 'delete', id: item.id, revision: detail.revision }), /다른 곳/)
    detail = await f.store.detail(f.cwd, 'skills', item.id)
    await f.store.mutate({ cwd: f.cwd, kind: 'skills', action: 'move', id: item.id, revision: detail.revision, target: target.id })
    assert.equal(fs.existsSync(source), false)
    const destination = path.join(target.path, 'demo')
    assert.equal(fs.readFileSync(path.join(destination, 'scripts/run.sh'), 'utf8'), 'external edit')
    assert.equal(fs.statSync(path.join(destination, 'scripts/run.sh')).mode & 0o777, 0o755)
    f.skill(path.join(source, 'SKILL.md'))
    const next = await f.store.detail(f.cwd, 'skills', item.id)
    await assert.rejects(f.store.mutate({ cwd: f.cwd, kind: 'skills', action: 'move', id: item.id, revision: next.revision, target: target.id }), /같은 이름/)
    fs.symlinkSync(destination, path.join(source, 'link'))
    const linked = await f.store.detail(f.cwd, 'skills', item.id)
    await assert.rejects(f.store.mutate({ cwd: f.cwd, kind: 'skills', action: 'delete', id: item.id, revision: linked.revision }), /링크/)
    await assert.rejects(f.store.mutate({ cwd: f.cwd, kind: 'skills', action: 'create', target: target.id, name: '../escape', content: '' }), /이름/)
    await assert.rejects(f.store.mutate({ cwd: f.cwd, kind: 'skills', action: 'create', target: '/tmp/arbitrary', name: 'test', content: '' }), /위치/)
  } finally { f.cleanup() }
})

test('MCP save, same-file local-to-global move, conflict, deletion preserve all unrelated settings', async () => {
  const f = fixture()
  try {
    const config = path.join(f.home, '.claude.json')
    f.write(config, JSON.stringify({ account: { opaque: 'keep' }, projects: { [f.cwd]: { mcpServers: { demo: { command: 'node', args: ['old.js'] } }, trust: true } }, mcpServers: { untouched: { url: 'https://example.test/mcp', type: 'http' } } }))
    let inventory = await f.store.list(f.cwd, 'mcp')
    const item = inventory.items.find(item => item.name === 'demo')!
    const target = inventory.locations.find(location => location.scope === 'global' && location.agent === 'claude')!
    let detail = await f.store.detail(f.cwd, 'mcp', item.id)
    await f.store.mutate({ cwd: f.cwd, kind: 'mcp', action: 'save', id: item.id, revision: detail.revision, content: '{"command":"node","args":["new.js"]}' })
    await assert.rejects(f.store.mutate({ cwd: f.cwd, kind: 'mcp', action: 'delete', id: item.id, revision: detail.revision }), /다른 곳/)
    detail = await f.store.detail(f.cwd, 'mcp', item.id)
    await f.store.mutate({ cwd: f.cwd, kind: 'mcp', action: 'move', id: item.id, revision: detail.revision, target: target.id })
    const changed = JSON.parse(fs.readFileSync(config, 'utf8'))
    assert.deepEqual(changed.account, { opaque: 'keep' })
    assert.equal(changed.projects[f.cwd].trust, true)
    assert.deepEqual(changed.projects[f.cwd].mcpServers, {})
    assert.deepEqual(changed.mcpServers.demo.args, ['new.js'])
    assert.ok(changed.mcpServers.untouched)
    inventory = await f.store.list(f.cwd, 'mcp')
    const moved = inventory.items.find(item => item.name === 'demo')!
    detail = await f.store.detail(f.cwd, 'mcp', moved.id)
    await f.store.mutate({ cwd: f.cwd, kind: 'mcp', action: 'delete', id: moved.id, revision: detail.revision })
    assert.equal(JSON.parse(fs.readFileSync(config, 'utf8')).mcpServers.demo, undefined)
  } finally { f.cleanup() }
})

test('TOML, JSONC and YAML preserve unrelated config and reject ambiguous or invalid source syntax', () => {
  const toml = '# comment\nmodel = "model"\n\n[mcp_servers."demo.one"]\ncommand = "node"\n[mcp_servers."demo.one".env]\nTOKEN = "keep"\n\n[projects."/tmp"]\ntrust_level = "trusted"\n'
  const patched = patchConfig(toml, 'toml', ['mcp_servers'], 'demo.one', { command: 'updated', env: { TOKEN: 'keep' } })
  assert.match(patched, /^# comment\nmodel = "model"/)
  assert.deepEqual(parseConfig(patched, 'toml').projects, parseConfig(toml, 'toml').projects)
  assert.deepEqual((parseConfig(patched, 'toml').mcp_servers as Record<string, unknown>)['demo.one'], { command: 'updated', env: { TOKEN: 'keep' } })
  assert.throws(() => patchConfig('mcp_servers = { demo = { command = "node" } }', 'toml', ['mcp_servers'], 'demo', undefined), /인라인/)
  const jsonc = '{\n// preserve me\n"theme": "dark",\n"mcp": {"demo": {"type":"local","command":["node"]}},\n}'
  const changed = patchConfig(jsonc, 'jsonc', ['mcp'], 'demo', { type: 'local', command: ['new'] })
  assert.match(changed, /\/\/ preserve me/)
  assert.equal(parseConfig(changed, 'jsonc').theme, 'dark')
  const yaml = '# keep comment\nmodel: test\nmcp_servers:\n  demo:\n    command: node\n'
  const yamlChanged = patchConfig(yaml, 'yaml', ['mcp_servers'], 'demo', { command: 'new' })
  assert.match(yamlChanged, /# keep comment/)
  assert.equal(parseConfig(yamlChanged, 'yaml').model, 'test')
  assert.throws(() => parseConfig('{bad}', 'json'))
  assert.throws(() => parseConfig('a: 1\na: 2', 'yaml'))
})

test('invalid MCP files stay unchanged; config symlinks and forged item ids are not writable', async () => {
  const f = fixture()
  try {
    f.write(path.join(f.cwd, '.mcp.json'), '{broken')
    const inventory = await f.store.list(f.cwd, 'mcp')
    assert.equal(inventory.warnings.length, 1)
    const target = inventory.locations.find(location => location.path === path.join(f.cwd, '.mcp.json'))!
    await assert.rejects(f.store.mutate({ cwd: f.cwd, kind: 'mcp', action: 'create', target: target.id, name: 'demo', content: '{"command":"node"}' }))
    assert.equal(fs.readFileSync(target.path, 'utf8'), '{broken')
    await assert.rejects(f.store.detail(f.cwd, 'mcp', 'forged'), HarnessError)
    fs.unlinkSync(target.path)
    f.write(path.join(f.home, 'outside.json'), '{"mcpServers":{"demo":{"command":"node"}}}')
    fs.symlinkSync(path.join(f.home, 'outside.json'), target.path)
    const linked = await f.store.list(f.cwd, 'mcp')
    assert.equal(linked.items[0].writable, false)
    const detail = await f.store.detail(f.cwd, 'mcp', linked.items[0].id)
    await assert.rejects(f.store.mutate({ cwd: f.cwd, kind: 'mcp', action: 'delete', id: detail.item.id, revision: detail.revision }), /링크/)
  } finally { f.cleanup() }
})

test('native Prime/OpenClaw configs, runtime home overrides and flat skill moves work', async () => {
  const f = fixture()
  try {
    const customHome = path.join(f.home, 'custom-codex')
    const store = new AgentHarnessStore({ home: f.home, env: {}, runtimeEnvs: { codex: { CODEX_HOME: customHome } } })
    f.skill(path.join(f.cwd, '.prime/agent/skills/flat.md'), 'flat')
    f.write(path.join(f.home, '.openclaw/openclaw.json'), '{ // preserve values\n theme: "dark", mcp: { servers: {demo:{url:"https://example.test"}}}}')
    const mcp = await store.list(f.cwd, 'mcp'), item = mcp.items.find(item => item.name === 'demo')!
    const detail = await store.detail(f.cwd, 'mcp', item.id)
    await store.mutate({ cwd: f.cwd, kind: 'mcp', action: 'save', id: item.id, revision: detail.revision, content: '{"url":"https://example.test/new"}' })
    assert.equal(JSON.parse(fs.readFileSync(item.path, 'utf8')).theme, 'dark')
    const skills = await store.list(f.cwd, 'skills'), flat = skills.items.find(item => item.name === 'flat')!
    const target = skills.locations.find(location => location.agent === 'codex' && location.scope === 'global')!
    assert.equal(target.path, path.join(customHome, 'skills'))
    const flatDetail = await store.detail(f.cwd, 'skills', flat.id)
    await store.mutate({ cwd: f.cwd, kind: 'skills', action: 'move', id: flat.id, revision: flatDetail.revision, target: target.id })
    assert.equal(fs.existsSync(flat.path), false)
    assert.match(fs.readFileSync(path.join(customHome, 'skills/flat/SKILL.md'), 'utf8'), /name: flat/)
  } finally { f.cleanup() }
})

test('slash skill discovery selects nearest scope and current runtime, shares global common, excludes sibling projects', () => {
  const f = fixture()
  try {
    f.write(path.join(f.cwd, '.git'), 'gitdir: /unused')
    f.skill(path.join(f.home, '.agents/skills/common/SKILL.md'), 'common')
    f.skill(path.join(f.home, '.codex/skills/demo/SKILL.md'))
    f.skill(path.join(f.cwd, '.codex/skills/demo/SKILL.md'))
    f.skill(path.join(f.cwd, 'apps/web/.agents/skills/local/SKILL.md'), 'local')
    f.skill(path.join(f.cwd, 'apps/other/.agents/skills/sibling/SKILL.md'), 'sibling')
    f.skill(path.join(f.cwd, '.claude/skills/claude-only/SKILL.md'), 'claude-only')
    const skills = listSkills(path.join(f.cwd, 'apps/web'), 'codex', f.home, {})
    assert.deepEqual(skills.map(skill => skill.name), ['common', 'demo', 'local'])
    assert.equal(skills.find(skill => skill.name === 'demo')!.path, path.join(f.cwd, '.codex/skills/demo/SKILL.md'))
    assert.deepEqual(listSkills(f.cwd, 'claude', f.home, {}).map(skill => skill.name), ['claude-only', 'common'])
  } finally { f.cleanup() }
})

test('HTTP denies guests and members and does not cache settings', async () => {
  const f = fixture(), app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.auth = { role: req.headers['x-test-role'] === 'owner' ? 'owner' : req.headers['x-test-role'] === 'member' ? 'member' : 'guest', email: 'harness-test@example.test', mustChangePassword: false }; next() })
  app.use('/harness', createAgentHarnessRouter(f.store))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address() as { port: number }
  const url = `http://127.0.0.1:${address.port}/harness?${new URLSearchParams({ cwd: f.cwd, kind: 'mcp' })}`
  try {
    assert.equal((await fetch(url)).status, 403)
    assert.equal((await fetch(url, { headers: { 'x-test-role': 'member' } })).status, 403)
    const response = await fetch(url, { headers: { 'x-test-role': 'owner' } })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal((await fetch(url, { method: 'POST', headers: { 'x-test-role': 'owner', 'Content-Type': 'application/json' }, body: '{}' })).status, 400)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); f.cleanup() }
})
