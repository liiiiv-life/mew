// Shift+Ctrl+Backspace 줄 삭제 — 리스트 항목·문단은 블록째, 코드블록은 커서 줄만.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

// tiptap/ProseMirror가 전역 DOM을 보도록 happy-dom 셧을 먼저 깐다 (headingEnter.test.ts와 같은 방식)
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
const { deleteCurrentLine } = await import('./deleteLine.ts')

function buildEditor(content: string) {
  return new Editor({ element: document.createElement('div'), extensions: serverEditorExtensions(), content })
}

function markdown(editor: ReturnType<typeof buildEditor>): string {
  return (editor.storage as any).markdown.getMarkdown()
}

function placeCursorIn(editor: ReturnType<typeof buildEditor>, needle: string) {
  let pos = -1
  editor.state.doc.descendants((node, p) => {
    if (pos === -1 && node.isText && node.text?.includes(needle)) pos = p + node.text.indexOf(needle) + 1
  })
  assert.notEqual(pos, -1, `커서 위치 못 찾음: ${needle}`)
  editor.commands.setTextSelection(pos)
}

test('중첩 리스트 항목에서 줄 삭제 — 그 항목만 사라진다', () => {
  const editor = buildEditor('- 하이\n  - 헬로\n  - 하이\n')
  placeCursorIn(editor, '헬로')
  assert.equal(deleteCurrentLine(editor), true)
  assert.equal(markdown(editor), '- 하이\n  - 하이')
})

test('항목 하나뿐인 중첩 리스트에서 줄 삭제 — 빈 리스트가 남지 않는다', () => {
  const editor = buildEditor('- 하이\n  - 헬로\n')
  placeCursorIn(editor, '헬로')
  assert.equal(deleteCurrentLine(editor), true)
  assert.equal(markdown(editor), '- 하이')
})

test('문단에서 줄 삭제', () => {
  const editor = buildEditor('첫 줄\n\n둘째 줄\n\n셋째 줄\n')
  placeCursorIn(editor, '둘째')
  assert.equal(deleteCurrentLine(editor), true)
  assert.equal(markdown(editor), '첫 줄\n\n셋째 줄')
})

test('코드블록 중간 줄 삭제 — 그 줄만 지워진다', () => {
  const editor = buildEditor('```\naaa\nbbb\nccc\n```\n')
  placeCursorIn(editor, 'bbb')
  assert.equal(deleteCurrentLine(editor), true)
  assert.equal(markdown(editor), '```\naaa\nccc\n```')
})

test('코드블록 마지막 줄 삭제 — 빈 줄이 남지 않는다', () => {
  const editor = buildEditor('```\naaa\nbbb\n```\n')
  placeCursorIn(editor, 'bbb')
  assert.equal(deleteCurrentLine(editor), true)
  assert.equal(markdown(editor), '```\naaa\n```')
})
