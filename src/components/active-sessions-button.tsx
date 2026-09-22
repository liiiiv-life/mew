import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayDismiss } from '@mew/ui'
import type { ActiveMewSessions } from '../../shared/active-sessions'
import { useI18n } from '../i18n'

export function ActiveSessionsButton({ presence }: { presence: ActiveMewSessions | null }) {
  const { t, formatDate } = useI18n()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const close = useCallback(() => setOpen(false), [])
  useOverlayDismiss(open && close)
  useEffect(() => {
    if (!open) return
    closeButton.current?.focus()
    const trigger = button.current
    return () => trigger?.focus()
  }, [open])
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
  return <>
    <button ref={button} type="button" onClick={() => setOpen(true)}
      aria-label={count === undefined ? t('sessions.connecting') : t('sessions.count', { count })}
      aria-haspopup="dialog" aria-expanded={open} title={t('sessions.title')}
      className="group flex h-8 w-8 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink md:h-9 md:w-9">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-secondary text-[10px] leading-none tabular-nums text-surface group-hover:bg-ink md:h-5.5 md:w-5.5">{count ?? '—'}</span>
    </button>
    {open && createPortal(
      <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-3" onPointerDown={event => { if (event.target === event.currentTarget) close() }}>
        <section role="dialog" aria-modal="true" aria-labelledby={titleId}
          className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-edge-bright bg-surface shadow-xl"
          onKeyDown={event => { if (event.key === 'Tab') { event.preventDefault(); closeButton.current?.focus() } }}>
          <header className="flex shrink-0 items-center gap-2 border-b border-edge px-4 py-2">
            <h2 id={titleId} className="min-w-0 flex-1 text-sm font-semibold text-ink">{t('sessions.title')}{count !== undefined && <span className="ml-2 font-normal tabular-nums text-ink-secondary"> {count}</span>}</h2>
            <button ref={closeButton} type="button" onClick={close} aria-label={t('common.close')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink">
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </header>
          <div className="min-h-0 overflow-y-auto px-4 py-3">
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
          </div>
        </section>
      </div>, document.body,
    )}
  </>
}
