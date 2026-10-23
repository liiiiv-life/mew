import { useEffect, useState, type ReactNode } from 'react'
import { fetchMemberProfiles, type MemberProfile } from '../api/client'

import { TaskAssigneeContext } from './task-assignees'

export function TaskAssigneeProvider({ children }: { children: ReactNode }) {
  const [members, setMembers] = useState<MemberProfile[]>([])
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true); setError(false)
    void fetchMemberProfiles().then(value => { if (alive) setMembers(value) }).catch(() => { if (alive) setError(true) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [attempt])
  return <TaskAssigneeContext.Provider value={{ members, loading, error, retry: () => setAttempt(value => value + 1) }}>{children}</TaskAssigneeContext.Provider>
}
