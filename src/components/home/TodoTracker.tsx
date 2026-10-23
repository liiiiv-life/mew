import { canAutoFocusInput } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
// 할 일 위젯 — 로그인 사용자가 직접 등록한 항목을 세 종류(오늘·기한·주기)로 보고 고친다.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayDismiss } from '@mew/ui'
import { Calendar, Check, CheckCircle, MoreHoriz, Plus, Repeat, Timer, Xmark } from 'iconoir-react'
import type { ProjectInfo, TodoItem, TodoType } from '../../api/client'
import { ProjectIcon } from '../ProjectIcon'
import { hasIcon } from '../../utils/projectIcons'
import type { HomeWidgetContext } from './widgets'

function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const TYPE_META: Record<TodoType, { label: string; icon: typeof Timer }> = {
  today: { get label() { return uiText("오늘") }, icon: Timer },
  dated: { get label() { return uiText("기한") }, icon: Calendar },
  recurring: { get label() { return uiText("주기") }, icon: Repeat },
}

export function TodoTracker({ items, projects, loading, onCreate, onUpdate, onDelete }: HomeWidgetContext) {
  useUiLocale()
  const [addingType, setAddingType] = useState<TodoType | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const today = todayISO()

  const projectByName = useMemo(() => new Map(projects.map((p) => [p.name, p])), [projects])
  // 주기 할 일은 매일 초기화되는 게 본래 모습이라 "끝난 일도 보기"와 무관하게 항상 보인다
  const visible = showClosed ? items : items.filter((item) => item.status === 'open' || item.type === 'recurring')
  const todayItems = visible.filter((item) => item.type === 'today')
  const datedItems = visible.filter((item) => item.type === 'dated')
  const recurringItems = visible.filter((item) => item.type === 'recurring')

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 px-1 py-3 text-xs text-ink-muted">
        <label className="ml-auto flex select-none items-center gap-1.5 rounded-full px-2 py-0.5 hover:bg-surface-raised">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          {uiText("끝난 일도 보기")}</label>
      </div>

      {loading && items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-edge px-1 py-8 text-center text-xs text-ink-muted">{uiText("불러오는 중...")}</div>
      ) : (
        <div className="flex flex-col gap-3">
          <TodoGroup
            type="today"
            title={uiText("당장 오늘 할 일")}
            items={todayItems}
            adding={addingType === 'today'}
            today={today}
            projects={projects}
            projectByName={projectByName}
            onAdd={() => setAddingType('today')}
            onCancelAdd={() => setAddingType(null)}
            onCreate={(input) => {
              onCreate(input)
              setAddingType(null)
            }}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
          <TodoGroup
            type="dated"
            title={uiText("기한이 있는 일")}
            items={datedItems}
            adding={addingType === 'dated'}
            today={today}
            projects={projects}
            projectByName={projectByName}
            onAdd={() => setAddingType('dated')}
            onCancelAdd={() => setAddingType(null)}
            onCreate={(input) => {
              onCreate(input)
              setAddingType(null)
            }}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
          <TodoGroup
            type="recurring"
            title={uiText("기간 상관 없이 주기적으로 할 일")}
            items={recurringItems}
            adding={addingType === 'recurring'}
            today={today}
            projects={projects}
            projectByName={projectByName}
            onAdd={() => setAddingType('recurring')}
            onCancelAdd={() => setAddingType(null)}
            onCreate={(input) => {
              onCreate(input)
              setAddingType(null)
            }}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        </div>
      )}
    </div>
  )
}

