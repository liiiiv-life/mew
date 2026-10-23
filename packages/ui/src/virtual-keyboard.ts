type VirtualKeyboard = EventTarget & {
  overlaysContent: boolean
  readonly boundingRect: DOMRectReadOnly
}

export type HostedKeyboardGeometry = {
  type: 'mew-keyboard-geometry'
  overlaysContent: boolean
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
}

const hostedKeyboards = new WeakMap<Window, VirtualKeyboard>()
const pendingFullscreen = new WeakMap<Window, { count: number; previousOverlay: boolean }>()

/** Keep the policy ready while native fullscreen entry is still pending. */
export function fullscreenKeyboardOverlay(win: Window = window) {
  return usesTouchKeyboard(win) && (Boolean(win.document.fullscreenElement) || pendingFullscreen.has(win))
}

/** Prepare the keyboard before Android starts changing its fullscreen surface. */
export async function requestFullscreenWithKeyboard(element: HTMLElement, options?: FullscreenOptions) {
  const win = element.ownerDocument.defaultView
  const keyboard = win && win === win.top && usesTouchKeyboard(win) ? getVirtualKeyboard(win) : undefined
  if (!win || !keyboard) return element.requestFullscreen(options)
  const pending = pendingFullscreen.get(win) ?? { count: 0, previousOverlay: keyboard.overlaysContent }
  pending.count++
  pendingFullscreen.set(win, pending)
  try {
    keyboard.overlaysContent = true
    // Call in the original user gesture; awaiting before this loses activation.
    await element.requestFullscreen(options)
  } finally {
    if (--pending.count === 0) {
      pendingFullscreen.delete(win)
      if (!win.document.fullscreenElement) keyboard.overlaysContent = pending.previousOverlay
    }
  }
}

/** The authenticated launcher port supplies geometry from the outermost page. */
export function installHostedKeyboard(win: Window = window) {
  const keyboard = new EventTarget() as VirtualKeyboard
  keyboard.overlaysContent = false
  Object.defineProperty(keyboard, 'boundingRect', { configurable: true, value: new DOMRect() })
  hostedKeyboards.set(win, keyboard)
  return {
    update(value: HostedKeyboardGeometry) {
      if (typeof value.overlaysContent !== 'boolean' || ![value.width, value.height, value.viewportWidth, value.viewportHeight].every(n => Number.isFinite(n) && n >= 0) || value.viewportWidth === 0) return
      // Desktop-site frames can use more CSS pixels than the outer mobile page.
      const ratio = (win.document.documentElement.clientWidth || win.innerWidth) / value.viewportWidth
      keyboard.overlaysContent = value.overlaysContent
      Object.defineProperty(keyboard, 'boundingRect', { configurable: true, value: new DOMRect(0, Math.max(0, value.viewportHeight - value.height) * ratio, value.width * ratio, value.height * ratio) })
      keyboard.dispatchEvent(new Event('geometrychange'))
    },
    dispose() {
      if (hostedKeyboards.get(win) === keyboard) hostedKeyboards.delete(win)
    },
  }
}

/** Chromium only accepts the overlay policy in the outermost browsing context. */
export function observeHostedKeyboard(send: (geometry: HostedKeyboardGeometry) => void, win: Window = window) {
  if (win !== win.top) return () => {}
  const keyboard = getVirtualKeyboard(win)
  if (!keyboard) return () => {}
  const previous = keyboard.overlaysContent
  const update = () => {
    const overlay = fullscreenKeyboardOverlay(win) ? true : previous
    if (keyboard.overlaysContent !== overlay) keyboard.overlaysContent = overlay
    const root = win.document.documentElement
    send({ type: 'mew-keyboard-geometry', overlaysContent: keyboard.overlaysContent,
      width: keyboard.boundingRect.width, height: keyboard.boundingRect.height,
      viewportWidth: root.clientWidth || win.innerWidth,
      viewportHeight: Math.max(win.innerHeight, root.clientHeight, root.getBoundingClientRect().height) })
  }
  keyboard.addEventListener('geometrychange', update)
  win.document.addEventListener('fullscreenchange', update)
  win.addEventListener('resize', update)
  update()
  return () => {
    keyboard.removeEventListener('geometrychange', update)
    win.document.removeEventListener('fullscreenchange', update)
    win.removeEventListener('resize', update)
    keyboard.overlaysContent = previous
  }
}

/** Touch input can use a wide desktop-site layout on a phone. */
export function usesTouchKeyboard(win: Window = window) {
  return win.innerWidth < 768 || win.matchMedia('(pointer: coarse)').matches
}

/** Zoom relative to the fitted layout, including desktop-site initial scale < 1. */
export function viewportZoomRatio(win: Window = window) {
  const width = win.visualViewport?.width ?? 0
  const layoutWidth = win.document.documentElement.clientWidth || win.innerWidth
  return width > 0 && Math.round(width) < layoutWidth ? layoutWidth / width : 1
}

export function unzoomedViewportHeight(win: Window = window) {
  return (win.visualViewport?.height ?? win.innerHeight) * viewportZoomRatio(win)
}

export function getVirtualKeyboard(win: Window = window) {
  return hostedKeyboards.get(win) ?? (win.navigator as Navigator & { virtualKeyboard?: VirtualKeyboard }).virtualKeyboard
}

/** Boundary above a bottom-docked mobile fullscreen keyboard; Infinity outside it. */
export function virtualKeyboardViewportBottom(win: Window = window) {
  const keyboard = getVirtualKeyboard(win)
  if (!keyboard?.overlaysContent || !usesTouchKeyboard(win) || !win.document.fullscreenElement) return Infinity
  const rect = keyboard.boundingRect
  if (!(rect.height > 0 && rect.width > 0)) return Infinity
  // The host already normalized legacy coordinates in its own viewport. The
  // nested frame may have resized independently, so do not subtract twice.
  if (hostedKeyboards.has(win)) return rect.top
  const root = win.document.documentElement
  const height = Math.max(win.innerHeight, root.clientHeight, root.getBoundingClientRect().height)
  // Older Android Chromium reports the visible root origin (often y=0), rather
  // than the keyboard top. Its height still tells us how much screen is covered.
  return Math.max(0, height - rect.height)
}
