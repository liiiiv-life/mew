import test from 'node:test'
import assert from 'node:assert/strict'
import { clipboardImages } from './clipboard-images.ts'

test('clipboard images preserve multiple photos without duplicating files also exposed as items', () => {
  const first = new File(['one'], 'one.png', { type: 'image/png' })
  const second = new File(['two'], 'two.jpg', { type: 'image/jpeg' })
  const text = new File(['text'], 'note.txt', { type: 'text/plain' })
  const data = {
    files: [first, text, second],
    items: [{ kind: 'file', type: 'image/png', getAsFile: () => first }],
  } as unknown as DataTransfer
  assert.deepEqual(clipboardImages(data), [first, second])
})

test('clipboard images fall back to file items, ignoring missing files and text', () => {
  const image = new File(['image'], 'photo.webp', { type: 'image/webp' })
  const data = {
    files: [],
    items: [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => null },
      { kind: 'file', type: 'image/webp', getAsFile: () => image },
    ],
  } as unknown as DataTransfer
  assert.deepEqual(clipboardImages(data), [image])
  assert.deepEqual(clipboardImages(null), [])
})
