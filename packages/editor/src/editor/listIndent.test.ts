// 앞 형제 항목이 없는 리스트 첫 줄의 Tab 들여쓰기와 그 반대(Shift+Tab). 구조가 틀리면 스키마가
// 거부하거나 마크다운 왕복에서 들여쓰기가 사라지므로 실제 스키마·마크다운으로 검증한다.
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
const { sinkFirstListItemTransaction, liftFirstListItemTransaction } = await import('./listIndent.ts')

function buildEditor(content: string) {
  return new Editor({ element: document.createElement('div'), extensions: serverEditorExtensions(), content })
}

function markdown(editor: ReturnType<typeof buildEditor>): string {
  // These tests compare body structure; final-newline persistence is covered by lineFocus.test.ts.
  return (editor.storage as any).markdown.getMarkdown().trimEnd()
}

// 주어진 텍스트를 가진 문단 안으로 커서를 옮긴다 (글자 사이 — 앞뒤 어느 쪽 끝도 아닌 자리)
function caretIn(editor: ReturnType<typeof buildEditor>, text: string) {
  let pos = -1
  editor.state.doc.descendants((node, p) => {
    if (pos === -1 && node.isTextblock && node.textContent === text) pos = p + 1
  })
  assert.notEqual(pos, -1, `문단 "${text}"를 못 찾음`)
  editor.commands.setTextSelection(pos + 1)
}

function sink(editor: ReturnType<typeof buildEditor>) {
  const tr = sinkFirstListItemTransaction(editor.state)
  assert.ok(tr, '들여쓰기 트랜잭션이 만들어져야 한다')
  editor.view.dispatch(tr)
}

test('첫 항목도 Tab으로 들여써진다 — 자기 줄 없는 부모 항목 안의 중첩 리스트가 된다', () => {
  const editor = buildEditor('- b\n')
  caretIn(editor, 'b')
  sink(editor)

  const outer = editor.state.doc.firstChild
  assert.equal(outer?.type.name, 'bulletList')
  const wrapper = outer?.firstChild
  assert.equal(wrapper?.type.name, 'listItem')
  assert.equal(wrapper?.childCount, 1) // 문단 없는 부모 항목
  assert.equal(wrapper?.child(0).type.name, 'bulletList')
  assert.equal(wrapper?.child(0).firstChild?.textContent, 'b')
  // 커서는 옮겨진 항목 안 그 자리에 남는다
  assert.equal(editor.state.selection.$from.parent.textContent, 'b')
})

test('들여쓴 첫 항목은 마크다운 왕복에서 들여쓰기를 잃지 않는다', () => {
  const editor = buildEditor('- b\n')
  caretIn(editor, 'b')
  sink(editor)
  const md = markdown(editor)
  assert.equal(md, '- - b')
  // 다시 읽어도 같은 문서·같은 마크다운이어야 한다 (디스크 왕복 안정)
  const reread = buildEditor(md)
  assert.equal(markdown(reread), md)
  assert.equal(reread.state.doc.firstChild?.firstChild?.child(0).type.name, 'bulletList')
})

test('Shift+Tab으로 다시 원래 자리로 나온다', () => {
  const editor = buildEditor('- b\n')
  caretIn(editor, 'b')
  sink(editor)
  const tr = liftFirstListItemTransaction(editor.state)
  assert.ok(tr, '내어쓰기 트랜잭션이 만들어져야 한다')
  editor.view.dispatch(tr)
  assert.equal(markdown(editor), '- b')
  assert.equal(editor.state.selection.$from.parent.textContent, 'b')
})

test('부모 항목 안에 형제가 있으면 현재 항목만 나오고 나머지는 그대로 들여써져 있다', () => {
  const editor = buildEditor('- - b\n  - c\n')
  assert.equal(markdown(editor), '- - b\n  - c') // 전제: 형제 둘이 한 부모 항목 안
  caretIn(editor, 'c')
  editor.view.dispatch(liftFirstListItemTransaction(editor.state)!)
  assert.equal(markdown(editor), '- - b\n- c')
  assert.equal(editor.state.selection.$from.parent.textContent, 'c')
})

test('앞 형제 항목이 있으면 null — 기본 sinkListItem에 맡긴다', () => {
  const editor = buildEditor('- a\n- b\n')
  caretIn(editor, 'b')
  assert.equal(sinkFirstListItemTransaction(editor.state), null)
})

test('자기 줄이 있는 평범한 부모 항목이면 lift는 null — 기본 liftListItem에 맡긴다', () => {
  const editor = buildEditor('- a\n  - b\n')
  caretIn(editor, 'b')
  assert.equal(liftFirstListItemTransaction(editor.state), null)
})

test('리스트 밖 문단이면 둘 다 null', () => {
  const editor = buildEditor('본문 줄\n')
  caretIn(editor, '본문 줄')
  assert.equal(sinkFirstListItemTransaction(editor.state), null)
  assert.equal(liftFirstListItemTransaction(editor.state), null)
})

test('숫자 리스트 첫 항목도 같은 타입의 중첩 리스트로 들여써진다', () => {
  const editor = buildEditor('1. b\n')
  caretIn(editor, 'b')
  sink(editor)
  assert.equal(editor.state.doc.firstChild?.type.name, 'orderedList')
  const wrapper = editor.state.doc.firstChild?.firstChild
  assert.equal(wrapper?.child(0).type.name, 'orderedList')
  assert.equal(wrapper?.child(0).firstChild?.textContent, 'b')
  assert.equal(markdown(buildEditor(markdown(editor))), markdown(editor))
})

test('두 번 들여쓰면 두 단계로 중첩된다', () => {
  const editor = buildEditor('- b\n')
  caretIn(editor, 'b')
  sink(editor)
  caretIn(editor, 'b')
  sink(editor)
  assert.equal(markdown(editor), '- - - b')
  assert.equal(markdown(buildEditor('- - - b')), '- - - b')
})
