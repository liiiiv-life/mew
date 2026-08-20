// 할 일 위젯 — 로그인 사용자가 직접 등록한 항목을 세 종류(오늘·기한·주기)로 보고 고친다.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Calendar, CheckCircle, Plus, Repeat, Square, Timer, Trash, XmarkCircle } from 'iconoir-react'
import type { ProjectInfo, TodoItem, TodoStatus, TodoType } from '../../api/client'
import { ProjectIcon } from '../ProjectIcon'
import { hasIcon } from '../../utils/projectIcons'
import type { HomeWidgetContext } from './widgets'

function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const TYPE_META: Record<TodoType, { label: string; icon: typeof Timer }> = {
  today: { label: '오늘', icon: Timer },
  dated: { label: '기한', icon: Calendar },
  recurring: { label: '주기', icon: Repeat },
}

export function TodoTracker({ items, projects, loading, onCreate, onUpdate, onDelete }: HomeWidgetContext) {
  const [addingType, setAddingType] = useState<TodoType | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const today = todayISO()

  const projectByName = useMemo(() => new Map(projects.map((p) => [p.name, p])), [projects])
  const filtered = showClosed ? items : items.filter((item) => item.status === 'open')
  const todayItems = filtered.filter((item) => item.type === 'today')
  const datedItems = filtered.filter((item) => item.type === 'dated')
  const recurringItems = filtered.filter((item) => item.type === 'recurring')
  const openCount = items.filter((i) => i.status === 'open').length

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 px-1 py-3 text-xs text-ink-muted">
        <span className="rounded-full bg-surface-raised px-2 py-0.5">
          열림 {openCount}개 · 전체 {items.length}개
        </span>
        <label className="ml-auto flex select-none items-center gap-1.5 rounded-full px-2 py-0.5 hover:bg-surface-raised">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          끝난 일도 보기
        </label>
      </div>

      {loading && items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-edge px-1 py-8 text-center text-xs text-ink-muted">불러오는 중...</div>
      ) : (
        <div className="flex flex-col gap-3">
          <TodoGroup
            type="today"
            title="당장 오늘 할 일"
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
            title="기한이 있는 일"
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
            title="기간 상관 없이 주기적으로 할 일"
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
  const [open, setOpen] = useState(false)
  if (projects.length === 0) return null
  const selectedSet = new Set(selected)
  return (
    <div
      className="relative shrink-0"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-7 min-w-7 max-w-[5.8rem] items-center justify-center gap-0.5 rounded border px-1 ${
          selected.length > 0
            ? 'border-edge bg-surface text-ink-secondary hover:border-edge-strong hover:text-ink'
            : 'border-edge bg-surface text-ink-faint hover:border-edge-strong hover:text-ink-muted'
        }`}
        aria-label="연관 프로젝트"
        title={selected.length > 0 ? selected.join(', ') : '프로젝트 없음'}
      >
        {selected.length > 0 ? (
          selected.slice(0, 4).map((name) => (
            <span key={name} className="-ml-1 first:ml-0" title={name}>
              {projectByName.has(name) ? (
                <ProjectGlyph project={projectByName.get(name)!} size={16} />
              ) : (
                <FallbackGlyph name={name} size={16} />
              )}
            </span>
          ))
        ) : (
          <span className="h-3.5 w-3.5 rounded border border-dashed border-current" aria-hidden="true" />
        )}
        {selected.length > 4 && <span className="text-[10px] leading-none">+{selected.length - 4}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-edge-bright bg-surface-raised p-1.5 shadow-xl">
          {projects.map((project) => {
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
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {active && <CheckCircle width={13} height={13} aria-hidden="true" />}
                </span>
                <ProjectGlyph project={project} size={16} />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
              </button>
            )
          })}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange([])}
            disabled={selected.length === 0}
            className="mt-1 w-full rounded border-t border-edge px-2 py-1.5 text-left text-xs text-ink-muted hover:bg-surface-hover disabled:opacity-40"
          >
            선택 해제
          </button>
        </div>
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
  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-1 text-[11px] font-semibold text-ink-muted">
        <span>{title}</span>
        <div className="flex items-center gap-1.5">
          <span>{items.length}</span>
          <button
            type="button"
            onClick={onAdd}
            className="flex h-5 w-5 items-center justify-center rounded text-ink-muted hover:bg-surface-raised hover:text-ink"
            aria-label={`${title} 추가`}
            title="추가"
          >
            <Plus width={13} height={13} aria-hidden="true" />
          </button>
        </div>
      </div>
      {adding && (
        <NewTodoRow
          type={type}
          today={today}
          projects={projects}
          projectByName={projectByName}
          onCreate={onCreate}
          onCancel={onCancelAdd}
        />
      )}
      {items.length === 0 && !adding ? (
        <div className="rounded-lg border border-dashed border-edge px-3 py-3 text-center text-xs text-ink-muted">비어 있습니다</div>
      ) : (
        items.map((item) => (
          <TodoRow
            key={item.id}
            item={item}
            overdue={!item.done && item.due != null && item.due < today}
            projects={projects}
            projectByName={projectByName}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        ))
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
  const [text, setText] = useState('')
  const [due, setDue] = useState(today)
  const [selectedProjects, setSelectedProjects] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const commit = () => {
    const value = text.trim()
    if (!value) return
    onCreate({ text: value, type, due: type === 'dated' ? due : null, projects: selectedProjects })
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/60 bg-accent/10 px-2 py-2"
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        if (!text.trim()) onCancel()
      }}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-accent/50 bg-surface text-accent">
        <Plus width={15} height={15} aria-hidden="true" />
      </span>
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit()
          if (e.key === 'Escape') onCancel()
        }}
        maxLength={240}
        placeholder={`${TYPE_META[type].label} 할 일`}
        className="min-w-0 flex-1 rounded border border-edge-strong bg-surface px-2 py-1 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright"
      />
      {type === 'dated' && (
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value || today)}
          className="w-[8.6rem] shrink-0 rounded border border-edge-strong bg-surface px-1.5 py-1 text-[11px] text-ink-secondary outline-none focus:border-edge-bright"
          aria-label="기한"
        />
      )}
      <ProjectDropdown
        projects={projects}
        projectByName={projectByName}
        selected={selectedProjects}
        onChange={setSelectedProjects}
      />
      <button
        type="button"
        onClick={commit}
        disabled={!text.trim()}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-accent text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
        aria-label="저장"
        title="저장"
      >
        <CheckCircle width={15} height={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
        aria-label="취소"
        title="취소"
      >
        <XmarkCircle width={15} height={15} aria-hidden="true" />
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
    <div
      className={`group flex flex-wrap items-center gap-2 rounded-lg border px-2 py-2 transition-colors ${
        item.status === 'done'
          ? 'border-edge bg-surface text-ink-muted'
          : item.status === 'canceled'
            ? 'border-edge bg-surface text-ink-muted'
            : item.status === 'missed' || overdue
              ? 'border-danger/50 bg-danger-surface/25'
              : 'border-edge bg-surface-raised hover:border-edge-strong'
      }`}
    >
      {item.type === 'today' ? (
        <StatusButtons status={item.status} onChange={(status) => onUpdate(item, { status })} />
      ) : (
        <input
          type="checkbox"
          checked={item.status === 'done'}
          onChange={(e) => onUpdate(item, { status: e.target.checked ? 'done' : 'open' })}
          aria-label={item.status === 'done' ? '되돌리기' : '완료'}
          className="shrink-0"
        />
      )}

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
            autoFocus
            className="min-w-0 rounded border border-edge-strong bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-edge-bright"
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

      <ProjectDropdown
        projects={projects}
        projectByName={projectByName}
        selected={item.projects}
        onChange={(next) => onUpdate(item, { projects: next })}
      />

      {item.type === 'dated' && (
        <input
          type="date"
          value={item.due ?? ''}
          onChange={(e) => onUpdate(item, { due: e.target.value || null })}
          className={`w-[8.6rem] shrink-0 rounded border border-edge bg-surface px-1.5 py-1 text-[11px] outline-none focus:border-edge-bright ${
            overdue ? 'text-danger-strong' : item.due ? 'text-ink-secondary' : 'text-ink-muted'
          }`}
          aria-label="기한"
        />
      )}

      <button
        type="button"
        onClick={() => onDelete(item)}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-muted opacity-80 hover:bg-surface-hover hover:text-danger-strong group-hover:opacity-100"
        aria-label="삭제"
        title="삭제"
      >
        <Trash width={14} height={14} aria-hidden="true" />
      </button>

    </div>
  )
}

function StatusButtons({ status, onChange }: { status: TodoStatus; onChange: (status: TodoStatus) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1" aria-label="오늘 할 일 상태">
      <StatusButton
        active={status === 'done'}
        label="완료"
        className="text-accent hover:bg-accent/15"
        onClick={() => onChange(status === 'done' ? 'open' : 'done')}
      >
        <CheckCircle width={16} height={16} aria-hidden="true" />
      </StatusButton>
      <StatusButton
        active={status === 'canceled'}
        label="취소"
        className="text-ink-muted hover:bg-surface-hover"
        onClick={() => onChange(status === 'canceled' ? 'open' : 'canceled')}
      >
        <Square width={15} height={15} aria-hidden="true" />
      </StatusButton>
      <StatusButton
        active={status === 'missed'}
        label="못함"
        className="text-danger-strong hover:bg-danger-surface/40"
        onClick={() => onChange(status === 'missed' ? 'open' : 'missed')}
      >
        <XmarkCircle width={16} height={16} aria-hidden="true" />
      </StatusButton>
    </div>
  )
}

function StatusButton({
  active,
  label,
  className,
  onClick,
  children,
}: {
  active: boolean
  label: string
  className: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded border ${
        active ? 'border-current bg-current/10' : 'border-edge bg-surface'
      } ${className}`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

function ProjectGlyph({ project, size }: { project: ProjectInfo; size: number }) {
  if (hasIcon(project.icon)) return <ProjectIcon icon={project.icon!} size={size} />
  return <FallbackGlyph name={project.name} size={size} />
}

function FallbackGlyph({ name, size }: { name: string; size: number }) {
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
