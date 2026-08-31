import { useEffect, useRef, type RefObject } from 'react'

/**
 * 포커스된 독립 표면이 전역 단축키의 의미를 바꿀 때 등록하는 행동 목록이다.
 *
 * App은 단축키를 한 번만 판정하고, 이 등록표는 그 키가 어느 탭 줄에 적용될지를 고른다.
 * 그래서 에이전트·터미널처럼 패키지가 다른 표면도 App의 조건문을 늘리지 않고 참여할 수 있다.
 */
/** true면 이 표면이 단축키를 처리했으므로 브라우저 기본 동작을 막는다. */
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
 * true일 때만 그 표면이 실제 행동을 처리한 것이다. false면 호출자는 브라우저 기본 동작을
 * 양보하되, 포커스가 다른 표면으로 떨어졌는지는 구분할 수 있다.
 */
export function dispatchFocusedShortcut(shortcut: string, event: KeyboardEvent): 'handled' | 'unhandled-in-scope' | 'no-scope' {
  const matching = [...focusedShortcutScopes].filter((scope) => scopeContainsFocus(scope, event))
  if (matching.length === 0) return 'no-scope'
  const scope = matching.find((candidate) => !matching.some((other) => other !== candidate && candidate.element.contains(other.element)))
    ?? matching[matching.length - 1]
  return scope.handlers()[shortcut]?.(event) ? 'handled' : 'unhandled-in-scope'
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
