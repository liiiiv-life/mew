import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, type Transaction } from '@codemirror/state'
import { history, isolateHistory, redo, undo } from '@codemirror/commands'
import { ComposerDocument } from './agent-composer-document.ts'

const firstId = '[[mew-upload:69d56432-f275-4489-821f-8ae04804211f]]'
const secondId = '[[mew-upload:second]]'
const firstRef = '[[.workspace:.mew/assets/a.png]]'
const secondRef = '[[.workspace:.mew/assets/첨부 파일 이름이 긴 두 번째 사진 copy.png]]'

function fixture() {
  const results = new Map<string, string>()
  const document = new ComposerDocument(token => results.get(token))
  return { document, results }
}

test('upload settlement serializes paths while retaining the original editing identity', () => {
  const { document, results } = fixture()
  const internal = `앞 ${firstId} 뒤\n[[docs:guide.md]]`
  document.remember(internal)
  assert.equal(document.canonical(internal), internal, 'an unresolved upload keeps its pending token')
  assert.equal(document.editor(internal), internal)

  results.set(firstId, firstRef)
  const canonical = `앞 ${firstRef} 뒤\n[[docs:guide.md]]`
  assert.equal(document.canonical(internal), canonical)
  assert.equal(document.editor(canonical), internal, 'settling an upload does not replace the editor identity')
  assert.equal(document.canonical(document.editor(canonical)), canonical)
  assert.equal(document.editor(document.canonical(internal)), internal)
  assert.equal(document.canonical(document.canonical(internal)), canonical, 'serialization is idempotent')
  assert.equal(document.editor(document.editor(canonical)), internal, 'editor conversion is idempotent')
})

test('unknown references and ordinary document text survive both document representations', () => {
  const { document, results } = fixture()
  results.set(firstId, firstRef)
  const text = `한글🙂\n${firstRef}\n[[docs:.mew/files/기존 자료.pdf]] [[docs:guide.md]]`
  assert.equal(document.editor(text), text, 'unremembered identities do not capture existing file references')
  assert.equal(document.canonical(text), text)
  document.remember('[[mew-upload:broken\nidentifier]]')
  assert.equal(document.editor(text), text, 'malformed pending tokens are not remembered')
})

test('deleting an attachment preserves its identity for undo, redo, and later clipboard insertion', () => {
  const { document, results } = fixture()
  const original = `시작 ${firstId} 끝`
  document.remember(original)
  results.set(firstId, firstRef)
  const deleted = '시작  끝'
  document.remember(deleted)
  assert.equal(document.canonical(deleted), deleted)
  assert.equal(document.editor(deleted), deleted)
  assert.equal(document.canonical(original), `시작 ${firstRef} 끝`, 'undo can restore the original editor token')
  assert.equal(document.editor(`시작 ${firstRef} 끝`), original, 'canonical restoration reuses the remembered identity')
  assert.equal(document.editor(firstRef), firstId, 'clipboard text resolves to the same editing identity')
  assert.equal(document.canonical(document.editor(firstRef)), firstRef)
})

test('repeated references remain repeated and share the remembered upload identity', () => {
  const { document, results } = fixture()
  const internal = `${firstId}${firstId}\n다시 ${firstId}`
  document.remember(internal)
  document.remember(internal)
  results.set(firstId, firstRef)
  const canonical = `${firstRef}${firstRef}\n다시 ${firstRef}`
  assert.equal(document.canonical(internal), canonical)
  assert.equal(document.editor(canonical), internal)
  assert.equal(document.canonical(document.editor(canonical)), canonical, 'serialization never deduplicates document content')
})

