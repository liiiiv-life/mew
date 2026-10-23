import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'rolldown'
import type { FileVersion } from '../../shared/file-version.ts'

test('file client reuses only matching complete cache content through the remote transport', async t => {
  const storage = new Map<string, string>()
  for (const [key, value] of Object.entries({ localStorage: { getItem: (key: string) => storage.get(key) ?? null }, location: { pathname: '/' } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { value, configurable: true })
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key) })
  }
  const client = new URL('./client.ts', import.meta.url).pathname
  const transport = new URL('../utils/remote-transport.ts', import.meta.url).pathname
  const bundled = await build({
    input: 'virtual:file-client', write: false, platform: 'browser', output: { format: 'esm' },
    plugins: [{ name: 'file-client-fixture', resolveId: id => id === 'virtual:file-client' ? id : undefined,
      load: id => id === 'virtual:file-client' ? `export { fetchFile } from ${JSON.stringify(client)}; export { setRemoteTransport } from ${JSON.stringify(transport)};` : undefined }],
  })
  const chunk = bundled.output.find(item => item.type === 'chunk')!
  assert.equal(bundled.output.length, 1)
  const api = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`) as {
    fetchFile(path: string, project?: string, cached?: { content: string; version?: FileVersion }): Promise<{ path: string; content: string; editable: boolean; version: FileVersion }>
    setRemoteTransport(transport: { fetch(input: unknown): Promise<Response>; socket(): never; close(): void }): void
  }
  const version: FileVersion = { size: 4, mtimeMs: 12, ctimeMs: 14, tag: 'current-version' }
  const urls: URL[] = []
  const responses: unknown[] = []
  api.setRemoteTransport({
    async fetch(input) {
      urls.push(new URL(String(input), 'https://device.test'))
      assert.ok(responses.length, 'only expected requests run')
      return Response.json(responses.shift())
    }, socket() { throw new Error('Unexpected socket') }, close() {},
  })
  const cached = { content: 'body', version }
  responses.push({ path: 'a & b.md', editable: false, version, unchanged: true, partial: false })
  assert.deepEqual(await api.fetchFile('a & b.md', 'one & two', cached), { path: 'a & b.md', content: 'body', editable: false, version })
  assert.equal(urls[0].searchParams.get('project'), 'one & two')
  assert.equal(urls[0].searchParams.get('path'), 'a & b.md')
  assert.equal(urls[0].searchParams.get('version'), version.tag)
  assert.equal(cached.content, 'body')

  const newer = { ...version, tag: 'new-version' }
  responses.push({ path: 'note.md', content: 'new body', editable: true, version: newer, partial: false })
  assert.equal((await api.fetchFile('note.md', 'docs', cached)).content, 'new body')

  responses.push({ path: 'empty.md', unchanged: true, editable: true, version })
  assert.equal((await api.fetchFile('empty.md', 'docs', { content: '', version })).content, '', 'an empty cached body is valid')
  responses.push({ path: 'legacy.md', content: 'fresh', editable: true, version })
  await api.fetchFile('legacy.md', 'docs', { content: 'old', version: { size: 3, mtimeMs: 0 } })
  assert.equal(urls.at(-1)!.searchParams.has('version'), false, 'legacy revisions trigger full reads')

  responses.push({ path: 'mismatch.md', unchanged: true, editable: true, version: newer }, { path: 'mismatch.md', content: 'verified', editable: true, version: newer })
  assert.equal((await api.fetchFile('mismatch.md', 'docs', cached)).content, 'verified')
  assert.equal(urls.at(-1)!.searchParams.has('version'), false, 'unexpected unchanged revisions retry without a validator')
  responses.push({ path: 'broken.md', unchanged: true, editable: true, version }, { path: 'broken.md', unchanged: true, editable: true, version })
  await assert.rejects(api.fetchFile('broken.md', 'docs'), /파일 본문/)
  assert.equal(responses.length, 0)
})
