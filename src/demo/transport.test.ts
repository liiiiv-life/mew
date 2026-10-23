import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDemoTransport, demoFetch } from './transport.ts'
import { DemoWorkspaceStore } from './workspace-store.ts'
import { DEMO_DATABASE_ID } from './http-database.ts'
import fs from 'node:fs'
import { MEWPET_ANIMATIONS, type MewpetSkinCatalog } from '../../shared/mewpet-skins.ts'
import { THEME_PRESETS } from '../../shared/theme.ts'
import { createDemoSocketFactory } from './socket.ts'

function write(method: string, body: unknown): RequestInit { return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } }
async function data(store: DemoWorkspaceStore, path: string, init?: RequestInit) {
  const response = await demoFetch(store, path, init)
  assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`)
  return response.json()
}

test('account themes migrate once, notify presence and stay in the visitor memory store', async () => {
  const store = new DemoWorkspaceStore(), other = new DemoWorkspaceStore(), factory = createDemoSocketFactory(store)
  const socket = factory('ws://demo.test/api/presence'), messages: { type: string }[] = []
  socket.onmessage = event => messages.push(JSON.parse(String(event.data)))
  try {
    await new Promise(resolve => setTimeout(resolve, 0))
    const initial = { palette: THEME_PRESETS[1].palette, custom: [] }
    assert.deepEqual(await data(store, '/api/user-ui/theme'), { state: null })
    assert.deepEqual(await data(store, '/api/user-ui/theme', write('PUT', { state: initial, initialize: true })), { state: initial })
    assert.deepEqual(await data(store, '/api/user-ui/theme', write('PUT', { state: { ...initial, palette: THEME_PRESETS[0].palette }, initialize: true })), { state: initial })
    assert.deepEqual(await data(other, '/api/user-ui/theme'), { state: null })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(messages.filter(message => message.type === 'theme').length, 1)
    store.reset()
    assert.deepEqual(await data(store, '/api/user-ui/theme'), { state: null })
  } finally { factory.close(); store.close(); other.close() }
})

test('file saves, version revalidation, search and Git agree through HTTP', async () => {
  const store = new DemoWorkspaceStore()
  const initial = await data(store, '/api/file?project=docs&path=welcome.md')
  const unchanged = await data(store, `/api/file?project=docs&path=welcome.md&version=${initial.version.tag}`)
  assert.equal(unchanged.unchanged, true)
  assert.equal(unchanged.content, undefined)
  await data(store, '/api/file', write('PUT', { path: 'welcome.md', project: 'docs', content: initial.content + '\nMoonlight idea\n', expectedContent: initial.content }))
  const search = await data(store, '/api/search?q=Moonlight&project=.workspace')
  assert.equal(search.results[0].path, 'docs/welcome.md')
  const files = await data(store, '/api/search/files?q=*.ts')
  assert.ok(files.results.some((file: { path: string }) => file.path === 'shared/features.ts'))
  const working = await data(store, '/api/git/working-tree')
  assert.deepEqual(working.files, [{ path: 'docs/welcome.md', status: 'M' }])
  const diff = await data(store, '/api/git/working-tree/diff?file=docs%2Fwelcome.md')
  assert.match(diff.diff, /\+Moonlight idea/)
  const commit = await data(store, '/api/git/commit', write('POST', { title: 'Add moonlight idea', files: ['docs/welcome.md'] }))
  assert.ok(commit.hash)
  assert.equal((await data(store, '/api/git/working-tree')).files.length, 0)
  const history = await data(store, '/api/file-history?path=welcome.md&project=docs')
  assert.equal(history.history[0].hash, commit.hash)
})

test('new, rename, copy and delete appear in the shared explorer', async () => {
  const store = new DemoWorkspaceStore()
  await data(store, '/api/new-folder', write('POST', { relPath: 'notes', project: '.workspace' }))
  await data(store, '/api/new-document', write('POST', { relPath: 'notes/idea.md', title: 'Idea', project: '.workspace' }))
  await data(store, '/api/rename', write('POST', { oldPath: 'notes/idea.md', newPath: 'notes/next.md' }))
  const duplicate = await data(store, '/api/copy', write('POST', { path: 'notes/next.md' }))
  const tree = await data(store, '/api/tree?path=notes&v=1')
  assert.equal(tree.entries.length, 2)
  await data(store, `/api/file?path=${encodeURIComponent(duplicate.relPath)}`, { method: 'DELETE' })
  assert.equal((await data(store, '/api/tree?path=notes&v=1')).entries.length, 1)
})

test('external file paths and agent directories remain absolute after a nested workspace switch', async () => {
  const store = new DemoWorkspaceStore(), docs = `${store.workspacePath}/docs`
  store.openWorkspace(docs)
  const entries = await data(store, `/api/fs/entries?path=${encodeURIComponent(docs)}`)
  const welcome = entries.entries.find((entry: { name: string }) => entry.name === 'welcome.md')
  assert.equal(welcome.path, `${docs}/welcome.md`)
  assert.equal((await data(store, `/api/fs/file?path=${encodeURIComponent(welcome.path)}`)).content, store.readFile('welcome.md').content)
  const created = await data(store, '/api/fs/folder', write('POST', { parent: docs, name: 'ideas' }))
  assert.equal(created.path, `${docs}/ideas`)
  const dirs = await data(store, `/api/fs/dirs?path=${encodeURIComponent(docs)}`)
  assert.ok(dirs.dirs.some((directory: { path: string }) => directory.path === `${docs}/ideas`))
  const renamed = await data(store, '/api/fs/rename', write('POST', { path: created.path, name: 'next' }))
  assert.equal(renamed.path, `${docs}/next`)
  assert.equal((await data(store, '/api/agent-cwd?path=next')).cwd, `${docs}/next`)
  assert.equal((await data(store, `/api/agent-cwd?path=docs&base=${encodeURIComponent(store.workspacePath)}`)).cwd, docs)
  const suggestions = await data(store, '/api/agent-cwd/suggestions?input=n')
  assert.equal(suggestions.directory, docs)
  assert.equal(suggestions.prefix, 'n')
  assert.deepEqual(suggestions.dirs, [{ name: 'next', path: `${docs}/next` }])
})

test('SSE content search returns matches followed by an explicit completion event', async () => {
  const store = new DemoWorkspaceStore()
  const response = await demoFetch(store, '/api/search/stream?q=Mew&project=docs')
  assert.match(response.headers.get('Content-Type') ?? '', /text\/event-stream/)
  const text = await response.text()
  assert.match(text, /event: result\ndata: /)
  assert.match(text, /event: done\ndata: .*"state":"ready"/)
})

test('workspace UI, runtime defaults and icons round trip independently', async () => {
  const store = new DemoWorkspaceStore()
  const state = { chrome: { sidebarOpen: false }, tabs: {} }
  await data(store, '/api/user-ui/workspace', write('PUT', { workspacePath: store.workspacePath, state }))
  assert.deepEqual((await data(store, `/api/user-ui/workspace?workspace=${encodeURIComponent(store.workspacePath)}`)).state, state)
  await data(store, '/api/agent-defaults/codex', write('PUT', { modelId: 'demo-model', modeId: 'default' }))
  assert.equal((await data(store, '/api/agent-defaults/codex')).settings.modeId, 'default')
  await data(store, '/api/project-icons', write('PUT', { path: store.workspacePath, icon: '🚀' }))
  assert.deepEqual((await data(store, '/api/project-icons/read', write('POST', { paths: [store.workspacePath] }))).icons, { [store.workspacePath]: '🚀' })
  const runtimes = await data(store, '/api/agent-runtimes')
  assert.equal(runtimes.runtimes[0].id, 'codex')
})

test('database creation and cell changes use the same visitor state and publish events', async () => {
  const store = new DemoWorkspaceStore(), events: string[] = []
  store.subscribe(event => { if (event.type === 'state' && event.key?.startsWith('db-event:')) events.push(event.key) })
  const view = await data(store, `/api/db/${DEMO_DATABASE_ID}?project=docs`)
  const rowId = view.rows[0].id
  await data(store, `/api/db/${view.id}/rows/${rowId}`, write('PATCH', { project: 'docs', columnId: 'status', value: '완료' }))
  assert.equal((await data(store, `/api/db/${view.id}?project=docs`)).rows[0].cells.status, '완료')
  assert.equal(events.length, 1)
  const event = store.getState<{ event: { type: string } } | null>(events[0], null)
  assert.equal(event?.event.type, 'row.update')
  const created = await data(store, '/api/db', write('POST', { title: 'Ideas', project: 'docs' }))
  assert.deepEqual(created.columns.map((column: { name: string; type: string }) => [column.name, column.type]), [['제목', 'text'], ['텍스트', 'text']])
  assert.deepEqual(created.rows.map((row: { cells: Record<string, string> }) => created.columns.map((column: { id: string }) => row.cells[column.id])), [
    ['항목 1', '첫 번째 내용'], ['항목 2', '두 번째 내용'],
  ])
  assert.deepEqual((await data(store, `/api/db/${created.id}?project=docs`)).rows, created.rows)
  const inserted = await data(store, `/api/db/${created.id}/rows`, write('POST', { project: 'docs' }))
  const saved = await data(store, `/api/db/${created.id}?project=docs`)
  assert.equal(saved.rows.length, 3)
  assert.equal(saved.rows.at(-1).id, inserted.id)
  assert.equal((await data(store, `/api/db/${DEMO_DATABASE_ID}?project=.workspace`)).rows[0].cells.status, '예정')
})

test('table imports in the demo retain strings, normalize primary fields and omit example rows', async () => {
  const store = new DemoWorkspaceStore()
  const table = { columns: ['Name', 'Value'], rows: [['', '003'], ['', 'false']] }
  const imported = await data(store, '/api/db', write('POST', { project: 'docs', title: 'Imported', table }))
  assert.deepEqual(imported.columns.map((column: { name: string; type: string }) => [column.name, column.type]), [['제목', 'text'], ['Name', 'text'], ['Value', 'text']])
  assert.deepEqual(imported.rows.map((row: { cells: Record<string, string> }) => imported.columns.map((column: { id: string }) => row.cells[column.id])), [['항목 1', '', '003'], ['항목 2', '', 'false']])
  assert.deepEqual((await data(store, `/api/db/${imported.id}?project=docs&allRows=true`)).rows, imported.rows)
  const empty = await data(store, '/api/db', write('POST', { project: 'docs', title: 'Empty', table: { columns: ['A'], rows: [] } }))
  assert.deepEqual(empty.rows, [])
  assert.equal((await demoFetch(store, '/api/db', write('POST', { project: 'docs', table: { columns: [], rows: [] } }))).status, 400)
})

test('unsupported and cross-origin requests never call a native network function', async () => {
  const nativeFetch = globalThis.fetch, store = new DemoWorkspaceStore()
  let networkCalls = 0
  globalThis.fetch = (() => { networkCalls++; throw new Error('No real network') }) as typeof fetch
  try {
    assert.equal((await demoFetch(store, '/api/unknown')).status, 501)
    assert.equal((await demoFetch(store, 'https://outside.example/api/file')).status, 403)
    assert.equal((await demoFetch(store, '/api/file?path=README.md', { method: 'POST' })).status, 405)
    assert.equal((await demoFetch(store, '/api/file', write('PUT', { path: '/etc/passwd', content: 'bad' }))).status, 404)
    assert.equal(networkCalls, 0)
  } finally { globalThis.fetch = nativeFetch }
})

test('request cancellation and transport shutdown cleanly reject work', async () => {
  const store = new DemoWorkspaceStore(), controller = new AbortController()
  controller.abort()
  await assert.rejects(demoFetch(store, '/api/auth/me', { signal: controller.signal }), { name: 'AbortError' })
  let socketClosed = 0
  const factory = Object.assign(() => { throw new Error('unused') }, { close() { socketClosed++ } })
  const transport = createDemoTransport(store, factory)
  transport.close(); transport.close()
  await assert.rejects(transport.fetch('/api/auth/me'), /종료/)
  assert.equal(socketClosed, 1)
})

test('profile updates use the real account contract without introducing real credentials', async () => {
  const store = new DemoWorkspaceStore()
  const saved = await data(store, '/api/auth/profile', write('PUT', { displayName: '  My demo name  ', avatarDataUrl: null }))
  assert.equal(saved.ok, true)
  assert.equal(saved.profile.displayName, 'My demo name')
  assert.equal((await data(store, '/api/auth/me')).displayName, 'My demo name')
  assert.equal((await data(store, '/api/auth/me')).hasPassword, false)
  assert.equal((await demoFetch(store, '/api/auth/profile', write('PUT', { displayName: '', avatarDataUrl: null }))).status, 400)
  assert.equal((await demoFetch(store, '/api/auth/profile', write('PUT', { displayName: 'Valid', avatarDataUrl: 'https://outside.example/avatar.png' }))).status, 400)
  for (const path of ['/api/auth/login', '/api/auth/change-password']) {
    const response = await demoFetch(store, path, write('POST', { email: 'real@example.test', password: 'never store credentials' }))
    assert.equal(response.status, 501)
    assert.match((await response.json()).error, /실제 계정/)
  }
})

test('the demo pet reuses shipped sprite manifests and fetches only allowlisted public assets', async () => {
  const store = new DemoWorkspaceStore(), catalog = await data(store, '/api/mewpet/skins') as MewpetSkinCatalog
  assert.equal(catalog.canManage, false)
  assert.equal(catalog.skins.length, 1)
  for (const action of MEWPET_ANIMATIONS) {
    const sprite = catalog.skins[0].sprites[action]!
    const png = fs.readFileSync(new URL(`../../public/mewcat/capybara/${action}.png`, import.meta.url))
    assert.equal(sprite.width, png.readUInt32BE(16))
    assert.equal(sprite.height, png.readUInt32BE(20))
  }
  const original = globalThis.fetch, requests: string[] = []
  globalThis.fetch = (async input => { requests.push(String(input)); return new Response('sprite', { headers: { 'Content-Type': 'image/webp' } }) }) as typeof fetch
  try {
    const response = await demoFetch(store, catalog.skins[0].sprites.idle.url)
    assert.equal(await response.text(), 'sprite')
    assert.deepEqual(requests, ['https://demo.mew.test/demo/mewcat/capybara/idle.webp'])
    assert.equal((await demoFetch(store, '/api/mewpet/skins/private/idle')).status, 501)
    assert.equal((await demoFetch(store, catalog.skins[0].sprites.idle.url, { method: 'POST' })).status, 405)
    assert.equal(requests.length, 1)
  } finally { globalThis.fetch = original }
})
