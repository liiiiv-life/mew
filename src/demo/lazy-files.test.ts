import assert from 'node:assert/strict'
import test from 'node:test'
import { DemoRepository, type DemoRepositoryEntry, type DemoRepositoryPayload } from './repository.ts'
import { demoFetch } from './transport.ts'
import { DemoError, DemoWorkspaceStore } from './workspace-store.ts'

function fixture(files: Record<string, string | Uint8Array>, wait?: () => Promise<void>) {
  const entries: Record<string, DemoRepositoryEntry> = {}, payloads = new Map<string, DemoRepositoryPayload>(), paths = new Map<string, string>(), fetched: string[] = []
  for (const [path, content] of Object.entries(files)) {
    const oid = (paths.size + 1).toString(16).padStart(64, '0')
    entries[path] = { oid, size: typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength, binary: typeof content !== 'string' }
    payloads.set(oid, typeof content === 'string' ? { content } : { base64: Buffer.from(content).toString('base64') })
    paths.set(oid, path)
  }
  const repository = new DemoRepository({ format: 'mew-demo-repository-v1', revision: 'test', files: entries }, async oid => {
    fetched.push(paths.get(oid)!)
    if (wait) await wait()
    return payloads.get(oid)!
  })
  return { store: new DemoWorkspaceStore(repository), repository, fetched }
}

async function json(store: DemoWorkspaceStore, input: string, init?: RequestInit) {
  const response = await demoFetch(store, input, init)
  assert.equal(response.status, 200, await response.clone().text())
  return response.json()
}

