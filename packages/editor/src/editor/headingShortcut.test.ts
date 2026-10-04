// Alt+1~6 제목 단축키. 키맵은 실제 keydown 경로로만 검증한다 — commands.keyboardShortcut()은
// 스텝을 다시 적용해 헛 TransformError를 낸다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

// tiptap/ProseMirror가 전역 DOM을 보도록 happy-dom 셧을 먼저 깐다 (tableWidths.test.ts와 같은 방식)
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
const { HeadingShortcut } = await import('./headingShortcut.ts')

function buildEditor(content: string) {
  return new Editor({
    element: document.createElement('div'),
    extensions: [...serverEditorExtensions(), HeadingShortcut],
    content,
  })
}

function markdown(editor: ReturnType<typeof buildEditor>): string {
  // These tests compare body structure; final-newline persistence is covered by lineFocus.test.ts.
  return (editor.storage as any).markdown.getMarkdown().trimEnd()
}

function pressAlt(editor: ReturnType<typeof buildEditor>, key: string): boolean {
  const event = new (globalThis as any).KeyboardEvent('keydown', { key, altKey: true }) as KeyboardEvent
  return editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) === true
}

test('Alt+1 — 본문 줄이 H1이 된다', () => {
  const editor = buildEditor('문제 인식\n')
  editor.commands.setTextSelection(3)
  assert.equal(pressAlt(editor, '1'), true)
  assert.equal(markdown(editor), '# 문제 인식')
})

test('Alt+3 — H1을 H3으로 바꾼다', () => {
  const editor = buildEditor('# 제목\n')
  editor.commands.setTextSelection(3)
  assert.equal(pressAlt(editor, '3'), true)
  assert.equal(markdown(editor), '### 제목')
})

test('같은 레벨을 다시 누르면 본문으로 돌아온다', () => {
  const editor = buildEditor('## 제목\n')
  editor.commands.setTextSelection(3)
  assert.equal(pressAlt(editor, '2'), true)
  assert.equal(markdown(editor), '제목')
})
