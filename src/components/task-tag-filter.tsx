import { useTaskTagColors } from './task-tag-color-context'
import { useRef, type CSSProperties } from 'react'
import { SelectField } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { Filter, Xmark } from 'iconoir-react'
import { taskTagHue } from '../utils/task-tag-color'


export function TaskTagFilter({ tags, selected, count, total, onChange, showCompleted, onShowCompletedChange }: {
  tags: string[]; selected: string[]; count: number; total: number; onChange: (tags: string[]) => void; showCompleted: boolean; onShowCompletedChange: (show: boolean) => void
}) {
  const { colors } = useTaskTagColors()
  const tagStyle = (tag: string) => ({ '--task-tag-hue': taskTagHue(tag, colors) }) as CSSProperties
  const root = useRef<HTMLDivElement>(null)
  const remove = (next: string[], button: HTMLButtonElement) => {
    const restoreFocus = button === button.ownerDocument.activeElement
    onChange(next)
    if (restoreFocus) requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[role="combobox"]')?.focus({ preventScroll: true }))
  }
  return <div ref={root} className="task-filter" data-active={selected.length > 0 || undefined}>
    {tags.length > 0 && <SelectField multiple compact label={uiText('태그 필터')} value={selected} onChange={onChange}
      className="task-filter-field" triggerClassName="task-filter-trigger" popupWidth={200} popupClassName="task-filter-menu"
      triggerContent={<><Filter width={14} height={14} aria-hidden="true" />{selected.length > 0 && <span>{selected.length}</span>}</>}
      options={tags.map(tag => ({ value: tag, label: tag, leading: <span className="task-filter-dot" style={tagStyle(tag)} aria-hidden="true" /> }))} />}
    <div className="task-filter-selected">{selected.map(tag => <button key={tag} type="button" className="task-tag task-filter-chip" style={tagStyle(tag)}
      aria-label={`${uiText('태그 필터 해제')}: ${tag}`} data-tip={`${uiText('태그 필터 해제')}: ${tag}`} onClick={event => remove(selected.filter(value => value !== tag), event.currentTarget)}>
      <span className="task-tag-name">{tag}</span><Xmark width={12} height={12} aria-hidden="true" />
    </button>)}</div>
    <label className="task-filter-completed"><input type="checkbox" checked={showCompleted} onChange={event => onShowCompletedChange(event.target.checked)} /><span>{uiText('완료된 항목 보기')}</span></label>
    <span className="task-filter-count">{count}/{total}</span>
    {selected.length > 0 && <button type="button" className="task-filter-clear" aria-label={uiText('모든 태그 필터 해제')} data-tip={uiText('모든 태그 필터 해제')}
      onClick={event => remove([], event.currentTarget)}><Xmark width={14} height={14} aria-hidden="true" /></button>}
  </div>
}
