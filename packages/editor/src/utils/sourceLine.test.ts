// Ctrl+L의 [경로:줄] 참조가 가리키는 줄 번호 검증 — 접두어 직렬화의 개행 수가 실제
// getMarkdown() 출력의 줄 위치와 일치해야 한다. 실제 스키마·마크다운으로 검증한다.
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
const { sourceLineOfPos } = await import('./sourceLine.ts')

function buildEditor(content: string) {
  return new Editor({ element: document.createElement('div'), extensions: serverEditorExtensions(), content })
}

// 주어진 텍스트를 가진 텍스트블록 안의 위치(첫 글자 뒤)를 찾는다
function posIn(editor: ReturnType<typeof buildEditor>, text: string): number {
  let pos = -1
  editor.state.doc.descendants((node, p) => {
    if (pos === -1 && node.isTextblock && node.textContent === text) pos = p + 2
  })
  assert.notEqual(pos, -1, `블록 "${text}"를 못 찾음`)
  return pos
}

function lineOf(editor: ReturnType<typeof buildEditor>, text: string): number {
  const serializer = (editor.storage as any).markdown.serializer
  return sourceLineOfPos(editor.state.doc, (c) => serializer.serialize(c), posIn(editor, text))
}

// getMarkdown() 출력에서 그 텍스트가 실제로 있는 줄 번호(1부터)
function expectedLine(editor: ReturnType<typeof buildEditor>, text: string): number {
  const lines: string[] = (editor.storage as any).markdown.getMarkdown().split('\n')
  const idx = lines.findIndex((l) => l.includes(text))
  assert.notEqual(idx, -1, `md 출력에 "${text}"가 없음`)
  return idx + 1
}

test('제목·문단·리스트 항목의 줄 번호가 md 출력의 실제 줄과 일치한다', () => {
  const editor = buildEditor('# 제목\n\n첫 문단\n\n- 항목1\n- 항목2\n- 항목3\n\n마지막 문단\n')
  for (const text of ['제목', '첫 문단', '항목1', '항목2', '항목3', '마지막 문단']) {
    assert.equal(lineOf(editor, text), expectedLine(editor, text), `"${text}"의 줄 번호`)
  }
})

test('문서 맨 앞은 1번 줄이다', () => {
  const editor = buildEditor('문단 하나\n')
  const serializer = (editor.storage as any).markdown.serializer
  assert.equal(sourceLineOfPos(editor.state.doc, (c) => serializer.serialize(c), 0), 1)
})
