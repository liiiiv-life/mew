import { KEY_CODES } from '../../native/remote-desktop/keys.mjs'
import { registerKeyboardCapture } from '@mew/shortcuts'
import type { DesktopInput } from './desktop-input.ts'
import { requestKeyboardLock, type KeyboardLock } from './keyboard-lock.ts'

export type { KeyboardLock } from './keyboard-lock.ts'

/** Capture remote viewport keys before app shortcuts, and release ownership with focus. */
export function captureDesktopKeyboard({ input, target, detected, copy, paste, status, keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard }: {
  input: DesktopInput; target: (target: EventTarget | null) => boolean; detected: () => void
  copy: () => Promise<void>; paste: (allowed: () => boolean) => Promise<void | boolean>; status: (state: 'locked' | 'limited' | 'denied') => void; keyboard?: KeyboardLock
}) {
  let closed = false, generation = 0
  let releaseLock: (() => void) | undefined
  let copyTimer: ReturnType<typeof setTimeout> | undefined
  const clipboardKeys = new Set<string>()
  const held = new Set<string>()
  const active = () => !closed && !document.hidden && document.hasFocus() && target(document.activeElement)
  const emit = (code: string, down: boolean) => { if (down) held.add(code); else held.delete(code); input.key(code, down) }
  const release = () => { input.release(); held.clear() }
  const unlock = () => { generation++; releaseLock?.(); releaseLock = undefined }
  const sync = () => {
    if (!active()) { unlock(); clearTimeout(copyTimer); clipboardKeys.clear(); release(); status('limited'); return }
    if (!document.fullscreenElement) { if (releaseLock) release(); unlock(); status('limited'); return }
    releaseLock ??= requestKeyboardLock({ keyboard, priority: 1, status: state => { if (!closed) status(state) } })
  }
  const key = (event: KeyboardEvent) => {
    if (!active() || !target(event.target)) return false
    event.preventDefault(); event.stopImmediatePropagation()
    const down = event.type === 'keydown'
    if (down && event.isTrusted && !event.isComposing && KEY_CODES[event.code]) detected()
    if (down && event.repeat && (held.has(event.code) || clipboardKeys.has(event.code))) {
      if (KEY_CODES[event.code] && held.has(event.code)) { emit(event.code, false); emit(event.code, true) }
      return true
    }
    if (down) {
      for (const [prefix, pressed] of [['Control', event.ctrlKey], ['Meta', event.metaKey], ['Alt', event.altKey], ['Shift', event.shiftKey]] as const) {
        if (pressed && !event.code.startsWith(prefix) && ![...held].some(code => code.startsWith(prefix))) emit(`${prefix}Left`, true)
      }
    }
    if (down && !event.altKey && !event.shiftKey && (event.ctrlKey || event.metaKey) && event.code === 'KeyV') {
      clipboardKeys.add(event.code)
      const current = generation
      const allowed = () => active() && current === generation
      const fallback = () => {
        if (!allowed()) return
        const prefix = event.metaKey ? 'Meta' : 'Control'
        const modifier = [...held].find(code => code.startsWith(prefix)) ?? `${prefix}Left`
        const restore = held.has(modifier)
        if (!restore) emit(modifier, true)
        emit('KeyV', true); emit('KeyV', false)
        if (!restore) emit(modifier, false)
      }
      void Promise.resolve().then(() => paste(allowed)).then(result => {
        if (result === false) fallback()
        else if (allowed()) for (const code of held) input.key(code, true)
      }, fallback)
      return true
    }
    if (!down && clipboardKeys.delete(event.code)) return true
    if (KEY_CODES[event.code]) emit(event.code, down)
    if (down && !event.altKey && (event.ctrlKey || event.metaKey) && ['KeyC', 'KeyX'].includes(event.code)) {
      clearTimeout(copyTimer)
      copyTimer = setTimeout(() => { if (active()) void copy().catch(() => {}) }, 200)
    }
    return true
  }
  const blur = () => { unlock(); clearTimeout(copyTimer); clipboardKeys.clear(); release() }
  const unregister = registerKeyboardCapture(key)
  window.addEventListener('blur', blur); window.addEventListener('focus', sync)
  document.addEventListener('focusin', sync); document.addEventListener('focusout', sync); document.addEventListener('fullscreenchange', sync)
  document.addEventListener('visibilitychange', sync)
  sync()
  return () => {
    closed = true; blur()
    unregister()
    window.removeEventListener('blur', blur); window.removeEventListener('focus', sync)
    document.removeEventListener('focusin', sync); document.removeEventListener('focusout', sync); document.removeEventListener('fullscreenchange', sync)
    document.removeEventListener('visibilitychange', sync)
  }
}