function ProjectDropdown({
  projects,
  projectByName,
  selected,
  onChange,
}: {
  projects: ProjectInfo[]
  projectByName: Map<string, ProjectInfo>
  selected: string[]
  onChange: (next: string[]) => void
}) {
  useUiLocale()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [anchor, setAnchor] = useState<{
    left: number
    top?: number
    bottom?: number
    maxWidth: number
    maxHeight: number
  } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])
  useOverlayDismiss(open && close)

  useEffect(() => {
    if (!open) return
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      const margin = 8
      const gap = 4
      const left = Math.max(margin, rect.left)
      const maxWidth = Math.max(0, window.innerWidth - margin * 2)
      const below = window.innerHeight - rect.bottom - gap - margin
      const above = rect.top - gap - margin
      const openAbove = below < 160 && above > below
      const maxHeight = Math.max(96, Math.min(256, openAbove ? above : below))
      setAnchor(
        openAbove
          ? { left, bottom: window.innerHeight - rect.top + gap, maxWidth, maxHeight }
          : { left, top: rect.bottom + gap, maxWidth, maxHeight },
      )
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !anchor || !menuRef.current) return
    const margin = 8
    const rect = menuRef.current.getBoundingClientRect()
    const shift = rect.right > window.innerWidth - margin ? window.innerWidth - margin - rect.right : 0
    if (shift !== 0) setAnchor((current) => (current ? { ...current, left: Math.max(margin, current.left + shift) } : current))
  }, [anchor, open, projects, selected])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [close, open])

  if (projects.length === 0) return null
  const selectedSet = new Set(selected)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleProjects = normalizedQuery
    ? projects.filter((project) => project.name.toLocaleLowerCase().includes(normalizedQuery))
    : projects
  const autoFocusSearch = canAutoFocusInput()
  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className={`flex h-6 min-w-6 max-w-[5.8rem] items-center justify-center gap-0.5 rounded-full px-0.5 leading-none ${
          selected.length > 0
            ? 'bg-transparent text-ink-secondary hover:text-ink'
            : 'bg-transparent text-ink-faint hover:text-ink-muted'
        }`}
        aria-label={uiText("연관 프로젝트")}
        title={selected.length > 0 ? selected.join(', ') : uiText("프로젝트 없음")}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {selected.length > 0 ? (
          selected.slice(0, 4).map((name) => (
            <span key={name} className="shrink-0" title={name}>
              {projectByName.has(name) ? (
                <ProjectGlyph project={projectByName.get(name)!} size={16} />
              ) : (
                <FallbackGlyph name={name} size={16} />
              )}
            </span>
          ))
        ) : (
          <MoreHoriz width={16} height={16} aria-hidden="true" />
        )}
        {selected.length > 4 && <span className="text-[10px] leading-none">+{selected.length - 4}</span>}
      </button>

      {open &&
        anchor &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label={uiText("프로젝트 선택")}
            data-todo-project-dropdown
            style={{
              left: anchor.left,
              top: anchor.top,
              bottom: anchor.bottom,
              width: 'max-content',
              maxWidth: anchor.maxWidth,
              maxHeight: anchor.maxHeight,
            }}
            className="fixed z-[1050] flex min-w-56 flex-col overflow-hidden rounded-lg border border-edge-bright bg-surface-raised shadow-xl"
          >
            <div className="shrink-0 p-1.5 pb-1">
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') close()
                }}
                autoFocus={autoFocusSearch}
                placeholder={uiText("프로젝트 검색")}
                aria-label={uiText("프로젝트 검색")}
                className="w-full rounded border border-edge-strong bg-surface px-2 py-1.5 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright"
              />
            </div>
            <div className="min-h-0 overflow-y-auto px-1.5 pb-1.5">
              {visibleProjects.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-ink-muted">{uiText("검색 결과가 없습니다")}</div>
              ) : (
                visibleProjects.map((project) => {
                  const active = selectedSet.has(project.name)
                  return (
                    <button
                      key={project.name}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onChange(active ? selected.filter((name) => name !== project.name) : [...selected, project.name])
                      }}
                      className={`flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
                        active ? 'bg-accent/15 text-ink-bright' : 'text-ink-secondary hover:bg-surface-hover hover:text-ink'
                      }`}
                    >
                      <ProjectGlyph project={project} size={16} />
                      <span className="min-w-0 flex-1 truncate whitespace-nowrap">{project.name}</span>
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        {active && <CheckCircle width={13} height={13} aria-hidden="true" />}
                      </span>
                    </button>
                  )
                })
              )}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChange([])}
                disabled={selected.length === 0}
                className="mt-1 w-full rounded border-t border-edge px-2 py-1.5 text-left text-xs text-ink-muted hover:bg-surface-hover disabled:opacity-40"
              >
                {uiText("선택 해제")}</button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

