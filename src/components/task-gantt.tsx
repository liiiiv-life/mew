import { TaskText } from './task-text'
import { TaskRangeCalendar } from './task-range-calendar'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayDismiss } from '@mew/ui'
import { useUiLocale } from '@mew/ui/i18n'
import { uiText } from '@mew/ui/i18n-core'
import { localToday } from '@mew/ui/date-value'
import { CursorPointer, EditPencil, Minus, Plus, Xmark } from 'iconoir-react'
import { TASK_LIMIT, taskRange, type TaskItem } from '../../shared/task-list'
import { floorTo, fromDay, isWeekend, scaleFor, tickDays, tickLabel, toDay } from '../utils/task-timeline'
import { MAX_TASK_DAY, MIN_TASK_DAY, moveTaskRange, taskBars, taskStatus, taskStatusLabels } from '../utils/task-schedule'
import { uuid } from '../utils/uuid'

// SVG grid, row dimensions, bars, handles and header gestures follow liiiiv/gantt-maker.
const ROW_H = 44, HEADER_H = 46, BAR_H = 22, LABEL_W = 168
type Mode = 'move' | 'start' | 'end' | 'draw' | 'header' | 'range-start' | 'range-end'
type Gesture = { pointer: number; element: Element; mode: Mode; task: TaskItem | null; x: number; y: number; anchor: number; ppd: number; moved: boolean; next: TaskItem | null; bounds: { start: number | null; end: number | null }; start: number; end: number }
type Pick = { id: string; x: number; y: number; keyboard?: boolean }

