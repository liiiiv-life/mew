import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Calendar, Xmark, RefreshDouble, Trash, Plus, List, StatsUpSquare } from 'iconoir-react'
import { TaskDateStatus } from './task-date-status'
import { useUiLocale } from '@mew/ui/i18n'
import { uiText } from '@mew/ui/i18n-core'
import { DockGrip, DockInlineBody } from './DockWorkspace'
import type { useTaskList } from '../hooks/use-task-list'
import { TASK_LIMIT, TASK_TEXT_LIMIT, taskDepths, taskSubtreeEnd, removeTask, setTaskDate, type TaskItem } from '../../shared/task-list'
import { uuid } from '../utils/uuid'
import { useTaskDrag } from '../hooks/use-task-drag'
import { createPortal } from 'react-dom'
import { localToday } from '@mew/ui/date-value'
import { sortTasksByDateStatus } from '../utils/task-date-label'
import { tasksOnDate } from '../utils/task-schedule'
import { TaskCalendar } from './task-calendar'
import { TaskGantt } from './task-gantt'
import './task-panel.css'

type Session = ReturnType<typeof useTaskList>
const newTask = (text: string, parentId?: string | null): TaskItem => ({ id: uuid(), text, done: false, ...(parentId ? { parentId } : {}) })
const taskErrors = [
  '태스크를 불러오지 못했습니다', '태스크를 저장하지 못했습니다',
  '다른 창에서 같은 태스크를 수정했습니다. 입력은 유지됩니다. 확인 후 다시 저장하세요.',
  '계정이 변경되었습니다. 태스크 패널을 다시 여세요.', '프로젝트가 변경되었습니다. 태스크 패널을 다시 여세요.',
  '태스크는 최대 2,000개까지 추가할 수 있습니다', '잘못된 태스크 변경입니다', '권한이 없습니다',
] as const

function TaskText({ id, text, disabled, placeholder, inputs, onChange, onKeyDown, onPaste, onBlur }: {
  id: string; text: string; disabled: boolean; placeholder?: string
  inputs: Map<string, HTMLTextAreaElement>; onChange: (text: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void; onBlur: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const input = ref.current
    if (!input) return
    const resize = () => { input.style.height = '0'; input.style.height = `${input.scrollHeight}px` }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(input)
    return () => observer.disconnect()
  }, [text])
  return <textarea ref={element => { ref.current = element; if (element) inputs.set(id, element); else inputs.delete(id) }}
    rows={1} value={text} readOnly={disabled} maxLength={TASK_TEXT_LIMIT} placeholder={placeholder}
    aria-label={uiText(id === 'draft' ? '새 태스크' : '태스크 내용')}
    onChange={event => onChange(event.target.value)} onKeyDown={onKeyDown} onPaste={onPaste} onBlur={onBlur} />
}

