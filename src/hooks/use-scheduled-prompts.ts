import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAgentScheduledPrompts, type AgentScheduledPrompt } from '../api/client.ts'
import { readScheduledCache, writeScheduledCache } from '../utils/agent-scheduled-cache.ts'

export function useScheduledPrompts(account: string, runtime: string, tab: string, cwd: string, connected: boolean) {
  const key = JSON.stringify([account, runtime, tab, cwd])
  const scope = useMemo(() => ({ key, runtime, tab, cwd, active: false, revision: 0, confirmed: false, jobs: [] as AgentScheduledPrompt[] }), [key, runtime, tab, cwd])
  const [snapshot, setSnapshot] = useState({ key, jobs: [] as AgentScheduledPrompt[] })

  const adopt = useCallback((jobs: AgentScheduledPrompt[]) => {
    if (!scope.active) return
    scope.jobs = jobs
    setSnapshot({ key: scope.key, jobs })
  }, [scope])

  const refresh = useCallback(async () => {
    const revision = ++scope.revision
    const { jobs } = await fetchAgentScheduledPrompts({ runtime, tab, cwd })
    if (!scope.active || revision !== scope.revision) return
    scope.confirmed = true
    adopt(jobs)
    void writeScheduledCache(key, jobs)
  }, [scope, adopt, key, runtime, tab, cwd])

  useEffect(() => {
    scope.active = true
    void readScheduledCache(key).then(jobs => {
      if (jobs && scope.active && !scope.confirmed) adopt(jobs)
    })
    const sync = () => { void refresh().catch(() => {}) }
    sync()
    window.addEventListener('focus', sync)
    window.addEventListener('online', sync)
    return () => {
      scope.active = false
      scope.revision++
      window.removeEventListener('focus', sync)
      window.removeEventListener('online', sync)
    }
  }, [key, scope, adopt, refresh])

  useEffect(() => {
    if (connected) void refresh().catch(() => {})
  }, [connected, refresh])

  // A successful mutation invalidates in-flight GETs and immediately persists its result.
  const change = useCallback((update: (jobs: AgentScheduledPrompt[]) => AgentScheduledPrompt[]) => {
    if (!scope.active) return
    scope.revision++
    scope.confirmed = true
    const jobs = update(scope.jobs).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    adopt(jobs)
    void writeScheduledCache(key, jobs)
  }, [scope, key, adopt])

  const upsert = useCallback((job: AgentScheduledPrompt) => change(jobs => [...jobs.filter(item => item.id !== job.id), job]), [change])
  const remove = useCallback((id: string) => change(jobs => jobs.filter(item => item.id !== id)), [change])
  return { scheduled: snapshot.key === key ? snapshot.jobs : [], refresh, upsert, remove }
}
