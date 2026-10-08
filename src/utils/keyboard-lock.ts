export type KeyboardLock = { lock(keys?: string[]): Promise<void>; unlock(): void }
export type KeyboardLockStatus = 'locked' | 'limited' | 'denied'
type Request = { keys?: string[]; priority: number; status: (state: KeyboardLockStatus) => void }
type State = { requests: Set<Request>; current?: Request; generation: number }
const states = new WeakMap<KeyboardLock, State>()

/** Remote all-key locks temporarily replace, then restore, the app shortcut lock. */
export function requestKeyboardLock({ keys, priority = 0, status = () => {}, keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard }: {
  keys?: string[]; priority?: number; status?: Request['status']; keyboard?: KeyboardLock
} = {}): () => void {
  if (!keyboard?.lock || !keyboard.unlock) { status('limited'); return () => {} }
  const state: State = states.get(keyboard) ?? { requests: new Set<Request>(), generation: 0 }
  states.set(keyboard, state)
  const request: Request = { keys, priority, status }
  const sync = () => {
    const next = [...state.requests].sort((a, b) => b.priority - a.priority)[0]
    if (next === state.current) return
    const generation = ++state.generation
    state.current = next
    if (!next) { keyboard.unlock(); return }
    let pending: Promise<void>
    try { pending = next.keys ? keyboard.lock(next.keys) : keyboard.lock() }
    catch { next.status('denied'); return }
    void pending.then(() => {
      if (generation === state.generation) next.status('locked')
      else if (!state.current) keyboard.unlock()
    }, () => { if (generation === state.generation) next.status('denied') })
  }
  state.requests.add(request)
  sync()
  return () => { state.requests.delete(request); sync() }
}

export const APP_KEYBOARD_KEYS = [
  'KeyW', 'KeyN', 'KeyT', 'KeyL', 'KeyP', 'KeyO', 'KeyS', 'KeyF', 'KeyB',
  'Escape', 'Tab', 'PageUp', 'PageDown',
  ...Array.from({ length: 9 }, (_, i) => `Digit${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `Numpad${i + 1}`),
]

export function captureAppKeyboardLock(keyboard?: KeyboardLock): () => void {
  let release: (() => void) | undefined
  const unlock = () => { release?.(); release = undefined }
  const sync = () => {
    if (document.fullscreenElement && document.hasFocus() && !document.hidden) {
      release ??= requestKeyboardLock({ keys: APP_KEYBOARD_KEYS, keyboard })
    } else unlock()
  }
  document.addEventListener('fullscreenchange', sync)
  document.addEventListener('visibilitychange', sync)
  window.addEventListener('focus', sync)
  window.addEventListener('blur', unlock)
  sync()
  return () => {
    document.removeEventListener('fullscreenchange', sync)
    document.removeEventListener('visibilitychange', sync)
    window.removeEventListener('focus', sync)
    window.removeEventListener('blur', unlock)
    unlock()
  }
}
