// 댓글 하이라이트의 자리 계산 — 렌더된 본문 텍스트 ↔ ProseMirror 위치 대응표(docTextWithMap)가
// 어긋나면 하이라이트가 엉뚱한 글자에 걸린다. 앵커 왕복이 원래 고른 텍스트를 돌려주는지 본다.
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
const { docTextWithMap, indexOfPos } = await import('./commentHighlight.ts')
const { makeCommentAnchor, resolveCommentAnchor } = await import('../utils/commentAnchor.ts')

function buildDoc(markdown: string) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: serverEditorExtensions(),
    content: markdown,
  })
  return editor.state.doc
}

test('블록은 개행 하나로 이어지고 대응표 길이는 텍스트+1이다', () => {
  const doc = buildDoc('<h1>제목</h1><p>첫 문단</p><p>둘째 문단</p>')
  const { text, map } = docTextWithMap(doc)
  assert.equal(text, '제목\n첫 문단\n둘째 문단')
  assert.equal(map.length, text.length + 1)
})

test('대응표가 가리키는 PM 위치가 그 글자와 같다', () => {
  const doc = buildDoc('<p>앞 문단</p><p>핵심 문장이 여기</p>')
  const { text, map } = docTextWithMap(doc)
  const from = text.indexOf('핵심 문장')
  const to = from + '핵심 문장'.length
  assert.equal(doc.textBetween(map[from], map[to - 1] + 1), '핵심 문장')
})

test('indexOfPos는 대응표를 거꾸로 되돌린다', () => {
  const doc = buildDoc('<p>가나다</p><p>라마바</p>')
  const { text, map } = docTextWithMap(doc)
  for (let i = 0; i < text.length; i++) assert.equal(indexOfPos(map, map[i]), i)
})

test('앵커 왕복 — 고른 텍스트가 그대로 돌아온다', () => {
  const doc = buildDoc('<p>사과는 좋다</p><p>바나나도 좋다</p><p>포도도 좋다</p>')
  const { text, map } = docTextWithMap(doc)
  // 같은 '좋다'가 셋 — prefix가 가운데 것을 골라야 한다
  const from = text.indexOf('좋다', text.indexOf('바나나'))
  const anchor = makeCommentAnchor(text, from, from + 2)

  const range = resolveCommentAnchor(text, anchor)
  assert.ok(range)
  assert.equal(range.from, from)
  assert.equal(doc.textBetween(map[range.from], map[range.to - 1] + 1), '좋다')
})

test('빈 선택에는 앵커가 없다 — 하이라이트도 서지 않는다 (ADR 0051)', () => {
  const doc = buildDoc('<p>앞 문맥이 있는 줄</p><p>다음 줄</p>')
  const { text } = docTextWithMap(doc)
  const at = text.indexOf('있는')
  assert.equal(makeCommentAnchor(text, at, at), null)
  assert.equal(resolveCommentAnchor(text, { text: '', prefix: '앞 문맥이 ', line: 1 }), null)
})
