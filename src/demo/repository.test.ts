import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { DemoRepository, createDemoRepositoryLoader, type DemoRepositoryEntry, type DemoRepositoryPayload } from './repository.ts'
import { DemoWorkspaceStore } from './workspace-store.ts'
import { createDemoResources } from './resources.ts'
import { createDemoCollaboration } from './collaboration.ts'
import type { CollaborationSession } from '../runtime/app-runtime.ts'

const source = (content: string): DemoRepositoryEntry => ({ oid: createHash('sha256').update(JSON.stringify({ content })).digest('hex'), size: Buffer.byteLength(content), binary: false })
const index = (files: Record<string, DemoRepositoryEntry>) => ({ format: 'mew-demo-snapshot/v2', revision: 'f'.repeat(40), files })

test('repository caches only requested immutable content and evicts within its byte budget', async () => {
  const a = source('alpha'), b = source('bravo'), calls: string[] = []
  const repository = new DemoRepository(index({ 'a.ts': a, 'b.ts': b }), async oid => { calls.push(oid); return { content: oid === a.oid ? 'alpha' : 'bravo' } }, 5)
  const store = new DemoWorkspaceStore(repository)
  assert.ok(store.tree().some(file => file.name === 'a.ts'))
  assert.deepEqual(calls, [])
  await store.loadFile('a.ts'); assert.equal(store.readFile('a.ts').content, 'alpha')
  await store.loadFile('a.ts'); assert.equal(calls.length, 1)
  store.writeFile('a.ts', 'changed')
  await store.loadFile('b.ts'); assert.equal(repository.cachedBytes, 5)
  assert.equal(store.readFile('a.ts').content, 'changed')
  assert.equal(store.gitWorkingTree().files.find(file => file.path === 'a.ts')?.status, 'M')
  await store.loadDiff('a.ts'); assert.match(store.gitDiff('a.ts').diff, /-alpha[\s\S]*\+changed/)
  store.writeFile('a.ts', 'alpha')
  await store.loadFile('b.ts')
  assert.deepEqual(store.gitWorkingTree().files, [], 'cache eviction cannot mark an edit restored to its original text dirty')
})

test('discovering an identical overwrite stays clean after later source cache eviction', async () => {
  const a = source('alpha'), b = source('bravo')
  const store = new DemoWorkspaceStore(new DemoRepository(index({ 'a.ts': a, 'b.ts': b }), async oid => ({ content: oid === a.oid ? 'alpha' : 'bravo' }), 5))
  store.writeFile('a.ts', 'alpha')
  await store.loadDiff('a.ts')
  assert.deepEqual(store.gitWorkingTree().files, [])
  await store.loadFile('b.ts')
  assert.deepEqual(store.gitWorkingTree().files, [])
})

test('edits, commits, moving unread sources and discarding work without hydrating unrelated files', async () => {
  const original = source('original'), other = source('not loaded'), calls: string[] = []
  const store = new DemoWorkspaceStore(new DemoRepository(index({ 'folder/a.ts': original, 'folder/b.ts': other }), async oid => { calls.push(oid); return { content: oid === original.oid ? 'original' : 'not loaded' } }))
  store.movePath('folder', 'moved')
  assert.equal(calls.length, 0)
  store.commit('Move source folder')
  assert.deepEqual(store.gitWorkingTree().files, [])
  await store.loadFile('moved/a.ts'); store.writeFile('moved/a.ts', 'visitor edit')
  const commit = store.commit('Edit source')
  await store.loadDiff('moved/a.ts', commit.hash)
  assert.match(store.gitDiff('moved/a.ts', commit.hash).diff, /visitor edit/)
  store.writeFile('moved/a.ts', 'temporary'); store.discard(['moved/a.ts'])
  assert.equal(store.readFile('moved/a.ts').content, 'visitor edit')
  assert.deepEqual(calls, [original.oid])
  store.reset()
  assert.equal(store.isFileLoaded('folder/a.ts'), false)
  assert.deepEqual(store.gitWorkingTree().files, [])
})

