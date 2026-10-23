import { appResourceUrl } from '../runtime/app-runtime.ts'
import type { AgentJob, AgentJobView, AgentScheduledPrompt, AgentSet, MewUpdateStatus } from '../api/client.ts'
import type { TmuxSession } from '../../packages/tmux-term/src/types.ts'
import type { RemoteStatus } from '../../shared/remote-access.ts'
import type { UpdatesStatus } from '../../shared/updates.ts'
import { demoAndroidStatus, demoMewUpdate, demoScheduleJobs, demoSystemStats, demoUpdates } from './host-fixtures.ts'
import { demoJson, requireMethod, stringArray, stringField, type DemoHttpHandler } from './http.ts'
import { DemoError, type DemoWorkspaceStore } from './workspace-store.ts'

export function demoHostSession(store: DemoWorkspaceStore, session: string, label: string): void {
  const sessions = store.getState<TmuxSession[]>('tmux-sessions', [{ name: 'demo-terminal', windows: 1, attached: false, createdAt: 0 }])
  if (!sessions.some(item => item.name === session)) store.setState('tmux-sessions', [...sessions, { name: session, windows: 1, attached: false, createdAt: Date.now() }])
  store.setState(`tmux-session-output:${session}`, `${label}\r\nDemo: 이 결과는 시뮬레이션입니다. 실제 명령·설치·예약·외부 연결은 실행하지 않았습니다.\r\n✓ 완료 — 변경은 현재 탭에만 유지됩니다.\r\n\r\n`)
}

