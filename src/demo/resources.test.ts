import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DemoWorkspaceStore } from './workspace-store.ts'
import { createDemoResources } from './resources.ts'

test('native file URLs become local blobs and change with the underlying file', async () => {
  const store = new DemoWorkspaceStore(), resources = createDemoResources(store)
  try {
    const input = '/api/raw?path=welcome.md&project=docs', initial = resources.url(input)
    assert.match(initial, /^blob:/)
    assert.equal(resources.url(input), initial)
    assert.equal(await (await fetch(initial)).text(), store.readFile('welcome.md', 'docs').content)
    store.writeFile('welcome.md', '# A revised document\n', 'docs')
    await assert.rejects(fetch(initial))
    const changed = resources.url(input)
    assert.notEqual(initial, changed)
    assert.equal(await (await fetch(changed)).text(), '# A revised document\n')
    assert.equal(resources.url('/demo/mewcat/capybara/idle.webp'), '/demo/mewcat/capybara/idle.webp')
  } finally { resources.close() }
})

test('folder downloads are valid UTF-8 ZIP archives containing current visitor files', async () => {
  const store = new DemoWorkspaceStore(), resources = createDemoResources(store)
  store.writeFile('docs/내 아이디어.md', 'Moonlight idea\n')
  try {
    const response = await fetch(resources.url('/api/download?path=docs&project=.workspace'))
    assert.equal(response.headers.get('Content-Type'), 'application/zip')
    const bytes = new Uint8Array(await response.arrayBuffer()), data = new DataView(bytes.buffer), decoder = new TextDecoder()
    const entries = new Map<string, string>()
    let offset = 0
    while (data.getUint32(offset, true) === 0x04034b50) {
      assert.equal(data.getUint16(offset + 6, true), 0x800)
      assert.equal(data.getUint16(offset + 8, true), 0)
      const size = data.getUint32(offset + 18, true), nameLength = data.getUint16(offset + 26, true), extraLength = data.getUint16(offset + 28, true)
      const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength)), start = offset + 30 + nameLength + extraLength
      entries.set(name, decoder.decode(bytes.subarray(start, start + size))); offset = start + size
    }
    assert.equal(entries.get('docs/내 아이디어.md'), 'Moonlight idea\n')
    assert.equal(entries.get('docs/welcome.md'), store.readFile('welcome.md', 'docs').content)
    assert.equal(data.getUint32(offset, true), 0x02014b50)
    assert.equal(data.getUint32(bytes.length - 22, true), 0x06054b50)
    assert.equal(data.getUint16(bytes.length - 12, true), entries.size)
    assert.equal(entries.has('src/main.tsx'), false)
  } finally { resources.close() }
})

test('missing and unsupported API resources return a local explanation without native requests', async () => {
  const store = new DemoWorkspaceStore(), resources = createDemoResources(store)
  try {
    for (const input of ['/api/raw?path=missing.md', '/api/private', '/api/fs/raw?path=%2Fetc%2Fpasswd', 'https://outside.example/api/raw?path=README.md']) {
      const output = resources.url(input)
      assert.match(output, /^blob:/)
      const response = await fetch(output)
      assert.match(response.headers.get('Content-Type') ?? '', /text\/plain/)
      assert.ok((await response.text()).length > 0)
    }
  } finally { resources.close() }
})

test('reset and close revoke every URL, and closed resources allocate no new blobs', async () => {
  const store = new DemoWorkspaceStore(), resources = createDemoResources(store)
  const first = resources.url('/api/raw?path=README.md')
  store.reset()
  await assert.rejects(fetch(first))
  const second = resources.url('/api/raw?path=README.md')
  store.close()
  await assert.rejects(fetch(second))
  assert.match(resources.url('/api/raw?path=README.md'), /^data:/)
  resources.close()
})

test('absolute directory downloads include their files while another nested workspace is active', async () => {
  const store = new DemoWorkspaceStore(), resources = createDemoResources(store)
  store.openWorkspace(`${store.workspacePath}/docs`)
  try {
    const input = `/api/fs/download?path=${encodeURIComponent(`${store.workspacePath}/src`)}`
    const response = await fetch(resources.url(input)), bytes = Buffer.from(await response.arrayBuffer())
    assert.equal(response.headers.get('Content-Type'), 'application/zip')
    assert.ok(bytes.includes(Buffer.from('src/main.tsx')))
    assert.ok(bytes.includes(Buffer.from(store.readFile(`${store.workspacePath}/src/main.tsx`).content)))
  } finally { resources.close() }
})
