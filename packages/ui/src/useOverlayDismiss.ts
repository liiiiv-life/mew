import { useEffect, useRef } from 'react'

// 열려 있는 오버레이(모달·팝업·드롭다운·슬라이드 패널)를 앱 전체에서 하나의 스택으로 모은다.
// Esc와 안드로이드 하드웨어 뒤로가기(=브라우저 뒤로가기)는 언제나 **가장 나중에 열린 것 하나만**
// 닫는다. 겹쳐 있으면 한 겹씩 걷히고, 다 걷힌 뒤에야 뒤로가기가 실제 페이지 이동이 된다.
//
// 오버레이마다 각자 keydown 리스너를 다는 방식이 안 되는 이유: capture 단계에서 stopPropagation을
// 해도 **같은 노드(window)에 붙은 다른 리스너는 그대로 실행된다.** 그래서 겹쳐 있는 오버레이가
// Esc 한 번에 전부 닫혀 버린다. 리스너를 이 모듈에 딱 하나만 두고 스택 맨 위만 고르는 이유다.

type EscapePhase = 'capture' | 'bubble'

type Entry = {
  close: () => void
  closeOnBack?: () => boolean
  closeOnEscape: (event: KeyboardEvent) => boolean
  escapePhase: EscapePhase
  /** 주면 이 요소 **바깥**을 누를 때도 닫는다 — Esc·뒤로가기가 없는 터치 화면의 유일한 탈출구 */
  outside?: () => Element | null
}

/** 열린 순서대로 쌓인다 — 맨 뒤가 "가장 위" */
const stack: Entry[] = []
let listening = false
/** 뒤로가기가 소비할 더미 History 항목을 지금 얹어 뒀는지 */
let guardActive = false

function handleEscape(event: KeyboardEvent, phase: EscapePhase) {
  if (event.key !== 'Escape') return
  const top = stack[stack.length - 1]
  // 맨 위가 다른 단계를 쓰는 오버레이면 이 리스너는 손대지 않는다 — Esc의 주인은 언제나 맨 위 하나뿐
  if (!top || top.escapePhase !== phase || !top.closeOnEscape(event)) return
  event.preventDefault()
  event.stopPropagation()
  top.close()
}

const onKeyDownCapture = (event: KeyboardEvent) => handleEscape(event, 'capture')
const onKeyDownBubble = (event: KeyboardEvent) => handleEscape(event, 'bubble')

// Esc와 같은 규칙 — 바깥 클릭도 맨 위 하나만 닫는다. capture로 듣고 요소 포함 여부로 안팎을 가른다
// (안쪽에서 stopPropagation을 해도 capture는 이미 지나갔다 — 전파가 아니라 위치로 판단해야 한다).
function onPointerDownCapture(event: Event) {
  const top = stack[stack.length - 1]
  const el = top?.outside?.()
  if (!el) return
  const target = event.target
  if (target instanceof Node && el.contains(target)) return
  top.close()
}

function onPopState() {
  if (!guardActive) return
  // 뒤로가기가 우리 가드 항목을 소비했다 — 페이지를 떠나는 대신 맨 위 오버레이 하나를 닫는다.
  // 아래 오버레이가 남아 있으면 sync()가 가드를 다시 얹는다.
  guardActive = false
  const top = stack[stack.length - 1]
  if (top?.closeOnBack?.() === false) {
    // Content consumed Back without unmounting; rearm for the next press too.
    scheduleSync()
  } else top?.close()
}

function sync() {
  const anyOpen = stack.length > 0

  if (anyOpen !== listening) {
    listening = anyOpen
    if (anyOpen) {
      window.addEventListener('keydown', onKeyDownCapture, true)
      window.addEventListener('keydown', onKeyDownBubble)
      window.addEventListener('pointerdown', onPointerDownCapture, true)
      window.addEventListener('popstate', onPopState)
    } else {
      window.removeEventListener('keydown', onKeyDownCapture, true)
      window.removeEventListener('keydown', onKeyDownBubble)
      window.removeEventListener('pointerdown', onPointerDownCapture, true)
      window.removeEventListener('popstate', onPopState)
    }
  }

  if (anyOpen && !guardActive) {
    guardActive = true
    window.history.pushState({ mewOverlayGuard: true }, '')
  } else if (!anyOpen && guardActive) {
    // 뒤로가기가 아니라 버튼·바깥 클릭으로 닫혔다 — 얹어둔 가드를 걷어 히스토리를 원래대로 맞춘다.
    // (guardActive를 먼저 내려야 back()이 부르는 popstate가 오버레이를 또 닫지 않는다)
    guardActive = false
    window.history.back()
  }
}

