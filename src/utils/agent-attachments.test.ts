import test from 'node:test'
import assert from 'node:assert/strict'
import { attachmentKind, conversationAttachments, uploadedAttachmentTokens, withoutAttachmentTokens } from './agent-attachments.ts'

test('attachment icons use MIME and fall back to extensions for untyped uploads', () => {
  assert.equal(attachmentKind('image/jpeg', 'upload.bin'), 'image')
  assert.equal(attachmentKind('video/mp4', 'clip'), 'video')
  assert.equal(attachmentKind('audio/mpeg', 'voice'), 'audio')
  assert.equal(attachmentKind('', 'PHOTO.JPG'), 'image')
  assert.equal(attachmentKind('application/octet-stream', 'clip.webm'), 'video')
  assert.equal(attachmentKind('', 'voice.mp3'), 'audio')
  assert.equal(attachmentKind('text/plain', 'example.png'), 'file')
  assert.equal(attachmentKind('', 'README'), 'file')
})

test('restored upload references retain scope and deduplicate metadata', () => {
  const photo = { project: '.workspace', path: '.mew/temp/assets/photo copy.jpg', mimeType: 'image/jpeg' }
  const files = conversationAttachments(
    '사진 확인\n[[.workspace:.mew/temp/assets/photo copy.jpg]]\n[[docs:.mew/files/clip.mp4]]\n[[docs:guide.md]]',
    [photo], [{ path: photo.path, mimeType: photo.mimeType }], '.workspace',
  )
  assert.deepEqual(files, [photo, { project: 'docs', path: '.mew/files/clip.mp4', mimeType: '' }])
  assert.deepEqual(conversationAttachments('ordinary [[docs:guide.md]] mention', [], [], '.workspace'), [])
})

test('uploaded attachment tokens retain document offsets and distinguish upload references from ordinary mentions', () => {
  const photo = '[[.workspace:.mew/temp/assets/사진 copy.jpg]]'
  const legacy = '[[docs:.mew/files/clip.mp4]]'
  const text = `앞 ${photo} 중간 ${legacy} 뒤 ${photo}\n[[docs:guide.md]] [[mew-upload:69d56432-f275-4489-821f-8ae04804211f]]`
  const tokens = uploadedAttachmentTokens(text)
  assert.deepEqual(tokens.map(({ token, project, path }) => ({ token, project, path })), [
    { token: photo, project: '.workspace', path: '.mew/temp/assets/사진 copy.jpg' },
    { token: legacy, project: 'docs', path: '.mew/files/clip.mp4' },
    { token: photo, project: '.workspace', path: '.mew/temp/assets/사진 copy.jpg' },
  ])
  assert.equal(tokens[0].from, 2)
  assert.equal(tokens[1].from, text.indexOf(legacy))
  assert.equal(tokens[2].from, text.lastIndexOf(photo))
  for (const { from, to, token } of tokens) assert.equal(text.slice(from, to), token)
  assert.deepEqual(uploadedAttachmentTokens('[[docs:.mew/assets/broken\nname.jpg]] [[docs:.mew/assets/]]'), [])
})

test('removing attachment tokens preserves surrounding whitespace and ordinary file mentions', () => {
  const text = '  앞[[.workspace:.mew/assets/photo.jpg]]  뒤\n[[docs:.mew/files/old.pdf]]\n[[mew-upload:69d56432-f275-4489-821f-8ae04804211f]] [[docs:guide.md]]  '
  assert.equal(withoutAttachmentTokens(text), '  앞  뒤\n\n [[docs:guide.md]]  ')
  assert.equal(withoutAttachmentTokens('텍스트만\n  입력 '), '텍스트만\n  입력 ')
  assert.equal(withoutAttachmentTokens('[[.workspace:.mew/assets/photo.jpg]][[.workspace:.mew/assets/photo.jpg]]'), '')
})
