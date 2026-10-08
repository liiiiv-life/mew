import { ToolPresentationToggle } from './tool-presentation-toggle'
import { TaskAssigneeProvider } from './task-assignee-context'
import { taskAssignees } from '../../shared/task-assignees'
import { TaskTagColorContext } from './task-tag-color-context'
import { TaskDocumentProvider } from './task-document-context'
import { TaskText } from './task-text'
import { TaskTagFilter } from './task-tag-filter'
import { TaskSortPicker } from './task-sort-picker'
import { defaultTaskSortRules, sortTasks, type TaskSortRule } from '../utils/task-sort'
import { collectTaskTags, taskTags, TASK_TAG_LIMIT } from '../../shared/task-tags'
import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type ComponentProps, type KeyboardEvent } from 'react'
import { useFocusedShortcutScope } from '@mew/shortcuts'
import { Calendar, Xmark, RefreshDouble, Plus, List, StatsUpSquare } from 'iconoir-react'
import { TaskDateStatus } from './task-date-status'
import { TaskActionMenu, type TaskMenuAnchor } from './task-action-menu'
import { TaskSwipeRow } from './task-swipe-row'
import { useUiLocale } from '@mew/ui/i18n'
import { uiText } from '@mew/ui/i18n-core'
import { DockGrip, DockInlineBody } from './DockWorkspace'
import type { useTaskList } from '../hooks/use-task-list'
import { TASK_LIMIT, TASK_TEXT_LIMIT, mergeVisibleTasks, removeTask, type TaskItem } from '../../shared/task-list'
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
const newTask = (text: string, tags: string[] = []): TaskItem => ({ id: uuid(), done: false, text, tags: [...new Set(tags)].slice(0, TASK_TAG_LIMIT) })
const taskErrors = [
  '태스크를 불러오지 못했습니다', '태스크를 저장하지 못했습니다',
  '다른 창에서 같은 태스크를 수정했습니다. 입력은 유지됩니다. 확인 후 다시 저장하세요.',
  '계정이 변경되었습니다. 태스크 패널을 다시 여세요.', '프로젝트가 변경되었습니다. 태스크 패널을 다시 여세요.',
  '태스크는 최대 2,000개까지 추가할 수 있습니다', '잘못된 태스크 변경입니다', '권한이 없습니다',
] as const

