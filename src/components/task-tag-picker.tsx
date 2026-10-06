import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, Plus, Xmark } from 'iconoir-react'
import { canAutoFocusInput, useOverlayDismiss } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { normalizeTag, validTag, TASK_TAG_LIMIT } from '../../shared/task-tags'
import { taskTagHue } from '../utils/task-tag-color'

export function TaskTagPicker({ tags, knownTags, disabled, onChange }: {
  tags: string[]; knownTags: string[]; disabled: boolean; onChange: (tags: string[]) => void
}) {
  const tagsElement = useRef<HTMLDivElement>(null)
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0)
  const [position, setPosition] = useState<CSSProperties>({})
  const normalized = normalizeTag(query.trim().replace(/^#/, ''))
  const choices = [...new Set([...knownTags, ...tags])].filter(tag => tag.includes(normalized))
  const create = validTag(normalized) && !choices.includes(normalized) ? normalized : null
  if (create) choices.push(create)
  const anchor = () => trigger.current?.isConnected ? trigger.current : tagsElement.current?.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')
  const openPicker = (event: MouseEvent<HTMLButtonElement>) => { trigger.current = event.currentTarget; setOpen(value => !value); setQuery(''); setActive(0) }
  const close = () => { setOpen(false); if (popup.current?.contains(document.activeElement) || document.activeElement === document.body) anchor()?.focus({ preventScroll: true }) }
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  useLayoutEffect(() => { if (open) { if (canAutoFocusInput()) popup.current?.querySelector('input')?.focus({ preventScroll: true }); else popup.current?.focus({ preventScroll: true }) } }, [open])
  useOverlayDismiss(open && close, { escapePhase: 'capture', outside: () => popup.current })
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = anchor()!.getBoundingClientRect(), viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const right = left + (viewport?.width ?? innerWidth), bottom = top + (viewport?.height ?? innerHeight)
      const width = Math.min(240, right - left - 16), below = bottom - rect.bottom - 12, above = rect.top - top - 12
      const down = below >= Math.min(260, popup.current?.scrollHeight ?? 260) || below >= above
      setPosition({ left: Math.max(left + 8, Math.min(rect.left, right - width - 8)), width,
        maxHeight: Math.max(48, Math.min(260, down ? below : above)), ...(down ? { top: rect.bottom + 4 } : { bottom: innerHeight - rect.top + 4 }) })
    }
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !tagsElement.current?.contains(event.target as Node)) close() }
    place(); document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place); window.visualViewport?.addEventListener('scroll', place)
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place) }
  }, [open, choices.length])
  useLayoutEffect(() => { if (open) popup.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }) }, [active, open])
  const toggle = (tag: string) => {
    if (tags.includes(tag)) onChange(tags.filter(value => value !== tag))
    else if (tags.length < TASK_TAG_LIMIT) onChange([...tags, tag])
    if (tag === create) { setQuery(''); setActive(0) }
  }
  return <div ref={tagsElement} className="task-tags task-tag-picker" aria-label={uiText('태그')}>
    {tags.map(tag => <span key={tag} className="task-tag" style={{ '--task-tag-hue': taskTagHue(tag) } as CSSProperties}>
      {disabled ? <span className="task-tag-name">{tag}</span> : <button type="button" className="task-tag-name" aria-label={`${uiText('태그')}: ${tag}`} aria-haspopup="dialog" aria-expanded={open && trigger.current?.textContent === tag} onClick={openPicker}>{tag}</button>}
      {!disabled && <button type="button" className="task-tag-remove" aria-label={`${uiText('태그 삭제')}: ${tag}`} data-tip={uiText('태그 삭제')} onClick={() => onChange(tags.filter(value => value !== tag))}><Xmark width={12} height={12} aria-hidden="true" /></button>}
    </span>)}
    {tags.length === 0 && <span className="task-tag task-tag-placeholder">{disabled ? <span className="task-tag-name">{uiText('태그')}</span> : <button type="button" className="task-tag-name" aria-haspopup="dialog" aria-expanded={open} onClick={openPicker}>{uiText('태그')}</button>}</span>}
    {open && createPortal(<div ref={popup} className="task-tag-picker-menu task-tag-suggestions" role="dialog" tabIndex={-1} aria-label={uiText('태그')} style={position} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) close() }}>
      <input value={query} aria-label={uiText('검색')} aria-controls={id} aria-activedescendant={choices.length ? `${id}-${Math.min(active, choices.length - 1)}` : undefined}
        onChange={event => { setQuery(event.target.value); setActive(0) }} onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % Math.max(1, choices.length)) }
          if (event.key === 'Enter' && choices.length) { event.preventDefault(); toggle(choices[Math.min(active, choices.length - 1)]) }
        }} />
      <div id={id} role="listbox" aria-label={uiText('태그')} aria-multiselectable="true">
        {choices.map((tag, index) => <button key={tag} id={`${id}-${index}`} type="button" role="option" aria-selected={tags.includes(tag)} data-active={index === Math.min(active, choices.length - 1)} disabled={!tags.includes(tag) && tags.length >= TASK_TAG_LIMIT} onClick={() => toggle(tag)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const buttons = popup.current?.querySelectorAll<HTMLButtonElement>('[role="option"]'); buttons?.[(index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length]?.focus() } }}>
          <span className="task-filter-dot" style={{ '--task-tag-hue': taskTagHue(tag) } as CSSProperties} aria-hidden="true" /><span className="task-tag-result">{tag}</span>{tags.includes(tag) ? <Check width={14} height={14} aria-hidden="true" /> : tag === create ? <Plus width={14} height={14} aria-hidden="true" /> : null}
        </button>)}
      </div>
    </div>, document.body)}
  </div>
}
