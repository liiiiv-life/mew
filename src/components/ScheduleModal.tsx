import { uiText, getUiLocale } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
// 예약 에이전트 작업 창 — "언제 / 어느 폴더에서 / 어떤 에이전트셋으로 / 어떤 프롬프트를" 을 GUI로 등록한다.
// 도구 줄의 시계 아이콘으로 연다. 실제 실행은 서버가 이 목록으로 crontab을 다시 써서 이뤄지고,
// 생성된 크론 줄은 각 작업의 "명령어"에서 그대로 볼 수 있다(읽기 전용).
// 크론 줄이 하는 일은 잡 전용 tmux 세션을 띄우고 에이전트를 타이핑하는 것이라, 각 줄의 터미널
// 아이콘으로 그 세션을 열어 무인 실행 화면을 그대로 볼 수 있다(명령어 버튼과 같은 창).
import { useCallback, useEffect, useState } from 'react'
import { SelectField, useOverlayDismiss } from '@mew/ui'
import { Xmark } from 'iconoir-react'
import { fetchProjects, fetchSchedules, runSchedule, saveSchedules, type AgentJob, type AgentJobView, type AgentSet } from '../api/client'
import { dayNames, describeSchedule, fromCron, toCron, type Schedule } from '../utils/cron'
import { runtimeOf } from './agentRuntimes'
import { SessionTerminalPopup } from './SessionTerminalPopup'

const KIND_LABEL: Record<Schedule['kind'], string> = {
  get daily() { return uiText("매일") },
  get weekly() { return uiText("요일마다") },
  get hourly() { return uiText("매시") },
  get interval() { return uiText("N분마다") },
  get custom() { return uiText("직접 입력") },
}

// id는 화면에서만 쓰는 임시값 — 저장하면 서버가 진짜 id를 발급한다.
// (crypto.randomUUID는 보안 컨텍스트에서만 있어서 http로 접속하면 없다)
const newJob = (): AgentJobView => ({
  id: `new-${Math.random().toString(36).slice(2, 10)}`,
  name: '',
  cron: '0 2 * * *',
  project: '',
  agent: '',
  prompt: '',
  enabled: true,
  command: '',
  lastRun: null,
  session: '', // 저장 전에는 세션 이름이 없다 — 터미널 아이콘도 그때까지 숨긴다
  running: false,
})

function lastRunLabel(iso: string | null): string {
  if (!iso) return uiText("실행 기록 없음")
  return uiText('마지막 실행 {time}', { time: new Intl.DateTimeFormat(getUiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) })
}

const inputClass = 'h-11 min-w-0 rounded border border-edge-strong bg-surface px-2.5 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60'
const labelClass = 'flex min-w-0 flex-col gap-1 text-xs text-ink-muted'