test('shared loads deduplicate and only abort the underlying request after every waiter cancels', async () => {
  const file = source('loaded'), first = new AbortController(), second = new AbortController()
  let requests = 0, actualSignal: AbortSignal | undefined
  let complete!: (payload: DemoRepositoryPayload) => void
  const repository = new DemoRepository(index({ 'a.ts': file }), async (_oid, signal) => { requests++; actualSignal = signal; return new Promise(resolve => { complete = resolve }) })
  const one = repository.load(file, first.signal), two = repository.load(file, second.signal)
  first.abort(); await assert.rejects(one, { name: 'AbortError' })
  assert.equal(actualSignal?.aborted, false)
  complete({ content: 'loaded' }); await two
  assert.equal(requests, 1); assert.equal(repository.peek(file), 'loaded')
  repository.clear()
  const cancelled = repository.load(file, second.signal)
  second.abort(); await assert.rejects(cancelled, { name: 'AbortError' })
  assert.equal(actualSignal?.aborted, true)
  complete({ content: 'loaded' }); await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(repository.cachedObjects, 0)
})

test('discard restores an active collaborative editor even after its source was evicted', async () => {
  const a = source('alpha'), b = source('bravo')
  const store = new DemoWorkspaceStore(new DemoRepository(index({ 'a.ts': a, 'b.ts': b }), async oid => ({ content: oid === a.oid ? 'alpha' : 'bravo' }), 5))
  await store.loadFile('a.ts')
  const collaboration = createDemoCollaboration(store)
  let room: CollaborationSession | undefined
  const session = collaboration.open({ project: '.workspace', path: 'a.ts', authEmail: null }, value => { room = value })
  try {
    assert.equal(room?.ydoc.getText('content').toString(), 'alpha')
    store.writeFile('a.ts', 'changed')
    await store.loadFile('b.ts')
    store.discard(['a.ts'])
    assert.equal(room?.ydoc.getText('content').toString(), 'alpha')
    assert.equal(store.isFileLoaded('a.ts'), true)
    assert.deepEqual(store.gitWorkingTree().files, [])
  } finally { session.close(); collaboration.close() }
})

test('static loader is confined to pinned hashes and rejects modified contents and redirects', async () => {
  const entry = source('trusted'), requests: { url: string; options?: RequestInit }[] = []
  const load = createDemoRepositoryLoader('/demo', async (url, options) => { requests.push({ url: String(url), options }); return new Response(JSON.stringify({ content: 'trusted' })) })
  assert.deepEqual(await load(entry.oid), { content: 'trusted' })
  assert.equal(requests[0].url, `/demo/repository/${entry.oid}.json`)
  assert.equal(requests[0].options?.credentials, 'omit'); assert.equal(requests[0].options?.redirect, 'error')
  await assert.rejects(load('../../api/auth'), /주소/)
  const modified = createDemoRepositoryLoader('/demo', async () => new Response(JSON.stringify({ content: 'tampered' })))
  await assert.rejects(modified(entry.oid), /내용/)
})

test('media URLs use native static aliases and explicit ZIP downloads include text and binary bytes', async () => {
  const text = source('lazy source'), bytes = Buffer.from([0, 255, 11, 0]), binary = { oid: 'b'.repeat(64), size: bytes.length, binary: true }
  const calls: string[] = []
  const store = new DemoWorkspaceStore(new DemoRepository(index({ 'folder/a.ts': text, 'folder/photo.png': binary }), async oid => {
    calls.push(oid); return oid === text.oid ? { content: 'lazy source' } : { base64: bytes.toString('base64') }
  }))
  const resources = createDemoResources(store)
  try {
    assert.equal(resources.url('/api/raw?path=folder%2Fphoto.png'), `/demo/repository/${binary.oid}.png`)
    assert.deepEqual(calls, [])
    store.openWorkspace(`${store.workspacePath}/docs`)
    const download = await resources.prepare(`/api/fs/download?path=${encodeURIComponent(`${store.workspacePath}/folder`)}`)
    const archive = Buffer.from(await (await fetch(download)).arrayBuffer())
    assert.ok(archive.includes(bytes)); assert.ok(archive.includes(Buffer.from('lazy source')))
    assert.ok(archive.includes(Buffer.from('folder/photo.png')))
    assert.equal(calls.length, 2)
    assert.deepEqual(store.gitWorkingTree().files, [])
    resources.release(download); await assert.rejects(fetch(download))
    store.reset()
  } finally { resources.close() }
})
