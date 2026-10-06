import { useEffect, useRef, type RefObject } from 'react'

/**
 * 포커스된 독립 표면이 전역 단축키의 의미를 바꿀 때 등록하는 행동 목록이다.
 *
 * App은 단축키를 한 번만 판정하고, 이 등록표는 그 키가 어느 탭 줄에 적용될지를 고른다.
 * 그래서 에이전트·터미널처럼 패키지가 다른 표면도 App의 조건문을 늘리지 않고 참여할 수 있다.
 */
/** true면 이 표면이 단축키의 행동을 처리했다. 기본 동작 차단 여부는 호출자가 정한다. */
export type FocusedShortcutHandlers = Partial<Record<string, (event: KeyboardEvent) => boolean>>

type FocusedShortcutScope = {
  element: HTMLElement
  handlers: () => FocusedShortcutHandlers
}

const focusedShortcutScopes = new Set<FocusedShortcutScope>()

function scopeContainsFocus(scope: FocusedShortcutScope, event: KeyboardEvent): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  if (path.includes(scope.element)) return true
  const target = event.target
  if (target instanceof Node && scope.element.contains(target)) return true
  const active = document.activeElement
  return active instanceof Node && scope.element.contains(active)
}

/**
 * 포커스를 가진 가장 안쪽 등록 표면에 shortcut을 전달한다.
 * false여도 해당 표면에 포커스가 있다는 사실은 유지한다. 다른 표면의 탭을 닫지 않는다.
 */
export function dispatchFocusedShortcut(shortcut: string, event: KeyboardEvent): 'handled' | 'unhandled-in-scope' | 'no-scope' {
  const matching = [...focusedShortcutScopes].filter((scope) => scopeContainsFocus(scope, event))
  if (matching.length === 0) return 'no-scope'
  const scope = matching.find((candidate) => !matching.some((other) => other !== candidate && candidate.element.contains(other.element)))
    ?? matching[matching.length - 1]
  return scope.handlers()[shortcut]?.(event) ? 'handled' : 'unhandled-in-scope'
}

/** capture 단계에서 호출해 편집기·PTY와 브라우저에 탭 닫기 키가 새지 않게 한다. */
export function closeFocusedTab(event: KeyboardEvent, closeEditorTab: () => void): void {
  event.preventDefault()
  event.stopImmediatePropagation()
  if (event.repeat) return
  const target = event.target instanceof HTMLElement ? event.target : document.activeElement
  if (target instanceof HTMLElement && target.closest('[role="dialog"], [aria-modal="true"]')) return
  if (dispatchFocusedShortcut('closeTab', event) === 'no-scope') closeEditorTab()
}

/** React 표면의 루트 ref를 포커스 기반 단축키 대상으로 등록한다. */
export function useFocusedShortcutScope(ref: RefObject<HTMLElement | null>, handlers: FocusedShortcutHandlers): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const scope: FocusedShortcutScope = { element, handlers: () => handlersRef.current }
    focusedShortcutScopes.add(scope)
    return () => { focusedShortcutScopes.delete(scope) }
  }, [ref])
}