function TodoGroup({
  type,
  title,
  items,
  adding,
  today,
  projects,
  projectByName,
  onAdd,
  onCancelAdd,
  onCreate,
  onUpdate,
  onDelete,
}: {
  type: TodoType
  title: string
  items: TodoItem[]
  adding: boolean
  today: string
  projects: ProjectInfo[]
  projectByName: Map<string, ProjectInfo>
  onAdd: () => void
  onCancelAdd: () => void
  onCreate: HomeWidgetContext['onCreate']
  onUpdate: HomeWidgetContext['onUpdate']
  onDelete: HomeWidgetContext['onDelete']
}) {
  useUiLocale()
  return (
    <section className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1 px-0 text-[11px] font-semibold text-ink-muted">
        <span>{title}</span>
        <span>{items.length}</span>
      </div>
      {items.map((item) => (
        <TodoRow
          key={item.id}
          item={item}
          overdue={!item.done && item.due != null && item.due < today}
          projects={projects}
          projectByName={projectByName}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      ))}
      {adding ? (
        <NewTodoRow
          type={type}
          today={today}
          projects={projects}
          projectByName={projectByName}
          onCreate={onCreate}
          onCancel={onCancelAdd}
        />
      ) : (
        <button
          type="button"
          onClick={onAdd}
          className="flex min-h-8 w-full items-center justify-center rounded border border-dashed border-edge text-ink-muted hover:border-edge-strong hover:text-ink"
          aria-label={uiText("{p0} 추가", { p0: title })}
          title={uiText("추가")}
        >
          <Plus width={15} height={15} aria-hidden="true" />
        </button>
      )}
    </section>
  )
}

function NewTodoRow({
  type,
  today,
  projects,
  projectByName,
  onCreate,
  onCancel,
}: {
  type: TodoType
  today: string
  projects: ProjectInfo[]
  projectByName: Map<string, ProjectInfo>
  onCreate: HomeWidgetContext['onCreate']
  onCancel: () => void
}) {
  useUiLocale()
  const [text, setText] = useState('')
  const [due, setDue] = useState(today)
  const [time, setTime] = useState<string | null>(null)
  const [selectedProjects, setSelectedProjects] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const dueRef = useRef(today)
  const timeRef = useRef<string | null>(null)
  const committedRef = useRef(false)

  useEffect(() => {
    if (canAutoFocusInput()) inputRef.current?.focus()
  }, [])

  const changeTime = (nextTime: string | null) => {
    timeRef.current = nextTime
    setTime(nextTime)
  }

  const commit = (nextTime = timeRef.current) => {
    if (committedRef.current) return
    const value = text.trim()
    if (!value) return
    committedRef.current = true
    onCreate({ text: value, type, due: type === 'dated' ? dueRef.current : null, time: nextTime, projects: selectedProjects })
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1 rounded border border-accent/60 px-1.5 py-1"
      onBlur={(e) => {
        const nextFocus = e.relatedTarget as HTMLElement | null
        if (e.currentTarget.contains(nextFocus) || nextFocus?.closest('[data-todo-project-dropdown]')) return
        if (text.trim()) commit()
        else onCancel()
      }}
    >
      <ProjectDropdown
        projects={projects}
        projectByName={projectByName}
        selected={selectedProjects}
        onChange={setSelectedProjects}
      />
      <TimeFields value={time} onChange={changeTime} onSubmit={commit} />
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit()
          if (e.key === 'Escape') onCancel()
        }}
        maxLength={240}
        placeholder={uiText("{p0} 할 일", { p0: TYPE_META[type].label })}
        className="min-w-0 flex-1 rounded border border-edge-strong bg-transparent px-1.5 py-0.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright"
      />
      {type === 'dated' && (
        <DateFields
          value={due}
          onChange={(nextDue) => {
            dueRef.current = nextDue
            setDue(nextDue)
          }}
          onSubmit={() => commit()}
        />
      )}
      <button
        type="button"
        onClick={() => commit()}
        disabled={!text.trim()}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-accent hover:bg-surface-hover hover:text-accent-strong disabled:text-ink-faint disabled:opacity-50"
        aria-label={uiText("할 일 등록")}
        title={uiText("등록")}
      >
        <Check width={16} height={16} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  )
}

