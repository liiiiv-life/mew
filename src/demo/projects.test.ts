import assert from 'node:assert/strict'
import { test } from 'node:test'
import { demoFetch } from './transport.ts'
import { DemoWorkspaceStore } from './workspace-store.ts'

const post = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
async function data(store: DemoWorkspaceStore, path: string, init?: RequestInit) {
  const response = await demoFetch(store, path, init)
  assert.equal(response.status, 200, await response.clone().text())
  return response.json()
}

test('an empty folder becomes an editable example project and switching back preserves both roots', async () => {
  const store = new DemoWorkspaceStore(), original = store.workspacePath
  const folder = await data(store, '/api/fs/folder', post({ parent: original, name: 'My project' }))
  const workspace = await data(store, '/api/workspace', post({ path: folder.path }))
  assert.equal(workspace.path, `${original}/My project`)
  assert.equal(workspace.docsPath, `${workspace.path}/docs`)
  assert.match((await data(store, '/api/file?path=README.md')).content, /^# mew : my easy workspace/)
  assert.match((await data(store, '/api/file?project=docs&path=welcome.md')).content, /Mew를 Mew 안에서 둘러보세요/)
  await data(store, '/api/file', post({ path: 'welcome.md', project: 'docs', content: '# My project only\n' }, 'PUT'))
  const tasks = await data(store, '/api/task-list')
  const features = await data(store, '/api/features')
  assert.ok(tasks.tasks.length > 0)
  assert.ok(features.features.length > 0)
  const agent = await data(store, `/api/user-ui/agent-tabs?workspace=${encodeURIComponent(workspace.path)}`)
  assert.equal(agent.state.tabs[0].cwd, workspace.path)
  await data(store, '/api/user-ui/workspace', post({ workspacePath: workspace.path, state: { chrome: { tasksOpen: true } } }, 'PUT'))
  await data(store, '/api/workspace', post({ path: original }))
  assert.match((await data(store, '/api/file?project=docs&path=welcome.md')).content, /Mew를 Mew 안에서 둘러보세요/)
  assert.notDeepEqual((await data(store, `/api/user-ui/workspace?workspace=${encodeURIComponent(original)}`)).state, { chrome: { tasksOpen: true } })
  const projects = await data(store, '/api/projects')
  assert.deepEqual(projects.map((project: { name: string }) => project.name), ['My project'])
  await data(store, '/api/workspace', post({ path: workspace.path }))
  assert.equal((await data(store, '/api/file?project=docs&path=welcome.md')).content, '# My project only\n')
})

test('project creation, rename, layout and deletion share the explorer state', async () => {
  const store = new DemoWorkspaceStore()
  await data(store, '/api/project', post({ name: 'side-project' }))
  assert.equal((await demoFetch(store, '/api/project', post({ name: 'side-project' }))).status, 409)
  await data(store, '/api/project', post({ oldName: 'side-project', newName: 'renamed' }, 'PUT'))
  await data(store, '/api/project-layout', post({ layout: { renamed: 3 } }, 'PUT'))
  assert.deepEqual((await data(store, '/api/projects'))[0], { name: 'renamed', icon: null, slot: 3 })
  assert.ok((await data(store, '/api/tree?v=1')).entries.some((entry: { name: string }) => entry.name === 'renamed'))
  await data(store, '/api/project?name=renamed', { method: 'DELETE' })
  assert.deepEqual(await data(store, '/api/projects'), [])
  assert.equal((await demoFetch(store, '/api/file?path=renamed/README.md')).status, 404)
})

test('missing folders offer virtual creation and clone/init produce local example repositories', async () => {
  const store = new DemoWorkspaceStore(), target = `${store.workspacePath}/ideas/new-project`
  const missing = await demoFetch(store, `/api/fs/entries?path=${encodeURIComponent(target)}`)
  assert.equal(missing.status, 404)
  assert.deepEqual((await missing.json()).missing, { path: target, existingPath: store.workspacePath, missingName: 'ideas/new-project' })
  await data(store, '/api/fs/directory', post({ path: target }))
  await data(store, '/api/fs/git/init', post({ path: target }))
  assert.ok((await data(store, `/api/fs/entries?path=${encodeURIComponent(target)}`)).entries.some((entry: { name: string }) => entry.name === '.git'))
  const clone = await data(store, '/api/fs/git/clone', post({ parent: store.workspacePath, url: 'https://example.test/team/fictional.git' }))
  assert.equal(clone.path, `${store.workspacePath}/fictional`)
  assert.match(store.readFile(`${clone.path}/README.md`).content, /^# mew : my easy workspace/)
  const root = await data(store, `/api/fs/entries?path=${encodeURIComponent(store.workspacePath)}`)
  assert.equal(root.entries.find((entry: { name: string }) => entry.name === 'fictional').git, true)
  assert.equal((await demoFetch(store, '/api/fs/git/clone', post({ parent: store.workspacePath, url: 'https://example.test/team/fictional.git' }))).status, 409)
  assert.equal((await demoFetch(store, '/api/workspace', post({ path: '/etc' }))).status, 404)
  assert.equal((await demoFetch(store, '/api/project', post({ name: '../outside' }))).status, 400)
})
