import { uiText } from '@mew/ui/i18n-core'
import { useEffect, useRef, useState } from 'react'
import { Toast } from '@mew/ui'
import { useI18n } from '../i18n'
import { desktopNotificationPermission, playNotificationSound, publishMewcatNotice, setNotificationPreferences, unlockNotificationAudio, useMewcatNotices, useNotificationPreferences } from '../utils/mewcat-notifications'

export function MewcatNotifications({ hasCat }: { hasCat: boolean }) {
  const notices = useMewcatNotices()
  const preferences = useNotificationPreferences()
  const { t } = useI18n()
  const [currentId, setCurrentId] = useState<number | null>(null)
  const lastSeen = useRef(0)
  const enabled = hasCat && preferences.visual && preferences.mewcat
  useEffect(() => {
    const latest = notices.at(-1)
    if (latest && latest.id > lastSeen.current) {
      lastSeen.current = latest.id
      setCurrentId(enabled ? latest.id : null)
    }
    if (!enabled) setCurrentId(null)
  }, [notices, enabled])
  const notice = notices.find(item => item.id === currentId)
  if (!enabled || !notice) return null
  const message = notice.kind === 'test' ? t('mewcat.testBody') : `${t(`mewcat.${notice.kind}`)} · ${notice.source}`
  return <Toast key={notice.id} message={message} onDone={() => setCurrentId(null)} />
}

export function MewcatNotificationSettings({ hasCat = false }: { hasCat?: boolean }) {
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
  return <section aria-label={uiText('알림')}>
    <div className="divide-y divide-edge">
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 py-2 text-sm text-ink">
        <span className="min-w-0">
          <span className="flex items-center gap-2"><span className="size-1.5 shrink-0 rounded-full bg-orange-500" aria-hidden="true" />{t('mewcat.autoOpenApproval')}</span>
          <span className="mt-1 block text-xs leading-relaxed text-ink-secondary">{t('mewcat.autoOpenApprovalHint')}</span>
        </span>
        <input type="checkbox" className="h-4 w-4 shrink-0 accent-accent" aria-label={t('mewcat.autoOpenApproval')} checked={preferences.autoOpenApproval} onChange={event => setNotificationPreferences({ autoOpenApproval: event.target.checked })} />
      </label>
      {(['visual', 'desktop', 'sound', 'resources'] as const).map(key => <label key={key} className="flex min-h-11 cursor-pointer items-center justify-between gap-4 py-2 text-sm text-ink">
        {key === 'visual' ? uiText('앱 내 알림') : t(`mewcat.${key}`)}
        <input type="checkbox" className="h-4 w-4 shrink-0 accent-accent" checked={preferences[key]} disabled={key === 'desktop' && permission !== 'granted'} onChange={event => {
          const enabled = event.target.checked
          setNotificationPreferences({ [key]: enabled })
          if (key === 'sound' && enabled) void unlockNotificationAudio().then(ok => {
            if (ok) { playNotificationSound('success', true); setError('') } else setError(t('mewcat.audioBlocked'))
          })
        }} />
      </label>)}
    </div>
    {hasCat && <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 border-t border-edge py-2 text-sm text-ink">
      {t('mewcat.visual')}<input type="checkbox" className="h-4 w-4 shrink-0 accent-accent" checked={preferences.mewcat} onChange={event => setNotificationPreferences({ mewcat: event.target.checked })} />
    </label>}
    <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{t(`mewcat.${permission}`)}</p>
    {permission === 'default' && <button type="button" className="mt-2 min-h-9 rounded border border-edge px-3 text-xs text-ink hover:bg-surface-raised" onClick={() => { void allow() }}>{t('mewcat.enable')}</button>}
    <div className="mt-4">
      <button type="button" disabled={testing} className="min-h-9 rounded border border-edge px-3 text-xs text-ink hover:bg-surface-raised disabled:opacity-50" onClick={() => {
        setError('')
        if (preferences.sound) void unlockNotificationAudio().then(ok => { if (!ok) setError(t('mewcat.audioBlocked')) })
        setTesting(true)
        timer.current = window.setTimeout(() => {
          publishMewcatNotice({ key: `test:${Date.now()}`, kind: 'test', level: 'success', source: 'Mewpet' })
          setTesting(false)
        }, 3000)
      }}>{testing ? t('mewcat.testing') : t('mewcat.test')}</button>
      <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{t('mewcat.testHint')}</p>
      <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{t('mewcat.scope')}</p>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  </section>
}