function TodoRow({
  item,
  overdue,
  projects,
  projectByName,
  onUpdate,
  onDelete,
}: {
  item: TodoItem
  overdue: boolean
  projects: ProjectInfo[]
  projectByName: Map<string, ProjectInfo>
  onUpdate: HomeWidgetContext['onUpdate']
  onDelete: HomeWidgetContext['onDelete']
}) {
  useUiLocale()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.text)

  const saveText = () => {
    const text = draft.trim()
    if (!text) {
      setDraft(item.text)
      setEditing(false)
      return
    }
    if (text !== item.text) onUpdate(item, { text })
    setEditing(false)
  }

  const closed = item.status !== 'open'

  return (
    <div className="group flex flex-wrap items-center gap-1 px-0 py-1">
      <input
        type="checkbox"
        checked={closed}
        onChange={(e) => onUpdate(item, { status: e.target.checked ? 'done' : 'open' })}
        aria-label={closed ? uiText("되돌리기") : uiText("완료")}
        className="shrink-0"
      />

      <ProjectDropdown
        projects={projects}
        projectByName={projectByName}
        selected={item.projects}
        onChange={(next) => onUpdate(item, { projects: next })}
      />

      <TimeFields value={item.time} onChange={(time) => onUpdate(item, { time })} />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {editing ? (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveText()
              if (e.key === 'Escape') {
                setDraft(item.text)
                setEditing(false)
              }
            }}
            maxLength={240}
            autoFocus={canAutoFocusInput()}
            className="min-w-0 rounded border border-edge-strong bg-transparent px-1.5 py-0.5 text-sm text-ink outline-none focus:border-edge-bright"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(item.text)
              setEditing(true)
            }}
            className={`min-w-0 truncate text-left text-sm ${
              closed ? 'text-ink-muted line-through' : 'text-ink'
            }`}
            title={item.text}
          >
            {item.text}
          </button>
        )}
      </div>

      {item.type === 'dated' && (
        <DateFields
          value={item.due ?? todayISO()}
          onChange={(due) => onUpdate(item, { due })}
          className={
            overdue ? 'text-danger-strong' : item.due ? 'text-ink-secondary' : 'text-ink-muted'
          }
        />
      )}

      <button
        type="button"
        onClick={() => onDelete(item)}
        className="-mr-[4.5px] flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-muted opacity-80 hover:text-danger-strong group-hover:opacity-100"
        aria-label={uiText("삭제")}
        title={uiText("삭제")}
      >
        <Xmark width={15} height={15} strokeWidth={2} aria-hidden="true" />
      </button>

    </div>
  )
}

function DateFields({
  value,
  onChange,
  onSubmit,
  className = 'text-ink-secondary',
}: {
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  className?: string
}) {
  useUiLocale()
  const [year, setYear] = useState(value.slice(0, 4))
  const [month, setMonth] = useState(value.slice(5, 7))
  const [day, setDay] = useState(value.slice(8, 10))
  const monthRef = useRef<HTMLInputElement>(null)
  const dayRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setYear(value.slice(0, 4))
    setMonth(value.slice(5, 7))
    setDay(value.slice(8, 10))
  }, [value])

  const reset = () => {
    setYear(value.slice(0, 4))
    setMonth(value.slice(5, 7))
    setDay(value.slice(8, 10))
  }

  const commit = (): string | undefined => {
    if (year.length !== 4 || month.length !== 2 || day.length !== 2) {
      reset()
      return undefined
    }
    const yearNumber = Number(year)
    const monthNumber = Number(month)
    const dayNumber = Number(day)
    const leapYear = yearNumber % 4 === 0 && (yearNumber % 100 !== 0 || yearNumber % 400 === 0)
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monthNumber - 1]
    if (yearNumber < 1 || monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > daysInMonth) {
      reset()
      return undefined
    }
    const next = `${year}-${month}-${day}`
    if (next !== value) onChange(next)
    return next
  }

  const digits = (input: string, length: number) => input.replace(/\D/g, '').slice(0, length)
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    const next = commit()
    if (next !== undefined) onSubmit?.(next)
  }

  return (
    <div
      className={`flex h-6 shrink-0 items-center px-1 text-[11px] tabular-nums ${className}`}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        commit()
      }}
      aria-label={uiText("기한")}
    >
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={year}
        onChange={(event) => {
          const next = digits(event.target.value, 4)
          setYear(next)
          if (next.length === 4) monthRef.current?.focus()
        }}
        onKeyDown={onKeyDown}
        onFocus={(event) => event.currentTarget.select()}
        maxLength={4}
        placeholder="YYYY"
        aria-label={uiText("연도")}
        className="w-8 bg-transparent text-center text-current outline-none placeholder:text-ink-faint"
      />
      <span className="select-none text-ink-muted" aria-hidden="true">-</span>
      <input
        ref={monthRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={month}
        onChange={(event) => {
          const next = digits(event.target.value, 2)
          setMonth(next)
          if (next.length === 2) dayRef.current?.focus()
        }}
        onKeyDown={onKeyDown}
        onFocus={(event) => event.currentTarget.select()}
        maxLength={2}
        placeholder="MM"
        aria-label={uiText("월")}
        className="w-5 bg-transparent text-center text-current outline-none placeholder:text-ink-faint"
      />
      <span className="select-none text-ink-muted" aria-hidden="true">-</span>
      <input
        ref={dayRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={day}
        onChange={(event) => setDay(digits(event.target.value, 2))}
        onKeyDown={onKeyDown}
        onFocus={(event) => event.currentTarget.select()}
        maxLength={2}
        placeholder="DD"
        aria-label={uiText("일")}
        className="w-5 bg-transparent text-center text-current outline-none placeholder:text-ink-faint"
      />
    </div>
  )
}

