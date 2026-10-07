import { KEY_CODES } from '../../native/remote-desktop/keys.mjs'
import type { DesktopInput } from './desktop-input.ts'

export type KeyboardLock = { lock(): Promise<void>; unlock(): void }
const keyboardOwners = new WeakMap<KeyboardLock, object>()

/** Capture remote viewport keys before app shortcuts, and release ownership with focus. */
export function captureDesktopKeyboard({ input, target, detected, copy, paste, status, keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard }: {
  input: DesktopInput; target: (target: EventTarget | null) => boolean; detected: () => void
  copy: () => Promise<void>; paste: () => Promise<void>; status: (state: 'locked' | 'limited' | 'denied') => void; keyboard?: KeyboardLock
}) {
  let owner = {}
  let closed = false, locking = false, locked = false, generation = 0
  let copyTimer: ReturnType<typeof setTimeout> | undefined
  const clipboardKeys = new Set<string>()
  const active = () => !closed && document.hasFocus() && target(document.activeElement)
  const unlock = () => { generation++; if (keyboard && keyboardOwners.get(keyboard) === owner) { keyboard.unlock(); keyboardOwners.delete(keyboard) }; locked = false; locking = false }
  const sync = () => {
    if (!active()) { unlock(); clearTimeout(copyTimer); clipboardKeys.clear(); input.release(); status('limited'); return }
    if (!document.fullscreenElement) { unlock(); status('limited'); return }
    if (!keyboard || typeof keyboard.lock !== 'function' || typeof keyboard.unlock !== 'function') { status('limited'); return }
    if (locking || locked) return
    const current = ++generation
    owner = {}; const requestedOwner = owner
    locking = true; keyboardOwners.set(keyboard, requestedOwner)
    void keyboard.lock().then(() => {
      if (closed || current !== generation || !active() || !document.fullscreenElement) { if (!keyboardOwners.has(keyboard) || keyboardOwners.get(keyboard) === requestedOwner) { keyboard.unlock(); keyboardOwners.delete(keyboard) }; return }
      locking = false; locked = true; status('locked')
    }, () => { if (!closed && current === generation) { locking = false; status('denied') } })
  }
  const key = (event: KeyboardEvent) => {
    if (!active() || !target(event.target)) return
    event.preventDefault(); event.stopImmediatePropagation()
    const down = event.type === 'keydown'
    if (down && event.isTrusted && !event.isComposing && KEY_CODES[event.code]) detected()
    if (down && event.repeat) return
    if (down && !event.altKey && (event.ctrlKey || event.metaKey) && event.code === 'KeyV') {
      clipboardKeys.add(event.code)
      void paste().catch(() => {})
      return
    }
    if (!down && clipboardKeys.delete(event.code)) return
    if (KEY_CODES[event.code]) input.key(event.code, down)
    if (down && !event.altKey && (event.ctrlKey || event.metaKey) && ['KeyC', 'KeyX'].includes(event.code)) {
      clearTimeout(copyTimer)
      copyTimer = setTimeout(() => { if (active()) void copy().catch(() => {}) }, 200)
    }
  }
  const blur = () => { unlock(); clearTimeout(copyTimer); clipboardKeys.clear(); input.release() }
  window.addEventListener('keydown', key, true); window.addEventListener('keyup', key, true)
  window.addEventListener('blur', blur); window.addEventListener('focus', sync)
  document.addEventListener('focusin', sync); document.addEventListener('focusout', sync); document.addEventListener('fullscreenchange', sync)
  sync()
  return () => {
    closed = true; blur()
    window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', key, true)
    window.removeEventListener('blur', blur); window.removeEventListener('focus', sync)
    document.removeEventListener('focusin', sync); document.removeEventListener('focusout', sync); document.removeEventListener('fullscreenchange', sync)
  }
}
