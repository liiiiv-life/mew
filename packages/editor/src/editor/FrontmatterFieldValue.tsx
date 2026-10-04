import { canAutoFocusInput } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useEffect, useRef, useState } from 'react'
import { frontmatterType, type FrontmatterField } from '../utils/frontmatter'
import { FrontmatterSelect } from './FrontmatterSelect'

const inputClass = 'min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-ink-secondary outline-none hover:border-edge focus:border-edge-bright'
const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g

export function FrontmatterFieldValue({ field, readOnly, busy, onChange, onOpenLink, onCreate, onOpen }: {
  field: FrontmatterField; readOnly?: boolean; onChange: (value: string) => void; onOpenLink: (href: string) => void
  onCreate: (field: FrontmatterField) => Promise<boolean>; onOpen?: () => void
  busy?: boolean
}) {
  useUiLocale()
  const [editing, setEditing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const type = frontmatterType(field)
  const links = [...field.value.matchAll(LINK_RE)]
  useEffect(() => {
    if (editing && canAutoFocusInput() && input.current && input.current.ownerDocument.activeElement !== input.current) input.current.focus()
  }, [editing])

  if (type === 'select' || type === 'multi-select') return <FrontmatterSelect field={field} readOnly={readOnly} busy={busy} onChange={onChange} onCreate={onCreate} onOpen={onOpen} />

  if (!editing && (links.length || (type === 'link' && field.value))) {
    let last = 0
    const segments: { text: string; href?: string }[] = []
    for (const link of links) {
      if (link.index > last) segments.push({ text: field.value.slice(last, link.index) })
      segments.push({ text: link[1] || link[2], href: link[2] })
      last = link.index + link[0].length
    }
    if (!links.length) segments.push({ text: field.value, href: field.value })
    else if (last < field.value.length) segments.push({ text: field.value.slice(last) })
    return <div className="flex min-w-0 flex-1 items-center gap-1">
      <div className="min-w-0 flex-1 truncate px-1 py-0.5 text-xs text-ink-secondary" onClick={() => { if (!readOnly) setEditing(true) }}>
        {segments.map((segment, index) => segment.href ? <a key={index} href={/^(javascript|data|vbscript):/i.test(segment.href) ? undefined : segment.href}
          title={segment.href} className="text-link underline" onClick={event => { event.preventDefault(); event.stopPropagation(); onOpenLink(segment.href!) }}>{segment.text}</a> : <span key={index}>{segment.text}</span>)}
      </div>
      {!readOnly && <button type="button" aria-label={uiText('링크 편집')} onClick={() => setEditing(true)} className="shrink-0 rounded p-1 text-ink-muted hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m16 3 5 5L9 20l-6 1 1-6L16 3Z" /></svg>
      </button>}
    </div>
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(field.value) ? new Date(`${field.value}T00:00:00Z`) : null
  const validDate = !field.value || !!date && !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === field.value
  const invalid = type === 'number' ? !!field.value && !Number.isFinite(Number(field.value)) : type === 'date' && !validDate
  return <input ref={input} value={field.value} readOnly={readOnly} aria-label={field.key || uiText('값')}
    aria-invalid={invalid || undefined} type={type === 'date' && validDate ? 'date' : 'text'} inputMode={type === 'number' ? 'decimal' : undefined}
    title={invalid ? uiText(type === 'number' ? '숫자를 입력하세요' : '날짜를 YYYY-MM-DD 형식으로 입력하세요') : undefined}
    className={inputClass} placeholder={uiText('값')} onFocus={() => setEditing(true)} onBlur={() => setEditing(false)} onChange={event => onChange(event.target.value)} />
}