function TimeFields({
  value,
  onChange,
  onSubmit,
}: {
  value: string | null
  onChange: (value: string | null) => void
  onSubmit?: (value: string | null) => void
}) {
  useUiLocale()
  const [hour, setHour] = useState(value?.slice(0, 2) ?? '')
  const [minute, setMinute] = useState(value?.slice(3, 5) ?? '')
  const minuteRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setHour(value?.slice(0, 2) ?? '')
    setMinute(value?.slice(3, 5) ?? '')
  }, [value])

  const reset = () => {
    setHour(value?.slice(0, 2) ?? '')
    setMinute(value?.slice(3, 5) ?? '')
  }

  const commit = (): string | null | undefined => {
    if (!hour && !minute) {
      if (value !== null) onChange(null)
      return null
    }
    if (!hour || !minute) {
      reset()
      return undefined
    }
    const hourNumber = Number(hour)
    const minuteNumber = Number(minute)
    if (!Number.isInteger(hourNumber) || hourNumber < 0 || hourNumber > 23 || !Number.isInteger(minuteNumber) || minuteNumber < 0 || minuteNumber > 59) {
      reset()
      return undefined
    }
    const next = `${String(hourNumber).padStart(2, '0')}:${String(minuteNumber).padStart(2, '0')}`
    setHour(next.slice(0, 2))
    setMinute(next.slice(3, 5))
    if (next !== value) onChange(next)
    return next
  }

  const digits = (input: string) => input.replace(/\D/g, '').slice(0, 2)
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    const next = commit()
    if (next !== undefined) onSubmit?.(next)
  }

  return (
    <div
      className="flex h-6 shrink-0 items-center px-1 text-[11px] text-ink-secondary"
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        commit()
      }}
      aria-label={uiText("시간")}
    >
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={hour}
        onChange={(event) => {
          const next = digits(event.target.value)
          setHour(next)
          if (next.length === 2) minuteRef.current?.focus()
        }}
        onKeyDown={onKeyDown}
        onFocus={(event) => event.currentTarget.select()}
        maxLength={2}
        placeholder="hh"
        aria-label={uiText("시")}
        className="w-5 bg-transparent text-center tabular-nums text-ink outline-none placeholder:text-ink-faint"
      />
      <span className="select-none text-ink-muted" aria-hidden="true">:</span>
      <input
        ref={minuteRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={minute}
        onChange={(event) => setMinute(digits(event.target.value))}
        onKeyDown={onKeyDown}
        onFocus={(event) => event.currentTarget.select()}
        maxLength={2}
        placeholder="mm"
        aria-label={uiText("분")}
        className="w-5 bg-transparent text-center tabular-nums text-ink outline-none placeholder:text-ink-faint"
      />
    </div>
  )
}

function ProjectGlyph({ project, size }: { project: ProjectInfo; size: number }) {
  useUiLocale()
  if (hasIcon(project.icon)) return <ProjectIcon icon={project.icon!} size={size} />
  return <FallbackGlyph name={project.name} size={size} />
}

function FallbackGlyph({ name, size }: { name: string; size: number }) {
  useUiLocale()
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded bg-surface-hover font-mono text-[9px] text-ink-secondary"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {name[0]?.toUpperCase()}
    </span>
  )
}
