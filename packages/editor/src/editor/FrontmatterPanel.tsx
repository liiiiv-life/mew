import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { nextFieldKey, type FrontmatterData, type FrontmatterField } from '../utils/frontmatter'
import { isExternalHref, resolveRelativePath } from '../utils/fuzzy'
import { FrontmatterFieldMenu } from './FrontmatterFieldMenu'
import { FrontmatterFieldValue } from './FrontmatterFieldValue'

// Properties live outside TipTap so editing a value cannot break the YAML structure.
export function FrontmatterPanel({ data, lineNumbers, onChange, readOnly, docPath = '', onOpenLink }: {
  data: FrontmatterData
  lineNumbers?: { title: number; fields: number[] }
  onChange: (next: FrontmatterData) => void
  readOnly?: boolean
  docPath?: string
  onOpenLink?: (path: string) => void
}) {
  useUiLocale()
  const rows = useRef(new Map<number, HTMLDivElement>())
  const drag = useRef<{ index: number; pointerId: number; y: number; active: boolean } | null>(null)
  const suppressClick = useRef(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [over, setOver] = useState<{ index: number; after: boolean } | null>(null)
  const [menu, setMenu] = useState<{ index: number; anchor: HTMLElement } | null>(null)

  useEffect(() => { setMenu(null); endDrag() }, [docPath, readOnly])
  useEffect(() => {
    const cancel = () => endDrag()
    window.addEventListener('blur', cancel)
    return () => window.removeEventListener('blur', cancel)
  }, [])

  function openLink(href: string) {
    if (/^(javascript|data|vbscript):/i.test(href)) return
    if (isExternalHref(href)) window.open(href, '_blank', 'noopener,noreferrer')
    else onOpenLink?.(resolveRelativePath(docPath, href))
  }
  function setField(index: number, field: FrontmatterField) {
    if (readOnly) return
    onChange({ ...data, fields: data.fields.map((f, i) => i === index ? field : f) })
  }
  function moveField(from: number, before: number) {
    if (readOnly) return
    const insertAt = from < before ? before - 1 : before
    if (from === insertAt) return
    const fields = [...data.fields]
    const [moved] = fields.splice(from, 1)
    fields.splice(insertAt, 0, moved)
    setMenu(null)
    onChange({ ...data, fields })
  }
  function removeField(index: number) {
    if (readOnly) return
    setMenu(null)
    onChange({ ...data, fields: data.fields.filter((_, i) => i !== index) })
  }
  function endDrag() {
    drag.current = null
    setDragIndex(null)
    setOver(null)
  }
  function dropTarget(y: number) {
    for (const [index, row] of rows.current) {
      const rect = row.getBoundingClientRect()
      if (y < rect.bottom) return { index, after: y > rect.top + rect.height / 2 }
    }
    return { index: data.fields.length - 1, after: true }
  }
  function startDrag(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (readOnly || event.button !== 0 || !event.isPrimary) return
    suppressClick.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { index, pointerId: event.pointerId, y: event.clientY, active: false }
  }
  function dragMove(event: PointerEvent<HTMLButtonElement>) {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    if (!state.active && Math.abs(event.clientY - state.y) < 4) return
    event.preventDefault()
    state.active = true
    suppressClick.current = true
    setMenu(null)
    setDragIndex(state.index)
    setOver(dropTarget(event.clientY))
    const scroller = event.currentTarget.closest('.editor-root')
    if (scroller) {
      const rect = scroller.getBoundingClientRect()
      if (event.clientY < rect.top + 32) scroller.scrollTop -= 20
      if (event.clientY > rect.bottom - 32) scroller.scrollTop += 20
    }
  }

  return <div className="frontmatter-panel mx-8 mt-12 mb-2 border-b border-edge pb-3">
    <div className="frontmatter-line" data-mew-line-numbers={lineNumbers?.title ?? 2}>
      <input value={data.title} onChange={event => onChange({ ...data, title: event.target.value })} readOnly={readOnly}
        placeholder={uiText('제목')} aria-label={uiText('제목')}
        className="w-full border-none bg-transparent text-3xl leading-tight font-bold text-ink-bright outline-none placeholder:text-ink-faint" />
    </div>
    <div className="mt-3 flex flex-col gap-1">
      {data.fields.map((field, i) => <div key={i} ref={el => { if (el) rows.current.set(i, el); else rows.current.delete(i) }}
        data-mew-line-numbers={lineNumbers?.fields[i] ?? i + 3}
        className={`frontmatter-line frontmatter-property group flex items-center gap-1 border-y-2 border-transparent ${dragIndex === i ? 'opacity-40' : ''} ${over && over.index === i && dragIndex !== i ? over.after ? 'border-b-accent' : 'border-t-accent' : ''}`}>
        {!readOnly && <button type="button" aria-label={uiText('필드 순서 변경')} aria-haspopup="dialog" aria-expanded={menu?.index === i}
          title={uiText('드래그해서 순서 변경')} className="frontmatter-handle cursor-grab rounded text-ink-muted hover:text-ink active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent"
          onPointerDown={event => startDrag(event, i)} onPointerMove={dragMove}
          onPointerUp={event => {
            const state = drag.current
            if (state?.active && state.pointerId === event.pointerId) {
              const target = dropTarget(event.clientY)
              moveField(state.index, target.index + (target.after ? 1 : 0))
            }
            endDrag()
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          }} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
          onClick={event => { if (suppressClick.current) { suppressClick.current = false; return }; setMenu({ index: i, anchor: event.currentTarget }) }}
          onContextMenu={event => { event.preventDefault(); endDrag(); setMenu({ index: i, anchor: event.currentTarget }) }}
          onKeyDown={event => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); setMenu({ index: i, anchor: event.currentTarget }) }
            if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
              event.preventDefault()
              if (event.key === 'ArrowUp' && i > 0) moveField(i, i - 1)
              if (event.key === 'ArrowDown' && i < data.fields.length - 1) moveField(i, i + 2)
            }
          }}><GripIcon /></button>}
        <input value={field.key} onChange={event => setField(i, { ...field, key: event.target.value })} readOnly={readOnly}
          placeholder={uiText('필드명')} aria-label={uiText('필드명')}
          className="w-24 shrink-0 truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-ink-muted outline-none hover:border-edge focus:border-edge-bright" />
        <FrontmatterFieldValue key={`${i}:${field.type ?? ''}`} field={field} readOnly={readOnly} onChange={value => setField(i, { ...field, value })} onOpenLink={openLink} />
        {!readOnly && <button type="button" aria-label={uiText('필드 삭제')}
          onClick={() => removeField(i)}
          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-ink-faint opacity-0 hover:bg-surface-hover hover:text-ink group-hover:opacity-100 focus-visible:opacity-100">×</button>}
      </div>)}
      {!readOnly && <button type="button" onClick={() => onChange({ ...data, fields: [...data.fields, { key: nextFieldKey(data.fields), value: '' }] })}
        className="mt-1 self-start rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-hover hover:text-ink">{uiText('+ 필드 추가')}</button>}
    </div>
    {!readOnly && menu && data.fields[menu.index] && <FrontmatterFieldMenu field={data.fields[menu.index]} anchor={menu.anchor}
      onChange={field => setField(menu.index, field)} onClose={() => setMenu(null)} onDelete={() => removeField(menu.index)} />}
  </div>
}

function GripIcon() {
  return <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
    <circle cx="3" cy="3" r="1.2" /><circle cx="7" cy="3" r="1.2" />
    <circle cx="3" cy="7" r="1.2" /><circle cx="7" cy="7" r="1.2" />
    <circle cx="3" cy="11" r="1.2" /><circle cx="7" cy="11" r="1.2" />
  </svg>
}