export function TaskPanel({ session, onClose, nextTabSignal = 0, previousTabSignal = 0 }: { session: Session; onClose: () => void; nextTabSignal?: number; previousTabSignal?: number }) {
  useUiLocale()
  const tabId = useId()
  const [view, setView] = useState<'list' | 'calendar' | 'gantt'>('list')
  const [selectedDate, setSelectedDate] = useState(localToday), [month, setMonth] = useState(() => localToday().slice(0, 7))
  const inputs = useRef(new Map<string, HTMLTextAreaElement>()).current
  const { tasks, canEdit, loading, saving, error, draft, edit, setDraft, flush, retry } = session
  const [today, setToday] = useState(localToday)
  useEffect(() => {
    const refresh = () => setToday(localToday())
    const timer = window.setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  const sortedTasks = useMemo(() => sortTasksByDateStatus(tasks, today), [tasks, today])
  const depths = taskDepths(tasks)
  const drag = useTaskDrag(view === 'list' ? sortedTasks : tasks, canEdit, edit)
  const createTask = (text: string, parentId?: string | null): TaskItem => ({ ...newTask(text, parentId), ...(view === 'calendar' ? { startDate: selectedDate, date: selectedDate } : {}) })
  const visibleTasks = view === 'calendar' ? tasksOnDate(tasks, selectedDate) : sortedTasks
  const focus = (id: string, position: number | 'end' = 0) => requestAnimationFrame(() => {
    const input = inputs.get(id)
    if (!input) return
    input.focus({ preventScroll: true })
    const offset = position === 'end' ? input.value.length : position
    input.setSelectionRange(offset, offset)
    input.scrollIntoView({ block: 'nearest' })
  })
  const update = (id: string, text: string) => edit(tasks.map(item => item.id === id ? { ...item, text } : item))
  const remove = (index: number) => { const shownIndex = visibleTasks.findIndex(item => item.id === tasks[index].id); edit(removeTask(tasks, index)); focus(visibleTasks[shownIndex - 1]?.id ?? visibleTasks[shownIndex + 1]?.id ?? 'draft', 'end') }
  const addChild = (index: number) => {
    if (tasks.length >= TASK_LIMIT) return
    const child = createTask('', tasks[index].id), end = taskSubtreeEnd(tasks, index)
    edit([...tasks.slice(0, end), child, ...tasks.slice(end)])
    focus(child.id)
  }
  const commitDraft = () => {
    if (!draft.trim() || tasks.length >= TASK_LIMIT || !canEdit) return
    edit([...tasks, createTask(draft)])
    setDraft('')
  }
  const switchView = (next: typeof view) => { if (next !== view) { commitDraft(); setView(next) } }
  const navigateView = useRef<(direction: -1 | 1) => void>(() => {})
  navigateView.current = direction => {
    const views = ['list', 'calendar', 'gantt'] as const
    switchView(views[(views.indexOf(view) + direction + views.length) % views.length])
  }
  const previousSignals = useRef({ next: nextTabSignal, previous: previousTabSignal })
  useEffect(() => {
    const previous = previousSignals.current
    previousSignals.current = { next: nextTabSignal, previous: previousTabSignal }
    if (nextTabSignal !== previous.next) navigateView.current(1)
    else if (previousTabSignal !== previous.previous) navigateView.current(-1)
  }, [nextTabSignal, previousTabSignal])
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>, index: number) => {
    if (!canEdit || event.nativeEvent.isComposing || event.keyCode === 229) return
    const input = event.currentTarget, isDraft = index === tasks.length
    const shownIndex = isDraft ? visibleTasks.length : visibleTasks.findIndex(item => item.id === tasks[index]?.id)
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (tasks.length >= TASK_LIMIT) return
      if (isDraft) { commitDraft(); return }
      const item = tasks[index]
      const next = createTask(item.text.slice(input.selectionEnd), item.parentId)
      const end = taskSubtreeEnd(tasks, index)
      edit([...tasks.slice(0, index), { ...item, text: item.text.slice(0, input.selectionStart) }, ...tasks.slice(index + 1, end), next, ...tasks.slice(end)])
      focus(next.id)
    } else if (event.key === 'Backspace' && !input.value && input.selectionStart === 0 && shownIndex > 0) {
      event.preventDefault()
      if (isDraft) focus(visibleTasks[shownIndex - 1].id, 'end')
      else remove(index)
    } else if (event.key === 'ArrowUp' && input.selectionStart === 0 && input.selectionEnd === 0 && shownIndex > 0) {
      event.preventDefault(); focus(visibleTasks[shownIndex - 1].id, 'end')
    } else if (event.key === 'ArrowDown' && input.selectionStart === input.value.length && input.selectionEnd === input.value.length && !isDraft) {
      event.preventDefault(); focus(visibleTasks[shownIndex + 1]?.id ?? 'draft')
    }
  }
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>, index: number) => {
    if (!canEdit) return
    const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
    if (!text.includes('\n')) return
    event.preventDefault()
    const input = event.currentTarget
    const lines = (input.value.slice(0, input.selectionStart) + text + input.value.slice(input.selectionEnd)).split('\n')
    if (tasks.length + lines.length > TASK_LIMIT || lines.some(line => line.length > TASK_TEXT_LIMIT)) return
    const created = lines.map(line => createTask(line, tasks[index]?.parentId))
    if (index < tasks.length) created[0] = { ...tasks[index], text: lines[0] }
    const end = index < tasks.length ? taskSubtreeEnd(tasks, index) : index
    edit([...tasks.slice(0, index), created[0], ...tasks.slice(index + 1, end), ...created.slice(1), ...tasks.slice(end)])
    if (index === tasks.length) setDraft('')
    focus(created.at(-1)!.id, 'end')
  }
  const renderTask = (item: TaskItem) => { const index = tasks.findIndex(task => task.id === item.id); return <div key={item.id} data-task-id={item.id} data-done={item.done} data-dragging={view === 'list' && drag.preview?.item.id === item.id || undefined} data-drop-before={view === 'list' && drag.preview?.beforeId === item.id || undefined} className="task-line group" style={{ paddingLeft: Math.min(depths.get(item.id) ?? 0, 8) * 16 }}>
          <label className="task-check" {...(view === 'list' ? drag.handle(item.id) : {})}><input type="checkbox" checked={item.done} disabled={!canEdit} aria-label={uiText('태스크 완료')} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            onChange={event => edit(tasks.map(task => task.id === item.id ? { ...task, done: event.target.checked } : task))} /></label>
          <div className="task-content"><TaskText id={item.id} text={item.text} disabled={!canEdit} inputs={inputs}
            onChange={text => update(item.id, text)} onKeyDown={event => keyDown(event, index)} onPaste={event => paste(event, index)} onBlur={() => void flush()} /></div>
          <TaskDateStatus task={item} today={today} readOnly={!canEdit} onChange={(field, value) => edit(tasks.map(task => task.id === item.id ? setTaskDate(task, field, value) : task))} />
          {canEdit && <button type="button" onClick={() => addChild(index)} disabled={tasks.length >= TASK_LIMIT} aria-label={uiText('하위 태스크 추가')} data-tip={uiText('하위 태스크 추가')}
            className="task-delete flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-ink"><Plus width={14} height={14} aria-hidden="true" /></button>}
          {canEdit && <button type="button" onClick={() => remove(index)} aria-label={uiText('태스크 삭제')} data-tip={uiText('태스크 삭제')}
            className="task-delete flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-danger focus-visible:outline-2 focus-visible:outline-ink"><Trash width={14} height={14} aria-hidden="true" /></button>}
        </div> }
  const lines = <div ref={view === 'list' ? drag.list : undefined} {...(view === 'list' ? drag.events : {})} className="task-lines px-3 py-2">
        {(view === 'calendar' ? visibleTasks : drag.tasks).map(renderTask)}
        {canEdit && tasks.length < TASK_LIMIT && <div data-drop-before={view === 'list' && !!drag.preview && drag.preview.beforeId === null || undefined} className="task-line">
          <span className="task-check"><input type="checkbox" disabled aria-hidden="true" /></span>
          <TaskText id="draft" text={draft} disabled={false} placeholder={uiText('새 태스크')} inputs={inputs}
            onChange={setDraft} onKeyDown={event => keyDown(event, tasks.length)} onPaste={event => paste(event, tasks.length)}
            onBlur={commitDraft} />
        </div>}
      </div>
  return <section aria-label={uiText('태스크')} className="task-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface text-ink">
    <header data-dock-tab-bar className="flex h-9 shrink-0 items-center border-b border-edge bg-surface-deep">
      <DockGrip group="tasks" />
      <div role="tab" aria-label={uiText('태스크')} aria-selected="true" tabIndex={0} className="task-panel-title flex min-w-0 flex-1 items-center gap-1.5 px-2.5 text-xs">
        <Calendar width={14} height={14} aria-hidden="true" /><span>{uiText('태스크')}</span>
      </div>
      <div className="task-view-switch" role="tablist" aria-label={uiText('태스크 보기')}>
        {([{ id: 'list', label: '목록', Icon: List }, { id: 'calendar', label: '달력', Icon: Calendar }, { id: 'gantt', label: '간트', Icon: StatsUpSquare }] as const).map(({ id, label, Icon }) => <button key={id} type="button" className="task-view-button" role="tab" id={`${tabId}-${id}`} aria-selected={view === id} aria-controls={`${tabId}-body`} tabIndex={view === id ? 0 : -1} onClick={() => switchView(id)} onKeyDown={event => {
          const views = ['list', 'calendar', 'gantt'] as const
          const index = views.indexOf(id)
          const next = event.key === 'ArrowRight' ? (index + 1) % views.length : event.key === 'ArrowLeft' ? (index + views.length - 1) % views.length : event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1 : null
          if (next === null) return
          event.preventDefault(); switchView(views[next])
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
        }}><Icon width={14} height={14} aria-hidden="true" />{uiText(label)}</button>)}
      </div>
      {saving && <span role="status" className="px-1 text-xs text-ink-muted">{uiText('저장 중…')}</span>}
      <button type="button" onClick={onClose} aria-label={uiText('닫기')} data-tip={uiText('닫기')}
        className="mx-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"><Xmark width={14} height={14} aria-hidden="true" /></button>
    </header>
    <DockInlineBody group="tasks" role="tabpanel" id={`${tabId}-body`} aria-labelledby={`${tabId}-${view}`} className={view === 'gantt' ? 'task-view-body min-h-0 flex-1 overflow-hidden' : 'task-view-body min-h-0 flex-1 overflow-auto'}>
      {error && <div role="alert" className="flex items-center gap-2 px-3 py-2 text-xs text-danger"><span className="min-w-0 flex-1">{uiText(taskErrors.find(message => message === error) ?? '태스크를 저장하지 못했습니다')}</span>
        <button type="button" onClick={() => void retry()} aria-label={uiText('다시 저장')} data-tip={uiText('다시 저장')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ink"><RefreshDouble width={16} height={16} aria-hidden="true" /></button>
      </div>}
      {loading ? <div role="status" className="px-3 py-2 text-xs text-ink-muted">{uiText('불러오는 중…')}</div> : view === 'gantt' ? <TaskGantt tasks={tasks} canEdit={canEdit} edit={edit} /> : view === 'calendar' ? <TaskCalendar tasks={tasks} selected={selectedDate} month={month} onSelect={setSelectedDate} onMonth={setMonth}>{tasksOnDate(tasks, selectedDate).length === 0 && <p className="task-empty">{uiText('이 날짜에는 일정이 없습니다')}</p>}{lines}</TaskCalendar> : lines}
      {drag.preview && tasks.length === TASK_LIMIT && drag.preview.beforeId === null && <div className="task-drop-end" />}
    </DockInlineBody>
    {drag.preview && createPortal(<div aria-hidden="true" data-task-drag-preview className="task-drag-preview" style={{ left: drag.preview.x, top: drag.preview.y, width: drag.preview.width }}>
      <span className="task-check"><input type="checkbox" checked={drag.preview.item.done} readOnly tabIndex={-1} /></span><span className="task-drag-text">{drag.preview.item.text}</span>
    </div>, document.body)}
  </section>
}
