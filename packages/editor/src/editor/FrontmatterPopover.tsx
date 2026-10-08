import { canAutoFocusInput, useOverlayDismiss } from '@mew/ui'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Field menus share viewport placement, dismissal and keyboard navigation. */
export function FrontmatterPopover({ anchor, label, onClose, children, initialFocus, ignoreAnchor = false }: {
  anchor: HTMLElement; label: string; onClose: () => void; children: ReactNode; initialFocus?: 'input'; ignoreAnchor?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 280, visibility: 'hidden' as 'hidden' | 'visible' })
  const close = () => { onClose(); if (anchor.isConnected) anchor.focus({ preventScroll: true }) }
  useOverlayDismiss(close, { outside: () => ref.current, outsideIgnore: () => ignoreAnchor ? anchor : null })
  useLayoutEffect(() => {
    const place = () => {
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight
      const rect = anchor.getBoundingClientRect()
      const menu = ref.current!
      const below = top + height - rect.bottom - 8, above = rect.top - top - 8
      const down = below >= Math.min(menu.scrollHeight, 280) || below >= above
      const maxHeight = Math.max(0, Math.min(height - 16, down ? below : above))
      setPosition({ left: Math.max(left + 8, Math.min(rect.left, left + width - menu.offsetWidth - 8)),
        top: down ? Math.max(top + 8, rect.bottom + 4) : Math.max(top + 8, rect.top - Math.min(menu.scrollHeight, maxHeight) - 4),
        maxHeight, visibility: 'visible' })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    const observer = new ResizeObserver(place)
    observer.observe(ref.current!)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
      observer.disconnect()
    }
  }, [anchor])
  useEffect(() => {
    if (position.visibility !== 'visible') return
    const target = initialFocus === 'input' && canAutoFocusInput() ? 'input' : 'button'
    ref.current?.querySelector<HTMLElement>(target)?.focus({ preventScroll: true })
  }, [position.visibility, initialFocus])
  return createPortal(<div ref={ref} role="dialog" aria-label={label} style={position}
    className="frontmatter-popover fixed z-[1201] overflow-y-auto overscroll-contain rounded border border-edge-bright bg-surface-raised p-1 text-xs text-ink shadow-xl"
    onKeyDown={event => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Tab') {
        const controls = Array.from(ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
        if (event.target === (event.shiftKey ? controls[0] : controls.at(-1))) close()
        return
      }
      if ((event.target as HTMLElement).tagName === 'INPUT') return
      const buttons = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      const index = buttons.indexOf(event.target as HTMLButtonElement)
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next]?.focus()
      }
    }}>{children}</div>, anchor.closest('[role="dialog"]') ?? document.body)
}
