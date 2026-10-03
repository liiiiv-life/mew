import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useState, type ReactNode } from 'react'
import { FRONTMATTER_TYPES, changeFrontmatterType, frontmatterSelections, frontmatterType, type FrontmatterField, type FrontmatterType } from '../utils/frontmatter'
import { FrontmatterPopover } from './FrontmatterPopover'

function fieldTypeLabel(type: FrontmatterType): string {
  switch (type) {
    case 'link': return uiText('글 링크')
    case 'select': return uiText('단일선택')
    case 'multi-select': return uiText('다중선택')
    case 'date': return uiText('날짜')
    case 'number': return uiText('숫자')
    default: return uiText('텍스트')
  }
}

function FieldTypeIcon({ type }: { type: FrontmatterType }) {
  const paths: Record<FrontmatterType, ReactNode> = {
    link: <><path d="m10 13 4-4" /><path d="M8 16H6a4 4 0 0 1 0-8h4m4 0h4a4 4 0 0 1 0 8h-4" /></>,
    select: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
    'multi-select': <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8 12 3 3 5-6" /></>,
    date: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4m8-4v4M4 10h16m-12 4h2m4 0h2" /></>,
    text: <path d="M4 6h16M12 6v14m-4 0h8" />,
    number: <path d="m10 4-4 16M18 4l-4 16M4 9h16M3 15h16" />,
  }
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-ink-muted">{paths[type]}</svg>
}

export function FrontmatterFieldMenu({ field, anchor, onChange, onClose, onDelete }: {
  field: FrontmatterField; anchor: HTMLElement; onChange: (field: FrontmatterField) => void; onClose: () => void; onDelete: () => void
}) {
  useUiLocale()
  const [draft, setDraft] = useState('')
  const type = frontmatterType(field)
  const choices = [...new Set([...(field.options ?? []), ...(type === 'multi-select' ? frontmatterSelections(field.value) : field.value ? [field.value] : [])])]
  const add = () => {
    const value = draft.trim()
    if (!value) return
    onChange({ ...field, options: [...new Set([...choices, value])] })
    setDraft('')
  }
  return <FrontmatterPopover anchor={anchor} label={uiText('필드 타입 변경')} onClose={onClose}>
    <div className="px-2 py-1 text-ink-muted">{uiText('필드 타입')}</div>
    {FRONTMATTER_TYPES.map(next => <button key={next} type="button" aria-pressed={type === next}
      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent"
      onClick={() => {
        onChange(changeFrontmatterType(field, next))
        if (!['select', 'multi-select'].includes(next)) { onClose(); anchor.focus({ preventScroll: true }) }
      }}>
      <FieldTypeIcon type={next} /><span className="flex-1">{fieldTypeLabel(next)}</span><Check checked={type === next} />
    </button>)}
    {['select', 'multi-select'].includes(type) && <div className="mt-1 border-t border-edge pt-1">
      <div className="px-2 py-1 text-ink-muted">{uiText('선택 항목')}</div>
      {choices.map(choice => <div key={choice} className="flex items-center gap-1 px-2 py-1">
        <span className="min-w-0 flex-1 break-words">{choice}</span>
        <button type="button" aria-label={uiText('{p0} 항목 삭제', { p0: choice })} className="rounded px-1 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => onChange({ ...field, options: choices.filter(v => v !== choice),
            value: type === 'multi-select' ? JSON.stringify(frontmatterSelections(field.value).filter(v => v !== choice)) : field.value === choice ? '' : field.value })}>×</button>
      </div>)}
      <form className="flex gap-1 p-1" onSubmit={event => { event.preventDefault(); add() }}>
        <input aria-label={uiText('새 선택 항목')} placeholder={uiText('새 선택 항목')} value={draft} onChange={event => setDraft(event.target.value)}
          className="min-w-0 flex-1 rounded border border-edge bg-surface px-1 py-1 outline-none focus:border-edge-bright" />
        <button type="submit" disabled={!draft.trim()} className="rounded px-2 hover:bg-surface-hover disabled:opacity-40">{uiText('추가')}</button>
      </form>
    </div>}
    <div className="mt-1 border-t border-edge pt-1">
      <button type="button" onClick={onDelete}
        className="w-full rounded px-2 py-1.5 text-left text-danger-strong hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent">
        {uiText('필드 삭제')}
      </button>
    </div>
  </FrontmatterPopover>
}

export function Check({ checked }: { checked: boolean }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" className="shrink-0">{checked && <path d="m5 12 4 4L19 6" />}</svg>
}
