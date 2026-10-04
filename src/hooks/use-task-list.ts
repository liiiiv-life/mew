import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { fetchTaskList, patchTaskList } from '../api/client'
import { TaskListSession } from '../utils/task-list-session'
import { uuid } from '../utils/uuid'

export function useTaskList(workspace: string | null, email: string, open: boolean) {
  const [draftWindow] = useState(() => {
    const id = uuid()
    try {
      const existing = sessionStorage.getItem('mew:task-draft-window')
      if (existing) return existing
      sessionStorage.setItem('mew:task-draft-window', id)
    } catch { /* Drafts still remain separate in memory. */ }
    return id
  })
  const sessions = useRef(new Map<string, TaskListSession>())
  const session = useMemo(() => {
    const key = `${email}:${workspace}`
    let value = sessions.current.get(key)
    if (!value) {
      value = new TaskListSession({ read: () => fetchTaskList(workspace ?? '', email), save: changes => patchTaskList(workspace ?? '', changes, email) }, `mew:task-draft:${key}:${draftWindow}`)
      sessions.current.set(key, value)
    }
    return value
  }, [email, workspace, draftWindow])
  const state = useSyncExternalStore(session.subscribe, session.snapshot)
  useEffect(() => {
    if (!open || !workspace || !email) return
    void session.refresh()
    const timer = setInterval(() => { void session.refresh() }, 3000)
    const refresh = () => { if (!document.hidden) void session.refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [session, open, workspace, email])
  useEffect(() => {
    for (const [key, value] of sessions.current) if (!key.startsWith(`${email}:`)) { value.dispose(); sessions.current.delete(key) }
  }, [email])
  return { ...state, edit: (tasks: typeof state.tasks) => session.edit(tasks), setDraft: (text: string) => session.setDraft(text), flush: () => session.flush(), retry: () => session.retry() }
}
