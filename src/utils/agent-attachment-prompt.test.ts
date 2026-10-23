import test from 'node:test'
import assert from 'node:assert/strict'
import { attachmentPrompt } from '../../shared/agent-attachment.ts'

const photo = { project: '.workspace', path: '.mew/assets/photo.jpg', mimeType: 'image/jpeg' }
const document = { project: 'docs', path: '.mew/files/notes.pdf', mimeType: 'application/pdf' }

test('attachment prompts preserve inline references and append only missing files', () => {
  const text = '앞 [[docs:.mew/files/notes.pdf]] 뒤 [[.workspace:.mew/assets/photo.jpg]] 설명'
  assert.equal(attachmentPrompt(text, [photo, document]), text)
  assert.equal(attachmentPrompt('앞 [[.workspace:.mew/assets/photo.jpg]] 뒤', [photo, document]),
    '앞 [[.workspace:.mew/assets/photo.jpg]] 뒤\n[[docs:.mew/files/notes.pdf]]')
})

test('legacy and attachment-only prompts retain their metadata order without duplicate appended refs', () => {
  assert.equal(attachmentPrompt('  예전 본문  ', [photo, document, photo]),
    '예전 본문\n[[.workspace:.mew/assets/photo.jpg]]\n[[docs:.mew/files/notes.pdf]]')
  assert.equal(attachmentPrompt(' ', [document]), '[[docs:.mew/files/notes.pdf]]')
  assert.equal(attachmentPrompt('  본문만  ', []), '본문만')
})

test('attachment refs use the exact project and path, preserving repeated inline uses', () => {
  const repeated = '[[.workspace:.mew/assets/photo.jpg]]와 [[.workspace:.mew/assets/photo.jpg]]'
  assert.equal(attachmentPrompt(repeated, [photo]), repeated)
  assert.equal(attachmentPrompt('[[docs:.mew/assets/photo.jpg]]', [photo]),
    '[[docs:.mew/assets/photo.jpg]]\n[[.workspace:.mew/assets/photo.jpg]]')
})
