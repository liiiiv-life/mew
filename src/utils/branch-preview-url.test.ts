import test from 'node:test'
import assert from 'node:assert/strict'
import { branchPreviewUrl, loadBranchPreviewBase } from './branch-preview-url.ts'
import { setRemoteTransport } from './remote-transport.ts'

test('direct preview links preserve the Mew access host and the app route', async () => {
  assert.equal(branchPreviewUrl(5101, '/', { remote: false }), '/5101/')
  assert.equal(branchPreviewUrl(5101, '/settings?tab=profile#name', { remote: false }), '/5101/settings?tab=profile#name')
  assert.deepEqual(await loadBranchPreviewBase(), { remote: false })
})

test('Mewlink preview links retain the public user and device instead of using the embedded app origin', () => {
  assert.equal(branchPreviewUrl(5102, '/search?q=hello', { remote: true, publicUrl: 'https://mew.run/alice/laptop' }), 'https://mew.run/alice/laptop/5102/search?q=hello')
  assert.equal(branchPreviewUrl(65535, '/', { remote: true, publicUrl: 'https://mew.example/alice/Work%20PC/' }), 'https://mew.example/alice/Work%20PC/65535/')
  for (const publicUrl of [undefined, 'https://app.mew.run', 'https://app.mew.run/__mew_ui/token/index.html', 'http://mew.run/alice/laptop', 'https://secret@mew.run/alice/laptop', 'https://mew.run/alice/laptop?session=secret', 'https://mew.run/alice/laptop#secret', 'https://mew.run/alice/laptop%2Fescape']) {
    assert.equal(branchPreviewUrl(5101, '/', { remote: true, publicUrl }), null, publicUrl)
  }
})

test('preview links reject invalid ports and paths that can escape the port boundary', () => {
  for (const port of [0, -1, 65536, 12.5, NaN]) assert.equal(branchPreviewUrl(port, '/', { remote: false }), null)
  for (const path of ['https://evil.test', '//evil.test', '/\\evil.test', '/\n', '/../api/auth/me', '/folder/../../api', '/%2e%2e/api', '/folder/%2Fapi', '/%00', '/bad%']) {
    assert.equal(branchPreviewUrl(5101, path, { remote: false }), null, path)
  }
  assert.equal(branchPreviewUrl(5101, '/search?redirect=https%3A%2F%2Fexample.test', { remote: false }), '/5101/search?redirect=https%3A%2F%2Fexample.test')
})

test('remote preview context reads only the authorized public-address endpoint and fails closed', async () => {
  const paths: string[] = []
  let fail = false
  setRemoteTransport({
    fetch: async input => { paths.push(String(input)); return fail ? Response.json({ error: 'unavailable' }, { status: 503 }) : Response.json({ url: 'https://mew.run/alice/laptop' }) },
    socket() { throw new Error('No socket needed for preview links') }, close() {},
  })
  try {
    assert.deepEqual(await loadBranchPreviewBase(), { remote: true, publicUrl: 'https://mew.run/alice/laptop' })
    fail = true
    assert.deepEqual(await loadBranchPreviewBase(), { remote: true })
    assert.equal(branchPreviewUrl(5101), null)
    assert.deepEqual(paths, ['/api/port-preview/access-url', '/api/port-preview/access-url'])
  } finally { setRemoteTransport(null) }
})