/** Host operations are modeled as visitor-owned state, never delegated to the OS. */
export const handleDemoHost: DemoHttpHandler = ({ store, request, url, body }) => {
  const route = url.pathname, method = request.method
  if (route === '/api/system-stats') { requireMethod(request, 'GET'); return demoJson(demoSystemStats()) }
  if (route === '/api/android/status') { requireMethod(request, 'GET'); return demoJson(demoAndroidStatus(store.getState<TmuxSession[]>('tmux-sessions', []).map(item => item.name))) }
  if (route === '/api/android-url') { requireMethod(request, 'GET'); return demoJson({ url: appResourceUrl('/api/demo/android') }) }
  const android = route.match(/^\/api\/android\/commands\/(emulator|gateway)\/run$/)
  if (android) {
    requireMethod(request, 'POST')
    const session = `mewcmd-demo-android-${android[1]}`; demoHostSession(store, session, `Android ${android[1]} · Demo`)
    return demoJson({ ok: true, session })
  }
  if (route === '/api/schedules' || route === '/api/schedules/run') {
    let jobs = store.getState<AgentJobView[]>('host-schedules', demoScheduleJobs(store.workspaceInfo().path))
    if (route.endsWith('/run')) {
      requireMethod(request, 'POST')
      const job = jobs.find(item => item.id === stringField(body, 'id'))
      if (!job) throw new DemoError('예약 작업을 찾을 수 없습니다.', 404)
      demoHostSession(store, job.session, `${job.name}\r\n${job.prompt}`)
      job.lastRun = new Date().toISOString(); job.running = false
      store.setState('host-schedules', jobs); return demoJson({ ok: true, session: job.session })
    }
    requireMethod(request, 'GET', 'PUT')
    if (method === 'PUT') {
      if (!Array.isArray(body.jobs)) throw new DemoError('예약 작업 목록을 확인해 주세요.')
      jobs = (body.jobs as AgentJob[]).map((job, index) => {
        if (!job || typeof job.name !== 'string' || typeof job.cron !== 'string' || typeof job.prompt !== 'string') throw new DemoError('예약 작업을 확인해 주세요.')
        const id = typeof job.id === 'string' && job.id ? job.id : `demo-job-${index + 1}`
        const previous = jobs.find(item => item.id === id)
        return { ...job, id, command: `demo-agent --job ${id} (simulated)`, lastRun: previous?.lastRun ?? null, session: `mewcmd-job-${id}`, running: false }
      })
      store.setState('host-schedules', jobs)
    }
    return demoJson({ jobs, agentSets: store.getState<AgentSet[]>('agent-sets', [{ id: 'demo-default', name: 'Demo agent', runtime: 'codex', role: 'Mew 문서와 태스크 검토', modelId: 'demo-model' }]), runtimes: [{ id: 'codex', label: 'Demo agent' }], otherLines: ['# Demo: 실제 crontab이나 예약 실행은 생성하지 않습니다.'] })
  }
  if (route.startsWith('/api/agent/scheduled-prompts')) {
    let jobs = store.getState<AgentScheduledPrompt[]>('host-prompts', [])
    const scope = (job: AgentScheduledPrompt) => ['runtime', 'tab', 'cwd'].every(key => job[key as keyof AgentScheduledPrompt] === (method === 'DELETE' || method === 'GET' ? url.searchParams.get(key) : body[key]))
    const id = route.slice('/api/agent/scheduled-prompts'.length + 1)
    if (!id && method === 'GET') return demoJson({ jobs: jobs.filter(scope) })
    requireMethod(request, id ? 'PUT' : 'POST', ...(id ? ['DELETE'] : []))
    if (method === 'DELETE') { jobs = jobs.filter(job => job.id !== id || !scope(job)); store.setState('host-prompts', jobs); return demoJson({ ok: true }) }
    const previous = id ? jobs.find(job => job.id === id && scope(job)) : undefined
    if (id && !previous) throw new DemoError('예약 프롬프트를 찾을 수 없습니다.', 404)
    const sequence = store.getState('host-prompt-sequence', 0) + 1
    store.setState('host-prompt-sequence', sequence)
    const job: AgentScheduledPrompt = { id: previous?.id ?? `demo-prompt-${sequence}`, runtime: stringField(body, 'runtime'), tab: stringField(body, 'tab'), cwd: stringField(body, 'cwd'), text: stringField(body, 'text'), at: stringField(body, 'at'), createdAt: previous?.createdAt ?? new Date().toISOString() }
    store.setState('host-prompts', [...jobs.filter(item => item.id !== job.id), job]); return demoJson({ job })
  }
  if (route === '/api/mew-update/status') { requireMethod(request, 'GET'); return demoJson(store.getState('host-mew-update', demoMewUpdate)) }
  const action = route.match(/^\/api\/mew-actions\/(restart|build|update)\/run$/)
  if (action) {
    requireMethod(request, 'POST')
    const session = `mewcmd-demo-${action[1]}`; demoHostSession(store, session, `Mew ${action[1]} · Demo`)
    if (action[1] === 'update') store.setState<MewUpdateStatus>('host-mew-update', { ...demoMewUpdate, localHash: demoMewUpdate.remoteHash, behind: 0, available: false, session, job: { state: 'succeeded', startedAt: Date.now(), finishedAt: Date.now(), message: 'Demo: 실제 업데이트는 실행하지 않았습니다.' } })
    return demoJson({ ok: true, session })
  }
  if (route === '/api/updates/status' || route === '/api/updates/run') {
    const status = store.getState<UpdatesStatus>('host-updates', demoUpdates)
    requireMethod(request, route.endsWith('/run') ? 'POST' : 'GET')
    if (method === 'POST') {
      const ids = stringArray(body, 'ids')
      if (ids.some(id => !status.items.some(item => item.id === id))) throw new DemoError('업데이트 항목을 확인해 주세요.')
      status.job.items = ids.map(id => {
        const item = status.items.find(item => item.id === id)!, session = `mewcmd-${id}`
        demoHostSession(store, session, `${item.label} 업데이트 · Demo`)
        item.current = item.latest; item.available = false; item.canUpdate = false; item.session = session
        return { id, state: 'succeeded' as const, error: null, session }
      })
    }
    status.checkedAt = Date.now(); store.setState('host-updates', status); return demoJson(status)
  }
  if (route === '/api/remote-access' || route === '/api/remote-access/register' || route === '/api/remote-access/prepare-network') {
    requireMethod(request, ...(route === '/api/remote-access' ? ['GET', 'DELETE'] : ['POST']))
    let status = store.getState<RemoteStatus>('host-remote', { enabled: true, state: 'online', username: 'demo-visitor', deviceName: 'Mew Demo', network: { state: 'ready' } })
    if (method === 'DELETE') status = { enabled: false, state: 'disabled' }
    else if (method === 'POST') status = { enabled: true, state: 'online', username: 'demo-visitor', deviceName: 'Mew Demo', network: { state: 'ready' } }
    store.setState('host-remote', status)
    return demoJson({ ...status, ...(status.enabled ? { url: 'https://demo.invalid/mew' } : {}) })
  }
}