/** 실행 주기 편집 — 형태를 고르면 그에 맞는 입력만 보여주고, 결과는 언제나 크론식 하나로 올라간다. */
function ScheduleFields({ cron, disabled, onChange }: { cron: string; disabled: boolean; onChange: (cron: string) => void }) {
  useUiLocale()
  const [custom, setCustom] = useState(false)
  const s: Schedule = custom ? { kind: 'custom', expr: cron } : fromCron(cron)
  const set = (next: Schedule) => onChange(toCron(next))

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SelectField label={uiText("실행 주기")} disabled={disabled} className="w-32 max-w-full"
        value={s.kind}
        onChange={(value) => {
          const kind = value as Schedule['kind']
          setCustom(kind === 'custom')
          const time = s.kind === 'daily' || s.kind === 'weekly' ? s.time : '02:00'
          if (kind === 'daily') set({ kind, time })
          else if (kind === 'weekly') set({ kind, time, days: s.kind === 'weekly' ? s.days : [1] })
          else if (kind === 'hourly') set({ kind, minute: 0 })
          else if (kind === 'interval') set({ kind, minutes: 30 })
          else set({ kind: 'custom', expr: cron })
        }}
        options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))}
      />

      {(s.kind === 'daily' || s.kind === 'weekly') && (
        <input type="time" aria-label={uiText("시간")} disabled={disabled} value={s.time} onChange={(e) => set({ ...s, time: e.target.value })} className={`${inputClass} w-36`} />
      )}

      {s.kind === 'weekly' && <div className="grid w-full grid-cols-7 gap-1">
        {dayNames().map((label, day) => (
          <button
            key={day}
            disabled={disabled}
            aria-pressed={s.days.includes(day)}
            type="button"
            onClick={() => {
              const days = s.days.includes(day) ? s.days.filter((d) => d !== day) : [...s.days, day]
              set({ ...s, days: days.length > 0 ? days : [day] })
            }}
            className={`h-11 min-w-0 rounded text-sm focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60 ${s.days.includes(day) ? 'bg-accent text-ink-on-accent' : 'bg-surface text-ink-muted'}`}
          >
            {label}
          </button>
        ))}</div>}

      {s.kind === 'hourly' && (
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="number"
            disabled={disabled}
            min={0}
            max={59}
            value={s.minute}
            onChange={(e) => set({ ...s, minute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) })}
            className={`${inputClass} w-20`}
          />
          {uiText("분에")}</label>
      )}

      {s.kind === 'interval' && (
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="number"
            disabled={disabled}
            min={1}
            max={59}
            value={s.minutes}
            onChange={(e) => set({ ...s, minutes: Math.min(59, Math.max(1, Number(e.target.value) || 1)) })}
            className={`${inputClass} w-20`}
          />
          {uiText("분마다")}</label>
      )}

      {s.kind === 'custom' && (
        <input
          value={s.expr}
          disabled={disabled}
          aria-label={uiText("분 시 일 월 요일")}
          onChange={(e) => set({ kind: 'custom', expr: e.target.value })}
          placeholder={uiText("분 시 일 월 요일")}
          className={`${inputClass} w-full sm:w-56 font-mono`}
        />
      )}
    </div>
  )
}

