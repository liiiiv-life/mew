import { scopedBrowserStorage } from '@mew/ui/browser-storage-scope'
import { uiText } from '@mew/ui/i18n-core'
import { KEY_CODES } from '../../native/remote-desktop/keys.mjs'

export const SCREEN_KEYBOARD_KEY = 'mew-desktop-screen-keyboard'
export const DEFAULT_GAME_KEYS = ['KeyQ', 'KeyW', 'KeyE', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'Space']
export type ScreenKeyboardSettings = { mode: 'full' | 'game'; gameKeys: string[]; keyboardOnly: boolean }
export const FULL_KEY_ROWS = [
  ['Escape', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)],
  ['Backquote', ...'1234567890'.split('').map(n => `Digit${n}`), 'Minus', 'Equal', 'Backspace'],
  ['Tab', ...'QWERTYUIOP'.split('').map(n => `Key${n}`), 'BracketLeft', 'BracketRight', 'Backslash'],
  ['CapsLock', ...'ASDFGHJKL'.split('').map(n => `Key${n}`), 'Semicolon', 'Quote', 'Enter'],
  ['ShiftLeft', ...'ZXCVBNM'.split('').map(n => `Key${n}`), 'Comma', 'Period', 'Slash', 'ShiftRight'],
  ['ControlLeft', 'MetaLeft', 'AltLeft', 'Space', 'AltRight', 'MetaRight', 'ContextMenu', 'ControlRight'],
]
export const NAVIGATION_KEYS = ['PrintScreen', 'ScrollLock', 'Pause', 'Insert', 'Home', 'PageUp', 'Delete', 'End', 'PageDown', 'Lang1', 'ArrowUp', 'Lang2', 'ArrowLeft', 'ArrowDown', 'ArrowRight']
export const NUMPAD_KEYS = ['NumLock', 'NumpadDivide', 'NumpadMultiply', 'NumpadSubtract', 'Numpad7', 'Numpad8', 'Numpad9', 'NumpadAdd', 'Numpad4', 'Numpad5', 'Numpad6', 'NumpadEnter', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad0', 'NumpadDecimal']
export const isScreenModifier = (code: string) => /^(Control|Shift|Alt|Meta)(Left|Right)$/.test(code)
const labels: Record<string, string> = { Escape: 'Esc', Backquote: '`', Minus: '-', Equal: '=', Backspace: 'Bksp', BracketLeft: '[', BracketRight: ']', Backslash: '\\', CapsLock: 'Caps', Semicolon: ';', Quote: "'", ShiftLeft: 'Shift', ShiftRight: 'Shift', Comma: ',', Period: '.', Slash: '/', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', MetaLeft: 'Meta', MetaRight: 'Meta', AltLeft: 'Alt', AltRight: 'Alt', ContextMenu: 'Menu', PrintScreen: 'PrtSc', ScrollLock: 'ScrLk', PageUp: 'PgUp', PageDown: 'PgDn', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', NumpadDivide: '/', NumpadMultiply: '*', NumpadSubtract: '-', NumpadAdd: '+', NumpadEnter: 'Enter', NumpadDecimal: '.' }
export function screenKeyLabel(code: string): string { return code === 'Lang1' ? uiText('한/영') : code === 'Lang2' ? uiText('한자') : code === 'NumLock' ? 'Num' : code === 'NumpadEnter' ? 'Ent' : labels[code] ?? code.replace(/^(Key|Digit|Numpad)(?=[A-Z0-9]$)/, '') }
export function screenKeyboardSettings(value: unknown): ScreenKeyboardSettings {
  const raw = value && typeof value === 'object' ? value as Partial<ScreenKeyboardSettings> : {}
  const keys = Array.isArray(raw.gameKeys) ? [...new Set(raw.gameKeys.filter((code): code is string => typeof code === 'string' && Object.hasOwn(KEY_CODES, code)))].slice(0, 24) : []
  return { keyboardOnly: raw.keyboardOnly === true, mode: raw.mode === 'game' ? 'game' : 'full', gameKeys: keys.length ? keys : [...DEFAULT_GAME_KEYS] }
}
export function readScreenKeyboard(): ScreenKeyboardSettings {
  try { return screenKeyboardSettings(JSON.parse(scopedBrowserStorage().getItem(SCREEN_KEYBOARD_KEY) ?? 'null')) } catch { return screenKeyboardSettings(null) }
}
export function saveScreenKeyboard(value: ScreenKeyboardSettings) {
  try { scopedBrowserStorage().setItem(SCREEN_KEYBOARD_KEY, JSON.stringify(screenKeyboardSettings(value))) } catch { /* The current viewer remains usable without storage. */ }
}

/** Pointer owners share a key without releasing another finger's hold. */
export function screenKeyboardInput(emit: (code: string, down: boolean) => void, changed: (codes: string[]) => void = () => {}) {
  const owners = new Map<number, string>(), latched = new Set<string>()
  let pressed = new Set<string>()
  const sync = () => {
    const next = new Set([...owners.values(), ...latched])
    for (const code of pressed) if (!next.has(code)) emit(code, false)
    for (const code of next) if (!pressed.has(code)) emit(code, true)
    pressed = next; changed([...pressed])
  }
  return {
    down(id: number, code: string) { if (!Object.hasOwn(KEY_CODES, code)) return; owners.set(id, code); sync() },
    up(id: number) { if (owners.delete(id)) sync() },
    toggle(code: string) { if (!Object.hasOwn(KEY_CODES, code)) return; if (latched.has(code)) latched.delete(code); else latched.add(code); sync() },
    unlatch(code: string) { if (latched.delete(code)) sync() },
    release() { owners.clear(); latched.clear(); sync() },
    reset() { owners.clear(); latched.clear(); pressed.clear(); changed([]) },
  }
}
