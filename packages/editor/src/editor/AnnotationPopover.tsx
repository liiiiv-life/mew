import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { canAutoFocusInput, useOverlayDismiss } from '@mew/ui'
import { getVirtualKeyboard, virtualKeyboardViewportBottom } from '@mew/ui/virtual-keyboard'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { Plus, Trash, Xmark } from 'iconoir-react'

export interface AnnotationEntry { num: number; content: string }

function AnnotationInput({ num, content, readOnly, onChange }: {
  num: number
  content: string
  readOnly: boolean
  onChange: (num: number, text: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState(content)
  // Markdown normalizes whitespace while a sentence is being typed. Keep the
  // active input intact, while still accepting external updates when unfocused.
  useEffect(() => {
    if (ref.current?.ownerDocument.activeElement !== ref.current) setDraft(content)
  }, [content, readOnly])
  return (
    <textarea
      ref={ref}
      aria-label={uiText('주석 내용')}
      value={draft}
      onChange={event => {
        setDraft(event.target.value)
        onChange(num, event.target.value)
      }}
      readOnly={readOnly}
      rows={3}
      autoFocus={!readOnly && canAutoFocusInput()}
      className="block w-full resize-y rounded border border-edge-strong bg-surface-deep px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
    />
  )
}

export function AnnotationPopover({ entries, num, x, y, readOnly, onPick, onChange, onDelete, onAdd, onClose, outsideIgnore }: {
  entries: AnnotationEntry[]
  num: number | null
  x: number
  y: number
  readOnly: boolean
  onPick: (num: number) => void
  onChange: (num: number, text: string) => void
  onDelete: (num: number) => void
  onAdd: () => void
  onClose: () => void
  outsideIgnore?: () => Element | null
}) {
  useUiLocale()
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y + 8, maxHeight: 320 })
  const entry = entries.find(entry => entry.num === num)
  const label = num === null ? uiText('주석 목록') : `${uiText('주석')} ${num})`
  useOverlayDismiss(onClose, { outside: () => ref.current, outsideIgnore })
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current
      if (!el) return
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0
      const top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth
      const height = Math.min(top + (viewport?.height ?? window.innerHeight), virtualKeyboardViewportBottom(window)) - top
      const rect = el.getBoundingClientRect()
      const maxHeight = Math.max(60, height - 16)
      const below = y + 8
      const above = y - Math.min(rect.height, maxHeight) - 8
      setPosition({
        left: Math.max(left + 8, Math.min(x, left + width - rect.width - 8)),
        top: Math.max(top + 8, Math.min(below + rect.height <= top + height - 8 ? below : above, top + height - Math.min(rect.height, maxHeight) - 8)),
        maxHeight,
      })
    }
    place()
    const observer = new ResizeObserver(place)
    if (ref.current) observer.observe(ref.current)
    const keyboard = getVirtualKeyboard(window)
    keyboard?.addEventListener('geometrychange', place)
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      observer.disconnect()
      keyboard?.removeEventListener('geometrychange', place)
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [x, y, num, entries.length])
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className="mew-annotation-popover fixed z-50 flex w-72 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-lg bg-surface-raised text-ink shadow-xl"
      style={position}
      onPointerDown={event => event.stopPropagation()}
    >
      <div className="flex shrink-0 items-center gap-1 px-2 py-1">
        <span className="mr-auto text-xs font-medium">{label}</span>
        {num === null && !readOnly && (
          <button type="button" className="rounded p-1 text-ink-secondary hover:bg-surface-hover" aria-label={uiText('주석 추가')} title={uiText('주석 추가')} onClick={onAdd}>
            <Plus width={16} height={16} aria-hidden="true" />
          </button>
        )}
        {num !== null && !readOnly && (
          <button type="button" className="rounded p-1 text-ink-secondary hover:bg-surface-hover hover:text-danger" aria-label={uiText('주석 삭제')} title={uiText('주석 삭제')} onClick={() => onDelete(num)}>
            <Trash width={16} height={16} aria-hidden="true" />
          </button>
        )}
        <button type="button" className="rounded p-1 text-ink-secondary hover:bg-surface-hover" aria-label={uiText('닫기')} title={uiText('닫기')} onClick={onClose}>
          <Xmark width={16} height={16} aria-hidden="true" />
        </button>
      </div>
      {num === null ? (
        <div className="overflow-y-auto pb-1">
          {entries.length === 0 ? (
            <p className="px-2 py-2 text-xs text-ink-secondary">{uiText('주석이 없습니다.')}</p>
          ) : entries.map(entry => (
            <button key={entry.num} type="button" onClick={() => onPick(entry.num)} className="flex w-full items-start gap-2 px-2 py-1.5 text-left text-sm hover:bg-surface-hover">
              <span className="shrink-0 text-xs text-ink-secondary">{entry.num})</span>
              <span className="min-w-0 whitespace-pre-wrap break-words">{entry.content || uiText('빈 주석')}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="min-h-0 overflow-y-auto px-2 pb-2">
          <AnnotationInput
            key={num}
            num={num}
            content={entry?.content ?? ''}
            onChange={onChange}
            readOnly={readOnly}
          />
        </div>
      )}
    </div>, document.body,
  )
}
