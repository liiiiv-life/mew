// 모바일 스와이프 판정. 규칙이 두 겹(화면 상하 구역 + 가로 스크롤 끝)이라 어긋나면 증상이 헷갈린다 —
// 플레인 뷰에서 긴 줄을 스크롤하려던 손짓이 터미널을 열어 버리거나, 반대로 끝까지 스크롤한 뒤에도
// 창이 안 열리는 식이다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

const win = new Window({ url: 'http://localhost' })
const w = win as unknown as Record<string, unknown>
for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement']) {
  if (k in globalThis) continue
  try {
    ;(globalThis as Record<string, unknown>)[k] = w[k]
  } catch {
    Object.defineProperty(globalThis, k, { value: w[k], configurable: true })
  }
}
// 브라우저에선 전역 getComputedStyle이 window에 묶여 있다 — 떼어 놓으면 happy-dom이 빈 값을 돌려준다
;(globalThis as Record<string, unknown>).getComputedStyle = win.getComputedStyle.bind(win)

const { resolveSwipe, scrollEdges, NO_SCROLLER } = await import('./useSwipeGesture.ts')

/** happy-dom엔 레이아웃이 없어 스크롤 치수를 직접 심는다. 붙여 두지 않으면 getComputedStyle이 빈 값이다 */
function makeScroller(overflowX: string, { scrollWidth = 1000, clientWidth = 400, scrollLeft = 0 } = {}) {
  const el = win.document.createElement('div')
  el.style.overflowX = overflowX
  win.document.body.appendChild(el)
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
  Object.defineProperty(el, 'scrollLeft', { value: scrollLeft, writable: true, configurable: true })
  return el
}

function swipe(dx: number, over: Partial<Parameters<typeof resolveSwipe>[0]> = {}) {
  return resolveSwipe({ zone: 'bottom', edges: NO_SCROLLER, startX: 200, startY: 0, lastX: 200 + dx, lastY: 0, ...over })
}

test('구역이 종류를, 방향이 좌우를 정한다', () => {
  assert.equal(swipe(-120, { zone: 'top' }), 'onTopLeft')
  assert.equal(swipe(120, { zone: 'top' }), 'onTopRight')
  assert.equal(swipe(-120, { zone: 'bottom' }), 'onBottomLeft')
  assert.equal(swipe(120, { zone: 'bottom' }), 'onBottomRight')
})

test('짧거나 세로가 우세한 손짓은 스와이프가 아니다', () => {
  assert.equal(swipe(-40), null, '60px 미만은 무시')
  assert.equal(swipe(-120, { lastY: 100 }), null, '|dy|가 |dx|의 0.6을 넘으면 세로 제스처')
})

test('스크롤 여유가 남은 방향은 스크롤 의도로 보고 무시한다', () => {
  const middle = { atLeft: false, atRight: false }
  assert.equal(swipe(120, { edges: middle }), null, '왼쪽 끝이 아니면 사이드바를 열지 않는다')
  assert.equal(swipe(-120, { edges: middle }), null, '오른쪽 끝이 아니면 터미널을 열지 않는다')

  assert.equal(swipe(120, { edges: { atLeft: true, atRight: false } }), 'onBottomRight')
  assert.equal(swipe(-120, { edges: { atLeft: false, atRight: true } }), 'onBottomLeft')

  // 탭 전환도 같은 규칙을 받는다 — 창 전환만 막으면 위 반쪽 스크롤이 탭을 바꿔 버린다
  assert.equal(swipe(120, { zone: 'top', edges: middle }), null)
  assert.equal(swipe(-120, { zone: 'top', edges: middle }), null)
  assert.equal(swipe(120, { zone: 'top', edges: { atLeft: true, atRight: false } }), 'onTopRight')
})

test('scrollEdges: 가로 스크롤이 없으면 양쪽 끝으로 친다', () => {
  const plain = win.document.createElement('div')
  const root = win.document.createElement('div')
  root.appendChild(plain)
  assert.deepEqual(scrollEdges(plain, root), NO_SCROLLER)
})

test('scrollEdges: 스크롤 위치에 따라 끝을 판정한다', () => {
  const left = makeScroller('auto', { scrollLeft: 0 })
  assert.deepEqual(scrollEdges(left, left), { atLeft: true, atRight: false })

  const middle = makeScroller('auto', { scrollLeft: 300 })
  assert.deepEqual(scrollEdges(middle, middle), { atLeft: false, atRight: false })

  const right = makeScroller('scroll', { scrollLeft: 600 })
  assert.deepEqual(scrollEdges(right, right), { atLeft: false, atRight: true })
})

test('scrollEdges: 넘치기만 하고 스크롤되지 않는 요소는 건너뛰고 위로 올라간다', () => {
  const scroller = makeScroller('auto', { scrollLeft: 600 })
  const overflowing = makeScroller('visible', { scrollWidth: 1000, clientWidth: 400 })
  scroller.appendChild(overflowing)
  const touched = win.document.createElement('span')
  overflowing.appendChild(touched)
  assert.deepEqual(scrollEdges(touched, scroller), { atLeft: false, atRight: true })
})

test('scrollEdges: 스와이프 컨테이너 밖의 스크롤러는 보지 않는다', () => {
  const outer = makeScroller('auto', { scrollLeft: 300 })
  const boundary = win.document.createElement('div')
  outer.appendChild(boundary)
  const touched = win.document.createElement('span')
  boundary.appendChild(touched)
  assert.deepEqual(scrollEdges(touched, boundary), NO_SCROLLER)
})
