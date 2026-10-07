import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Minus, Undo } from 'iconoir-react'
import { useOverlayDismiss } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'

export function GitChangesMenu({ x, y, onClose, onInclude, onExclude, onDiscard }: {
  x: number; y: number; onClose: () => void; onInclude: () => void; onExclude: () => void; onDiscard: () => void
}) {
  useUiLocale()
  useOverlayDismiss(onClose)
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const place = () => {
      const viewport = window.visualViewport
      const left = (viewport?.offsetLeft ?? 0) + 4, top = (viewport?.offsetTop ?? 0) + 4
      const right = left + (viewport?.width ?? window.innerWidth) - 8
      const dock = window.matchMedia('(width < 768px)').matches ? document.querySelector('.mobile-dock:not([hidden])')?.getBoundingClientRect() : null
      const bottom = Math.min(top + (viewport?.height ?? window.innerHeight) - 8, dock?.height ? dock.top - 4 : Infinity)
      menu.style.maxWidth = `${Math.max(0, right - left)}px`
      menu.style.maxHeight = `${Math.max(0, bottom - top)}px`
      const bounds = menu.getBoundingClientRect()
      setPosition({ left: Math.max(left, Math.min(x, right - bounds.width)), top: Math.max(top, Math.min(y, bottom - bounds.height)) })
    }
    place()
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [x, y])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const menu = ref.current
    menu?.querySelector<HTMLButtonElement>('button')?.focus()
    const dismiss = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose() }
    const scroll = (event: Event) => { if (event.target instanceof Node && !ref.current?.contains(event.target)) onClose() }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('scroll', scroll, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('scroll', scroll, true)
      if (previous?.isConnected && (!document.activeElement || document.activeElement === document.body || menu?.contains(document.activeElement))) previous.focus({ preventScroll: true })
    }
  }, [onClose])
  return createPortal(<div ref={ref} role="menu" aria-label={uiText('변경 파일 작업')} style={position}
    className="fixed z-[1300] w-44 overflow-auto border border-edge-bright bg-surface-raised py-1 text-xs"
    onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
      const index = buttons.indexOf(event.target as HTMLButtonElement)
      const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null
      if (next !== null) { event.preventDefault(); buttons[next]?.focus() }
      if (event.key === 'Tab') onClose()
    }}>
    {[
      { label: uiText('커밋 대상에 포함'), action: onInclude, Icon: Check },
      { label: uiText('커밋 대상에서 제외'), action: onExclude, Icon: Minus },
      { label: uiText('취소 (Discard)'), action: onDiscard, Icon: Undo, danger: true },
    ].map(({ label, action, Icon, danger }) => <button key={label} type="button" role="menuitem" onClick={action}
      className={`flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none ${danger ? 'text-danger' : 'text-ink'}`}>
      <Icon width={14} height={14} aria-hidden="true" />{label}
    </button>)}
  </div>, document.body)
}
