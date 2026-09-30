import { useEffect, useRef, useState, type RefObject } from 'react'
import { useMewcatBubble } from '../hooks/use-mewcat-bubble'
import { ArrowRight, BellNotification, Check, NavArrowDown, WarningTriangle, Xmark } from 'iconoir-react'
import { useI18n } from '../i18n'
import { clearMewcatNotices, desktopNotificationPermission, dismissMewcatNotice, openMewcatNotice, playNotificationSound, publishMewcatNotice, setNotificationPreferences, unlockNotificationAudio, useMewcatNotices, useNotificationPreferences } from '../utils/mewcat-notifications'

export function MewcatNotifications({ hasCat, anchorRef }: { hasCat: boolean; anchorRef?: RefObject<HTMLDivElement | null> }) {
  const notices = useMewcatNotices()
  const preferences = useNotificationPreferences()
  const [expanded, setExpanded] = useState(false)
  const { t } = useI18n()
  // Errors and approval requests stay ahead of completions. No auto-dismiss while the user is away.
  const ordered = [...notices].sort((a, b) => ({ danger: 2, warning: 1, success: 0 }[b.level] - { danger: 2, warning: 1, success: 0 }[a.level]) || b.id - a.id)
  const notice = ordered[0]
  const bubbleRef = useMewcatBubble(anchorRef, hasCat && preferences.visual && !!notice, 300)
  if (!preferences.visual || !notice) return null
  const Icon = notice.level === 'success' ? Check : WarningTriangle
  return (
    <aside ref={bubbleRef} className={`mewcat-notifications ${hasCat ? 'mewcat-notifications-with-cat' : ''}`} aria-label={t('mewcat.title')}>
      <div className="mewcat-notifications-content">
      <div className="mewcat-notification-summary">
        <Icon width={16} height={16} className={`mt-0.5 shrink-0 ${notice.level === 'danger' ? 'text-danger' : notice.level === 'warning' ? 'text-warning' : 'text-success'}`} aria-hidden="true" />
        <div className="min-w-0 flex-1" role="status" aria-live="polite" aria-atomic="true">
          <p className="break-words text-[13px] font-medium leading-5 text-ink">{notice.kind === 'test' ? t('mewcat.testBody') : t(`mewcat.${notice.kind}`)}</p>
          <p className="mt-0.5 break-words text-xs leading-4 text-ink-secondary">{notice.kind === 'test' ? t('settings.mewcat') : notice.source}</p>
        </div>
        <button type="button" className="mewcat-notification-button shrink-0 text-ink-secondary" onClick={() => dismissMewcatNotice(notice.id)} aria-label={t('mewcat.dismiss')}><Xmark width={16} height={16} /></button>
      <div className="mewcat-notification-footer">
        {notice.target && <button type="button" className="mewcat-notification-button mewcat-notification-action" onClick={() => openMewcatNotice(notice)}><span>{notice.target === 'updates' ? t('mewcat.updateOpen') : notice.target === 'system' ? t('mewcat.system') : t('mewcat.open')}</span><ArrowRight width={13} height={13} className="shrink-0" aria-hidden="true" /></button>}
        <button type="button" className="mewcat-notification-button ml-auto gap-1.5 px-2 text-xs tabular-nums text-ink-secondary" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-label={`${expanded ? t('mewcat.less') : t('mewcat.more')} · ${t('mewcat.count')} ${notices.length}`}><BellNotification width={14} height={14} aria-hidden="true" />{notices.length}<NavArrowDown width={12} height={12} className={expanded ? 'rotate-180' : ''} aria-hidden="true" /></button>
      </div>
      </div>
      {expanded && <div className="mewcat-notification-list max-h-[min(45dvh,320px)] overflow-y-auto border-t border-edge">
        <button type="button" className="mewcat-notification-button mewcat-notification-clear w-full px-2 text-xs text-ink-secondary" onClick={clearMewcatNotices}>{t('mewcat.clear')}</button>
        {ordered.map(item => <div key={item.id} className="mewcat-notification-row mewcat-notification-row-plain">
          <button type="button" className="min-w-0 flex-1 self-stretch rounded text-left text-xs leading-[18px] text-ink hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent" onClick={() => item.target ? openMewcatNotice(item) : dismissMewcatNotice(item.id)}>
            <span className="block">{item.kind === 'test' ? t('mewcat.testBody') : t(`mewcat.${item.kind}`)}</span>
            <span className="mt-0.5 block break-words text-ink-secondary">{item.kind === 'test' ? t('settings.mewcat') : item.source}</span>
          </button>
          <button type="button" className="mewcat-notification-button shrink-0" aria-label={t('mewcat.dismiss')} onClick={() => dismissMewcatNotice(item.id)}><Xmark width={16} height={16} /></button>
        </div>)}
      </div>}
      </div>
    </aside>
  )
}

export function MewcatNotificationSettings() {
  const preferences = useNotificationPreferences()
  const { t } = useI18n()
  const [permission, setPermission] = useState(desktopNotificationPermission)
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    const refresh = () => setPermission(desktopNotificationPermission())
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('focus', refresh); clearTimeout(timer.current) }
  }, [])
  const allow = async () => {
    setError('')
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result === 'granted') setNotificationPreferences({ desktop: true })
    } catch { setError(t('mewcat.permissionError')) }
  }
  return <section className="mt-6 border-t border-edge pt-4" aria-label={t('mewcat.title')}>
    <h3 className="text-sm font-medium text-ink">{t('mewcat.title')}</h3>
    <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{t('mewcat.hint')}</p>
    <div className="mt-3 divide-y divide-edge">
      {(['visual', 'desktop', 'sound', 'resources'] as const).map(key => <label key={key} className="flex min-h-11 cursor-pointer items-center justify-between gap-4 py-2 text-sm text-ink">
        {t(`mewcat.${key}`)}
        <input type="checkbox" className="h-4 w-4 shrink-0 accent-accent" checked={preferences[key]} disabled={key === 'desktop' && permission !== 'granted'} onChange={event => {
          const enabled = event.target.checked
          setNotificationPreferences({ [key]: enabled })
          if (key === 'sound' && enabled) void unlockNotificationAudio().then(ok => {
            if (ok) { playNotificationSound('success', true); setError('') } else setError(t('mewcat.audioBlocked'))
          })
        }} />
      </label>)}
    </div>
    <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{t(`mewcat.${permission}`)}</p>
    {permission === 'default' && <button type="button" className="mt-2 min-h-9 rounded border border-edge px-3 text-xs text-ink hover:bg-surface-raised" onClick={() => { void allow() }}>{t('mewcat.enable')}</button>}
    <div className="mt-4">
      <button type="button" disabled={testing} className="min-h-9 rounded border border-edge px-3 text-xs text-ink hover:bg-surface-raised disabled:opacity-50" onClick={() => {
        setError('')
        if (preferences.sound) void unlockNotificationAudio().then(ok => { if (!ok) setError(t('mewcat.audioBlocked')) })
        setTesting(true)
        timer.current = window.setTimeout(() => {
          publishMewcatNotice({ key: `test:${Date.now()}`, kind: 'test', level: 'success', source: 'Mewcat' })
          setTesting(false)
        }, 3000)
      }}>{testing ? t('mewcat.testing') : t('mewcat.test')}</button>
      <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{t('mewcat.testHint')}</p>
      <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{t('mewcat.scope')}</p>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  </section>
}