const mutate = (store: DemoWorkspaceStore, action: string, fields: Record<string, unknown>) => json(store, `/api/docs/pages/${action}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'docs', ...fields }),
})

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test('tree, filesystem entries, filename search and agent links inspect lazy files without fetching contents', async t => {
  const { store, fetched } = fixture({ 'docs/lazy-metadata/unread.md': '# Unread\n', 'docs/lazy-metadata/picture.png': new Uint8Array([1, 2, 3]) })
  t.after(() => store.close())
  const tree = await json(store, '/api/tree?v=1&path=docs/lazy-metadata')
  assert.deepEqual(tree.entries.map((entry: { name: string }) => entry.name), ['picture.png', 'unread.md'])
  const entries = await json(store, `/api/fs/entries?path=${encodeURIComponent(`${store.workspacePath}/docs/lazy-metadata`)}`)
  assert.equal(entries.entries.find((entry: { name: string }) => entry.name === 'picture.png')?.size, 3)
  const names = await json(store, '/api/search/files?q=lazy-metadata%2Fpicture.png')
  assert.ok(names.results.some((entry: { path: string }) => entry.path === 'docs/lazy-metadata/picture.png'))
  const link = await json(store, '/api/agent-file-link?href=docs%2Flazy-metadata%2Funread.md%3A7')
  assert.deepEqual(link.target, { project: '.workspace', path: 'docs/lazy-metadata/unread.md', line: 7 })
  assert.deepEqual(fetched, [])
  assert.deepEqual(store.gitWorkingTree().files, [])
})

test('opening one lazy file fetches once and reuses its cache without dirtying Git', async t => {
  const path = 'src/lazy-opening/example.ts', content = 'export const lazy = true\n'
  const { store, fetched } = fixture({ [path]: content, 'src/lazy-opening/other.ts': 'export const other = true\n' })
  t.after(() => store.close())
  assert.throws(() => store.readFile(path), error => error instanceof DemoError && error.status === 503)
  const version = store.fileInfo(path).version.tag
  const unchanged = await json(store, `/api/file?path=${path}&version=${version}`)
  assert.equal(unchanged.unchanged, true)
  assert.deepEqual(fetched, [], 'known versions can be revalidated without fetching a body')
  assert.equal((await json(store, `/api/file?path=${path}`)).content, content)
  assert.equal((await json(store, `/api/file?path=${path}`)).content, content)
  assert.deepEqual(fetched, [path])
  assert.equal(store.isFileLoaded('src/lazy-opening/other.ts'), false)
  assert.deepEqual(store.gitWorkingTree().files, [])
})

test('Documents rename and copy preserve unread code and binary refs while loading only Markdown', async t => {
  const content = '# Lazy parent\n\n[Source](unread.ts)\n'
  const { store, fetched } = fixture({
    'docs/lazy-pages/_lazy-pages.md': content,
    'docs/lazy-pages/unread.ts': 'export const untouched = true\n',
    'docs/lazy-pages/picture.png': new Uint8Array([1, 2, 3]),
  })
  t.after(() => store.close())
  const code = store.sourceEntry('docs/lazy-pages/unread.ts'), binary = store.sourceEntry('docs/lazy-pages/picture.png')
  const renamed = await mutate(store, 'rename', { path: 'lazy-pages', name: 'renamed-lazy' })
  assert.equal(renamed.path, 'renamed-lazy/_renamed-lazy.md')
  assert.equal(store.readFile(renamed.path, 'docs').content, content)
  assert.deepEqual(store.sourceEntry('docs/renamed-lazy/unread.ts'), code)
  assert.deepEqual(store.sourceEntry('docs/renamed-lazy/picture.png'), binary)
  assert.equal(store.isFileLoaded('docs/renamed-lazy/unread.ts'), false)
  const copied = await mutate(store, 'copy', { path: 'renamed-lazy', destination: '' })
  assert.equal(copied.path, 'renamed-lazy copy/_renamed-lazy copy.md')
  assert.deepEqual(store.sourceEntry('docs/renamed-lazy copy/unread.ts'), code)
  assert.deepEqual(store.sourceEntry('docs/renamed-lazy copy/picture.png'), binary)
  assert.equal(store.isFileLoaded('docs/renamed-lazy copy/unread.ts'), false)
  assert.deepEqual(fetched, ['docs/lazy-pages/_lazy-pages.md'])
})

test('scoped content search fetches matching text scope, skips binary files and bounds result lines', async t => {
  const path = 'src/lazy-search/matches.ts'
  const { store, fetched } = fixture({
    [path]: Array.from({ length: 1002 }, (_, index) => `lazy-search-needle ${index}`).join('\n'),
    'src/lazy-search/picture.png': new Uint8Array([1, 2, 3]),
    'src/outside-search/unread.ts': 'lazy-search-needle outside\n',
  })
  t.after(() => store.close())
  const result = await json(store, '/api/search?q=lazy-search-needle&scopes=src%2Flazy-search')
  assert.equal(result.truncated, true)
  assert.equal(result.results.length, 1)
  assert.equal(result.results[0].path, path)
  assert.equal(result.results[0].matches.length, 1000)
  assert.deepEqual(fetched, [path])
  assert.equal(store.isFileLoaded('src/outside-search/unread.ts'), false)
  assert.deepEqual(store.gitWorkingTree().files, [])
})

test('explicit backlinks load unread Markdown references without fetching unrelated code or binaries', async t => {
  const { store, fetched } = fixture({
    'docs/lazy-backlinks/target.md': '# Target\n',
    'docs/lazy-backlinks/reference.md': '# Reference\n\n[Target](target.md)\n',
    'docs/lazy-backlinks/unread.ts': 'export const unrelated = true\n',
    'docs/lazy-backlinks/picture.png': new Uint8Array([1, 2, 3]),
  })
  t.after(() => store.close())
  const result = await json(store, '/api/docs/backlinks?path=lazy-backlinks%2Ftarget.md&project=docs')
  assert.ok(result.documents.some((entry: { path: string }) => entry.path === 'lazy-backlinks/reference.md'))
  assert.equal(result.skipped, 0)
  assert.deepEqual(fetched.sort(), ['docs/lazy-backlinks/reference.md', 'docs/lazy-backlinks/target.md'])
  assert.deepEqual(store.gitWorkingTree().files, [])
})

test('cancelling a lazy content search prevents later file batches from starting', async t => {
  const files: Record<string, DemoRepositoryEntry> = {}, fetched: string[] = []
  for (let index = 1; index <= 12; index++) files[`src/lazy-cancel/${index}.ts`] = { oid: index.toString(16).padStart(64, '0'), size: 7, binary: false }
  let release = () => {}, started = () => {}
  const gate = new Promise<void>(resolve => { release = resolve }), pending = new Promise<void>(resolve => { started = resolve })
  const repository = new DemoRepository({ format: 'mew-demo-repository-v1', revision: 'test', files }, async oid => {
    fetched.push(oid)
    if (fetched.length === 6) started()
    await gate
    return { content: 'needle\n' }
  })
  const store = new DemoWorkspaceStore(repository), controller = new AbortController()
  t.after(() => { release(); store.close() })
  const search = demoFetch(store, '/api/search?q=needle&scopes=src%2Flazy-cancel', { signal: controller.signal })
  await pending
  controller.abort()
  await assert.rejects(search, { name: 'AbortError' })
  assert.equal(fetched.length, 6)
  release()
})

test('pending file reads retain their original absolute path when the workspace switches', async t => {
  const started = deferred(), released = deferred(), path = 'docs/lazy-race/probe.md', content = '# Original root\n'
  const { store } = fixture({ [path]: content }, () => { started.resolve(); return released.promise })
  t.after(() => { released.resolve(); store.close() })
  store.writeFile('src/docs/lazy-race/probe.md', '# Other root\n')
  const request = demoFetch(store, '/api/file?path=lazy-race%2Fprobe.md&project=docs')
  await started.promise
  store.openWorkspace(`${store.workspacePath}/src`)
  released.resolve()
  const response = await request
  assert.equal(response.status, 200)
  const file = await response.json()
  assert.equal(file.path, 'lazy-race/probe.md')
  assert.equal(file.content, content)
  assert.equal(store.readFile('lazy-race/probe.md', 'docs').content, '# Other root\n')
})

test('pending lazy mutations reject a workspace switch before writing another project', async t => {
  for (const operation of ['save', 'replace', 'page'] as const) await t.test(operation, async t => {
    const started = deferred(), released = deferred(), path = 'docs/lazy-race/probe.md', content = '# Original root\n'
    const { store } = fixture({ [path]: content }, () => { started.resolve(); return released.promise })
    t.after(() => { released.resolve(); store.close() })
    store.writeFile('src/docs/lazy-race/probe.md', '# Other root\n')
    const fields = operation === 'save' ? { path: 'lazy-race/probe.md', content: '# Changed\n', expectedContent: content }
      : operation === 'replace' ? { path: 'lazy-race/probe.md', query: 'root', replace: 'changed' }
        : { path: 'lazy-race/probe.md', name: 'Child' }
    const route = operation === 'save' ? '/api/file' : operation === 'replace' ? '/api/search/replace' : '/api/docs/pages/create'
    const request = demoFetch(store, route, { method: operation === 'save' ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'docs', ...fields }) })
    await started.promise
    store.openWorkspace(`${store.workspacePath}/src`)
    released.resolve()
    const response = await request
    assert.equal(response.status, 409, await response.clone().text())
    assert.equal(store.readFile(`${store.workspacePath}/${path}`).content, content)
    assert.equal(store.readFile('lazy-race/probe.md', 'docs').content, '# Other root\n')
    assert.equal(store.hasFile('lazy-race/probe/Child.md', 'docs'), false)
  })
})
