import { canAutoFocusInput, openDropdownOnArrow } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { editSelection, optionHue, SELECTION_PALETTE, type OptionEdit } from '../../../../shared/selection-options'
import { frontmatterSelections, type FrontmatterField } from '../utils/frontmatter'
import { Check } from './FrontmatterFieldMenu'
import { FrontmatterPopover } from './FrontmatterPopover'
import { FrontmatterTag } from './FrontmatterTag'

/** Both selection types use the same searchable, creatable project choices. */
export function FrontmatterSelect({ field, readOnly, busy, onChange, onCreate, onOpen, onEditOption }: {
  field: FrontmatterField; readOnly?: boolean; onChange: (value: string) => void
  onCreate: (field: FrontmatterField) => Promise<boolean>; onOpen?: () => void
  busy?: boolean
  onEditOption?: (option: string, edit: OptionEdit) => Promise<boolean>
}) {
  const id = useId(), input = useRef<HTMLInputElement>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [query, setQuery] = useState(''), [active, setActive] = useState(0)
  const [editing, setEditing] = useState<{ option: string; name: string } | null>(null)
  const [colorPick, setColorPick] = useState<string | null>(null)
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const multi = field.type === 'multi-select'
  const selected = multi ? frontmatterSelections(field.value) : field.value ? [field.value] : []
  const choices = [...new Set([...(field.options ?? []), ...selected])].filter(Boolean)
  const draft = query.trim()
  const filtered = choices.filter(value => value.toLocaleLowerCase().includes(draft.toLocaleLowerCase()))
  const canCreate = !!draft && !choices.includes(draft)
  const items = [
    ...(!multi && !draft ? [{ value: '', label: uiText('선택 해제'), create: false }] : []),
    ...filtered.map(value => ({ value, label: value, create: false })),
    ...(canCreate ? [{ value: draft, label: uiText('“{p0}” 추가', { p0: draft }), create: true }] : []),
  ]
  const current = Math.min(active, Math.max(0, items.length - 1))
  const close = () => { setAnchor(null); setEditing(null); setColorPick(null); setError('') }
  useEffect(() => { if (readOnly) close() }, [readOnly])
  useEffect(() => {
    if (anchor) anchor.ownerDocument.getElementById(`${id}-${current}`)?.scrollIntoView({ block: 'nearest' })
  }, [current, id, anchor])
  async function choose(index: number) {
    const item = items[index]
    if (!item || readOnly || busy || saving) return
    const focusInput = canAutoFocusInput() || input.current?.ownerDocument.activeElement === input.current
    const next = multi ? JSON.stringify(selected.includes(item.value) ? selected.filter(value => value !== item.value) : [...selected, item.value]) : item.value
    if (item.create) {
      if (!await onCreate({ ...field, options: [...(field.options ?? []), item.value], value: next })) return
    } else onChange(next)
    setQuery(''); setActive(0)
    if (!multi) { close(); requestAnimationFrame(() => { if (anchor?.isConnected) anchor.focus({ preventScroll: true }) }) }
    else if (focusInput) input.current?.focus({ preventScroll: true })
  }
  async function editOption(option: string, edit: OptionEdit) {
    if (readOnly || busy || saving) return
    setSaving(true); setError('')
    try {
      if (onEditOption) {
        if (!await onEditOption(option, edit)) { setError(uiText('선택 항목 저장 실패')); return }
      } else {
        const next = editSelection(choices, field.optionColors ?? {}, option, edit)
        const values = selected.flatMap(value => value === option ? edit.remove ? [] : [next.name] : [value])
        if (!await onCreate({ ...field, options: next.options, optionColors: next.optionColors, value: multi ? JSON.stringify(values) : values[0] ?? '' })) return
      }
      setEditing(null); setColorPick(null); setQuery(''); setActive(0)
      if (canAutoFocusInput()) requestAnimationFrame(() => input.current?.focus({ preventScroll: true }))
    } catch (error) { setError(error instanceof Error ? error.message : uiText('선택 항목 저장 실패')) }
    finally { setSaving(false) }
  }
  return <div className="min-w-0 flex-1">
    <button type="button" role={multi ? undefined : 'combobox'} disabled={readOnly || busy}
      aria-label={field.key || uiText('값')} aria-haspopup="dialog" aria-expanded={!!anchor && !readOnly} aria-controls={anchor ? `${id}-list` : undefined}
      className="flex min-h-7 w-full flex-wrap items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent"
      onKeyDown={event => {
        if (readOnly || busy || saving || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey ||
          (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
        if (multi || anchor) { openDropdownOnArrow(event); return }
        event.preventDefault(); event.stopPropagation()
        const step = event.key === 'ArrowDown' ? 1 : -1
        const selectedIndex = choices.indexOf(field.value)
        const index = (selectedIndex >= 0 ? selectedIndex : step > 0 ? -1 : choices.length) + step
        if (choices[index] !== undefined) onChange(choices[index])
      }}
      onClick={event => {
        if (anchor) close()
        else { setQuery(''); setActive(0); setAnchor(event.currentTarget); onOpen?.() }
      }}>
      {selected.length ? selected.map(value => <FrontmatterTag key={value} hue={optionHue(value, field.optionColors)}>{value}</FrontmatterTag>) : <span className="text-ink-muted">{uiText('선택')}</span>}
    </button>
    {anchor && !readOnly && <FrontmatterPopover anchor={anchor} label={field.key || uiText('값')} initialFocus="input" onClose={close}>
      {error && <div role="alert" className="px-1 py-0.5 text-danger-strong">{error}</div>}
      {editing && <form className="mb-1 flex items-center gap-1" onSubmit={event => { event.preventDefault(); void editOption(editing.option, { name: editing.name }) }}>
        <input autoFocus={canAutoFocusInput()} aria-label={uiText('항목 이름')} value={editing.name} disabled={saving || busy}
          onChange={event => setEditing({ ...editing, name: event.target.value })}
          className="min-w-0 flex-1 rounded border border-edge bg-surface px-1 py-0.5 outline-none focus:border-edge-bright" />
        <button type="submit" disabled={saving || busy || !editing.name.trim()} aria-label={uiText('저장')} data-tip={uiText('저장')} className="frontmatter-option-tool"><Check checked /></button>
        <button type="button" aria-label={uiText('취소')} data-tip={uiText('취소')} className="frontmatter-option-tool" onClick={() => setEditing(null)}><OptionIcon kind="close" /></button>
      </form>}
      {colorPick && <div className="mb-1 rounded border border-edge p-1" role="group" aria-label={uiText('{p0} 색상', { p0: colorPick })}
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setColorPick(null) } }}>
        <div className="frontmatter-option-colors">{SELECTION_PALETTE.map((hue, index) => <button key={hue} type="button"
          aria-label={uiText('색상 {index}', { index: index + 1 })} aria-pressed={optionHue(colorPick, field.optionColors) === hue}
          disabled={saving || busy} style={{ '--option-hue': hue } as CSSProperties}
          onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowDown' ? index + 4 : event.key === 'ArrowUp' ? index - 4 : event.key === 'Home' ? 0 : event.key === 'End' ? 15 : null
            if (next === null) return
            event.preventDefault(); event.stopPropagation()
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[(next + 16) % 16]?.focus()
          }} onClick={() => { void editOption(colorPick, { hue }) }}><Check checked={optionHue(colorPick, field.optionColors) === hue} /></button>)}</div>
      </div>}
      <input ref={input} readOnly={busy || saving} aria-busy={busy || saving || undefined} role="combobox" aria-label={uiText('검색 또는 새 항목')} aria-autocomplete="list" aria-expanded="true"
        aria-controls={`${id}-list`} aria-activedescendant={items.length ? `${id}-${current}` : undefined}
        placeholder={uiText('검색 또는 새 항목')} value={query}
        className="mb-1 w-full min-w-0 rounded border border-edge bg-surface px-2 py-1.5 outline-none focus:border-edge-bright"
        onChange={event => { setQuery(event.target.value); setActive(0) }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void choose(current) }
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && items.length) {
            event.preventDefault(); event.stopPropagation()
            setActive(event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length)
          }
        }} />
      <div id={`${id}-list`} role="listbox" aria-label={field.key || uiText('값')} aria-multiselectable={multi || undefined}>
        {items.map((item, index) => <div key={item.create ? `${item.value}:create` : item.value} className="flex items-center gap-0.5">
          {!item.create && item.value && <button type="button" disabled={busy || saving} className="frontmatter-option-tool"
            aria-label={uiText('{p0} 색상', { p0: item.value })} data-tip={uiText('색상')}
            aria-expanded={colorPick === item.value} onClick={() => { setColorPick(colorPick === item.value ? null : item.value); setEditing(null) }}>
            <span className="frontmatter-choice-dot" style={{ '--option-hue': optionHue(item.value, field.optionColors) } as CSSProperties} />
          </button>}
          <button disabled={busy || saving} id={`${id}-${index}`} type="button" role="option"
          aria-selected={!item.create && selected.includes(item.value)}
          className={`flex min-w-0 flex-1 items-center justify-between gap-1 rounded px-1 py-0.5 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:py-1 ${index === current ? 'bg-surface-hover' : ''}`}
          onClick={() => { void choose(index) }}>
          <span className="min-w-0 break-words">{item.label}</span><Check checked={!item.create && selected.includes(item.value)} />
          </button>
          {!item.create && item.value && <>
            <button type="button" disabled={busy || saving} className="frontmatter-option-tool" aria-label={uiText('{p0} 항목 편집', { p0: item.value })} data-tip={uiText('편집')}
              onClick={() => { setEditing({ option: item.value, name: item.value }); setColorPick(null) }}><OptionIcon kind="edit" /></button>
            <button type="button" disabled={busy || saving} className="frontmatter-option-tool hover:text-danger-strong" aria-label={uiText('{p0} 항목 삭제', { p0: item.value })} data-tip={uiText('삭제')}
              onClick={() => { void editOption(item.value, { remove: true }) }}><OptionIcon kind="close" /></button>
          </>}
        </div>)}
      </div>
    </FrontmatterPopover>}
  </div>
}

function OptionIcon({ kind }: { kind: 'edit' | 'close' }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={kind === 'close' ? 'm6 6 12 12M6 18 18 6' : 'm16 3 5 5L9 20l-6 1 1-6L16 3ZM14 5l5 5'} />
  </svg>
}
