// 모바일 스와이프 판정. 화면 높이로 갈리는 구역이 전부라 — 위 40% 탭 전환, 가운데 40% 제스처 없음,
// 아래 20% 창 전환 — 경계가 어긋나면 에디터를 가로로 끌다가 터미널이 열리는 식으로 증상이 헷갈린다.
import test from 'node:test'
import assert from 'node:assert/strict'

const { resolveSwipe, zoneForY } = await import('./useSwipeGesture.ts')

function swipe(dx: number, over: Partial<Parameters<typeof resolveSwipe>[0]> = {}) {
  return resolveSwipe({ zone: 'bottom', startX: 200, startY: 0, lastX: 200 + dx, lastY: 0, ...over })
}

test('구역이 종류를, 방향이 좌우를 정한다', () => {
  assert.equal(swipe(-120, { zone: 'top' }), 'onTopLeft')
  assert.equal(swipe(120, { zone: 'top' }), 'onTopRight')
  assert.equal(swipe(-120, { zone: 'bottom' }), 'onBottomLeft')
  assert.equal(swipe(120, { zone: 'bottom' }), 'onBottomRight')
})

test('구역은 위 40% 탭 전환 / 가운데 40% 없음 / 아래 20% 창 전환', () => {
  assert.equal(zoneForY(0, 1000), 'top')
  assert.equal(zoneForY(399, 1000), 'top')
  assert.equal(zoneForY(400, 1000), null, '가운데는 에디터 가로 스크롤 몫이다')
  assert.equal(zoneForY(799, 1000), null)
  assert.equal(zoneForY(800, 1000), 'bottom')
  assert.equal(zoneForY(1000, 1000), 'bottom')
})

test('짧거나 세로가 우세한 손짓은 스와이프가 아니다', () => {
  assert.equal(swipe(-40), null, '60px 미만은 무시')
  assert.equal(swipe(-120, { lastY: 100 }), null, '|dy|가 |dx|의 0.6을 넘으면 세로 제스처')
})
