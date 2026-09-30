import { canAutoFocusInput } from './input-focus'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayDismiss } from './useOverlayDismiss'

const focusable = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'
const frames: HTMLElement[] = []

/** Shared app-owned modal: portal, focus containment/restoration and overlay-stack dismissal. */
export function DialogFrame({ children, labelledBy, describedBy, onClose, className = 'max-w-md max-h-[90dvh] overflow-y-auto', busy = false }: {
  children: ReactNode
  labelledBy: string
  describedBy?: string
  onClose: () => void
  className?: string
  busy?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlayDismiss(() => { if (!busy) onClose() })

  useEffect(() => {
    const element = ref.current!
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    frames.push(element)
    const focusFirst = () => {
      const target = element.querySelector<HTMLElement>('[data-dialog-autofocus]') ?? element.querySelector<HTMLElement>(focusable) ?? element
      const opensKeyboard = target.matches('input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"]), textarea, [contenteditable]:not([contenteditable="false"])')
      ;(opensKeyboard && !canAutoFocusInput() ? element : target).focus()
    }
    focusFirst()
    const containFocus = (event: FocusEvent) => {
      if (frames.at(-1) === element && !element.contains(event.target as Node)) focusFirst()
    }
    document.addEventListener('focusin', containFocus)
    return () => {
      document.removeEventListener('focusin', containFocus)
      frames.splice(frames.indexOf(element), 1)
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-3 sm:p-6" onPointerDown={(event) => {
      event.stopPropagation()
      if (event.target === event.currentTarget && !busy) onClose()
    }} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy} aria-busy={busy || undefined} tabIndex={-1}
        className={`mew-dialog w-full overflow-hidden rounded-xl bg-surface shadow-2xl outline-none ${className}`}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
          if (event.key !== 'Tab') return
          const items = Array.from(ref.current!.querySelectorAll<HTMLElement>(focusable)).filter((item) => item.getClientRects().length > 0)
          const first = items[0]
          const last = items.at(-1)
          if (!first) { event.preventDefault(); ref.current?.focus(); return }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus() }
        }}>
        {children}
      </div>
    </div>, document.body,
  )
}
