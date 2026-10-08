import { DocumentBacklinks } from './DocumentBacklinks'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { frontmatterType, nextFieldKey, type FrontmatterData, type FrontmatterField } from '../utils/frontmatter'
import type { EditorApi, FrontmatterOptionsApi } from '../types'
import { isExternalHref, resolveRelativePath } from '../utils/fuzzy'
import { FrontmatterFieldMenu } from './FrontmatterFieldMenu'
import { FrontmatterFieldValue } from './FrontmatterFieldValue'

// Properties live outside TipTap so editing a value cannot break the YAML structure.
export function FrontmatterPanel({ data, lineNumbers, onChange, readOnly, docPath = '', onOpenLink, optionsApi, fetchBacklinks }: {
  data: FrontmatterData
  lineNumbers?: { title: number; fields: number[] }
  onChange: (next: FrontmatterData) => void
  readOnly?: boolean
  docPath?: string
  onOpenLink?: (path: string) => void
  optionsApi?: FrontmatterOptionsApi
  fetchBacklinks?: EditorApi['fetchBacklinks']
}) {
  useUiLocale()
  const rows = useRef(new Map<number, HTMLDivElement>())
  const drag = useRef<{ index: number; pointerId: number; y: number; active: boolean } | null>(null)
  const suppressClick = useRef(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [over, setOver] = useState<{ index: number; after: boolean } | null>(null)
  const [menu, setMenu] = useState<{ index: number; anchor: HTMLElement } | null>(null)
  const [sharedOptions, setSharedOptions] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)
  const [optionsError, setOptionsError] = useState('')
  const latest = useRef({ data, docPath, optionsApi, onChange, readOnly })
  latest.current = { data, docPath, optionsApi, onChange, readOnly }
  const pending = useRef(false)
  const requests = useRef(new Map<string, number>())
  const nextRequest = (key: string) => { const next = (requests.current.get(key) ?? 0) + 1; requests.current.set(key, next); return next }
  const optionKeys = JSON.stringify([...new Set(data.fields.filter(field => ['select', 'multi-select'].includes(frontmatterType(field))).map(field => field.key).filter(Boolean))])
  useEffect(() => {
    let cancelled = false
    setSharedOptions({})
    setOptionsError('')
    if (optionsApi) void Promise.all((JSON.parse(optionKeys) as string[]).map(async key => {
      const request = nextRequest(key)
      try {
        const options = await optionsApi.fetch(key)
        if (!cancelled && requests.current.get(key) === request && options !== null) setSharedOptions(previous => ({ ...previous, [key]: options }))
      } catch (error) {
        if (!cancelled) setOptionsError(error instanceof Error ? error.message : uiText('선택 항목을 불러오지 못했습니다'))
      }
    }))
    return () => { cancelled = true }
  }, [optionsApi, docPath, optionKeys])

  const effectiveField = (field: FrontmatterField): FrontmatterField => Object.prototype.hasOwnProperty.call(sharedOptions, field.key)
    ? { ...field, options: sharedOptions[field.key] } : field
  async function refreshOptions(field: FrontmatterField) {
    if (!optionsApi || !field.key.trim()) return
    const scope = latest.current
    const request = nextRequest(field.key)
    try {
      let options = await optionsApi.fetch(field.key)
      if (options === null && !readOnly && field.options?.length) options = await optionsApi.update(field.key, { seed: field.options, add: [], remove: [] })
      if (latest.current.optionsApi !== scope.optionsApi || latest.current.docPath !== scope.docPath || requests.current.get(field.key) !== request) return
      if (options !== null) setSharedOptions(previous => ({ ...previous, [field.key]: options! }))
      setOptionsError('')
    } catch (error) {
      if (latest.current.optionsApi === scope.optionsApi && latest.current.docPath === scope.docPath) setOptionsError(error instanceof Error ? error.message : uiText('선택 항목을 불러오지 못했습니다'))
    }
  }

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
  async function setField(index: number, field: FrontmatterField): Promise<boolean> {
    if (readOnly || pending.current) return false
    const before = effectiveField(data.fields[index])
    const scope = latest.current
    const changedOptions = JSON.stringify(before.options ?? []) !== JSON.stringify(field.options ?? [])
    if (optionsApi && changedOptions && ['select', 'multi-select'].includes(frontmatterType(field))) {
      pending.current = true
      nextRequest(field.key)
      setSaving(true)
      try {
        const options = await optionsApi.update(field.key, {
          seed: before.options ?? [], add: (field.options ?? []).filter(value => !before.options?.includes(value)),
          remove: (before.options ?? []).filter(value => !field.options?.includes(value)),
        })
        if (latest.current.optionsApi !== scope.optionsApi || latest.current.docPath !== scope.docPath || latest.current.readOnly) return false
        field = { ...field, options }
        setSharedOptions(previous => ({ ...previous, [field.key]: options }))
        setOptionsError('')
      } catch (error) {
        if (latest.current.optionsApi === scope.optionsApi && latest.current.docPath === scope.docPath) setOptionsError(error instanceof Error ? error.message : uiText('선택 항목을 저장하지 못했습니다'))
        return false
      } finally {
        pending.current = false
        setSaving(false)
      }
    }
    const current = latest.current
    if (current.docPath !== scope.docPath || current.optionsApi !== scope.optionsApi || current.readOnly) return false
    current.onChange({ ...current.data, fields: current.data.fields.map((f, i) => i === index ? field : f) })
    return true
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
    <div className="frontmatter-line flex items-center gap-1" data-mew-line-numbers={lineNumbers?.title ?? 2}>
      <input value={data.title} onChange={event => onChange({ ...data, title: event.target.value })} readOnly={readOnly}
        placeholder={uiText('제목')} aria-label={uiText('제목')}
        className="min-w-0 flex-1 border-none bg-transparent text-3xl leading-tight font-bold text-ink-bright outline-none placeholder:text-ink-faint" />
      {fetchBacklinks && onOpenLink && docPath && <DocumentBacklinks path={docPath} fetchBacklinks={fetchBacklinks} onOpenLink={onOpenLink} />}
    </div>
    <div className="mt-3 flex flex-col gap-1">
      {data.fields.map((rawField, i) => { const field = effectiveField(rawField); return <div key={i} ref={el => { if (el) rows.current.set(i, el); else rows.current.delete(i) }}
        data-mew-line-numbers={lineNumbers?.fields[i] ?? i + 3}
        className={`frontmatter-line frontmatter-property group flex min-h-8 items-center gap-1 border-y-2 border-transparent ${dragIndex === i ? 'opacity-40' : ''} ${over && over.index === i && dragIndex !== i ? over.after ? 'border-b-accent' : 'border-t-accent' : ''}`}>
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
          disabled={saving}
          onClick={event => { if (suppressClick.current) { suppressClick.current = false; return }; void refreshOptions(field); setMenu({ index: i, anchor: event.currentTarget }) }}
          onContextMenu={event => { event.preventDefault(); endDrag(); void refreshOptions(field); setMenu({ index: i, anchor: event.currentTarget }) }}
          onKeyDown={event => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); setMenu({ index: i, anchor: event.currentTarget }) }
            if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
              event.preventDefault()
              if (event.key === 'ArrowUp' && i > 0) moveField(i, i - 1)
              if (event.key === 'ArrowDown' && i < data.fields.length - 1) moveField(i, i + 2)
            }
          }}><GripIcon /></button>}
        <input value={field.key} onChange={event => setField(i, { ...field, key: event.target.value })} readOnly={readOnly}
          placeholder={uiText('필드명')} aria-label={uiText('필드명')} disabled={saving}
          className="w-24 shrink-0 truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-ink-muted outline-none hover:border-edge focus:border-edge-bright" />
        <FrontmatterFieldValue key={`${i}:${field.type ?? ''}`} field={field} readOnly={readOnly} busy={saving} onChange={value => { void setField(i, { ...field, value }) }}
          onCreate={next => setField(i, next)} onOpen={() => { void refreshOptions(field) }} onOpenLink={openLink} />
        {!readOnly && <button type="button" disabled={saving} aria-label={uiText('필드 삭제')}
          onClick={() => removeField(i)}
          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-ink-faint opacity-0 hover:bg-surface-hover hover:text-ink group-hover:opacity-100 focus-visible:opacity-100">×</button>}
      </div> })}
      {!readOnly && <button type="button" disabled={saving} onClick={() => onChange({ ...data, fields: [...data.fields, { key: nextFieldKey(data.fields), value: '' }] })}
        className="mt-1 self-start rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-hover hover:text-ink">{uiText('+ 필드 추가')}</button>}
    </div>
    {optionsError && <div role="alert" className="mt-1 text-xs text-danger-strong">{optionsError}</div>}
    {!readOnly && !saving && menu && data.fields[menu.index] && <FrontmatterFieldMenu field={effectiveField(data.fields[menu.index])} anchor={menu.anchor}
      onChange={field => { void setField(menu.index, field) }} onClose={() => setMenu(null)} onDelete={() => removeField(menu.index)} />}
  </div>
}

function GripIcon() {
  return <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
    <circle cx="3" cy="3" r="1.2" /><circle cx="7" cy="3" r="1.2" />
    <circle cx="3" cy="7" r="1.2" /><circle cx="7" cy="7" r="1.2" />
    <circle cx="3" cy="11" r="1.2" /><circle cx="7" cy="11" r="1.2" />
  </svg>
}
