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
    const controller = new AbortController()
    const stream = async () => {
      try {
        const response = await fetch(`/api/task-list/events?workspace=${encodeURIComponent(workspace)}`, { headers: { 'X-Mew-Task-Owner': encodeURIComponent(email) }, signal: controller.signal })
        if (!response.ok || !response.body) return
        const reader = response.body.getReader(), decoder = new TextDecoder()
        let buffered = ''
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read()
          if (done) break
          buffered += decoder.decode(value, { stream: true })
          let boundary: number
          while ((boundary = buffered.indexOf('\n\n')) >= 0) {
            if (buffered.slice(0, boundary).startsWith('data:')) void session.refresh()
            buffered = buffered.slice(boundary + 2)
          }
        }
      } catch { /* Periodic refresh covers unavailable streams and reconnects. */ }
    }
    void stream()
    const timer = setInterval(() => { void session.refresh() }, 3000)
    const refresh = () => { if (!document.hidden) void session.refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [session, open, workspace, email])
  useEffect(() => {
    for (const [key, value] of sessions.current) if (!key.startsWith(`${email}:`)) { value.dispose(); sessions.current.delete(key) }
  }, [email])
  return { ...state, edit: (tasks: typeof state.tasks) => session.edit(tasks), setDraft: (text: string) => session.setDraft(text), setDraftTags: (tags: string[]) => session.setDraftTags(tags), flush: () => session.flush(), retry: () => session.retry() }
}
