import { uiText } from '@mew/ui/i18n-core'
import { useSyncExternalStore } from 'react'
import shortcutsData from './shortcuts.json'

export interface ShortcutDef {
  id: string
  category: string
  label: string
  /** 기본 조합 — "Ctrl+Shift+N" 형식 (수정자는 Ctrl/Alt/Shift 순, 마지막 토큰이 실제 키) */
  keys: string
  /** false면 팝업에는 표시하되 재지정은 막는다 (에디터 내부 키맵과 충돌 위험이 있는 것들) */
  editable: boolean
}

export const DEFAULT_SHORTCUTS: ShortcutDef[] = shortcutsData

const DEFAULT_MAP: Record<string, ShortcutDef> = Object.fromEntries(DEFAULT_SHORTCUTS.map((s) => [s.id, s]))

interface KeyLikeEvent {
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  key: string
  code: string
}

const NAMED_KEYS = new Set(['Enter', 'Escape', 'Delete', 'Insert', 'F2', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

interface ParsedShortcut {
  ctrl: boolean
  shift: boolean
  alt: boolean
  token: string
}

function parseShortcut(keys: string): ParsedShortcut {
  const parts = keys.split('+').map((p) => p.trim())
  const token = parts[parts.length - 1]
  const mods = parts.slice(0, -1).map((p) => p.toLowerCase())
  return {
    ctrl: mods.includes('ctrl') || mods.includes('cmd'),
    shift: mods.includes('shift'),
    alt: mods.includes('alt'),
    token,
  }
}

/** 키 이벤트가 "Ctrl+Shift+N" 같은 조합 문자열과 일치하는지 확인한다.
 * 문자 키는 Alt 조합일 때만 event.code로 비교한다 — macOS에서 Option+문자는 event.key가
 * 특수문자로 바뀌어 레이아웃에 취약하기 때문 (기존 App.tsx 단축키 처리 방식과 동일). */
export function matchesShortcut(event: KeyLikeEvent, keys: string): boolean {
  const p = parseShortcut(keys)
  if ((event.ctrlKey || event.metaKey) !== p.ctrl) return false
  if (event.shiftKey !== p.shift) return false
  if (event.altKey !== p.alt) return false

  if (p.token === '`') return event.code === 'Backquote'
  if (NAMED_KEYS.has(p.token)) return event.key === p.token
  if (p.alt) return event.code === `Key${p.token.toUpperCase()}`
  return event.key.toLowerCase() === p.token.toLowerCase()
}

/** 키 이벤트를 "Ctrl+Shift+N" 형식의 정규 표기로 되돌린다 — 팝업에서 새 조합을 녹화할 때 쓴다 */
export function formatKeyCombo(event: KeyLikeEvent): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(labelForKey(event))
  return parts.join('+')
}

function labelForKey(event: KeyLikeEvent): string {
  if (event.code === 'Backquote') return '`'
  if (NAMED_KEYS.has(event.key)) return event.key
  if (event.code.startsWith('Key')) return event.code.slice(3)
  return event.key.length === 1 ? event.key.toUpperCase() : event.key
}

const STORAGE_KEY = 'mew:shortcuts'
/** 2026-07-30 이전 키 — 읽기만 한다. 지우면 그때까지 재지정한 단축키가 한 번에 기본값으로 돌아간다 */
const LEGACY_STORAGE_KEY = 'liiiiv-mew:shortcuts'

type Overrides = Record<string, string>

function loadOverrides(): Overrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

let overrides: Overrides = typeof localStorage !== 'undefined' ? loadOverrides() : {}
const listeners = new Set<() => void>()

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // 저장 실패(프라이빗 모드 등)해도 메모리상 바인딩은 세션 동안 유지된다
  }
  cachedBindings = computeBindings()
  listeners.forEach((l) => l())
}

/** 특정 단축키의 현재 유효 조합(사용자 재지정 우선, 없으면 기본값)을 읽는다.
 * 모듈 전역 상태를 직접 읽으므로 keydown 핸들러 안에서 매번 호출해도 stale closure 문제가 없다. */
export function getBinding(id: string): string {
  return overrides[id] ?? DEFAULT_MAP[id]?.keys ?? ''
}

function computeBindings(): Overrides {
  return Object.fromEntries(DEFAULT_SHORTCUTS.map((s) => [s.id, getBinding(s.id)]))
}

// useSyncExternalStore는 getSnapshot이 매번 같은 참조를 반환해야 무한 리렌더를 피한다 —
// overrides가 바뀔 때만(persist에서) 재계산하고, 그 사이엔 캐시된 객체를 그대로 돌려준다.
let cachedBindings: Overrides = computeBindings()

export function getBindings(): Overrides {
  return cachedBindings
}

/** id의 조합을 재지정한다. 다른 편집 가능한 단축키와 겹치면 저장하지 않고 에러를 반환한다. */
export function setBinding(id: string, keys: string): { ok: true } | { ok: false; error: string } {
  const def = DEFAULT_MAP[id]
  if (!def || !def.editable) return { ok: false, error: uiText("수정할 수 없는 단축키입니다") }

  const conflict = DEFAULT_SHORTCUTS.find((s) => s.id !== id && s.editable && getBinding(s.id) === keys)
  if (conflict) return { ok: false, error: uiText("이미 \"{p0}\"에서 사용 중입니다", { p0: conflict.label }) }

  overrides = { ...overrides, [id]: keys }
  persist()
  return { ok: true }
}

export function resetBinding(id: string): void {
  if (!(id in overrides)) return
  const next = { ...overrides }
  delete next[id]
  overrides = next
  persist()
}

export function resetAllBindings(): void {
  overrides = {}
  persist()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 팝업 등 UI에서 바인딩 변경에 반응해 리렌더링하려면 이 훅을 쓴다 */
export function useShortcutBindings(): Overrides {
  return useSyncExternalStore(subscribe, getBindings, getBindings)
}
export { closeFocusedTab, openFocusedTab, dispatchFocusedShortcut, useFocusedShortcutScope, type FocusedShortcutHandlers } from './focusedShortcutScope'
export { numberedTabIndex, projectTabIndex, adjacentPanelTabDirection } from './numberedTab'
export { registerKeyboardCapture } from './keyboardCapture'
