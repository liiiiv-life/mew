// 커서가 있는 줄 고르기 — 번호를 그리는 대상(최상위 블록 / 리스트 항목)과 같은 노드를 골라야 한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

// tiptap/ProseMirror가 전역 DOM을 보도록 happy-dom 셧을 먼저 깐다 (headingShortcut.test.ts와 같은 방식)
const win = new Window({ url: 'http://localhost' })
const w = win as unknown as Record<string, unknown>
for (const k of ['window', 'document', 'DOMParser', 'Node', 'Element', 'HTMLElement', 'Text', 'DocumentFragment', 'getComputedStyle', 'MutationObserver', 'KeyboardEvent']) {
  if (k in globalThis) continue
  try {
    ;(globalThis as Record<string, unknown>)[k] = w[k]
  } catch {
    Object.defineProperty(globalThis, k, { value: w[k], configurable: true })
  }
}

const { Editor } = await import('@tiptap/core')
const { serverEditorExtensions } = await import('../serverExtensions.ts')
const { LineFocus, focusedLinePos, listLevel } = await import('./lineFocus.ts')

function buildEditor(content: string) {
  return new Editor({ element: document.createElement('div'), extensions: [...serverEditorExtensions(), LineFocus], content })
}

/** 커서를 그 글자 위에 놓고, 골라진 줄 노드의 타입·본문·리스트 깊이를 돌려준다 */
function lineAt(editor: ReturnType<typeof buildEditor>, text: string) {
  let pos = -1
  editor.state.doc.descendants((node, nodePos) => {
    if (pos < 0 && node.isText && node.text?.includes(text)) pos = nodePos + (node.text.indexOf(text) + 1)
  })
  assert.ok(pos >= 0, `본문에 "${text}"가 있어야 한다`)
  editor.commands.setTextSelection(pos)
  const linePos = focusedLinePos(editor.state)
  const line = editor.state.doc.nodeAt(linePos)
  return { type: line?.type.name, text: line?.textContent, level: listLevel(editor.state.doc, linePos) }
}

test('본문 줄은 최상위 블록 하나가 한 줄이고, 들여쓰기 되돌림은 0이다', () => {
  const editor = buildEditor('첫 문단\n\n# 제목\n')
  assert.deepEqual(lineAt(editor, '첫 문단'), { type: 'paragraph', text: '첫 문단', level: 0 })
  assert.deepEqual(lineAt(editor, '제목'), { type: 'heading', text: '제목', level: 0 })
})

test('손잡이 클릭으로 블록을 통째로 선택해도 그 블록이 잡힌다', () => {
  const editor = buildEditor('첫 문단\n\n둘째 문단\n')
  let target = -1
  editor.state.doc.forEach((node, pos) => {
    if (node.textContent === '둘째 문단') target = pos
  })
  assert.ok(target >= 0)
  editor.commands.setNodeSelection(target)
  assert.equal(focusedLinePos(editor.state), target)
})

test('리스트는 항목이 한 줄이고, 중첩되면 가장 안쪽 항목이 그 깊이로 잡힌다', () => {
  const editor = buildEditor('- 바깥\n  - 안쪽\n')
  assert.deepEqual(lineAt(editor, '안쪽'), { type: 'listItem', text: '안쪽', level: 2 })
  const outer = lineAt(editor, '바깥')
  assert.equal(outer.type, 'listItem')
  assert.equal(outer.level, 1)
  // 바깥 항목은 중첩 리스트를 품고 있다 — 그래도 골라진 것은 커서가 있는 바깥 항목이다
  assert.ok(outer.text?.startsWith('바깥'))
})
