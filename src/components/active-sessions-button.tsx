import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { DialogFrame } from '@mew/ui'
import { SessionHistory } from './session-history'
import type { ActiveMewSessions } from '../../shared/active-sessions'
import { useI18n } from '../i18n'

export function ActiveSessionsButton({ presence }: { presence: ActiveMewSessions | null }) {
  const { t, formatDate } = useI18n()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const [view, setView] = useState<'live' | 'history'>('live')
  const titleId = useId()
  const close = useCallback(() => setOpen(false), [])
  const groups = useMemo(() => {
    const result = new Map<string, ActiveMewSessions['sessions']>()
    for (const session of presence?.sessions ?? []) {
      const key = session.email ?? ''
      if (!result.has(key)) result.set(key, [])
      result.get(key)!.push(session)
    }
    return [...result.values()]
  }, [presence])

  const count = presence?.sessions.length
  const displayCount = String(count ?? '—')
  const monitorWidth = Math.max(24, 10 + displayCount.length * 6)
  return <>
    <button ref={button} type="button" onClick={() => setOpen(true)}
      aria-label={count === undefined ? t('sessions.connecting') : t('sessions.count', { count })}
      aria-haspopup="dialog" aria-expanded={open} title={t('sessions.title')}
      className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded px-1 text-ink-secondary hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink md:h-9 md:min-w-9">
      <span aria-hidden="true" className="relative block h-6" style={{ width: monitorWidth }}>
        <svg width={monitorWidth} height="24" viewBox={`0 0 ${monitorWidth} 24`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="2" width={monitorWidth - 2} height="16" rx="2" />
          <path d={`M${monitorWidth / 2} 18v4m-4 0h8`} />
        </svg>
        <span className="absolute inset-x-0 top-0.5 flex h-4 items-center justify-center text-[10px] font-semibold leading-none tabular-nums">{displayCount}</span>
      </span>
    </button>
    {open && <DialogFrame labelledBy={titleId} onClose={close} className={`flex max-h-[85dvh] flex-col ${view === 'history' ? 'max-w-4xl' : 'max-w-lg'}`}>
          <header className="flex shrink-0 items-center gap-2 border-b border-edge px-4 py-2">
            <h2 id={titleId} className="min-w-0 flex-1 text-sm font-semibold text-ink">{t('sessions.title')}{count !== undefined && <span className="ml-2 font-normal tabular-nums text-ink-secondary"> {count}</span>}</h2>
            <button data-dialog-autofocus type="button" onClick={close} aria-label={t('common.close')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink">
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </header>
          <div className="flex shrink-0 gap-4 border-b border-edge px-4" role="tablist" aria-label={t('sessions.title')}>
            {(['live', 'history'] as const).map(tab => <button key={tab} id={`${titleId}-${tab}-tab`} type="button" role="tab" aria-selected={view === tab} aria-controls={`${titleId}-${tab}`} tabIndex={view === tab ? 0 : -1}
              onClick={() => setView(tab)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'live' : event.key === 'End' ? 'history' : view === 'live' ? 'history' : 'live'; setView(next); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#${CSS.escape(titleId)}-${next}-tab`)?.focus() } }}
              className={`min-h-10 border-b-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-accent ${view === tab ? 'border-accent text-ink' : 'border-transparent text-ink-secondary hover:text-ink'}`}>{t(`sessions.history.${tab}`)}</button>)}
          </div>
          <div role="tabpanel" id={`${titleId}-${view}`} aria-labelledby={`${titleId}-${view}-tab`} className="flex min-h-0 flex-1 flex-col">
          {view === 'history' ? <SessionHistory /> : <div className="min-h-0 overflow-y-auto px-4 py-3">
            {!presence ? <p role="status" className="py-5 text-center text-sm text-ink-secondary">{t('sessions.connecting')}</p>
              : groups.length === 0 ? <p className="py-5 text-center text-sm text-ink-secondary">{t('sessions.empty')}</p>
                : <div className="space-y-5">{groups.map(sessions => {
                  const user = sessions[0]
                  return <section key={user.email ?? 'guest'}>
                    <div className="mb-1 flex items-baseline gap-2">
                      <h3 className="min-w-0 break-words text-sm font-medium text-ink">{user.displayName ?? t('sessions.guest')}</h3>
                      <span className="shrink-0 text-xs tabular-nums text-ink-secondary">{sessions.length}</span>
                    </div>
                    {user.email && <p className="select-text mb-2 break-all text-xs text-ink-secondary">{user.email}</p>}
                    <ul className="divide-y divide-edge">{sessions.map(session => <li key={session.id} className="py-2.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span className="font-medium text-ink-secondary">{[session.browser, session.device].filter(Boolean).join(' · ') || t('sessions.browser')}</span>
                        {session.id === presence.selfId && <span className="rounded bg-surface-raised px-1.5 py-0.5 text-ink">{t('sessions.current')}</span>}
                        {!session.visible && <span className="text-ink-secondary">{t('sessions.background')}</span>}
                        <time dateTime={new Date(session.connectedAt).toISOString()} className="ml-auto text-ink-secondary" title={formatDate(session.connectedAt, { dateStyle: 'short', timeStyle: 'short' })}>{t('sessions.since', { time: formatDate(session.connectedAt, { hour: '2-digit', minute: '2-digit' }) })}</time>
                      </div>
                      {session.workspaceLabel && <p className="mt-1 break-words text-xs text-ink-secondary">{session.workspaceLabel}{session.project === 'docs' ? ` · ${t('project.documents')}` : ''}</p>}
                      <p className={`mt-1 break-all text-xs ${session.path ? 'select-text text-ink-secondary' : 'text-ink-secondary'}`}>{session.path ?? t('sessions.noFile')}</p>
                      <p className="mt-1 text-xs tabular-nums text-ink-secondary" title={session.agents ? formatDate(session.agents.reportedAt, { timeStyle: 'medium' }) : t('sessions.agentsUnavailable')}>
                        {t('sessions.runningAgents', { count: session.agents?.running ?? '—' })}
                      </p>
                    </li>)}</ul>
                  </section>
                })}</div>}
          </div>}
          </div>
    </DialogFrame>}
  </>
}
