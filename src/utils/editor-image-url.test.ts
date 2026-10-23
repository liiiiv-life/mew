import test from 'node:test'
import assert from 'node:assert/strict'
import { editorImageUrl } from './editor-image-url.ts'

const workspace = { path: '/projects/mew', docsPath: '/projects/mew/docs' }
const resource = (url: string) => {
  const parsed = new URL(url, 'http://mew.test')
  return [parsed.pathname, parsed.searchParams.get('project'), parsed.searchParams.get('path'), parsed.hash]
}

test('document images use their file scope, including parent directories and external documents', () => {
  assert.deepEqual(resource(editorImageUrl('docs/assets/screenshots/split.png', 'README.md', '.workspace', workspace)), ['/api/raw', '.workspace', 'docs/assets/screenshots/split.png', ''])
  assert.deepEqual(resource(editorImageUrl('../assets/screenshots/split.png', 'guides/overview.md', 'docs', workspace)), ['/api/raw', 'docs', 'assets/screenshots/split.png', ''])
  assert.deepEqual(resource(editorImageUrl('../../public/logo.svg#mark', 'guides/overview.md', 'docs', workspace)), ['/api/raw', '.workspace', 'public/logo.svg', '#mark'])
  assert.deepEqual(resource(editorImageUrl('./image%20copy.png', '/projects/other/notes.md', '.workspace', workspace)), ['/api/fs/raw', null, '/projects/other/image copy.png', ''])
  assert.deepEqual(resource(editorImageUrl('../../../other/photo.png', 'guides/overview.md', 'docs', workspace)), ['/api/fs/raw', null, '/projects/other/photo.png', ''])
})

test('existing uploaded assets and browser image URLs retain their URLs', () => {
  for (const src of ['/api/asset?project=docs&path=image.png', '/api/raw?project=docs&path=image.png', 'https://example.com/image.png', '//example.com/image.png', 'data:image/png;base64,AAAA', 'blob:http://mew.test/image']) {
    assert.equal(editorImageUrl(src, 'guides/overview.md', 'docs', workspace), src)
  }
})
