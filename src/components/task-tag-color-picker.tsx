import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Check } from 'iconoir-react'
import { useOverlayDismiss } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { TASK_TAG_PALETTE } from '../../shared/task-tag-colors'

export function TaskTagColorPicker({ tag, hue, anchor, onChange, onClose }: {
  tag: string; hue: number; anchor: HTMLButtonElement; onChange: (hue: number) => void; onClose: () => void
}) {
  const popup = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<CSSProperties>({})
  const close = () => { onClose(); if (anchor.isConnected) anchor.focus({ preventScroll: true }) }
  useOverlayDismiss(close, { escapePhase: 'capture', outside: () => popup.current })
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect(), box = popup.current!.getBoundingClientRect(), viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const right = left + (viewport?.width ?? innerWidth), bottom = top + (viewport?.height ?? innerHeight)
      setPosition({ left: Math.max(left + 8, Math.min(rect.left, right - box.width - 8)),
        top: Math.max(top + 8, Math.min(rect.bottom + box.height + 12 <= bottom ? rect.bottom + 4 : rect.top - box.height - 4, bottom - box.height - 8)) })
    }
    place()
    popup.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true })
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place); window.visualViewport?.addEventListener('scroll', place)
    return () => {
      window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [anchor])
  return <div ref={popup} className="task-tag-color-picker" role="dialog" aria-label={`${uiText('태그 색상')}: ${tag}`} style={position}>
    <div className="task-tag-color-title">{tag}</div>
    <div className="task-tag-color-grid">{TASK_TAG_PALETTE.map((color, index) => <button key={color} type="button"
      aria-label={uiText('색상 {index}', { index: index + 1 })} aria-pressed={hue === color} tabIndex={hue === color ? 0 : -1}
      style={{ '--task-tag-hue': color } as CSSProperties} onClick={() => { onChange(color); close() }} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowDown' ? index + 4 : event.key === 'ArrowUp' ? index - 4 : event.key === 'Home' ? 0 : event.key === 'End' ? 15 : null
        if (next === null) return
        event.preventDefault(); event.stopPropagation()
        popup.current?.querySelectorAll<HTMLButtonElement>('button')[(next + 16) % 16]?.focus()
      }}>
      {hue === color && <Check width={14} height={14} aria-hidden="true" />}
    </button>)}</div>
  </div>
}
