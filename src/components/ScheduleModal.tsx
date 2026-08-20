// 예약 에이전트 작업 창 — "언제 / 어느 폴더에서 / 어떤 에이전트로 / 어떤 프롬프트를" 을 GUI로 등록한다.
// 도구 줄의 시계 아이콘으로 연다. 실제 실행은 서버가 이 목록으로 crontab을 다시 써서 이뤄지고,
// 생성된 크론 줄은 각 작업의 "명령어"에서 그대로 볼 수 있다(읽기 전용).
// 크론 줄이 하는 일은 잡 전용 tmux 세션을 띄우고 에이전트를 타이핑하는 것이라, 각 줄의 터미널
// 아이콘으로 그 세션을 열어 무인 실행 화면을 그대로 볼 수 있다(명령어 버튼과 같은 창).
import { useCallback, useEffect, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { fetchProjects, fetchSchedules, runSchedule, saveSchedules, type AgentJob, type AgentJobView } from '../api/client'
import { DAY_NAMES, describeSchedule, fromCron, toCron, type Schedule } from '../utils/cron'
import { runtimeOf } from './agentRuntimes'
import { SessionTerminalPopup } from './SessionTerminalPopup'

const KIND_LABEL: Record<Schedule['kind'], string> = {
  daily: '매일',
  weekly: '요일마다',
  hourly: '매시',
  interval: 'N분마다',
  custom: '직접 입력',
}

// id는 화면에서만 쓰는 임시값 — 저장하면 서버가 진짜 id를 발급한다.
// (crypto.randomUUID는 보안 컨텍스트에서만 있어서 http로 접속하면 없다)
const newJob = (): AgentJobView => ({
  id: `new-${Math.random().toString(36).slice(2, 10)}`,
  name: '',
  cron: '0 2 * * *',
  project: '',
  agent: 'claude',
  prompt: '',
  enabled: true,
  command: '',
  lastRun: null,
  session: '', // 저장 전에는 세션 이름이 없다 — 터미널 아이콘도 그때까지 숨긴다
  running: false,
})

function lastRunLabel(iso: string | null): string {
  if (!iso) return '실행 기록 없음'
  const d = new Date(iso)
  return `마지막 실행 ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const inputClass = 'rounded border border-edge-strong bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-edge-bright'

/** 실행 주기 편집 — 형태를 고르면 그에 맞는 입력만 보여주고, 결과는 언제나 크론식 하나로 올라간다. */
function ScheduleFields({ cron, onChange }: { cron: string; onChange: (cron: string) => void }) {
  const s = fromCron(cron)
  const set = (next: Schedule) => onChange(toCron(next))

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={s.kind}
        onChange={(e) => {
          const kind = e.target.value as Schedule['kind']
          const time = s.kind === 'daily' || s.kind === 'weekly' ? s.time : '02:00'
          if (kind === 'daily') set({ kind, time })
          else if (kind === 'weekly') set({ kind, time, days: s.kind === 'weekly' ? s.days : [1] })
          else if (kind === 'hourly') set({ kind, minute: 0 })
          else if (kind === 'interval') set({ kind, minutes: 30 })
          else set({ kind: 'custom', expr: cron })
        }}
        className={inputClass}
      >
        {Object.entries(KIND_LABEL).map(([kind, label]) => (
          <option key={kind} value={kind}>
            {label}
          </option>
        ))}
      </select>

      {(s.kind === 'daily' || s.kind === 'weekly') && (
        <input type="time" value={s.time} onChange={(e) => set({ ...s, time: e.target.value })} className={inputClass} />
      )}

      {s.kind === 'weekly' &&
        DAY_NAMES.map((label, day) => (
          <button
            key={day}
            type="button"
            onClick={() => {
              const days = s.days.includes(day) ? s.days.filter((d) => d !== day) : [...s.days, day]
              set({ ...s, days: days.length > 0 ? days : [day] })
            }}
            className={`h-6 w-6 rounded text-[11px] ${s.days.includes(day) ? 'bg-accent text-ink-on-accent' : 'bg-surface text-ink-muted'}`}
          >
            {label}
          </button>
        ))}

      {s.kind === 'hourly' && (
        <label className="flex items-center gap-1 text-[11px] text-ink-muted">
          <input
            type="number"
            min={0}
            max={59}
            value={s.minute}
            onChange={(e) => set({ ...s, minute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) })}
            className={`${inputClass} w-14`}
          />
          분에
        </label>
      )}

      {s.kind === 'interval' && (
        <label className="flex items-center gap-1 text-[11px] text-ink-muted">
          <input
            type="number"
            min={1}
            max={59}
            value={s.minutes}
            onChange={(e) => set({ ...s, minutes: Math.min(59, Math.max(1, Number(e.target.value) || 1)) })}
            className={`${inputClass} w-14`}
          />
          분마다
        </label>
      )}

      {s.kind === 'custom' && (
        <input
          value={s.expr}
          onChange={(e) => set({ kind: 'custom', expr: e.target.value })}
          placeholder="분 시 일 월 요일"
          className={`${inputClass} w-40 font-mono`}
        />
      )}
    </div>
  )
}

export function ScheduleModal({ onClose }: { onClose: () => void }) {
  const [jobs, setJobs] = useState<AgentJobView[] | null>(null)
  const [runtimes, setRuntimes] = useState<{ id: string; label: string }[]>([])
  const [otherLines, setOtherLines] = useState<string[]>([])
  const [projects, setProjects] = useState<string[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [showCommand, setShowCommand] = useState<string | null>(null)
  const [session, setSession] = useState<AgentJobView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 서버가 세션 실행 여부(running)까지 계산해 주므로, 실행·종료 뒤에는 목록을 다시 받아 온다.
  // 편집 중인 내용은 아직 저장 전이라 덮이면 안 되므로 여기서는 세션 상태만 갈아 끼운다.
  const refreshSessions = useCallback(() => {
    fetchSchedules()
      .then((res) => {
        const live = new Map(res.jobs.map((j) => [j.id, j]))
        setRuntimes(res.runtimes)
        setJobs((prev) =>
          (prev ?? []).map((job) => {
            const fresh = live.get(job.id)
            return fresh ? { ...job, session: fresh.session, running: fresh.running, lastRun: fresh.lastRun } : job
          }),
        )
      })
      .catch(() => {
        /* 세션 표시 갱신 실패는 조용히 넘긴다 — 편집 중인 내용은 그대로 둔다 */
      })
  }, [])

  useEffect(() => {
    fetchSchedules()
      .then((res) => {
        setJobs(res.jobs)
        setRuntimes(res.runtimes)
        setOtherLines(res.otherLines)
      })
      .catch((err) => setError(err instanceof Error ? err.message : '불러오기 실패'))
    fetchProjects()
      .then((list) => setProjects(list.map((p) => p.name)))
      .catch(() => setProjects([]))
  }, [])

  useOverlayDismiss(onClose)

  function patch(id: string, next: Partial<AgentJob>) {
    setJobs((prev) => (prev ?? []).map((job) => (job.id === id ? { ...job, ...next } : job)))
  }

  async function save() {
    if (jobs === null || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await saveSchedules(
        jobs.map(({ id, name, cron, project, agent, prompt, enabled }) => ({ id, name, cron, project, agent, prompt, enabled })),
      )
      setJobs(res.jobs)
      setRuntimes(res.runtimes)
      setOtherLines(res.otherLines)
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setBusy(false)
    }
  }

  return (
    // 바깥을 눌렀는지는 target으로 판정한다 — 세션 팝업은 포털이지만 React 이벤트는 컴포넌트 트리를
    // 타고 올라오므로, onMouseDown={onClose}로 두면 팝업 안을 누를 때 이 창까지 닫힌다
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-surface-raised p-4 shadow-xl">
        <div className="mb-1 text-sm font-semibold text-ink">예약 작업</div>
        <div className="mb-3 text-[11px] text-ink-muted">정해진 시각에 에이전트를 열어 프롬프트를 실행한다 — 서버 계정의 crontab으로 돌아간다</div>

        {jobs === null && !error ? (
          <div className="py-6 text-center text-xs text-ink-muted">불러오는 중…</div>
        ) : (
          <div className="mb-3 flex-1 overflow-y-auto">
            {(jobs ?? []).length === 0 && <div className="py-6 text-center text-xs text-ink-muted">등록된 예약 작업이 없습니다</div>}

            {(jobs ?? []).map((job) => {
              const open = openId === job.id
              return (
                <div key={job.id} className={`mb-2 rounded bg-surface p-2 ${job.enabled ? '' : 'opacity-50'}`}>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={job.enabled}
                      onChange={(e) => patch(job.id, { enabled: e.target.checked })}
                      title={job.enabled ? '켜짐' : '꺼짐'}
                      className="accent-accent"
                    />
                    <button type="button" onClick={() => setOpenId(open ? null : job.id)} className="flex flex-1 items-baseline gap-2 text-left">
                      <span className="truncate text-xs text-ink">{job.name || '(이름 없음)'}</span>
                      <span className="truncate text-[11px] text-ink-muted">
                        {describeSchedule(job.cron)} · {runtimeLabel(job.agent, runtimes)} · {job.project || '워크스페이스 루트'}
                      </span>
                    </button>
                    <span className="hidden shrink-0 text-[10px] text-ink-faint sm:inline">{lastRunLabel(job.lastRun)}</span>
                    {job.running && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-strong" title="실행 세션 있음" />}
                    {job.session && (
                      <button
                        type="button"
                        onClick={() => setSession(job)}
                        title="이 작업의 tmux 세션 보기 (여기서 지금 실행할 수도 있다)"
                        aria-label={`${job.name || '예약 작업'} 터미널 세션`}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-surface-hover hover:text-ink"
                      >
                        <TerminalGlyph />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setJobs((prev) => (prev ?? []).filter((j) => j.id !== job.id))}
                      title="삭제"
                      className="px-1 text-[13px] text-ink-faint hover:text-danger"
                    >
                      ×
                    </button>
                  </div>

                  {open && (
                    <div className="mt-2 flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input
                          value={job.name}
                          onChange={(e) => patch(job.id, { name: e.target.value })}
                          placeholder="작업 이름"
                          className={`${inputClass} w-40`}
                        />
                        <select value={job.agent} onChange={(e) => patch(job.id, { agent: e.target.value as AgentJob['agent'] })} className={inputClass}>
                          {runtimes.map(({ id, label }) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <select value={job.project} onChange={(e) => patch(job.id, { project: e.target.value })} className={inputClass}>
                          <option value="">워크스페이스 루트</option>
                          {projects.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <ScheduleFields cron={job.cron} onChange={(cron) => patch(job.id, { cron })} />

                      <textarea
                        value={job.prompt}
                        onChange={(e) => patch(job.id, { prompt: e.target.value })}
                        rows={4}
                        placeholder="에이전트에게 시킬 일을 적는다"
                        className="w-full resize-y rounded bg-surface-raised px-2 py-1.5 text-xs text-ink outline-none placeholder:text-ink-faint"
                      />

                      <div>
                        <button
                          type="button"
                          onClick={() => setShowCommand(showCommand === job.id ? null : job.id)}
                          className="text-[11px] text-ink-muted hover:text-ink"
                        >
                          {showCommand === job.id ? '명령어 숨기기' : '명령어 보기'}
                        </button>
                        {showCommand === job.id && (
                          <pre className="mt-1 overflow-x-auto rounded bg-surface-raised p-2 font-mono text-[10px] text-ink-muted">
                            {job.command || '저장하면 생성됩니다'}
                          </pre>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            <button
              type="button"
              onClick={() => {
                const job = newJob()
                setJobs((prev) => [...(prev ?? []), job])
                setOpenId(job.id)
              }}
              className="text-[11px] text-accent hover:underline"
            >
              + 예약 작업 추가
            </button>

            {otherLines.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-[11px] text-ink-faint">직접 작성한 크론 줄 {otherLines.length}개 (여기서 수정하지 않음)</summary>
                <pre className="mt-1 overflow-x-auto rounded bg-surface p-2 font-mono text-[10px] text-ink-muted">{otherLines.join('\n')}</pre>
              </details>
            )}
          </div>
        )}

        {error && <div className="mb-2 text-xs text-danger-strong">{error}</div>}

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-sm text-ink hover:bg-surface">
            닫기
          </button>
          <button
            type="button"
            disabled={busy || jobs === null}
            onClick={save}
            className="rounded bg-accent px-3 py-1.5 text-sm text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
          >
            저장
          </button>
        </div>
      </div>

      {session && (
        <SessionTerminalPopup
          title={session.name || '(이름 없음)'}
          subtitle={`${describeSchedule(session.cron)} · ${runtimeLabel(session.agent, runtimes)} · ${session.project || '워크스페이스 루트'}`}
          session={session.session}
          running={session.running}
          onRun={() => runSchedule(session.id)}
          onClose={() => setSession(null)}
          onChanged={refreshSessions}
        />
      )}
    </div>
  )
}

function runtimeLabel(id: string, runtimes: { id: string; label: string }[]): string {
  return runtimes.find((runtime) => runtime.id === id)?.label ?? runtimeOf(id).label
}

function TerminalGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m6 9 3 3-3 3" />
      <path d="M13 15h4" />
    </svg>
  )
}
