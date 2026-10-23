import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'rolldown'
import type * as Client from '../api/client.ts'
import type { DemoWorkspaceStore } from './workspace-store.ts'

test('the real client API and the demo adapter agree on core workspace contracts', async t => {
  const storage = new Map<string, string>()
  for (const [key, value] of Object.entries({ location: { pathname: '/demo/', origin: 'https://demo.mew.test' }, localStorage: { getItem: (name: string) => storage.get(name) ?? null, setItem: (name: string, value: string) => storage.set(name, value) } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { value, configurable: true })
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key) })
  }
  const source = `export * from ${JSON.stringify(new URL('../api/client.ts', import.meta.url).pathname)};
    import { DemoWorkspaceStore } from ${JSON.stringify(new URL('./workspace-store.ts', import.meta.url).pathname)};
    import { createDemoTransport } from ${JSON.stringify(new URL('./transport.ts', import.meta.url).pathname)};
    import { configureAppRuntime } from ${JSON.stringify(new URL('../runtime/app-runtime.ts', import.meta.url).pathname)};
    export const store = new DemoWorkspaceStore();
    configureAppRuntime({ kind:'demo', transport:createDemoTransport(store), basePath:'/demo/' });
    export const dispose = () => configureAppRuntime({});`
  const bundle = await build({ input: 'virtual:demo-contracts', write: false, platform: 'browser', output: { format: 'esm' }, plugins: [{ name: 'demo-contract-fixture', resolveId: id => id === 'virtual:demo-contracts' ? id : undefined, load: id => id === 'virtual:demo-contracts' ? source : undefined }] })
  const entry = bundle.output.find(item => item.type === 'chunk')!
  assert.equal(bundle.output.length, 1)
  const api = await import(`data:text/javascript;base64,${Buffer.from(entry.code).toString('base64')}`) as typeof Client & { store: DemoWorkspaceStore; dispose(): void }
  t.after(() => api.dispose())

  assert.equal((await api.fetchAuthStatus()).authenticated, true)
  const profile = await api.updateProfile('Contract visitor', null)
  assert.equal(profile.profile.displayName, 'Contract visitor')
  assert.equal((await api.fetchAgentRuntimes()).runtimes[0].id, 'codex')
  assert.equal((await api.fetchAgentModels('codex')).models[0].modelId, 'demo-model')
  await api.saveAgentDefault('codex', { modelId: 'demo-model' })
  assert.equal((await api.fetchAgentDefault('codex')).settings?.modelId, 'demo-model')
  const workspace = await api.fetchWorkspace()
  const agentTabs = await api.fetchAgentTabs(workspace.path)
  assert.equal(agentTabs.state?.tabs[0].runtime, 'codex')
  assert.deepEqual(agentTabs.claims, [])
  const ui = await api.fetchWorkspaceUi(workspace.path)
  assert.ok(ui.state?.tabs)
  await api.saveWorkspaceUi(workspace.path, { chrome: { sidebarOpen: false } })
  assert.deepEqual((await api.fetchWorkspaceUi(workspace.path)).state, { chrome: { sidebarOpen: false } })

  const editor = api.createEditorApi('docs'), initial = await editor.fetchFile('welcome.md')
  await api.saveFile('welcome.md', initial.content + '\nA contract idea\n', false, 'docs', initial.content)
  const search = await api.searchProject('A contract idea', { regex: false, caseSensitive: false }, 'docs')
  assert.equal(search.results[0].path, 'welcome.md')
  const changed = await api.fetchGitWorkingTree('', '.workspace')
  assert.deepEqual(changed.files, [{ path: 'docs/welcome.md', status: 'M' }])
  assert.match((await api.fetchGitWorkingTreeDiff('', changed.files[0].path, '.workspace')).diff, /\+A contract idea/)
  await api.commitGitWorkingTree('', 'Commit contract idea', '', '.workspace', changed.files.map(file => file.path))
  assert.equal((await api.fetchGitWorkingTree('', '.workspace')).files.length, 0)

  const database = await editor.db.create('Contract board'), row = await editor.db.insertRow(database.id)
  await editor.db.updateCell(database.id, row.id, database.columns[0].id, 'One task')
  assert.equal((await editor.db.getView(database.id)).rows.find(item => item.id === row.id)?.cells[database.columns[0].id], 'One task')
  assert.equal((await api.fetchTmuxSessions())[0].name, 'demo-terminal')
  assert.equal((await api.fetchFileFavorites()).folders[0].kind, 'custom')
  await assert.rejects(api.login('actual@example.test', 'no actual password'), /실제 계정/)
})