export function TaskPanel({ session, onClose, nextTabSignal = 0, previousTabSignal = 0, workspace, onOpenFile }: { workspace?: string | null; onOpenFile?: (path: string) => void; session: Session; onClose: () => void; nextTabSignal?: number; previousTabSignal?: number }) {
  const locale = useUiLocale()
  const tabId = useId()
  const [menu, setMenu] = useState<(TaskMenuAnchor & { id: string }) | null>(null)
  const [dateId, setDateId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [filters, setFilters] = useState<string[]>([])
  const [showCompleted, setShowCompleted] = useState(false)
  const [sortRules, setSortRules] = useState<TaskSortRule[]>(defaultTaskSortRules)
  useEffect(() => { setSortRules(defaultTaskSortRules()) }, [workspace])
  const [view, setView] = useState<'list' | 'calendar' | 'gantt'>('list')
  const [selectedDate, setSelectedDate] = useState(localToday), [month, setMonth] = useState(() => localToday().slice(0, 7))
  const inputs = useRef(new Map<string, HTMLTextAreaElement>()).current
  const { tasks, canEdit, loading, saving, error, draft, draftTags, draftAssignees, setDraftAssignees, edit, setDraft, setDraftTags, flush, retry } = session
  useEffect(() => { setMenu(null); setDateId(null) }, [workspace, canEdit, view, filters, showCompleted])
  const [today, setToday] = useState(localToday)
  useEffect(() => { setDeleteId(null) }, [workspace, canEdit])
  useEffect(() => {
    const refresh = () => setToday(localToday())
    const timer = window.setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  const sortedTasks = useMemo(() => sortRules.length ? sortTasks(tasks, sortRules, locale, today) : sortTasksByDateStatus(tasks, today), [tasks, today, sortRules, locale])
  const knownTags = collectTaskTags(tasks, [...(session.tags ?? []), ...draftTags])
  useEffect(() => {
    setFilters(current => { const next = current.filter(tag => knownTags.includes(tag)); return next.length === current.length ? current : next })
  }, [knownTags])
  const matchesFilter = (task: TaskItem) => (showCompleted || !task.done) && (!filters.length || taskTags(task).some(tag => filters.includes(tag)))
  const filteredTasks = tasks.filter(matchesFilter)
  const sortedFiltered = sortedTasks.filter(matchesFilter)
  const drag = useTaskDrag(sortedFiltered, canEdit && !sortRules.length, next => edit(mergeVisibleTasks(tasks, sortedFiltered, next)))
  const createTask = (text: string, tags: string[] = [], assignees: string[] = []): TaskItem => ({ assignees, ...newTask(text, [...tags, ...filters]), ...(view === 'calendar' ? { startDate: selectedDate, date: selectedDate } : {}) })
  const visibleTasks = view === 'calendar' ? tasksOnDate(filteredTasks, selectedDate) : sortedFiltered
  const focus = (id: string, position: number | 'end' = 0) => {
    requestAnimationFrame(() => {
      const input = inputs.get(id)
      if (!input) return
      input.focus({ preventScroll: true })
      const offset = position === 'end' ? input.value.length : position
      input.setSelectionRange(offset, offset)
      input.scrollIntoView({ block: 'nearest' })
    })
  }
  const update = (id: string, text: string, tags: string[]) => edit(tasks.map(item => item.id === id ? { ...item, text, tags } : item))
  const remove = (index: number) => edit(removeTask(tasks, index))
  const commitDraft = () => {
    if ((!draft.trim() && !draftTags.length && !draftAssignees.length) || tasks.length >= TASK_LIMIT || !canEdit) return
    edit([...tasks, createTask(draft, draftTags, draftAssignees)])
    setDraft(''); setDraftTags([]); setDraftAssignees([])
  }
  const startCreate = () => {
    if (!canEdit || loading || tasks.length >= TASK_LIMIT) return false
    if (view === 'gantt') edit([...tasks, createTask(uiText('새 태스크'))])
    else focus('draft', 'end')
    return true
  }
  const switchView = (next: typeof view) => { if (next !== view) { commitDraft(); setDeleteId(null); setView(next) } }
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
      const next = createTask(item.text.slice(input.selectionEnd), taskTags(item), taskAssignees(item))
      edit([...tasks.slice(0, index), { ...item, text: item.text.slice(0, input.selectionStart) }, next, ...tasks.slice(index + 1)])
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
    const created = lines.map(line => createTask(line, index < tasks.length ? taskTags(tasks[index]) : draftTags, index < tasks.length ? taskAssignees(tasks[index]) : draftAssignees))
    if (index < tasks.length) created[0] = { ...tasks[index], text: lines[0] }
    edit([...tasks.slice(0, index), ...created, ...tasks.slice(index + (index < tasks.length ? 1 : 0))])
    if (index === tasks.length) { setDraft(''); setDraftTags([]); setDraftAssignees([]) }
    focus(created.at(-1)!.id, 'end')
  }
  const menuTask = visibleTasks.find(item => item.id === menu?.id)
  const renderTask = (item: TaskItem) => { const index = tasks.findIndex(task => task.id === item.id); return <TaskSwipeRow key={`${workspace}:${item.id}`} enabled={canEdit} open={deleteId === item.id} onReveal={open => setDeleteId(open ? item.id : null)} onDelete={() => { remove(index); setDeleteId(null) }} onMenu={anchor => setMenu({ ...anchor, id: item.id })} id={item.id} done={item.done} dragging={view === 'list' && drag.preview?.item.id === item.id} dropBefore={view === 'list' && drag.preview?.beforeId === item.id}>
          <label className="task-check" {...(view === 'list' ? drag.handle(item.id) : {})}><input type="checkbox" checked={item.done} disabled={!canEdit} aria-label={uiText('태스크 완료')} aria-keyshortcuts={view === 'list' && !sortRules.length ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
            onChange={event => edit(tasks.map(task => task.id === item.id ? { ...task, done: event.target.checked } : task))} /></label>
          <div className="task-content"><TaskText id={item.id} text={item.text} tags={item.tags} assignees={item.assignees} onAssigneesChange={assignees => edit(tasks.map(task => task.id === item.id ? { ...task, assignees } : task))} knownTags={knownTags} onFilter={tag => setFilters(current => current.includes(tag) ? current : [...current, tag])} disabled={!canEdit} inputs={inputs}
            onChange={(text, tags) => update(item.id, text, tags)} onKeyDown={event => keyDown(event, index)} onPaste={event => paste(event, index)} onBlur={() => void flush()} /></div>
          <TaskDateStatus task={item} isOpen={dateId === item.id} onOpenChange={open => setDateId(open ? item.id : null)} today={today} readOnly={!canEdit} onChange={(startDate, date) => { if (!canEdit) return; edit(tasks.map(task => task.id === item.id ? { ...task, startDate, date } : task)) }} />
        </TaskSwipeRow> }
  const lines = <div ref={view === 'list' ? drag.list : undefined} {...(view === 'list' ? drag.events : {})} className="task-lines px-2 py-1">
        {(view === 'calendar' ? visibleTasks : drag.tasks.filter(matchesFilter)).map(renderTask)}
        {canEdit && tasks.length < TASK_LIMIT && <div data-drop-before={view === 'list' && !!drag.preview && drag.preview.beforeId === null || undefined} className="task-line task-draft" data-empty={!draft && !draftTags.length && !draftAssignees.length || undefined}>
          <span className="task-draft-plus" aria-hidden="true"><Plus width={18} height={18} /></span>
          <span className="task-check"><input type="checkbox" disabled aria-hidden="true" /></span>
          <TaskText id="draft" text={draft} tags={draftTags} assignees={draftAssignees} onAssigneesChange={setDraftAssignees} knownTags={knownTags} disabled={false} inputs={inputs}
            onChange={(text, tags) => { setDraft(text); setDraftTags(tags) }} onKeyDown={event => keyDown(event, tasks.length)} onPaste={event => paste(event, tasks.length)}
            onBlur={commitDraft} />
        </div>}
      </div>
  return <TaskAssigneeProvider key={workspace}><TaskTagColorContext.Provider value={{ colors: session.tagColors, onChange: session.setTagColor, onDelete: session.deleteTag }}><TaskDocumentProvider key={workspace} workspace={workspace} onOpen={onOpenFile}><TaskShortcutScope onCreate={startCreate} data-workspace-panel="tasks" aria-label={uiText('태스크')} data-sort-active={view === 'list' && sortRules.length > 0 || undefined} className="task-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface text-ink">
    <header data-dock-tab-bar className="flex h-9 shrink-0 items-center border-b border-edge bg-surface-deep">
      <DockGrip group="tasks" />
      <div className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5">
        <div role="tab" aria-label={uiText('태스크')} aria-selected="true" tabIndex={0} className="task-panel-title flex shrink-0 items-center gap-1.5 text-xs">
          <Calendar width={14} height={14} aria-hidden="true" /><span>{uiText('태스크')}</span>
        </div>
        {saving && <span role="status" className="min-w-0 truncate text-xs text-ink-secondary">{uiText('저장 중…')}</span>}
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
      <ToolPresentationToggle tool="tasks" />
      <button type="button" onClick={onClose} aria-label={uiText('닫기')} data-tip={uiText('닫기')}
        className="mx-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"><Xmark width={14} height={14} aria-hidden="true" /></button>
    </header>
    <TaskTagFilter tags={knownTags} selected={filters} count={filteredTasks.length} total={tasks.length} onChange={setFilters} showCompleted={showCompleted} onShowCompletedChange={setShowCompleted}>
      {view === 'list' && <TaskSortPicker rules={sortRules} onChange={setSortRules} />}
    </TaskTagFilter>
    <DockInlineBody group="tasks" role="tabpanel" id={`${tabId}-body`} aria-labelledby={`${tabId}-${view}`} className={view === 'gantt' ? 'task-view-body min-h-0 flex-1 overflow-hidden' : 'task-view-body min-h-0 flex-1 overflow-auto'}>
      {error && <div role="alert" className="flex items-center gap-2 px-3 py-2 text-xs text-danger"><span className="min-w-0 flex-1">{uiText(taskErrors.find(message => message === error) ?? '태스크를 저장하지 못했습니다')}</span>
        <button type="button" onClick={() => void retry()} aria-label={uiText('다시 저장')} data-tip={uiText('다시 저장')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ink"><RefreshDouble width={16} height={16} aria-hidden="true" /></button>
      </div>}
      {loading ? <div role="status" className="px-3 py-2 text-xs text-ink-muted">{uiText('불러오는 중…')}</div> : view === 'gantt' ? <TaskGantt tasks={filteredTasks} knownTags={knownTags} canEdit={canEdit} totalTasks={tasks.length} edit={next => edit(mergeVisibleTasks(tasks, filteredTasks, next.map(task => !tasks.some(existing => existing.id === task.id) && filters.length ? { ...task, tags: [...new Set([...taskTags(task), ...filters])].slice(0, TASK_TAG_LIMIT) } : task)))} /> : view === 'calendar' ? <TaskCalendar tasks={filteredTasks} selected={selectedDate} month={month} onSelect={setSelectedDate} onMonth={setMonth}>{tasksOnDate(filteredTasks, selectedDate).length === 0 && <p className="task-empty">{uiText('이 날짜에는 일정이 없습니다')}</p>}{lines}</TaskCalendar> : lines}
      {drag.preview && tasks.length === TASK_LIMIT && drag.preview.beforeId === null && <div className="task-drop-end" />}
    </DockInlineBody>
    {menu && menuTask && <TaskActionMenu anchor={menu} task={menuTask} onClose={() => setMenu(null)}
      onOpenDocument={menuTask.path && onOpenFile ? () => onOpenFile(menuTask.path!) : undefined}
      onEditDates={canEdit ? () => setDateId(menuTask.id) : undefined}
      onToggleDone={canEdit ? () => edit(tasks.map(item => item.id === menuTask.id ? { ...item, done: !item.done } : item)) : undefined}
      onDelete={canEdit ? () => { remove(tasks.findIndex(item => item.id === menuTask.id)); setDeleteId(null) } : undefined} />}
    {drag.preview && createPortal(<div aria-hidden="true" data-task-drag-preview className="task-drag-preview" style={{ left: drag.preview.x, top: drag.preview.y, width: drag.preview.width }}>
      <span className="task-check"><input type="checkbox" checked={drag.preview.item.done} readOnly tabIndex={-1} /></span><span className="task-drag-text">{drag.preview.item.text}</span>
    </div>, document.body)}
  </TaskShortcutScope></TaskDocumentProvider></TaskTagColorContext.Provider></TaskAssigneeProvider>
}

function TaskShortcutScope({ onCreate, ...props }: ComponentProps<'section'> & { onCreate: () => boolean }) {
  const ref = useRef<HTMLElement>(null)
  useFocusedShortcutScope(ref, { newTab: onCreate })
  return <section {...props} ref={ref} />
}