test('UTF-16 offsets round-trip across Korean text and multiple attachments of different serialized lengths', () => {
  const { document, results } = fixture()
  results.set(firstId, firstRef)
  results.set(secondId, secondRef)
  const segments = [
    { editor: '앞🙂 한글 ', canonical: '앞🙂 한글 ', atomic: false },
    { editor: firstId, canonical: firstRef, atomic: true },
    { editor: ' 중간\n다음 ', canonical: ' 중간\n다음 ', atomic: false },
    { editor: secondId, canonical: secondRef, atomic: true },
    { editor: ' 끝 [[docs:.mew/files/기존.pdf]]', canonical: ' 끝 [[docs:.mew/files/기존.pdf]]', atomic: false },
  ]
  const internal = segments.map(segment => segment.editor).join('')
  const canonical = segments.map(segment => segment.canonical).join('')
  document.remember(internal)
  assert.equal(document.canonical(internal), canonical)
  assert.equal(document.editor(canonical), internal)
  assert.ok(firstId.length > firstRef.length)
  assert.ok(secondId.length < secondRef.length)

  let editorStart = 0, canonicalStart = 0
  for (const segment of segments) {
    if (segment.atomic) {
      assert.equal(document.canonicalPosition(internal, editorStart), canonicalStart)
      assert.equal(document.canonicalPosition(internal, editorStart + segment.editor.length), canonicalStart + segment.canonical.length)
      assert.equal(document.editorPosition(internal, canonicalStart), editorStart)
      assert.equal(document.editorPosition(internal, canonicalStart + segment.canonical.length), editorStart + segment.editor.length)
      assert.equal(document.canonicalPosition(internal, editorStart + 1), canonicalStart, 'positions near a token start snap before it')
      assert.equal(document.canonicalPosition(internal, editorStart + segment.editor.length - 1), canonicalStart + segment.canonical.length)
      assert.equal(document.editorPosition(internal, canonicalStart + 1), editorStart)
      assert.equal(document.editorPosition(internal, canonicalStart + segment.canonical.length - 1), editorStart + segment.editor.length)
    } else {
      for (let offset = 0; offset <= segment.editor.length; offset++) {
        assert.equal(document.canonicalPosition(internal, editorStart + offset), canonicalStart + offset)
        assert.equal(document.editorPosition(internal, canonicalStart + offset), editorStart + offset)
      }
    }
    editorStart += segment.editor.length
    canonicalStart += segment.canonical.length
  }
})

test('unresolved tokens keep offsets stable until an upload settles', () => {
  const { document } = fixture()
  const text = `앞 ${firstId} 뒤`
  document.remember(text)
  const start = text.indexOf(firstId), end = start + firstId.length
  for (const position of [0, 1, start, end, text.length]) {
    assert.equal(document.canonicalPosition(text, position), position)
    assert.equal(document.editorPosition(text, position), position)
  }
})

test('failed uploads serialize to nothing and cannot be recreated from canonical content', () => {
  const { document, results } = fixture()
  const internal = `앞 ${firstId} 중간 ${secondId} 뒤`
  document.remember(internal)
  results.set(firstId, '')
  results.set(secondId, secondRef)
  const canonical = `앞  중간 ${secondRef} 뒤`
  assert.equal(document.canonical(internal), canonical)
  assert.equal(document.editor(canonical), `앞  중간 ${secondId} 뒤`, 'empty results cannot acquire an editing identity')
  assert.equal(document.canonical(firstId), '', 'a restored failed placeholder is still discarded')
  assert.equal(document.canonical(document.editor(canonical)), canonical)
  const failedStart = internal.indexOf(firstId)
  assert.equal(document.canonicalPosition(internal, failedStart), failedStart)
  assert.equal(document.canonicalPosition(internal, failedStart + firstId.length), failedStart)
  assert.equal(document.canonicalPosition(internal, failedStart + 1), failedStart)
  assert.equal(document.canonicalPosition(internal, internal.length), canonical.length)
  assert.equal(document.editorPosition(internal, canonical.length), internal.length)
})

test('settling a deleted upload preserves insertion and deletion history through repeated undo and redo', () => {
  const { document, results } = fixture()
  const plain = '앞 뒤'
  let state = EditorState.create({ doc: plain, extensions: [history()] })
  const dispatch = (transaction: Transaction) => {
    state = transaction.state
    document.remember(state.doc.toString())
  }
  dispatch(state.update({ changes: { from: 2, insert: firstId }, annotations: isolateHistory.of('full'), userEvent: 'input' }))
  dispatch(state.update({ changes: { from: 2, to: 2 + firstId.length }, annotations: isolateHistory.of('full'), userEvent: 'delete' }))
  assert.equal(state.doc.toString(), plain)

  results.set(firstId, firstRef)
  const restored = `앞 ${firstRef}뒤`
  assert.equal(undo({ state, dispatch }), true)
  assert.equal(document.canonical(state.doc.toString()), restored, 'undoing the deletion resolves the finished upload')
  assert.equal(redo({ state, dispatch }), true)
  assert.equal(document.canonical(state.doc.toString()), plain, 'redo still deletes the resolved attachment')
  assert.equal(undo({ state, dispatch }), true)
  assert.equal(document.canonical(state.doc.toString()), restored)
  assert.equal(undo({ state, dispatch }), true)
  assert.equal(document.canonical(state.doc.toString()), plain, 'the original insertion remains undoable')
  assert.equal(redo({ state, dispatch }), true)
  assert.equal(state.doc.toString(), `앞 ${firstId}뒤`, 'redo restores the stable identity stored by CodeMirror')
  assert.equal(document.canonical(state.doc.toString()), restored)
  assert.equal(redo({ state, dispatch }), true)
  assert.equal(document.canonical(state.doc.toString()), plain)
})
