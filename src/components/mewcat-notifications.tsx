import { useEffect, useRef, useState } from 'react'
import { BellNotification, Check, WarningTriangle, Xmark } from 'iconoir-react'
import { useI18n } from '../i18n'
import { mewcatNotificationCopy } from './mewcat-notification-copy'
import { clearMewcatNotices, desktopNotificationPermission, dismissMewcatNotice, openMewcatNotice, playNotificationSound, publishMewcatNotice, setNotificationPreferences, unlockNotificationAudio, useMewcatNotices, useNotificationPreferences } from '../utils/mewcat-notifications'

export function MewcatNotifications({ hasCat }: { hasCat: boolean }) {
  const notices = useMewcatNotices()
  const preferences = useNotificationPreferences()
  const [expanded, setExpanded] = useState(false)
  const { locale } = useI18n()
  const copy = mewcatNotificationCopy[locale]
  // Errors and approval requests stay ahead of completions. No auto-dismiss while the user is away.
  const ordered = [...notices].sort((a, b) => ({ danger: 2, warning: 1, success: 0 }[b.level] - { danger: 2, warning: 1, success: 0 }[a.level]) || b.id - a.id)
  const notice = ordered[0]
  if (!preferences.visual || !notice) return null
  const Icon = notice.level === 'success' ? Check : WarningTriangle
  return (
    <aside className={`mewcat-notifications ${hasCat ? 'mewcat-notifications-with-cat' : ''}`} aria-label={copy.title}>
      <div className="mewcat-notifications-content">
      <div className="flex items-start gap-2 p-3">
        <Icon width={18} height={18} className={`mt-0.5 shrink-0 ${notice.level === 'danger' ? 'text-danger' : notice.level === 'warning' ? 'text-warning' : 'text-success'}`} aria-hidden="true" />
        <div className="min-w-0 flex-1" role="status" aria-live="polite" aria-atomic="true">
          <p className="text-sm font-medium text-ink">{notice.kind === 'test' ? copy.testBody : copy[notice.kind]}</p>
          <p className="mt-1 break-words text-xs text-ink-secondary">{notice.source}</p>
        </div>
        <button type="button" className="mewcat-notification-button shrink-0" onClick={() => dismissMewcatNotice(notice.id)} aria-label={copy.dismiss}><Xmark width={18} height={18} /></button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-2">
        {notice.target && <button type="button" className="mewcat-notification-button px-2 text-xs text-accent" onClick={() => openMewcatNotice(notice)}>{notice.target === 'system' ? copy.system : copy.open}</button>}
        <button type="button" className="mewcat-notification-button gap-1.5 px-2 text-xs text-ink-secondary" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-label={`${expanded ? copy.less : copy.more} · ${copy.count} ${notices.length}`}><BellNotification width={14} height={14} />{notices.length}</button>
      </div>
      {expanded && <div className="max-h-[min(45dvh,320px)] overflow-y-auto border-t border-edge p-2">
        <button type="button" className="mewcat-notification-button mb-1 w-full px-2 text-xs text-ink-secondary" onClick={clearMewcatNotices}>{copy.clear}</button>
        {ordered.map(item => <div key={item.id} className="flex items-center gap-1 border-t border-edge py-1">
          <button type="button" className="min-w-0 flex-1 rounded px-2 py-2 text-left text-xs text-ink hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent" onClick={() => item.target ? openMewcatNotice(item) : dismissMewcatNotice(item.id)}>
            <span className="block">{item.kind === 'test' ? copy.testBody : copy[item.kind]}</span>
            <span className="mt-1 block break-words text-ink-secondary">{item.source}</span>
          </button>
          <button type="button" className="mewcat-notification-button shrink-0" aria-label={copy.dismiss} onClick={() => dismissMewcatNotice(item.id)}><Xmark width={16} height={16} /></button>
        </div>)}
      </div>}
      </div>
    </aside>
  )
}

export function MewcatNotificationSettings() {
  const preferences = useNotificationPreferences()
  const { locale } = useI18n()
  const copy = mewcatNotificationCopy[locale]
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
    } catch { setError(copy.permissionError) }
  }
  return <section className="mt-6 border-t border-edge pt-4" aria-label={copy.title}>
    <h3 className="text-sm font-medium text-ink">{copy.title}</h3>
    <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{copy.hint}</p>
    <div className="mt-3 divide-y divide-edge">
      {(['visual', 'desktop', 'sound', 'resources'] as const).map(key => <label key={key} className="flex min-h-11 cursor-pointer items-center justify-between gap-4 py-2 text-sm text-ink">
        {copy[key]}
        <input type="checkbox" className="h-4 w-4 shrink-0 accent-accent" checked={preferences[key]} disabled={key === 'desktop' && permission !== 'granted'} onChange={event => {
          const enabled = event.target.checked
          setNotificationPreferences({ [key]: enabled })
          if (key === 'sound' && enabled) void unlockNotificationAudio().then(ok => {
            if (ok) { playNotificationSound('success', true); setError('') } else setError(copy.audioBlocked)
          })
        }} />
      </label>)}
    </div>
    <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{copy[permission]}</p>
    {permission === 'default' && <button type="button" className="mt-2 min-h-9 rounded border border-edge px-3 text-xs text-ink hover:bg-surface-raised" onClick={() => { void allow() }}>{copy.enable}</button>}
    <div className="mt-4">
      <button type="button" disabled={testing} className="min-h-9 rounded border border-edge px-3 text-xs text-ink hover:bg-surface-raised disabled:opacity-50" onClick={() => {
        setError('')
        if (preferences.sound) void unlockNotificationAudio().then(ok => { if (!ok) setError(copy.audioBlocked) })
        setTesting(true)
        timer.current = window.setTimeout(() => {
          publishMewcatNotice({ key: `test:${Date.now()}`, kind: 'test', level: 'success', source: 'Mewcat' })
          setTesting(false)
        }, 3000)
      }}>{testing ? copy.testing : copy.test}</button>
      <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{copy.testHint}</p>
      <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{copy.scope}</p>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  </section>
}
