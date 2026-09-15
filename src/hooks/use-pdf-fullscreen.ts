import { useEffect, useRef, useState, type RefObject } from 'react'

/** Fullscreen only this PDF. A modal top-layer fallback also escapes transformed/clipped panes. */
export function usePdfFullscreen(viewer: RefObject<HTMLDivElement | null>, stage: RefObject<HTMLDialogElement | null>) {
  const [fullscreen, setFullscreen] = useState(false)
  const mode = useRef<'native' | 'dialog' | null>(null)
  const pending = useRef(false)
  const alive = useRef(true)
  const previousFocus = useRef<HTMLElement | null>(null)

  function restore() {
    mode.current = null
    if (alive.current) setFullscreen(false)
    if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true })
  }
  async function exit() {
    if (document.fullscreenElement === viewer.current) {
      try { await document.exitFullscreen() } catch { /* Native Escape may already have exited. */ }
    } else if (mode.current === 'dialog') {
      stage.current?.close()
      stage.current?.show()
      restore()
    }
  }
  async function toggle() {
    if (pending.current) return
    if (mode.current) { await exit(); return }
    const element = viewer.current, dialog = stage.current
    if (!element || !dialog) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    pending.current = true
    try {
      try {
        await element.requestFullscreen({ navigationUI: 'hide' })
        if (!alive.current) { if (document.fullscreenElement === element) await document.exitFullscreen(); return }
        mode.current = 'native'
      } catch {
        if (!alive.current) return
        // Keep the DOM and PDF worker mounted. showModal supplies top-layer placement and focus isolation.
        dialog.close()
        dialog.showModal()
        mode.current = 'dialog'
      }
      setFullscreen(true)
      element.querySelector<HTMLElement>('.pdf-scroll')?.focus({ preventScroll: true })
    } finally { pending.current = false }
  }

  const exitRef = useRef(exit)
  exitRef.current = exit
  useEffect(() => {
    alive.current = true
    const element = viewer.current, dialog = stage.current
    const change = () => {
      if (document.fullscreenElement === element) { mode.current = 'native'; setFullscreen(true) }
      else if (mode.current === 'native') restore()
    }
    const key = (event: KeyboardEvent) => {
      if (!mode.current) return
      if (event.key === 'Tab') {
        const controls = Array.from(element?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') ?? []).filter(control => control.getClientRects().length)
        const first = controls[0], last = controls.at(-1)
        if (first && last && (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault(); event.stopImmediatePropagation()
          ;(event.shiftKey ? last : first).focus({ preventScroll: true })
        }
        return
      }
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopImmediatePropagation()
      void exitRef.current()
    }
    const cancel = (event: Event) => { event.preventDefault(); void exitRef.current() }
    document.addEventListener('fullscreenchange', change)
    window.addEventListener('keydown', key, true)
    dialog?.addEventListener('cancel', cancel)
    return () => {
      alive.current = false
      document.removeEventListener('fullscreenchange', change)
      window.removeEventListener('keydown', key, true)
      dialog?.removeEventListener('cancel', cancel)
      if (dialog?.matches(':modal')) dialog.close()
      if (document.fullscreenElement === element) void document.exitFullscreen().catch(() => {})
      mode.current = null
    }
  }, [viewer, stage])
  return { fullscreen, toggle }
}
