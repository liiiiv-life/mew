// 오버레이 Esc·뒤로가기 스택. 규칙은 하나뿐이지만 어긋나면 증상이 크다 —
// 겹친 팝업이 한 번에 다 닫히거나, 팝업 위에서 뒤로가기를 눌렀는데 뒤의 터미널이 닫히거나,
// 에디터 슬래시 메뉴의 Esc가 사이드바를 대신 닫는 식이다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

const win = new Window({ url: 'http://localhost' })
const w = win as unknown as Record<string, unknown>
for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Event', 'KeyboardEvent']) {
  if (k in globalThis) continue
  try {
    ;(globalThis as Record<string, unknown>)[k] = w[k]
  } catch {
    Object.defineProperty(globalThis, k, { value: w[k], configurable: true })
  }
}

const { registerOverlay } = await import('./useOverlayDismiss.ts')

// history는 happy-dom 구현에 기대지 않고 직접 센다 — pushState/back 호출 자체가 검증 대상이다
let pushes = 0
let backs = 0
window.history.pushState = () => {
  pushes += 1
}
window.history.back = () => {
  backs += 1
}

/** scheduleSync가 마이크로태스크로 미뤄 두는 히스토리 정리를 흘려보낸다 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function pressEscape(target: EventTarget = window.document.body) {
  target.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}

function reset() {
  pushes = 0
  backs = 0
}

test('content Back rearms the guard repeatedly while modals and Escape keep dismissal priority', async () => {
  reset()
  let remaining = 2
  let closed = 0
  const unregister = registerOverlay({
    close: () => { closed++ }, closeOnEscape: () => true, escapePhase: 'bubble',
    closeOnBack: () => remaining > 0 ? (remaining--, false) : true,
  })
  await settle()
  let modalClosed = 0
  const modal = registerOverlay({ close: () => { modalClosed++ }, closeOnEscape: () => true, escapePhase: 'capture' })
  await settle()
  window.dispatchEvent(new window.Event('popstate'))
  assert.equal(modalClosed, 1)
  assert.equal(remaining, 2)
  modal()
  await settle()
  for (const expected of [1, 0]) {
    const before = pushes
    window.dispatchEvent(new window.Event('popstate'))
    await settle()
    assert.equal(remaining, expected)
    assert.equal(closed, 0)
    assert.equal(pushes, before + 1, 'consuming Back without unmounting must restore the guard')
  }
  window.dispatchEvent(new window.Event('popstate'))
  assert.equal(closed, 1, 'no history falls back to closing')
  remaining = 2
  pressEscape()
  assert.equal(closed, 2)
  assert.equal(remaining, 2, 'Escape does not navigate')
  unregister()
  await settle()
})

test('Back rearms a shared registration when closing changes its foreground without unmounting', async () => {
  reset()
  let remaining = 2
  const unregister = registerOverlay({
    close: () => { remaining-- }, closeOnEscape: () => true, escapePhase: 'bubble',
  })
  await settle()
  window.dispatchEvent(new window.Event('popstate'))
  await settle()
  assert.equal(remaining, 1)
  assert.equal(pushes, 2, 'the remaining panel needs a guard even without registration cleanup')
  window.dispatchEvent(new window.Event('popstate'))
  assert.equal(remaining, 0, 'the second Back also reaches the app')
  unregister()
  await settle()
  assert.equal(backs, 0, 'exhausting the stack leaves the browser history unguarded')
})

test('Esc는 가장 나중에 열린 것 하나만 닫는다', async () => {
  reset()
  const closed: string[] = []
  const closeFirst = registerOverlay({ close: () => closed.push('first'), closeOnEscape: () => true, escapePhase: 'capture' })
  const closeSecond = registerOverlay({ close: () => closed.push('second'), closeOnEscape: () => true, escapePhase: 'capture' })
  await settle()

  pressEscape()
  assert.deepEqual(closed, ['second'], '맨 위 하나만 닫혀야 한다')

  // 실제로는 close()가 언마운트를 부르지만, 여기선 등록 해제를 직접 흉내 낸다
  closeSecond()
  pressEscape()
  assert.deepEqual(closed, ['second', 'first'])

  closeFirst()
  await settle()
})

test('closeOnEscape가 false면 Esc를 삼키지 않는다 (터미널 안의 vim 등)', async () => {
  reset()
  let closedCount = 0
  const unregister = registerOverlay({ close: () => (closedCount += 1), closeOnEscape: () => false, escapePhase: 'capture' })
  await settle()

  const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  window.document.body.dispatchEvent(event)
  assert.equal(closedCount, 0)
  assert.equal(event.defaultPrevented, false, 'preventDefault도 하면 안 된다 — 콘텐츠가 Esc를 받아야 한다')

  unregister()
  await settle()
})

test("escapePhase: 'bubble'인 패널은 안쪽이 Esc를 먼저 쓰면 닫히지 않는다", async () => {
  reset()
  let panelClosed = 0
  const unregister = registerOverlay({ close: () => (panelClosed += 1), closeOnEscape: () => true, escapePhase: 'bubble' })
  await settle()

  // 에디터의 슬래시 메뉴처럼 안쪽에서 Esc를 소비하는 경우
  const swallow = (e: Event) => e.stopPropagation()
  window.document.body.addEventListener('keydown', swallow)
  pressEscape()
  assert.equal(panelClosed, 0, '안쪽이 Esc를 가져갔으면 패널은 그대로여야 한다')

  window.document.body.removeEventListener('keydown', swallow)
  pressEscape()
  assert.equal(panelClosed, 1, '안쪽이 안 쓰면 그때 패널이 닫힌다')

  unregister()
  await settle()
})

test('capture 오버레이가 위에 있으면 bubble 패널은 Esc를 받지 않는다', async () => {
  reset()
  let panelClosed = 0
  let dialogClosed = 0
  const unregisterPanel = registerOverlay({ close: () => (panelClosed += 1), closeOnEscape: () => true, escapePhase: 'bubble' })
  const unregisterDialog = registerOverlay({ close: () => (dialogClosed += 1), closeOnEscape: () => true, escapePhase: 'capture' })
  await settle()

  pressEscape()
  assert.equal(dialogClosed, 1)
  assert.equal(panelClosed, 0)

  unregisterDialog()
  unregisterPanel()
  await settle()
})

test('인라인 툴팁도 capture 스택에 올라가면 Esc가 패널보다 먼저 닫는다', async () => {
  reset()
  const closed: string[] = []
  const unregisterPanel = registerOverlay({ close: () => closed.push('agent'), closeOnEscape: () => true, escapePhase: 'bubble' })
  // MentionTextarea처럼 문서 흐름 안에 뜨는 검색 메뉴도 독립 오버레이다.
  const unregisterTooltip = registerOverlay({ close: () => closed.push('tooltip'), closeOnEscape: () => true, escapePhase: 'capture' })
  await settle()

  pressEscape()
  assert.deepEqual(closed, ['tooltip'])

  unregisterTooltip()
  pressEscape()
  assert.deepEqual(closed, ['tooltip', 'agent'])

  unregisterPanel()
  await settle()
})

test('뒤로가기 가드는 겹쳐도 한 개만 얹고, 한 겹 닫힐 때마다 다시 얹는다', async () => {
  reset()
  const closed: string[] = []
  const unregisterPanel = registerOverlay({ close: () => closed.push('panel'), closeOnEscape: () => true, escapePhase: 'bubble' })
  await settle()
  assert.equal(pushes, 1, '오버레이가 열리면 뒤로가기가 소비할 가드 항목을 얹는다')

  const unregisterDialog = registerOverlay({ close: () => closed.push('dialog'), closeOnEscape: () => true, escapePhase: 'capture' })
  await settle()
  assert.equal(pushes, 1, '두 겹이어도 가드는 하나뿐이다')

  // 안드로이드 뒤로가기 = 가드 항목 소비
  window.dispatchEvent(new window.Event('popstate'))
  assert.deepEqual(closed, ['dialog'], '맨 위 하나만 닫힌다')
  assert.equal(backs, 0, '뒤로가기로 닫혔으니 history.back()을 또 부르면 안 된다')

  unregisterDialog()
  await settle()
  assert.equal(pushes, 2, '패널이 아직 열려 있으니 가드를 다시 얹는다')

  // 이번엔 UI(닫기 버튼)로 닫는다 — 얹어둔 가드를 걷어야 히스토리가 원래대로 돌아온다
  unregisterPanel()
  await settle()
  assert.equal(backs, 1)
})

test('outside를 준 오버레이는 바깥을 누르면 닫히고 안쪽은 그대로다', async () => {
  reset()
  const card = window.document.createElement('div')
  const inside = window.document.createElement('button')
  card.appendChild(inside)
  window.document.body.appendChild(card)

  let closed = 0
  const unregister = registerOverlay({
    close: () => (closed += 1),
    closeOnEscape: () => true,
    escapePhase: 'capture',
    outside: () => card,
  })
  await settle()

  const press = (target: EventTarget) => target.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
  // 팝업 안쪽이 stopPropagation을 해도 capture로 이미 지나간 뒤다 — 위치로 판단하므로 안 닫힌다
  inside.addEventListener('pointerdown', (e: Event) => e.stopPropagation())
  press(inside)
  assert.equal(closed, 0, '카드 안을 누르면 닫히지 않는다')

  press(window.document.body)
  assert.equal(closed, 1, '바깥을 누르면 닫힌다')

  unregister()
  await settle()
  card.remove()
})

test('바깥 클릭도 맨 위 하나만 닫는다 — outside가 없는 오버레이는 건드리지 않는다', async () => {
  reset()
  const card = window.document.createElement('div')
  window.document.body.appendChild(card)
  const closed: string[] = []

  // 아래는 사이드바처럼 바깥 클릭으로 닫히면 안 되는 오버레이
  const unregisterPanel = registerOverlay({ close: () => closed.push('panel'), closeOnEscape: () => true, escapePhase: 'bubble' })
  const unregisterCard = registerOverlay({
    close: () => closed.push('card'),
    closeOnEscape: () => true,
    escapePhase: 'capture',
    outside: () => card,
  })
  await settle()

  window.document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
  assert.deepEqual(closed, ['card'], '맨 위 카드만 닫힌다')

  unregisterCard()
  await settle()
  window.document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
  assert.deepEqual(closed, ['card'], 'outside가 없는 패널은 바깥 클릭에 반응하지 않는다')

  unregisterPanel()
  await settle()
  card.remove()
})

test('한 커밋에서 A가 닫히고 B가 열리면 history를 건드리지 않는다', async () => {
  reset()
  const unregisterA = registerOverlay({ close: () => {}, closeOnEscape: () => true, escapePhase: 'capture' })
  await settle()
  assert.equal(pushes, 1)

  // React는 정리(cleanup)를 전부 돌린 뒤 등록(setup)을 돌린다 — 그 사이 스택이 잠깐 빈다.
  // 여기서 back()을 불러 버리면 곧이어 B가 얹는 가드를 그 back()이 소비해 B가 저절로 닫힌다.
  unregisterA()
  const unregisterB = registerOverlay({ close: () => {}, closeOnEscape: () => true, escapePhase: 'capture' })
  await settle()

  assert.equal(backs, 0, '스택이 계속 비어 있지 않았으므로 뒤로 갈 일이 없다')
  assert.equal(pushes, 1, '가드도 그대로 하나')

  unregisterB()
  await settle()
  assert.equal(backs, 1)
})
