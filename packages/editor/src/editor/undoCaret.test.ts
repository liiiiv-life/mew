// undo/redo 전후 문서 diff로 커서 놓을 자리를 찾는다 — 삽입·삭제·겹침·무변경 네 갈래.
// 전후 문서는 반드시 같은 에디터에서 떠야 한다 — 스키마 인스턴스가 다르면 sameMarkup이 항상 false다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

// tiptap/ProseMirror가 전역 DOM을 보도록 happy-dom 셧을 먼저 깐다 (tableWidths.test.ts와 같은 방식)
const win = new Window({ url: 'http://localhost' })
const w = win as unknown as Record<string, unknown>
for (const k of ['window', 'document', 'DOMParser', 'Node', 'Element', 'HTMLElement', 'Text', 'DocumentFragment', 'getComputedStyle', 'MutationObserver']) {
  if (k in globalThis) continue
  try {
    ;(globalThis as Record<string, unknown>)[k] = w[k]
  } catch {
    Object.defineProperty(globalThis, k, { value: w[k], configurable: true })
  }
}

const { Editor } = await import('@tiptap/core')
const { serverEditorExtensions } = await import('../serverExtensions.ts')
const { changedCaretPos } = await import('./undoCaret.ts')

function buildEditor(content: string) {
  return new Editor({ element: document.createElement('div'), extensions: serverEditorExtensions(), content })
}

test('삽입 — 끼어든 글자 바로 뒤', () => {
  const editor = buildEditor('ab')
  const before = editor.state.doc
  editor.view.dispatch(editor.state.tr.insertText('X', 2)) // 'a' 뒤 → aXb
  assert.equal(changedCaretPos(before, editor.state.doc), 3)
})

test('삭제 — 사라진 자리', () => {
  const editor = buildEditor('aXb')
  const before = editor.state.doc
  editor.commands.deleteRange({ from: 2, to: 3 }) // X 삭제 → ab
  assert.equal(changedCaretPos(before, editor.state.doc), 2)
})

test('반복 문자 겹침 — diffEnd가 diffStart보다 앞서도 바뀐 구간 끝', () => {
  const editor = buildEditor('aaa')
  const before = editor.state.doc
  editor.commands.deleteRange({ from: 3, to: 4 }) // aa
  assert.equal(changedCaretPos(before, editor.state.doc), 3)
})

test('무변경 — null', () => {
  const editor = buildEditor('같음')
  const doc = editor.state.doc
  assert.equal(changedCaretPos(doc, doc), null)
})

test('둘째 문단 변경 — 그 문단 안 위치', () => {
  const editor = buildEditor('첫 문단\n\n둘째 문단')
  const before = editor.state.doc
  editor.view.dispatch(editor.state.tr.insertText('!', before.content.size - 1)) // 둘째 문단 끝
  const pos = changedCaretPos(before, editor.state.doc)
  assert.ok(pos !== null && pos > '첫 문단'.length + 2, `둘째 문단 안이어야 함: ${pos}`)
})