export function ScheduleModal({ onClose }: { onClose: () => void }) {
  useUiLocale()
  const [jobs, setJobs] = useState<AgentJobView[] | null>(null)
  const [agentSets, setAgentSets] = useState<AgentSet[]>([])
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
        setAgentSets(res.agentSets)
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
        setAgentSets(res.agentSets)
        setOtherLines(res.otherLines)
      })
      .catch((err) => setError(err instanceof Error ? err.message : uiText("불러오기 실패")))
    fetchProjects()
      .then((list) => setProjects(list.map((p) => p.name)))
      .catch(() => setProjects([]))
  }, [])

  useOverlayDismiss(() => { if (!busy) onClose() })

  function patch(id: string, next: Partial<AgentJob>) {
    setJobs((prev) => (prev ?? []).map((job) => (job.id === id ? { ...job, ...next } : job)))
  }

  async function save() {
    if (jobs === null || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await saveSchedules(
        jobs.map(({ id, name, cron, project, agent, agentSet, prompt, enabled }) => ({ id, name, cron, project, agent, agentSetId: agentSet?.id, prompt, enabled })),
      )
      setJobs(res.jobs)
      setAgentSets(res.agentSets)
      setRuntimes(res.runtimes)
      setOtherLines(res.otherLines)
    } catch (err) {
      setError(err instanceof Error ? err.message : uiText("저장 실패"))
    } finally {
      setBusy(false)
    }
  }

  return (
    // 바깥을 눌렀는지는 target으로 판정한다 — 세션 팝업은 포털이지만 React 이벤트는 컴포넌트 트리를
    // 타고 올라오므로, onMouseDown={onClose}로 두면 팝업 안을 누를 때 이 창까지 닫힌다
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-2 sm:p-3"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={uiText("예약 작업")} className="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-lg bg-surface-raised p-2.5 sm:p-3 shadow-xl">
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">{uiText("예약 작업")}</h2>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label={uiText("닫기")}
            data-tip={uiText("닫기")}
            className="rounded p-1.5 text-ink-muted hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
          >
            <Xmark width={18} height={18} />
          </button>
        </div>

        {jobs === null && !error ? (
          <div className="py-6 text-center text-xs text-ink-muted">{uiText("불러오는 중…")}</div>
        ) : (
          <div className="mb-2 min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {(jobs ?? []).length === 0 && <div className="py-6 text-center text-xs text-ink-muted">{uiText("등록된 예약 작업이 없습니다")}</div>}

            {(jobs ?? []).map((job) => {
              const open = openId === job.id
              const schedule = fromCron(job.cron)
              const fixedTime = schedule.kind === 'daily' || schedule.kind === 'weekly'
              return (
                <div key={job.id} className={`mb-1.5 rounded bg-surface p-2 ${job.enabled ? '' : 'opacity-50'}`}>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      disabled={busy}
                      aria-label={job.enabled ? uiText("켜짐") : uiText("꺼짐")}
                      checked={job.enabled}
                      onChange={(e) => patch(job.id, { enabled: e.target.checked })}
                      title={job.enabled ? uiText("켜짐") : uiText("꺼짐")}
                      className="h-4 w-4 shrink-0 accent-accent"
                    />
                    <button type="button" onClick={() => setOpenId(open ? null : job.id)} aria-expanded={open} className="flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-accent">
                      <span className={`w-16 shrink-0 break-words text-ink tabular-nums sm:w-20 ${fixedTime ? 'text-xl font-semibold tracking-tight sm:text-2xl' : 'text-sm font-semibold'}`}>
                        {fixedTime ? schedule.time : describeSchedule(job.cron)}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium text-ink">{job.name || uiText("(이름 없음)")}</span>
                        <span className="break-words text-xs leading-snug text-ink-muted">
                          {fixedTime && <>{describeSchedule(job.cron).replace(schedule.time, '').trim()} · </>}
                          {job.agentSet?.name || runtimeLabel(job.agent, runtimes)} · {job.project || uiText("워크스페이스 루트")}
                        </span>
                        <span className="text-xs leading-snug text-ink-faint">{lastRunLabel(job.lastRun)}</span>
                      </span>
                    </button>
                    {job.running && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" title={uiText("실행 세션 있음")} />}
                    {job.session && (
                      <button
                        type="button"
                        onClick={() => setSession(job)}
                        title={uiText("작업 터미널 열기")}
                        aria-label={uiText("{p0} 터미널 세션", { p0: job.name || uiText("예약 작업") })}
                        className="flex h-11 w-8 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-surface-hover hover:text-ink"
                      >
                        <TerminalGlyph />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={uiText("삭제")}
                      onClick={() => setJobs((prev) => (prev ?? []).filter((j) => j.id !== job.id))}
                      title={uiText("삭제")}
                      data-tip={uiText("삭제")}
                      className="flex h-11 w-8 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-danger focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
                    >
                      <Xmark width={18} height={18} />
                    </button>
                  </div>

                  {open && (
                    <div className="mt-2 flex flex-col gap-2 border-t border-edge pt-2">
                      <label className={labelClass}>
                        {uiText("작업 이름")}
                        <input value={job.name} disabled={busy} onChange={(e) => patch(job.id, { name: e.target.value })} className={`${inputClass} w-full`} />
                      </label>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className={labelClass}>
                          <label htmlFor={`schedule-set-${job.id}`}>{uiText("에이전트셋")}</label>
                          <SelectField id={`schedule-set-${job.id}`} label={uiText("에이전트셋")} value={job.agentSet?.id ?? ''} disabled={busy || agentSets.length === 0}
                            onChange={(id) => {
                              const agentSet = agentSets.find((set) => set.id === id)
                              if (agentSet) patch(job.id, { agentSet, agent: agentSet.runtime })
                            }}
                            options={[
                              ...(!job.agentSet ? [{ value: '', label: job.agent ? runtimeLabel(job.agent, runtimes) : uiText("에이전트셋 선택"), disabled: true }] : []),
                              ...(job.agentSet && !agentSets.some((set) => set.id === job.agentSet?.id) ? [{ value: job.agentSet.id, label: job.agentSet.name }] : []),
                              ...agentSets.map((set) => ({ value: set.id, label: set.name })),
                            ]} />
                        </div>
                        <div className={labelClass}>
                          <label htmlFor={`schedule-project-${job.id}`}>{uiText("프로젝트")}</label>
                          <SelectField id={`schedule-project-${job.id}`} label={uiText("프로젝트")} value={job.project} disabled={busy}
                            onChange={(project) => patch(job.id, { project })}
                            options={[{ value: '', label: uiText("워크스페이스 루트") }, ...projects.map((value) => ({ value, label: value }))]} />
                        </div>
                      </div>
                      {agentSets.length === 0 && !job.agentSet && <p className="text-xs text-ink-muted">{uiText("에이전트 패널에서 에이전트셋을 먼저 만들어 주세요.")}</p>}
                      <div className={labelClass}>
                        <span>{uiText("실행 주기")}</span>
                        <ScheduleFields cron={job.cron} disabled={busy} onChange={(cron) => patch(job.id, { cron })} />
                      </div>
                      <label className={labelClass}>
                        {uiText("작업 내용")}
                        <textarea value={job.prompt} disabled={busy} onChange={(e) => patch(job.id, { prompt: e.target.value })} rows={4}
                          className="w-full min-w-0 resize-y rounded border border-edge-strong bg-surface px-2.5 py-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60" />
                      </label>

                      <div>
                        <button
                          type="button"
                          onClick={() => setShowCommand(showCommand === job.id ? null : job.id)}
                          className="min-h-11 text-xs text-ink-muted hover:text-ink"
                        >
                          {showCommand === job.id ? uiText("명령어 숨기기") : uiText("명령어 보기")}
                        </button>
                        {showCommand === job.id && (
                          <pre className="mt-1 overflow-x-auto rounded bg-surface-raised p-2 font-mono text-[10px] text-ink-muted">
                            {job.command || uiText("저장 후 확인 가능")}
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
              disabled={busy || jobs === null}
              onClick={() => {
                const job = newJob()
                setJobs((prev) => [...(prev ?? []), job])
                setOpenId(job.id)
              }}
              className="min-h-11 rounded px-2 text-sm text-accent hover:bg-surface-hover disabled:opacity-60"
            >
              {uiText("+ 예약 작업 추가")}</button>

            {otherLines.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-ink-faint">{uiText("기타 예약")}{otherLines.length}{uiText("개 · 읽기 전용")}</summary>
                <pre className="mt-1 overflow-x-auto rounded bg-surface p-2 font-mono text-[10px] text-ink-muted">{otherLines.join('\n')}</pre>
              </details>
            )}
          </div>
        )}

        {error && <div role="alert" className="select-text mb-2 text-xs text-danger-strong">{error}</div>}

        <div className="flex items-center justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="h-11 rounded px-4 text-sm text-ink hover:bg-surface">
            {uiText("닫기")}</button>
          <button
            type="button"
            disabled={busy || jobs === null || jobs.some((job) => !job.agentSet && !job.agent)}
            onClick={save}
            className="h-11 rounded bg-accent px-4 text-sm text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
          >
            {uiText("저장")}</button>
        </div>
      </div>

      {session && (
        <SessionTerminalPopup
          title={session.name || uiText("(이름 없음)")}
          subtitle={`${describeSchedule(session.cron)} · ${session.agentSet?.name || runtimeLabel(session.agent, runtimes)} · ${session.project || uiText("워크스페이스 루트")}`}
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
  if (!id) return uiText("에이전트셋 선택")
  return runtimes.find((runtime) => runtime.id === id)?.label ?? runtimeOf(id).label
}

function TerminalGlyph() {
  useUiLocale()
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m6 9 3 3-3 3" />
      <path d="M13 15h4" />
    </svg>
  )
}
