// 표 열 너비 왕복 — .mew/table-layout.json에 저장할 값을 문서에서 읽고, 다시 문서에 입히는 경로.
// 위치 계산(셀 pos)이 틀리면 엉뚱한 노드에 colwidth가 박히므로 실제 스키마로 검증한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

// tiptap/ProseMirror가 전역 DOM을 보도록 happy-dom 셧을 먼저 깐다 (serverExtensions.test.ts와 같은 방식)
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
const { readTableWidths, tableWidthsTransaction, docHasTable } = await import('./tableWidths.ts')

const TABLE_MD = `| a | b |\n| --- | --- |\n| 1 | 2 |\n`

function buildEditor(content: string) {
  return new Editor({
    element: document.createElement('div'),
    extensions: serverEditorExtensions(),
    content,
  })
}

function apply(editor: ReturnType<typeof buildEditor>, widths: (number[] | null)[]) {
  const tr = tableWidthsTransaction(editor.state, widths)
  if (tr) editor.view.dispatch(tr)
  return tr !== null
}

test('표가 없으면 docHasTable=false, 너비 목록은 빈 배열', () => {
  const editor = buildEditor('# 제목\n\n본문')
  assert.equal(docHasTable(editor.state.doc), false)
  assert.deepEqual(readTableWidths(editor.state.doc), [])
  editor.destroy()
})

test('입힌 너비를 그대로 다시 읽는다', () => {
  const editor = buildEditor(TABLE_MD)
  assert.equal(docHasTable(editor.state.doc), true)
  assert.equal(apply(editor, [[220, 130]]), true)
  assert.deepEqual(readTableWidths(editor.state.doc), [[220, 130]])
  editor.destroy()
})

test('너비는 첫 행뿐 아니라 모든 행의 셀에 들어간다', () => {
  const editor = buildEditor(TABLE_MD)
  apply(editor, [[220, 130]])
  const widths: (number[] | null)[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'tableCell' && node.type.name !== 'tableHeader') return true
    widths.push((node.attrs.colwidth as number[] | null) ?? null)
    return false
  })
  assert.equal(widths.length, 4) // 2열 × 2행
  assert.deepEqual(widths, [[220], [130], [220], [130]])
  editor.destroy()
})

test('0인 열은 건드리지 않는다 (아직 끌지 않은 열)', () => {
  const editor = buildEditor(TABLE_MD)
  apply(editor, [[0, 150]])
  assert.deepEqual(readTableWidths(editor.state.doc), [[0, 150]])
  editor.destroy()
})

test('표가 여러 개면 등장 순서로 매칭되고, null인 자리는 건너뛴다', () => {
  const editor = buildEditor(`${TABLE_MD}\n사이 문단\n\n${TABLE_MD}`)
  apply(editor, [null, [90, 240]])
  assert.deepEqual(readTableWidths(editor.state.doc), [null, [90, 240]])
  editor.destroy()
})

test('같은 값을 다시 입히면 트랜잭션을 만들지 않는다 (저장 루프 방지)', () => {
  const editor = buildEditor(TABLE_MD)
  assert.equal(apply(editor, [[220, 130]]), true)
  assert.equal(apply(editor, [[220, 130]]), false)
  editor.destroy()
})

test('복원 트랜잭션은 undo 스택에 올라가지 않는다', () => {
  const editor = buildEditor(TABLE_MD)
  const tr = tableWidthsTransaction(editor.state, [[220, 130]])
  assert.ok(tr)
  assert.equal(tr.getMeta('addToHistory'), false)
  editor.destroy()
})

test('마크다운 직렬화는 너비의 영향을 받지 않는다 (본문은 순수 md 유지)', () => {
  const editor = buildEditor(TABLE_MD)
  const before = (editor.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
  apply(editor, [[220, 130]])
  const after = (editor.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
  assert.equal(after, before)
  editor.destroy()
})
