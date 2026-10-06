import { useCallback, useEffect, useId, useState } from 'react'
import { BellNotification, Check, WarningTriangle, Xmark } from 'iconoir-react'
import { DialogFrame } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useI18n } from '../i18n'
import { clearMewcatNotices, dismissMewcatNotice, openMewcatNotice, useMewcatNotices, useNotificationPreferences } from '../utils/mewcat-notifications'

export function HeaderNotifications() {
  const notices = useMewcatNotices(), preferences = useNotificationPreferences()
  const { t } = useI18n()
  const [open, setOpen] = useState(false), titleId = useId()
  const close = useCallback(() => setOpen(false), [])
  useEffect(() => { if (!preferences.visual || !notices.length) setOpen(false) }, [preferences.visual, notices.length])
  if (!preferences.visual || !notices.length) return null
  const ordered = [...notices].sort((a, b) => ({ danger: 2, warning: 1, success: 0 }[b.level] - { danger: 2, warning: 1, success: 0 }[a.level]) || b.id - a.id)
  return <>
    <button type="button" aria-label={`${uiText('알림')}: ${notices.length}`} data-tip={`${uiText('알림')}: ${notices.length}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}
      className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded border border-edge-strong text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent md:h-9 md:w-9">
      <BellNotification width={18} height={18} aria-hidden="true" /><span aria-hidden="true" className="absolute -right-1 -top-1 min-w-3.5 rounded-full bg-accent px-0.5 text-center text-[9px] leading-3.5 text-ink-on-accent">{notices.length}</span>
    </button>
    {open && <DialogFrame labelledBy={titleId} onClose={close} className="max-w-md max-h-[85dvh] flex flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
        <h2 id={titleId} className="min-w-0 flex-1 text-sm font-medium text-ink">{uiText('알림')}</h2>
        <button type="button" className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent" onClick={clearMewcatNotices}>{t('mewcat.clear')}</button>
        <button type="button" aria-label={t('common.close')} data-dialog-autofocus className="flex h-7 w-7 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent" onClick={close}><Xmark width={16} height={16} aria-hidden="true" /></button>
      </header>
      <ul className="min-h-0 overflow-y-auto divide-y divide-edge px-3">
        {ordered.map(notice => {
          const Icon = notice.level === 'success' ? Check : WarningTriangle
          const body = <><span className="block break-words text-xs leading-5 text-ink">{notice.kind === 'test' ? t('mewcat.testBody') : t(`mewcat.${notice.kind}`)}</span><span className="block break-words text-[11px] leading-4 text-ink-secondary">{notice.kind === 'test' ? uiText('알림') : notice.source}</span></>
          return <li key={notice.id} className="flex items-start gap-2 py-2">
            <Icon width={16} height={16} aria-hidden="true" className={`mt-0.5 shrink-0 ${notice.level === 'danger' ? 'text-danger' : notice.level === 'warning' ? 'text-warning' : 'text-success'}`} />
            {notice.target ? <button type="button" className="min-w-0 flex-1 rounded text-left hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent" onClick={() => { close(); openMewcatNotice(notice) }}>{body}</button> : <div className="min-w-0 flex-1">{body}</div>}
            <button type="button" aria-label={`${t('mewcat.dismiss')}: ${notice.source}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent" onClick={() => dismissMewcatNotice(notice.id)}><Xmark width={14} height={14} aria-hidden="true" /></button>
          </li>
        })}
      </ul>
    </DialogFrame>}
  </>
}
