import { TaskAssigneePicker } from './task-assignee-picker'
import { useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { uiText } from '@mew/ui/i18n-core'
import { TASK_TEXT_LIMIT } from '../../shared/task-list'
import { TaskTagPicker } from './task-tag-picker'

export function TaskText({ id, text, tags = [], assignees = [], onAssigneesChange, knownTags, disabled, inputs, onChange, onKeyDown, onPaste, onBlur }: {
  id: string; text: string; tags?: string[]; assignees?: string[]; onAssigneesChange?: (assignees: string[]) => void; knownTags: string[]; disabled: boolean
  inputs?: Map<string, HTMLTextAreaElement>; onChange: (text: string, tags: string[]) => void
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void; onBlur?: () => void; onFilter?: (tag: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const input = ref.current
    if (!input) return
    const resize = () => { input.style.height = '28px'; if (editing) { input.style.height = '0'; input.style.height = `${input.scrollHeight}px` } }
    resize()
    const observer = new ResizeObserver(resize); observer.observe(input)
    return () => observer.disconnect()
  }, [text, tags, assignees, editing])
  return <div className="task-text" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget) && !(event.relatedTarget as Element | null)?.closest('.task-tag-picker-menu, .task-assignee-picker-menu')) onBlur?.()
  }}>
    <TaskTagPicker tags={tags} knownTags={knownTags} disabled={disabled} onChange={next => onChange(text, next)} />
    <TaskAssigneePicker assignees={assignees} disabled={disabled || !onAssigneesChange} onChange={next => onAssigneesChange?.(next)} />
    <div className="task-text-input">
      <span className="task-text-preview" aria-hidden="true">{text.replace(/\s*\n\s*/g, ' ')}</span>
      <textarea ref={element => { ref.current = element; if (element) inputs?.set(id, element); else inputs?.delete(id) }} rows={1} value={text} readOnly={disabled} maxLength={TASK_TEXT_LIMIT}
        onFocus={() => setEditing(true)} onBlur={() => { setEditing(false); if (ref.current) ref.current.scrollLeft = 0 }}
        aria-label={uiText(id === 'draft' ? '새 태스크' : '태스크 내용')} onChange={event => onChange(event.target.value, tags)} onKeyDown={onKeyDown} onPaste={onPaste} />
    </div>
  </div>
}
