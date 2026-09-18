import { useEffect, useRef } from 'react'
import { fetchSystemStats } from '../api/client'
import { useI18n } from '../i18n'
import { mewcatNotificationCopy } from '../components/mewcat-notification-copy'
import { createResourceNoticeTracker } from '../utils/mewcat-notification-rules'
import { clearMewcatNotices, desktopNotificationPermission, onMewcatNotice, openMewcatNotice, playNotificationSound, publishMewcatNotice, unlockNotificationAudio, useNotificationPreferences } from '../utils/mewcat-notifications'

/** Mounted independently of the cat skin and settings dialog. */
export function useMewcatNotifications(canMonitorResources: boolean, identity: string | null) {
  const preferences = useNotificationPreferences()
  const { locale } = useI18n()
  const copy = mewcatNotificationCopy[locale]
  const current = useRef({ preferences, copy })
  current.current = { preferences, copy }

  useEffect(() => {
    clearMewcatNotices()
    const desktop = new Set<Notification>()
    const unsubscribe = onMewcatNotice(notice => {
      const { preferences, copy } = current.current
      const away = document.visibilityState === 'hidden' || !document.hasFocus()
      if (preferences.sound) playNotificationSound(notice.level)
      if (!preferences.desktop || !away || desktopNotificationPermission() !== 'granted') return
      try {
        // Never expose transcripts, tool arguments or raw errors on the lock screen.
        const notification = new Notification(`mew · ${notice.kind === 'test' ? copy.testBody : copy[notice.kind]}`, {
          tag: notice.key, silent: true,
        })
        if (desktop.size >= 30) {
          const oldest = desktop.values().next().value!
          oldest.close()
          desktop.delete(oldest)
        }
        desktop.add(notification)
        notification.onclose = () => desktop.delete(notification)
        notification.onclick = () => { window.focus(); openMewcatNotice(notice); notification.close(); desktop.delete(notification) }
      } catch { /* In-app notices remain available on unsupported platforms. */ }
    })
    return () => { unsubscribe(); desktop.forEach(notification => notification.close()) }
  }, [identity])

  useEffect(() => {
    if (!preferences.sound) return
    const unlock = () => { void unlockNotificationAudio() }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock) }
  }, [preferences.sound])

  useEffect(() => {
    if (!canMonitorResources || !preferences.resources) return
    let disposed = false
    let timer: number | undefined
    const controller = new AbortController()
    const sample = createResourceNoticeTracker()
    const poll = async () => {
      try {
        const stats = await fetchSystemStats(AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]))
        if (!disposed) sample(stats).forEach(publishMewcatNotice)
      } catch { sample(null) }
      if (!disposed) timer = window.setTimeout(poll, 15_000)
    }
    void poll()
    return () => { disposed = true; clearTimeout(timer); controller.abort() }
  }, [canMonitorResources, preferences.resources, identity])
}