let syncQueued = false
// 한 커밋 안에서 A가 닫히고 B가 열리는 경우(드롭다운 → 팝업 등) React는 정리(cleanup)를 전부 돌린
// 뒤에 등록(setup)을 돌린다. 그 사이의 "스택이 잠깐 빈" 순간에 바로 back()을 부르면, 곧이어 B가
// 얹은 새 가드를 그 back()이 소비해 B가 저절로 닫힌다. 마이크로태스크로 미뤄 한 번만 맞춘다.
function scheduleSync() {
  if (syncQueued) return
  syncQueued = true
  queueMicrotask(() => {
    syncQueued = false
    sync()
  })
}

export interface OverlayDismissOptions {
  /** false means content handled Back; retain the overlay and rearm its history guard. */
  closeOnBack?: () => boolean
  /**
   * Esc를 이 오버레이가 삼킬지 판단한다. false를 돌려주면 Esc는 원래 가던 곳으로 흘러간다 —
   * 터미널 안(vim 등)처럼 Esc가 콘텐츠의 몫인 경우에 쓴다. 뒤로가기에는 영향이 없다.
   */
  closeOnEscape?: (event: KeyboardEvent) => boolean
  /**
   * Esc를 어느 단계에서 잡을지. 기본값 `'capture'`는 다이얼로그용 — 아래 있는 에디터·터미널이
   * 손대기 전에 가로챈다.
   *
   * 사이드바·터미널 패널처럼 **콘텐츠를 감싸고만 있는** 오버레이는 `'bubble'`을 써야 한다.
   * 열려 있는 동안에도 그 안에서 작업이 계속되기 때문에, 슬래시 메뉴·인라인 이름 바꾸기처럼
   * 안쪽이 먼저 Esc를 쓰고 stopPropagation 하는 경우 패널이 대신 닫혀 버리면 안 된다.
   */
  escapePhase?: EscapePhase
  /**
   * 이 요소 바깥을 누르면 닫는다. 터치 화면에는 Esc 키가 없으므로, 닫기 버튼이 없는 팝업은
   * 이걸 주지 않으면 뒤로가기 말고는 빠져나갈 길이 없다.
   */
  outside?: () => Element | null
}

/** React 없이도 쓸 수 있는 등록 함수 — 훅은 이걸 감싼 것뿐이고, 테스트도 여기로 붙는다 */
export function registerOverlay(entry: Entry): () => void {
  stack.push(entry)
  scheduleSync()
  return () => {
    const index = stack.lastIndexOf(entry)
    if (index >= 0) stack.splice(index, 1)
    scheduleSync()
  }
}

/**
 * 이 오버레이를 Esc·뒤로가기 스택에 등록한다.
 *
 * @param close 오버레이를 닫는 함수. `null`·`false`를 주면 (아직 안 열림) 등록하지 않는다.
 *              열려 있는 동안만 마운트되는 컴포넌트라면 그냥 onClose를 그대로 넘기면 된다.
 */
export function useOverlayDismiss(close: (() => void) | null | false, options?: OverlayDismissOptions): void {
  // 콜백은 매 렌더 새로 만들어지는 게 보통이다 — ref로 받아 두면 스택 순서가 흔들리지 않는다
  const closeRef = useRef(close)
  closeRef.current = close
  const optionsRef = useRef(options)
  optionsRef.current = options

  const active = !!close
  useEffect(
    () =>
      active
        ? registerOverlay({
            close: () => {
              const fn = closeRef.current
              if (fn) fn()
            },
            closeOnEscape: (event) => optionsRef.current?.closeOnEscape?.(event) ?? true,
            closeOnBack: () => optionsRef.current?.closeOnBack?.() ?? true,
            escapePhase: optionsRef.current?.escapePhase ?? 'capture',
            outside: () => optionsRef.current?.outside?.() ?? null,
          })
        : undefined,
    [active],
  )
}