export function TaskGantt({ tasks, canEdit, edit, knownTags, totalTasks = tasks.length }: { tasks: TaskItem[]; canEdit: boolean; edit: (tasks: TaskItem[]) => void; knownTags: string[]; totalTasks?: number }) {
  const locale = useUiLocale(), today = localToday(), gradientId = useId().replace(/:/g, '')
  const [ppd, setPpd] = useState(24), [drawing, setDrawing] = useState(false), [preview, setPreview] = useState<TaskItem | null>(null), [pick, setPick] = useState<Pick | null>(null)
  const scroller = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null), gesture = useRef<Gesture | null>(null)
  const labels = useRef<HTMLDivElement>(null), pickElement = useRef<HTMLElement | SVGElement | null>(null)
  const current = useRef({ tasks, canEdit, edit, ppd }); current.current = { tasks, canEdit, edit, ppd }
  const [bounds, setBounds] = useState<{ start: number | null; end: number | null }>({ start: null, end: null })
  const pendingScroll = useRef<number | null>(null)
  const allShown = preview ? tasks.some(task => task.id === preview.id) ? tasks.map(task => task.id === preview.id ? preview : task) : [...tasks, preview] : tasks
  const ranges = allShown.flatMap(task => { const range = taskRange(task); return range ? [toDay(range.end)] : [] })
  const startDay = bounds.start ?? Math.max(MIN_TASK_DAY, toDay(today) - 5)
  const endDay = Math.max(startDay, bounds.end ?? Math.min(MAX_TASK_DAY, Math.max(toDay(today), ...ranges)))
  const previousStart = useRef(startDay), days = endDay - startDay + 1
  const shown = allShown
  const bars = taskBars(allShown, today), width = days * ppd, height = (shown.length + 1) * ROW_H
  const { minor, major } = scaleFor(Math.min(ppd, days > 800 ? 4 : ppd))
  const minors = tickDays(startDay, endDay, minor), majors = tickDays(startDay, endDay, major)
  const X = (day: number) => (day - startDay) * ppd
  const closePick = useCallback((restore = true) => {
    setPick(null)
    if (restore && pickElement.current?.isConnected) pickElement.current.focus({ preventScroll: true })
  }, [])
  useOverlayDismiss(pick ? closePick : false, { escapePhase: 'capture' })
  const selected = tasks.find(task => task.id === pick?.id)
  const cancel = () => {
    const active = gesture.current; gesture.current = null
    if (active?.element.hasPointerCapture(active.pointer)) active.element.releasePointerCapture(active.pointer)
    if (active?.mode === 'range-start' || active?.mode === 'range-end') setBounds(active.bounds)
    setPreview(null)
  }
  const zoom = (value: number, clientX?: number) => {
    const element = scroller.current
    const next = Math.max(.35, Math.min(80, value))
    if (element) {
      const labelWidth = labels.current?.clientWidth ?? LABEL_W
      const anchor = clientX == null ? (element.clientWidth - labelWidth) / 2 : clientX - element.getBoundingClientRect().left - labelWidth
      pendingScroll.current = (element.scrollLeft + anchor) / current.current.ppd * next - anchor
    }
    current.current.ppd = next; setPpd(next)
  }
  useLayoutEffect(() => {
    if (scroller.current) {
      if (pendingScroll.current !== null) { scroller.current.scrollLeft = pendingScroll.current; pendingScroll.current = null }
      else scroller.current.scrollLeft += (previousStart.current - startDay) * ppd
    }
    previousStart.current = startDay
  }, [ppd, startDay])
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault(); zoom(current.current.ppd * Math.exp(-event.deltaY * .0025), event.clientX)
    }
    const touch = (event: TouchEvent) => { if ((event.target as Element).closest('[data-gantt-grab]')) event.preventDefault() }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopImmediatePropagation(); cancel() }
    }
    const hidden = () => { if (document.hidden) cancel() }
    element.addEventListener('wheel', wheel, { passive: false }); element.addEventListener('touchstart', touch, { passive: false })
    window.addEventListener('keydown', key, true); window.addEventListener('blur', cancel); window.addEventListener('resize', cancel); document.addEventListener('visibilitychange', hidden)
    return () => {
      element.removeEventListener('wheel', wheel); element.removeEventListener('touchstart', touch)
      window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); document.removeEventListener('visibilitychange', hidden)
      const active = gesture.current; gesture.current = null
      if (active?.element.hasPointerCapture(active.pointer)) active.element.releasePointerCapture(active.pointer)
    }
    // Handlers read live refs; cancel does not depend on render state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const active = gesture.current
    if (!canEdit && active && !['header', 'range-start', 'range-end'].includes(active.mode)) cancel()
    else if (active?.task) {
      const now = tasks.find(task => task.id === active.task!.id)
      if (!now || now.startDate !== active.task.startDate || now.date !== active.task.date) cancel()
    }
    if (pick && !tasks.some(task => task.id === pick.id)) closePick(false)
  }, [tasks, canEdit, pick, closePick])
  const dayAt = (clientX: number) => Math.max(MIN_TASK_DAY, Math.min(MAX_TASK_DAY, Math.floor(startDay + (clientX - (svg.current?.getBoundingClientRect().left ?? 0)) / ppd)))
  const begin = (event: ReactPointerEvent<Element>, mode: Mode, task: TaskItem | null) => {
    if (event.button !== 0 || !event.isPrimary || (!['header', 'range-start', 'range-end'].includes(mode) && !canEdit)) return
    if (mode === 'draw' && !task && totalTasks >= TASK_LIMIT) return
    event.preventDefault(); event.stopPropagation(); setPick(null)
    event.currentTarget.setPointerCapture(event.pointerId)
    if (task) pickElement.current = (event.currentTarget.closest('[data-gantt-task]')?.querySelector('[data-gantt-bar]') ?? event.currentTarget) as HTMLElement | SVGElement
    gesture.current = { pointer: event.pointerId, element: event.currentTarget, mode, task, x: event.clientX, y: event.clientY, anchor: dayAt(event.clientX), ppd, moved: false, next: null, bounds, start: startDay, end: endDay }
  }
  const move = (event: ReactPointerEvent) => {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    if (active.mode === 'range-start' || active.mode === 'range-end') {
      const delta = Math.round((event.clientX - active.x) / active.ppd)
      if (active.mode === 'range-start') {
        pendingScroll.current = 0
        setBounds({ ...active.bounds, start: Math.max(MIN_TASK_DAY, Math.min(active.end, active.start + delta)) })
      } else {
        setBounds({ ...active.bounds, end: Math.min(MAX_TASK_DAY, Math.max(active.start, active.end + delta)) })
      }
      return
    }
    if (active.mode === 'header') {
      if (scroller.current) scroller.current.scrollLeft -= event.clientX - active.x
      if (event.clientY !== active.y) zoom(current.current.ppd * Math.exp((event.clientY - active.y) * .007), event.clientX)
      active.x = event.clientX; active.y = event.clientY
      return
    }
    if (Math.abs(event.clientX - active.x) < 4 && !active.moved) return
    active.moved = true
    if (active.mode === 'draw') {
      const day = dayAt(event.clientX)
      active.next = { ...(active.task ?? { id: active.next?.id ?? uuid(), text: uiText('새 태스크'), done: false }), startDate: fromDay(Math.min(active.anchor, day)), date: fromDay(Math.max(active.anchor, day)) }
    } else if (active.task) active.next = moveTaskRange(active.task, Math.round((event.clientX - active.x) / active.ppd), active.mode)
    setPreview(active.next)
  }
  const end = (event: ReactPointerEvent) => {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    move(event); gesture.current = null
    if (active.element.hasPointerCapture(active.pointer)) active.element.releasePointerCapture(active.pointer)
    if (active.moved && active.next && current.current.canEdit) {
      const next = active.next, latest = current.current.tasks
      if (!active.task) current.current.edit([...latest, next])
      else current.current.edit(latest.map(task => task.id === next.id ? { ...task, startDate: next.startDate, date: next.date } : task))
    } else if (active.task && active.mode !== 'header') setPick({ id: active.task.id, x: event.clientX, y: event.clientY })
    setPreview(null)
  }
  const pickTask = (task: TaskItem, element: Element, keyboard = false) => { pickElement.current = element as HTMLElement | SVGElement; const rect = element.getBoundingClientRect(); setPick({ id: task.id, x: rect.right, y: rect.top, keyboard }) }

  const adjustBoundary = (side: 'start' | 'end', delta: number) => {
    if (side === 'start') { pendingScroll.current = 0; setBounds({ ...bounds, start: Math.max(MIN_TASK_DAY, Math.min(endDay, startDay + delta)) }) }
    else setBounds({ ...bounds, end: Math.min(MAX_TASK_DAY, Math.max(startDay, endDay + delta)) })
  }

  return <div className="task-gantt" data-range-start={fromDay(startDay)} data-range-end={fromDay(endDay)}>
    <div className="task-gantt-tools">
      <div className="task-tool-group">
        <button type="button" className="task-tool" aria-label={uiText('선택')} data-tip={uiText('선택')} aria-pressed={!drawing} onClick={() => { cancel(); setDrawing(false) }}><CursorPointer width={16} height={16} aria-hidden="true" /></button>
        <button type="button" className="task-tool" aria-label={uiText('일정 그리기')} data-tip={uiText('일정 그리기')} aria-pressed={drawing} disabled={!canEdit} onClick={() => { cancel(); setDrawing(true) }}><EditPencil width={16} height={16} aria-hidden="true" /></button>
      </div>
      <button type="button" className="task-tool task-today" onClick={() => { if (scroller.current) scroller.current.scrollLeft = X(toDay(today)) - (scroller.current.clientWidth - (labels.current?.clientWidth ?? LABEL_W)) / 2 }}>{uiText('오늘')}</button>
      <button type="button" className="task-tool" aria-label={uiText('전체 기간 보기')} data-tip={uiText('전체 기간 보기')} onClick={() => { zoom(((scroller.current?.clientWidth ?? 600) - (labels.current?.clientWidth ?? LABEL_W)) / days); pendingScroll.current = 0 }}>{uiText('전체')}</button>
      <button type="button" className="task-tool" aria-label={uiText('축소')} data-tip={uiText('축소')} disabled={ppd <= .35} onClick={() => zoom(ppd / 1.4)}><Minus width={16} height={16} aria-hidden="true" /></button>
      <button type="button" className="task-tool" aria-label={uiText('확대')} data-tip={uiText('확대')} disabled={ppd >= 80} onClick={() => zoom(ppd * 1.4)}><Plus width={16} height={16} aria-hidden="true" /></button>
      <div className="task-gantt-legend">{(['done', 'planned', 'missed'] as const).map(status => <span key={status}><i data-status={status} />{uiText(taskStatusLabels[status])}</span>)}</div>
    </div>
    <div className="task-gantt-frame" onPointerMove={move} onPointerUp={end} onPointerCancel={cancel} onLostPointerCapture={() => { if (gesture.current) cancel() }}>
      <div ref={scroller} className="task-gantt-scroller">
      <div className="task-gantt-content" style={{ width: `calc(var(--task-gantt-label-width) + ${width}px)` }}>
        <div ref={labels} className="task-gantt-labels" style={{ width: 'var(--task-gantt-label-width)' }}>
          <div className="task-gantt-label-header">{uiText('태스크')}</div>
          {shown.map(task => <div key={task.id} className="task-gantt-label" data-done={task.done} style={{ paddingLeft: 8 }}>
            <input type="checkbox" checked={task.done} disabled={!canEdit} aria-label={uiText('태스크 완료')} onChange={event => edit(tasks.map(item => item.id === task.id ? { ...item, done: event.target.checked } : item))} />
            <button type="button" data-tip={task.text || uiText('새 태스크')} onClick={event => pickTask(task, event.currentTarget, event.detail === 0)}>{task.text || uiText('새 태스크')}</button>
          </div>)}
          <div className="task-gantt-label task-gantt-new">{canEdit && <button type="button" disabled={totalTasks >= TASK_LIMIT} onClick={() => { const task = { id: uuid(), text: uiText('새 태스크'), done: false }; edit([...tasks, task]) }}><Plus width={14} height={14} aria-hidden="true" />{uiText('새 태스크')}</button>}</div>
        </div>
        <div className="task-gantt-plot" style={{ width }}>
          <svg className="task-gantt-header" width={width} height={HEADER_H} aria-label={uiText('간트 날짜 눈금')}>
            <rect width={width} height={HEADER_H} fill="var(--color-surface)" />
            {majors.map((day, index) => <g key={day}><line x1={X(day)} x2={X(day)} y1={0} y2={HEADER_H} stroke="var(--color-edge)" /><text x={Math.max(0, X(day)) + 8} y={17} className="task-gantt-major">{tickLabel(day, major, locale)}</text>{index === 0 && day > startDay && <text x={8} y={17} className="task-gantt-major">{tickLabel(floorTo(startDay, major), major, locale)}</text>}</g>)}
            {minors.map(day => <text key={day} x={Math.max(0, X(day)) + (minor === 'day' ? ppd / 2 : 6)} y={37} textAnchor={minor === 'day' ? 'middle' : 'start'} className="task-gantt-minor">{tickLabel(day, minor, locale)}</text>)}
            <g data-gantt-today pointerEvents="none"><line x1={X(toDay(today))} x2={X(toDay(today))} y1={20} y2={HEADER_H} stroke="#f43f5e" strokeWidth={1.5} strokeDasharray="4 3" /><rect x={X(toDay(today)) - 18} y={5} width={36} height={16} rx={8} fill="#be123c" /><text x={X(toDay(today))} y={16.5} textAnchor="middle" fill="#fff" fontSize={10}>{uiText('오늘')}</text></g>
            <rect data-gantt-grab width={width} height={HEADER_H} fill="transparent" style={{ cursor: 'ns-resize', touchAction: 'none' }} onPointerDown={event => begin(event, 'header', null)} />
          </svg>
          <svg ref={svg} width={width} height={height} className="task-gantt-svg" aria-label={uiText('태스크 간트')}>
            <defs>{shown.flatMap(task => (bars.get(task.id) ?? []).map((bar, index) => <linearGradient key={`${task.id}-${index}`} id={`${gradientId}-${task.id}-${index}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor={bar.from} /><stop offset="100%" stopColor={bar.to} /></linearGradient>))}</defs>
            <rect width={width} height={height} fill="var(--color-surface)" />
            {minor === 'day' && days <= 800 && Array.from({ length: days }, (_, index) => startDay + index).filter(isWeekend).map(day => <rect key={day} x={X(day)} width={ppd} height={height} fill="var(--color-surface-deep)" />)}
            {minors.map(day => <line key={day} x1={X(day)} x2={X(day)} y1={0} y2={height} stroke="var(--color-edge)" opacity={.5} />)}
            {majors.map(day => <line key={day} x1={X(day)} x2={X(day)} y1={0} y2={height} stroke="var(--color-edge)" />)}
            {shown.map((task, row) => <g key={task.id} data-gantt-task={task.id}>
              <line x1={0} x2={width} y1={(row + 1) * ROW_H} y2={(row + 1) * ROW_H} stroke="var(--color-edge)" opacity={.5} />
              {drawing && canEdit && <rect data-gantt-grab x={0} y={row * ROW_H} width={width} height={ROW_H} fill="transparent" style={{ cursor: 'crosshair', touchAction: 'none' }} onPointerDown={event => begin(event, 'draw', tasks.find(item => item.id === task.id) ?? null)} />}
              {(bars.get(task.id) ?? []).map((bar, index, rowBars) => {
                const x = X(toDay(bar.start)), span = toDay(bar.end) - toDay(bar.start) + 1, w = Math.max(4, span * ppd - 1), y = row * ROW_H + (ROW_H - BAR_H) / 2
                const status = taskStatus(task, today), label = `${task.text} · ${bar.start} – ${bar.end}${bar.own ? ` · ${uiText(taskStatusLabels[status])}` : ''}`
                return <g key={index}>
                  {index > 0 && <line x1={X(toDay(rowBars[index - 1].end) + 1)} x2={x} y1={y + BAR_H / 2} y2={y + BAR_H / 2} stroke="var(--color-ink-muted)" strokeWidth={3} strokeLinecap="round" />}
                  <rect data-gantt-bar={bar.own ? task.id : undefined} data-gantt-summary={!bar.own || undefined} data-gantt-grab={bar.own && canEdit || undefined}
                    role="button" aria-label={label} tabIndex={0} x={x} y={y} width={w} height={BAR_H} rx={Math.min(7, w / 2)} fill={`url(#${gradientId}-${task.id}-${index})`}
                    stroke={pick?.id === task.id ? 'var(--color-ink)' : 'none'} strokeWidth={1.5} style={{ cursor: bar.own && canEdit ? 'grab' : 'pointer', touchAction: bar.own && canEdit ? 'none' : undefined }}
                    onPointerDown={bar.own && canEdit ? event => begin(event, 'move', task) : undefined}
                    onClick={!canEdit || !bar.own ? event => pickTask(task, event.currentTarget) : undefined}
                    onContextMenu={event => { event.preventDefault(); pickElement.current = event.currentTarget; setPick({ id: task.id, x: event.clientX, y: event.clientY }) }}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pickTask(task, event.currentTarget, true) }
                      else if (canEdit && bar.own && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); edit(tasks.map(item => item.id === task.id ? moveTaskRange(item, event.key === 'ArrowLeft' ? -1 : 1, event.shiftKey ? 'end' : event.altKey ? 'start' : 'move') : item)) }
                    }}><title>{label}</title></rect>
                  {w >= 40 && <text x={x + 8} y={y + 15} fontSize={11} fill="#102235" pointerEvents="none">{uiText('{p0}일', { p0: span })}</text>}
                  {bar.own && canEdit && w >= 20 && (['start', 'end'] as const).map(mode => <rect key={mode} data-gantt-resize={mode} data-gantt-grab x={(mode === 'start' ? x : x + w) - 7} y={y - 5} width={14} height={BAR_H + 10} fill="transparent" style={{ cursor: 'ew-resize', touchAction: 'none' }} onPointerDown={event => begin(event, mode, task)} />)}
                </g>
              })}
            </g>)}
            <line x1={8} x2={width - 8} y1={shown.length * ROW_H + ROW_H / 2} y2={shown.length * ROW_H + ROW_H / 2} stroke="var(--color-edge)" strokeDasharray="3 6" />
            {drawing && canEdit && totalTasks < TASK_LIMIT && <rect data-gantt-new data-gantt-grab x={0} y={shown.length * ROW_H} width={width} height={ROW_H} fill="transparent" style={{ cursor: 'crosshair', touchAction: 'none' }} onPointerDown={event => begin(event, 'draw', null)} />}
            <line pointerEvents="none" x1={X(toDay(today))} x2={X(toDay(today))} y1={0} y2={height} stroke="#f43f5e" strokeWidth={1.5} strokeDasharray="4 3" />
          </svg>
        </div>
      </div>
      </div>
      {(['start', 'end'] as const).map(side => <button key={side} type="button" className="task-gantt-boundary" data-gantt-boundary={side}
        aria-label={uiText(side === 'start' ? '시작일' : '종료일')} data-tip={uiText(side === 'start' ? '시작일' : '종료일')}
        onPointerDown={event => begin(event, side === 'start' ? 'range-start' : 'range-end', null)}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); adjustBoundary(side, (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 7 : 1)) } }}><span aria-hidden="true" /></button>)}
    </div>
    {pick && selected && createPortal(<GanttInspector pick={pick} task={selected} knownTags={knownTags} canEdit={canEdit} onClose={closePick} onEdit={item => edit(tasks.map(task => task.id === item.id ? item : task))} />, document.body)}
  </div>
}

