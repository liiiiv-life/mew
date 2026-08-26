// md 직렬화 동작 회귀 테스트: 표(문단 여러 개 셀·colwidth·병합 셀 폴백)와
// 중첩 리스트 복사(clipboardTextSerializer의 unwrap) — 실제 스키마·직렬화기로 검증한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

// tiptap/ProseMirror가 전역 DOM을 보도록 happy-dom 셧을 먼저 깐다 (serverExtensions.test.ts와 동일)
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
const { unwrapOpenListWrappers } = await import('../utils/clipboardList.ts')

type Ed = InstanceType<typeof Editor>

function makeEditor(content: string): Ed {
  return new Editor({ element: document.createElement('div'), extensions: serverEditorExtensions(), content })
}

const md = (e: Ed) => (e.storage as any).markdown.getMarkdown() as string

const TABLE = `| A | B |\n| --- | --- |\n| 1 | 2 |`

/** 문서에서 조건에 맞는 노드들의 pos 목록 */
function findPos(e: Ed, pred: (name: string) => boolean): number[] {
  const out: number[] = []
  e.state.doc.descendants((node, pos) => {
    if (pred(node.type.name)) out.push(pos)
    return true
  })
  return out
}

test('셀 안 문단 여러 개는 <br>로 이어 파이프 표를 유지한다 — HTML 덤프 금지', () => {
  const e = makeEditor(TABLE)
  const cellPos = findPos(e, (n) => n === 'tableCell')[0]
  const cell = e.state.doc.nodeAt(cellPos)!
  const para = e.schema.nodes.paragraph.create(null, e.schema.text('둘째 문단'))
  e.view.dispatch(e.state.tr.insert(cellPos + cell.nodeSize - 1, para))
  const out = md(e)
  assert.match(out, /\| 1<br>둘째 문단 \| 2 \|/)
  assert.doesNotMatch(out, /<table/)
})

test('colwidth(열 리사이즈)는 md 파이프 표에 아무 흔적을 남기지 않는다', () => {
  const e = makeEditor(TABLE)
  const tr = e.state.tr
  for (const pos of findPos(e, (n) => n === 'tableHeader' || n === 'tableCell')) {
    tr.setNodeAttribute(pos, 'colwidth', [240])
  }
  e.view.dispatch(tr)
  assert.equal(md(e).trim(), TABLE)
})

test('병합 셀 때문에 HTML로 갈 때도 colwidth는 벗겨서 낸다', () => {
  const e = makeEditor(TABLE)
  const headerPos = findPos(e, (n) => n === 'tableHeader')[0]
  const tr = e.state.tr
  tr.setNodeAttribute(headerPos, 'colspan', 2)
  tr.setNodeAttribute(headerPos, 'colwidth', [120, 120])
  e.view.dispatch(tr)
  const out = md(e)
  assert.match(out, /<table/)
  assert.doesNotMatch(out, /colwidth/)
})

test('핫뷰의 빈 문단은 plain 뷰에서 <br/>로 남는다', () => {
  const e = makeEditor('첫 줄\n\n셋째 줄')
  e.view.dispatch(e.state.tr.insert(e.state.doc.child(0).nodeSize, e.schema.nodes.paragraph.create()))
  assert.match(md(e), /첫 줄\n\n<br\/>\n\n셋째 줄/)
})

test('중첩 리스트 중간만 복사하면 그 층의 마커로 시작한다 — "- - -" 금지', () => {
  const e = makeEditor(`- 부모\n  - 자식1\n  - 자식2\n  - 자식3`)
  // 자식1 텍스트 시작부터 자식3 텍스트 끝까지 — 에디터에서 세 항목을 긁은 선택과 같다
  let from = -1
  let to = -1
  e.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === '자식1') from = pos
    if (node.isText && node.text === '자식3') to = pos + node.nodeSize
    return true
  })
  assert.ok(from > 0 && to > from)
  // 세 번째 인자 true = 조상 포함 — 실제 복사(Selection.content)가 만드는 slice와 같은 형태
  const slice = e.state.doc.slice(from, to, true)
  const content = unwrapOpenListWrappers(slice.content, slice.openStart, slice.openEnd)
  const out = ((e.storage as any).markdown.serializer.serialize(content) as string).trim()
  assert.equal(out, '- 자식1\n- 자식2\n- 자식3')
})

test('리스트가 아닌 일반 문단 부분 복사는 예전과 같다', () => {
  const e = makeEditor('문단 하나')
  const slice = e.state.doc.slice(1, 4, true) // "문단 "쯤 — 문단 내부 부분 선택
  const content = unwrapOpenListWrappers(slice.content, slice.openStart, slice.openEnd)
  const out = ((e.storage as any).markdown.serializer.serialize(content) as string).trim()
  assert.equal(out, e.state.doc.textBetween(1, 4).trim())
})
