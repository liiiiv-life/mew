import { useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { uiText } from '@mew/ui/i18n-core'
import { TASK_TEXT_LIMIT } from '../../shared/task-list'
import { TaskTagPicker } from './task-tag-picker'

export function TaskText({ id, text, tags = [], knownTags, disabled, inputs, onChange, onKeyDown, onPaste, onBlur }: {
  id: string; text: string; tags?: string[]; knownTags: string[]; disabled: boolean
  inputs?: Map<string, HTMLTextAreaElement>; onChange: (text: string, tags: string[]) => void
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void; onBlur?: () => void; onFilter?: (tag: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const input = ref.current
    if (!input) return
    const resize = () => { input.style.height = '0'; input.style.height = `${input.scrollHeight}px` }
    resize()
    const observer = new ResizeObserver(resize); observer.observe(input)
    return () => observer.disconnect()
  }, [text, tags])
  return <div className="task-text" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget) && !(event.relatedTarget as Element | null)?.closest('.task-tag-picker-menu')) onBlur?.()
  }}>
    <TaskTagPicker tags={tags} knownTags={knownTags} disabled={disabled} onChange={next => onChange(text, next)} />
    <textarea ref={element => { ref.current = element; if (element) inputs?.set(id, element); else inputs?.delete(id) }} rows={1} value={text} readOnly={disabled} maxLength={TASK_TEXT_LIMIT}
      aria-label={uiText(id === 'draft' ? '새 태스크' : '태스크 내용')} onChange={event => onChange(event.target.value, tags)} onKeyDown={onKeyDown} onPaste={onPaste} />
  </div>
}
