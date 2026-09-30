import './project-tasks.css'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SelectField } from '@mew/ui'
import { CheckCircle, Plus, Refresh, Xmark, Trash, NavArrowRight, NavArrowDown } from 'iconoir-react'
import { taskCopy } from './project-tasks-copy'
import { useI18n } from '../i18n'
import type { ProjectTask, ProjectTaskBoard, ProjectTaskResponse } from '../../shared/project-tasks'

type Copy = typeof taskCopy.en
async function request(workspace: string, board?: ProjectTaskBoard): Promise<ProjectTaskResponse> {
  const response = await fetch(`/api/project-tasks${board ? '' : `?workspace=${encodeURIComponent(workspace)}`}`, {
    ...(board ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace, board }) } : {}),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error)
  return result
}
export function ProjectTasks({ workspace, onClose }: { workspace: string; onClose: () => void }) {
  // A workspace change discards only that project's local UI and cancels stale responses.
  return <TaskPanel key={workspace} workspace={workspace} onClose={onClose} />
}
function TaskPanel({ workspace, onClose }: { workspace: string; onClose: () => void }) {
  const { locale } = useI18n(), c = taskCopy[locale]
  const [board, setBoard] = useState<ProjectTaskResponse | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState(new Set<string>())
  const [adding, setAdding] = useState<{ parentId: string | null; title: string } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const alive = useRef(true), pending = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  async function run(next?: ProjectTaskBoard) {
    if (pending.current) return false
    pending.current = true; setBusy(true); setError('')
    try { const result = await request(workspace, next); if (!alive.current) return false; setBoard(result); return true }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : c.error); return false }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  useEffect(() => {
    let cancelled = false
    pending.current = true; setBusy(true)
    void request(workspace).then(result => { if (!cancelled) setBoard(result) }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : c.error) }).finally(() => { if (!cancelled) { pending.current = false; setBusy(false) } })
    return () => { cancelled = true }
  }, [workspace, c.error])
  function start(parentId: string | null) {
    setAdding({ parentId, title: '' })
    if (parentId) setCollapsed(previous => { const next = new Set(previous); next.delete(parentId); return next })
  }
  async function add() {
    if (!board || !adding?.title.trim()) return
    const task: ProjectTask = { id: crypto.randomUUID(), title: adding.title.trim(), parentId: adding.parentId, milestoneId: null, status: 'todo', due: null, time: null, priority: null }
    if (await run({ ...board, tasks: [...board.tasks, task] })) setAdding(null)
  }
  function remove(task: ProjectTask) {
    if (!board) return
    if (deleting !== task.id) { setDeleting(task.id); return }
    // Removing a parent promotes its children, preserving their work and relative order.
    void run({ ...board, tasks: board.tasks.filter(t => t.id !== task.id).map(t => t.parentId === task.id ? { ...t, parentId: task.parentId ?? null } : t) }).then(ok => { if (ok) setDeleting(null) })
  }
  const children = new Map<string | null, ProjectTask[]>()
  for (const task of board?.tasks ?? []) { const parent = task.parentId ?? null; children.set(parent, [...(children.get(parent) ?? []), task]) }
  const rows: { task: ProjectTask; depth: number }[] = []
  const stack = [...(children.get(null) ?? [])].reverse().map(task => ({ task, depth: 0 }))
  while (stack.length) { const row = stack.pop()!; rows.push(row); if (!collapsed.has(row.task.id)) for (const task of [...(children.get(row.task.id) ?? [])].reverse()) stack.push({ task, depth: row.depth + 1 }) }
  const composer = (parentId: string | null, depth: number) => adding?.parentId === parentId && <form className="task-composer" style={{ paddingInlineStart: 8 + Math.min(depth, 8) * 18 }} onSubmit={e => { e.preventDefault(); void add() }}>
    <input aria-label={c.name} placeholder={c.name} maxLength={240} required className="task-field task-new-title" value={adding.title} disabled={busy} onChange={e => setAdding({ ...adding, title: e.target.value })} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setAdding(null) } }} />
    <button type="submit" className="task-button" disabled={busy || !adding.title.trim()}>{c.add}</button><button type="button" className="task-icon" aria-label={c.cancel} onClick={() => setAdding(null)}><Xmark width={16} height={16} /></button>
  </form>
  return <section className="project-tasks" aria-label={c.title}>
    <header className="task-header"><CheckCircle width={16} height={16} /><h2>{c.title}</h2><span className="task-project" title={workspace}>{workspace.split('/').filter(Boolean).at(-1)}</span>
      <button type="button" className="task-icon" disabled={busy} onClick={() => void run()} aria-label={c.refresh}><Refresh width={16} height={16} /></button><button type="button" className="task-icon" onClick={onClose} aria-label={c.close}><Xmark width={16} height={16} /></button>
    </header>
    {error && <div role="alert" className="task-error">{error}</div>}
    {!board && busy && <p role="status" className="task-empty">{c.loading}</p>}
    {board && <div className="task-list">
      {rows.map(({ task, depth }) => <div key={task.id}>
        <TaskRow task={task} depth={depth} copy={c} disabled={!board.canEdit || busy} hasChildren={!!children.get(task.id)?.length} collapsed={collapsed.has(task.id)} deleting={deleting === task.id} onToggle={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(task.id)) next.delete(task.id); else next.add(task.id); return next })} onAdd={() => start(task.id)} onRemove={() => remove(task)} onCancelDelete={() => setDeleting(null)} onSave={next => run({ ...board, tasks: board.tasks.map(t => t.id === task.id ? next : t) })} />
        {composer(task.id, depth + 1)}
      </div>)}
      {!board.tasks.length && !adding && <p className="task-empty">{c.empty}</p>}
      {composer(null, 0)}
      {board.canEdit && <button type="button" className="task-add" disabled={busy || !!adding} onClick={() => start(null)}><Plus width={16} height={16} />{c.task} {c.add}</button>}
    </div>}
  </section>
}
function TaskRow({ task, depth, copy: c, disabled, hasChildren, collapsed, deleting, onToggle, onAdd, onRemove, onCancelDelete, onSave }: {
  task: ProjectTask; depth: number; copy: Copy; disabled: boolean; hasChildren: boolean; collapsed: boolean; deleting: boolean
  onToggle: () => void; onAdd: () => void; onRemove: () => void; onCancelDelete: () => void; onSave: (task: ProjectTask) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(task)
  const previous = useRef(task)
  useLayoutEffect(() => {
    const before = previous.current
    if (JSON.stringify(before) !== JSON.stringify(task)) setDraft(current => ({
      ...task,
      title: current.title !== before.title ? current.title : task.title,
      due: current.due !== before.due ? current.due : task.due,
      time: current.time !== before.time ? current.time : task.time,
      priority: current.priority !== before.priority ? current.priority : task.priority,
    }))
    previous.current = task
  }, [task])
  const dirty = JSON.stringify(draft) !== JSON.stringify(task)
  async function save(next = draft) { if (next.title.trim() && JSON.stringify(next) !== JSON.stringify(task)) await onSave({ ...next, title: next.title.trim() }) }
  const label = (name: string) => `${name}: ${task.title}`
  return <div className={`task-row ${draft.status === 'done' ? 'task-done' : ''}`} style={{ paddingInlineStart: 8 + Math.min(depth, 8) * 18 }}>
    <div className="task-main">
      {hasChildren ? <button type="button" className="task-icon" aria-label={label(collapsed ? c.expand : c.collapse)} aria-expanded={!collapsed} onClick={onToggle}>{collapsed ? <NavArrowRight width={16} height={16} /> : <NavArrowDown width={16} height={16} />}</button> : <span className="task-arrow-space" />}
      <input type="checkbox" className="task-checkbox" checked={draft.status === 'done'} disabled={disabled || dirty} aria-label={label(c.done)} onChange={e => { const next: ProjectTask = { ...task, status: e.target.checked ? 'done' : 'todo' }; setDraft(next); void onSave(next).then(ok => { if (!ok) setDraft(task) }) }} />
      <input className="task-field task-title" aria-label={label(c.name)} value={draft.title} maxLength={240} disabled={disabled} onChange={e => setDraft({ ...draft, title: e.target.value })} onBlur={() => void save()} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void save() }; if (e.key === 'Escape') { e.stopPropagation(); setDraft(task) } }} />
    </div>
    <div className="task-details">
      <SelectField compact className="task-priority" label={label(c.priority)} disabled={disabled} value={draft.priority ?? ''} options={[{ value: '', label: c.none }, ...(['low', 'medium', 'high'] as const).map(value => ({ value, label: c[value] }))]} onChange={value => { const next = { ...draft, priority: (value || null) as ProjectTask['priority'] }; setDraft(next); void save(next) }} />
      <input type="date" className="task-field task-date" aria-label={label(c.due)} value={draft.due ?? ''} disabled={disabled} onChange={e => setDraft({ ...draft, due: e.target.value || null })} onBlur={() => void save()} />
      <input type="time" className="task-field task-time" aria-label={label(c.time)} value={draft.time ?? ''} disabled={disabled} onChange={e => setDraft({ ...draft, time: e.target.value || null })} onBlur={() => void save()} />
      <button type="button" className="task-icon" disabled={disabled} aria-label={label(c.child)} onClick={onAdd}><Plus width={16} height={16} /></button>
      <button type="button" className={`task-icon ${deleting ? 'task-danger' : ''}`} disabled={disabled} aria-label={label(deleting ? c.confirm : c.remove)} onClick={onRemove}><Trash width={16} height={16} /></button>
      {deleting && <button type="button" className="task-icon" aria-label={c.cancel} onClick={onCancelDelete}><Xmark width={16} height={16} /></button>}
      {dirty && <button type="button" className="task-button" disabled={disabled || !draft.title.trim()} onClick={() => void save()}>{c.save}</button>}
    </div>
  </div>
}
