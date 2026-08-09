// 문서 내 찾기 — 매치 이동(next/prev)이 현재 매치 표시를 실제로 옮기는지. 찾기 바에 포커스가 있는
// 상태에서 스크롤이 안 따라가던 버그를 잡을 자리라, 인덱스뿐 아니라 DOM의 .search-match-current까지 본다.
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
const { SearchAndReplace } = await import('./searchExtension.ts')

function buildEditor(content: string) {
  return new Editor({
    element: document.createElement('div'),
    extensions: [...serverEditorExtensions(), SearchAndReplace],
    content,
  })
}

/** 현재 매치로 표시된 텍스트가 문서에서 몇 번째 매치인지 — 표시가 실제로 옮겨졌는지 본다 */
function currentMatchIndex(editor: ReturnType<typeof buildEditor>): number {
  const marks = Array.from(editor.view.dom.querySelectorAll('.search-match'))
  return marks.findIndex((el) => el.classList.contains('search-match-current'))
}

test('findNextResult: 현재 매치 표시가 다음 매치로 옮겨가고, 끝에서 처음으로 돈다', () => {
  const editor = buildEditor('<p>사과 하나</p><p>사과 둘</p><p>사과 셋</p>')
  editor.commands.setSearchQuery('사과')
  const storage = editor.storage.searchAndReplace

  assert.equal(storage.results.length, 3)
  editor.commands.gotoSearchResult(0)
  assert.equal(currentMatchIndex(editor), 0)

  editor.commands.findNextResult()
  assert.equal(storage.index, 1)
  assert.equal(currentMatchIndex(editor), 1)
  assert.equal(editor.state.selection.from, storage.results[1].from, '선택도 그 매치로 옮겨간다')

  editor.commands.findNextResult()
  editor.commands.findNextResult()
  assert.equal(storage.index, 0, '마지막 다음은 처음으로 돈다')
  assert.equal(currentMatchIndex(editor), 0)

  editor.commands.findPrevResult()
  assert.equal(storage.index, 2)
  assert.equal(currentMatchIndex(editor), 2)
})
