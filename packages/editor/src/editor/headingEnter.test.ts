// 제목 중간 Enter → 뒷부분은 본문. 기본 splitBlock이 노드 타입을 이어받아 제목이 둘로 갈라지던 동작을 대체한다.
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
const { splitHeadingIntoParagraph } = await import('./headingEnter.ts')

function buildEditor(content: string) {
  return new Editor({ element: document.createElement('div'), extensions: serverEditorExtensions(), content })
}

function markdown(editor: ReturnType<typeof buildEditor>): string {
  return (editor.storage as any).markdown.getMarkdown()
}

test('제목 중간에서 Enter — 뒷부분은 본문이 된다', () => {
  const editor = buildEditor('# 1. Problem - 문제 인식\n')
  editor.commands.setTextSelection(1 + '1. Problem - '.length)
  assert.equal(splitHeadingIntoParagraph(editor), true)
  assert.equal(markdown(editor), '# 1. Problem - \n\n문제 인식') // 커서 앞의 공백은 제목 쪽에 남는다
  assert.equal(editor.state.selection.$from.parent.type.name, 'paragraph')
})

test('제목 끝에서 Enter — 다음 줄은 본문 (기본 동작과 같음)', () => {
  const editor = buildEditor('## 제목\n')
  editor.commands.setTextSelection(1 + '제목'.length)
  assert.equal(splitHeadingIntoParagraph(editor), true)
  assert.equal(editor.state.doc.lastChild?.type.name, 'paragraph')
  assert.equal(markdown(editor), '## 제목\n\n<br/>')
})

test('제목 맨 앞에서 Enter는 건드리지 않는다 — 위에 빈 줄이 생기는 기본 동작', () => {
  const editor = buildEditor('# 제목\n')
  editor.commands.setTextSelection(1)
  assert.equal(splitHeadingIntoParagraph(editor), false)
})

test('제목이 아니면 건드리지 않는다', () => {
  const editor = buildEditor('본문 줄\n')
  editor.commands.setTextSelection(3)
  assert.equal(splitHeadingIntoParagraph(editor), false)
})

test('제목 일부를 선택한 채 Enter — 선택은 지워지고 뒷부분은 본문', () => {
  const editor = buildEditor('# abcd\n')
  editor.commands.setTextSelection({ from: 3, to: 4 }) // "c" 선택
  assert.equal(splitHeadingIntoParagraph(editor), true)
  assert.equal(markdown(editor), '# ab\n\nd')
})
