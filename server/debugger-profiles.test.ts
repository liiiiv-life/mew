import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expandDebugConfiguration, importDebugProfiles, testDebugProfile } from './debugger-profiles.ts'

test('launch import preserves JSONC profiles/compounds and rejects tasks, traversal and executable variables', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-debug-profiles-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, '.vscode'))
  const file = path.join(root, '.vscode/launch.json')
  await fs.writeFile(file, '{// comment\n"configurations":[{"name":"Server","request":"launch","program":"${workspaceFolder}/main.js",},{"name":"Worker","request":"attach","port":9000}],"compounds":[{"name":"Both","configurations":["Server","Worker"]}]}')
  const imported = await importDebugProfiles(root)
  assert.equal(imported.profiles.length, 2); assert.deepEqual(imported.compounds[0].profiles, ['Server', 'Worker'])
  assert.equal(expandDebugConfiguration(imported.profiles[0].configuration, root).program, path.join(root, 'main.js'))
  assert.deepEqual(expandDebugConfiguration({ env: { token: '${env:FIXTURE}' }, name: '${workspaceFolderBasename}' }, root, { FIXTURE: 'value' }), { env: { token: 'value' }, name: path.basename(root) })
  assert.throws(() => expandDebugConfiguration({ command: '${command:run}' }, root), /지원하지/)
  assert.throws(() => expandDebugConfiguration({ token: '${env:MISSING}' }, root, {}), /환경 변수/)
  await fs.writeFile(file, JSON.stringify({ configurations: [{ name: 'Task', request: 'launch', preLaunchTask: 'build' }] }))
  await assert.rejects(importDebugProfiles(root), /태스크/)
  await fs.symlink(path.join(root, '..'), path.join(root, 'outside'))
  await assert.rejects(importDebugProfiles(root, 'outside/not-real'), /ENOENT/)
  await assert.rejects(importDebugProfiles(root, '/absolute'), /상대 경로/)
})
test('test plans escape regex selectors and multi-session/compound execution isolates target state', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-debug-compound-')); process.env.MEW_DATA_DIR = root; process.env.MEW_WORKSPACE = root
  const { defaultDebugConfig } = await import('../shared/debugger.ts')
  const { saveDebugConfig, debugConfig, debugSession, debugSessions, newDebugSession, selectDebugSession, startDebugCompound } = await import('./debugger.ts')
  const { upsertUser } = await import('./auth.ts')
  const account = 'one@example.test'; upsertUser(account, { hash: 'fixture', role: 'owner', mustChangePassword: false, createdAt: 0, passwordChangedAt: 0 })
  const node = testDebugProfile(root, 'node', 'test.js', 'a(b).'), vitest = testDebugProfile(root, 'vitest', 'test.ts'), go = testDebugProfile(root, 'go', 'test.go', 'Test(a)')
  assert.ok((node.configuration.runtimeArgs as string[]).includes('a\\(b\\)\\.')); assert.equal(vitest.configuration.autoAttachChildProcesses, true); assert.deepEqual(go.configuration.args, ['-test.run', '^Test\\(a\\)$'])
  assert.throws(() => testDebugProfile(root, 'node', '../outside.js'), /프로젝트/)
  const config = { ...defaultDebugConfig('custom', root), command: process.execPath, args: [new URL('./fixtures/debug-adapter.cjs', import.meta.url).pathname], profiles: [{ ...node, name: 'First' }, { ...node, name: 'Second' }], compounds: [{ name: 'Both', profiles: ['First', 'Second'] }], breakpoints: [{ file: 'test.js', line: 3, enabled: true }] }
  await saveDebugConfig(account, root, config)
  t.after(async () => { await Promise.allSettled(debugSessions(account, root).map(s => s.stop())); await fs.rm(root, { recursive: true, force: true }) })
  const snapshots = await startDebugCompound(account, root, 'Both')
  assert.equal(snapshots.length, 2); assert.notEqual(snapshots[0].id, snapshots[1].id)
  assert.throws(() => newDebugSession(account, root), /이미/)
  assert.equal(debugSession('other@example.test', root, snapshots[0].id!), undefined)
  assert.equal(selectDebugSession(account, root, snapshots[0].id!).snapshot.id, snapshots[0].id)
  await saveDebugConfig(account, root, { ...config, watches: ['counter'] })
  assert.ok(debugSessions(account, root).every(s => s.config.watches.includes('counter')))
  const updates = await Promise.allSettled([
    saveDebugConfig(account, root, { ...config, functionBreakpoints: [{ name: 'unsupported', enabled: true }] }),
    saveDebugConfig(account, root, { ...config, watches: ['latest'] }),
  ])
  assert.equal(updates[0].status, 'rejected'); assert.equal(updates[1].status, 'fulfilled')
  assert.deepEqual(debugConfig(account, root).watches, ['latest']); assert.ok(debugSessions(account, root).every(s => s.config.watches[0] === 'latest'))
  assert.equal(debugConfig(account, root).request, 'launch')
  await debugSession(account, root, snapshots[0].id!)!.stop()
  assert.notEqual(debugSession(account, root, snapshots[1].id!)!.snapshot.state, 'terminated')
})
