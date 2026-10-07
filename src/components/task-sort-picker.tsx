import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { SelectField, useOverlayDismiss } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { ArrowDown, ArrowUp, NavArrowDown, Plus, RefreshDouble, Sort, Xmark } from 'iconoir-react'
import { defaultTaskSortRules, TASK_SORT_FIELDS, type TaskSortField, type TaskSortRule } from '../utils/task-sort'

const fieldLabels = { tags: '태그', title: '제목', schedule: '일정 우선순위', startStatus: '시작 여부', dueDate: '마감일', startDate: '시작일' } as const
const directionLabels = {
  tags: ['가나다순', '역순'], title: ['가나다순', '역순'],
  schedule: ['기본 순서', '역순'], startStatus: ['진행 우선', '시작 전 우선'],
  dueDate: ['빠른 날짜순', '늦은 날짜순'], startDate: ['빠른 날짜순', '늦은 날짜순'],
} as const
const scheduleSummary = 'D-Day → 마감 임박 → 기한 초과 → 시작 전 → 날짜 미정'

export function TaskSortPicker({ rules, onChange }: { rules: TaskSortRule[]; onChange: (rules: TaskSortRule[]) => void }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false), [position, setPosition] = useState<CSSProperties>({})
  const close = () => {
    if (popup.current?.contains(document.activeElement) || document.activeElement === document.body) trigger.current?.focus({ preventScroll: true })
    setOpen(false)
  }
  useOverlayDismiss(open && close)
  useLayoutEffect(() => {
    if (!open) return
    popup.current?.querySelector<HTMLButtonElement>('[role="combobox"], .task-sort-add')?.focus({ preventScroll: true })
  }, [open])
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect(), element = popup.current
      if (!rect || !element) return
      const viewport = window.visualViewport, left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const right = left + (viewport?.width ?? innerWidth)
      let bottom = top + (viewport?.height ?? innerHeight)
      if (window.matchMedia('(width < 768px)').matches) {
        const dock = document.querySelector('.mobile-dock:not([hidden])')?.getBoundingClientRect()
        if (dock?.height && dock.width) bottom = Math.min(bottom, dock.top)
      }
      const width = Math.min(304, right - left - 16), below = bottom - rect.bottom - 12, above = rect.top - top - 12
      const down = below >= element.scrollHeight || below >= above
      setPosition({ width, left: Math.max(left + 8, Math.min(rect.right - width, right - width - 8)), maxHeight: Math.max(0, down ? below : above),
        ...(down ? { top: rect.bottom + 4 } : { bottom: innerHeight - rect.top + 4 }) })
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(popup.current!)
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place); window.visualViewport?.addEventListener('scroll', place)
    return () => {
      observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      // The nested SelectField owns the first outside click while its list is open.
      if (popup.current?.querySelector('[role="listbox"]') || popup.current?.contains(event.target as Node) || trigger.current?.contains(event.target as Node)) return
      close()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open])
  const update = (index: number, next: TaskSortRule) => onChange(rules.map((rule, i) => i === index ? next : rule))
  const remove = (index: number) => {
    onChange(rules.filter((_, i) => i !== index))
    requestAnimationFrame(() => popup.current?.querySelector<HTMLButtonElement>(`[data-sort-index="${Math.min(index, rules.length - 2)}"] [role="combobox"], .task-sort-add`)?.focus({ preventScroll: true }))
  }
  return <>
    <button ref={trigger} type="button" className="task-sort-trigger task-filter-trigger" aria-label={uiText('목록 정렬')} data-tip={uiText('목록 정렬')} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} data-active={rules.length > 0 || undefined} onClick={() => open ? close() : setOpen(true)}>
      <Sort width={14} height={14} aria-hidden="true" />{rules.length > 0 && <span>{rules.length}</span>}
    </button>
    {open && createPortal(<div ref={popup} id={id} role="dialog" aria-label={uiText('목록 정렬')} className="task-sort-popup" style={position} onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) close()
    }}>
      <div className="task-sort-heading"><strong>{uiText('정렬 기준')}</strong><div className="task-tool-group">
        <button type="button" className="task-tool" aria-label={uiText('기본값으로 되돌리기')} data-tip={uiText('기본값으로 되돌리기')} disabled={JSON.stringify(rules) === JSON.stringify(defaultTaskSortRules())} onClick={() => { onChange(defaultTaskSortRules()); requestAnimationFrame(() => popup.current?.querySelector<HTMLButtonElement>('[role="combobox"]')?.focus({ preventScroll: true })) }}><RefreshDouble width={14} height={14} aria-hidden="true" /></button>
        <button type="button" className="task-tool" aria-label={uiText('닫기')} data-tip={uiText('닫기')} onClick={close}><Xmark width={14} height={14} aria-hidden="true" /></button>
      </div></div>
      {!rules.length && <p className="task-sort-default">{uiText('날짜 상태순')}</p>}
      {rules.map((rule, index) => <div key={index} className="task-sort-row" data-sort-index={index}>
        <span className="task-sort-priority" aria-hidden="true">{index + 1}</span>
        <SelectField compact className="task-sort-field" label={uiText('정렬 기준 {index}', { index: index + 1 })} value={rule.field} onChange={field => update(index, { ...rule, field: field as TaskSortField })}
          options={TASK_SORT_FIELDS.map(field => ({ value: field, label: uiText(fieldLabels[field]), disabled: rules.some((other, i) => i !== index && other.field === field) }))}
          triggerContent={<><span data-tip={rule.field === 'schedule' ? uiText(scheduleSummary) : undefined}>{uiText(fieldLabels[rule.field])}</span><NavArrowDown width={12} height={12} aria-hidden="true" /></>}
          triggerClassName="task-sort-select" popupClassName="task-filter-menu" popupWidth={176} portalContainer={popup.current} />
        <SelectField compact className="task-sort-direction" label={uiText('정렬 방향 {index}', { index: index + 1 })} value={rule.direction} onChange={direction => update(index, { ...rule, direction: direction as TaskSortRule['direction'] })}
          options={[{ value: 'asc', label: uiText(directionLabels[rule.field][0]) }, { value: 'desc', label: uiText(directionLabels[rule.field][1]) }]} triggerClassName="task-sort-select" popupClassName="task-filter-menu" popupWidth={144} portalContainer={popup.current}
          triggerContent={<><span className="task-sort-direction-label">{rule.direction === 'asc' ? <ArrowDown width={12} height={12} aria-hidden="true" /> : <ArrowUp width={12} height={12} aria-hidden="true" />}{uiText(directionLabels[rule.field][rule.direction === 'asc' ? 0 : 1])}</span><NavArrowDown width={12} height={12} aria-hidden="true" /></>} />
        <button type="button" className="task-tool" aria-label={uiText('정렬 조건 {index} 삭제', { index: index + 1 })} data-tip={uiText('정렬 조건 삭제')} onClick={() => remove(index)}><Xmark width={14} height={14} aria-hidden="true" /></button>
      </div>)}
      {rules.length < TASK_SORT_FIELDS.length && <div className="task-sort-footer"><button type="button" className="task-sort-add" onClick={() => {
        onChange([...rules, { field: TASK_SORT_FIELDS.find(field => !rules.some(rule => rule.field === field))!, direction: 'asc' }])
        requestAnimationFrame(() => popup.current?.querySelector<HTMLButtonElement>(`[data-sort-index="${rules.length}"] [role="combobox"]`)?.focus({ preventScroll: true }))
      }}><Plus width={14} height={14} aria-hidden="true" />{uiText('정렬 조건 추가')}</button></div>}
    </div>, document.body)}
  </>
}
