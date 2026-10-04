import { canAutoFocusInput } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useEffect, useId, useRef, useState } from 'react'
import { frontmatterSelections, type FrontmatterField } from '../utils/frontmatter'
import { Check } from './FrontmatterFieldMenu'
import { FrontmatterPopover } from './FrontmatterPopover'

/** Both selection types use the same searchable, creatable project choices. */
export function FrontmatterSelect({ field, readOnly, busy, onChange, onCreate, onOpen }: {
  field: FrontmatterField; readOnly?: boolean; onChange: (value: string) => void
  onCreate: (field: FrontmatterField) => Promise<boolean>; onOpen?: () => void
  busy?: boolean
}) {
  const id = useId(), input = useRef<HTMLInputElement>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [query, setQuery] = useState(''), [active, setActive] = useState(0)
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
  const close = () => setAnchor(null)
  useEffect(() => { if (readOnly) close() }, [readOnly])
  useEffect(() => {
    if (anchor) anchor.ownerDocument.getElementById(`${id}-${current}`)?.scrollIntoView({ block: 'nearest' })
  }, [current, id, anchor])
  async function choose(index: number) {
    const item = items[index]
    if (!item || readOnly || busy) return
    const focusInput = canAutoFocusInput() || input.current?.ownerDocument.activeElement === input.current
    const next = multi ? JSON.stringify(selected.includes(item.value) ? selected.filter(value => value !== item.value) : [...selected, item.value]) : item.value
    if (item.create) {
      if (!await onCreate({ ...field, options: [...(field.options ?? []), item.value], value: next })) return
    } else onChange(next)
    setQuery(''); setActive(0)
    if (!multi) { close(); requestAnimationFrame(() => { if (anchor?.isConnected) anchor.focus({ preventScroll: true }) }) }
    else if (focusInput) input.current?.focus({ preventScroll: true })
  }
  return <div className="min-w-0 flex-1">
    <button type="button" role={multi ? undefined : 'combobox'} disabled={readOnly || busy}
      aria-label={field.key || uiText('값')} aria-haspopup="dialog" aria-expanded={!!anchor && !readOnly} aria-controls={anchor ? `${id}-list` : undefined}
      className="flex min-h-7 w-full flex-wrap items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent"
      onClick={event => {
        if (anchor) close()
        else { setQuery(''); setActive(0); setAnchor(event.currentTarget); onOpen?.() }
      }}>
      {selected.length ? selected.map(value => <span key={value} className="max-w-full break-words rounded bg-surface-hover px-1.5 py-0.5 text-ink-secondary">{value}</span>) : <span className="text-ink-muted">{uiText('선택')}</span>}
    </button>
    {anchor && !readOnly && <FrontmatterPopover anchor={anchor} label={field.key || uiText('값')} initialFocus="input" onClose={close}>
      <input ref={input} readOnly={busy} aria-busy={busy || undefined} role="combobox" aria-label={uiText('검색 또는 새 항목')} aria-autocomplete="list" aria-expanded="true"
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
        {items.map((item, index) => <button disabled={busy} key={item.create ? `${item.value}:create` : item.value} id={`${id}-${index}`} type="button" role="option"
          aria-selected={!item.create && selected.includes(item.value)}
          className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent ${index === current ? 'bg-surface-hover' : ''}`}
          onClick={() => { void choose(index) }}>
          <span className="min-w-0 break-words">{item.label}</span><Check checked={!item.create && selected.includes(item.value)} />
        </button>)}
      </div>
    </FrontmatterPopover>}
  </div>
}