function GanttInspector({ pick, task, knownTags, canEdit, onClose, onEdit }: { pick: Pick; task: TaskItem; knownTags: string[]; canEdit: boolean; onClose: (restore?: boolean) => void; onEdit: (task: TaskItem) => void }) {
  const ref = useRef<HTMLDivElement>(null), [position, setPosition] = useState({ left: pick.x, top: pick.y })
  useLayoutEffect(() => {
    const update = () => {
      const rect = ref.current?.getBoundingClientRect(), viewport = window.visualViewport
      if (!rect) return
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      setPosition({ left: Math.max(left + 8, Math.min(pick.x + 8, left + (viewport?.width ?? innerWidth) - rect.width - 8)), top: Math.max(top + 8, Math.min(pick.y + 8, top + (viewport?.height ?? innerHeight) - rect.height - 8)) })
    }
    update()
    // Start on a non-input control so keyboard access does not open a touch keyboard.
    if (pick.keyboard) ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    window.addEventListener('resize', update); window.visualViewport?.addEventListener('resize', update); window.visualViewport?.addEventListener('scroll', update)
    const outside = (event: PointerEvent) => { const target = event.target as Element; if (!ref.current?.contains(target) && !target.closest('.mew-calendar, .task-tag-suggestions')) onClose(false) }
    document.addEventListener('pointerdown', outside)
    return () => { window.removeEventListener('resize', update); window.visualViewport?.removeEventListener('resize', update); window.visualViewport?.removeEventListener('scroll', update); document.removeEventListener('pointerdown', outside) }
  }, [pick, onClose])
  return <div ref={ref} role="dialog" aria-label={uiText('일정 편집')} className="task-gantt-inspector" style={position}>
    <div className="task-inspector-head"><strong>{uiText('일정 편집')}</strong><button type="button" className="task-tool" aria-label={uiText('닫기')} data-tip={uiText('닫기')} onClick={() => onClose()}><Xmark width={16} height={16} aria-hidden="true" /></button></div>
    <TaskText id={task.id} text={task.text} tags={task.tags} knownTags={knownTags} disabled={!canEdit} onChange={(text, tags) => onEdit({ ...task, text, tags })} />
    <TaskRangeCalendar key={task.id} start={task.startDate} end={task.date} readOnly={!canEdit} onChange={(startDate, date) => onEdit({ ...task, startDate, date })} />
    <div className="task-inspector-actions"><label><input type="checkbox" checked={task.done} disabled={!canEdit} onChange={event => onEdit({ ...task, done: event.target.checked })} />{uiText('완료')}</label>
    </div>
  </div>
}
