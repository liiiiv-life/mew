import { useEffect, useState } from 'react'
import { advanceBreak, breakSignature, restoreBreakProgress, type BreakProgress } from '../utils/mewcat-break-rules'
import { BREAK_PROGRESS_KEY, useBreakPreferences } from '../utils/mewcat-break-preferences'

export function useMewcatBreak() {
  const preferences = useBreakPreferences()
  const [remainingMs, setRemainingMs] = useState<number | null>(null)
  useEffect(() => {
    let raw: string | null = null
    try { raw = sessionStorage.getItem(BREAK_PROGRESS_KEY) } catch { /* memory-only progress */ }
    let lastAt = Date.now()
    let progress: BreakProgress = restoreBreakProgress(raw, preferences, lastAt)
    const active = () => document.visibilityState === 'visible' && document.hasFocus()
    let wasActive = active()
    const persist = () => {
      try {
        if (preferences.enabled) sessionStorage.setItem(BREAK_PROGRESS_KEY, JSON.stringify({ ...progress, signature: breakSignature(preferences) }))
        else sessionStorage.removeItem(BREAK_PROGRESS_KEY)
      } catch { /* the timer must work even with unavailable storage */ }
    }
    const sync = () => {
      const now = Date.now()
      progress = advanceBreak(progress, preferences, now, now - lastAt, wasActive)
      lastAt = now
      wasActive = active()
      persist()
      setRemainingMs(progress.restUntil === null ? null : Math.max(0, progress.restUntil - now))
    }
    sync()
    if (!preferences.enabled) return
    const timer = window.setInterval(sync, 1000)
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)
    window.addEventListener('pagehide', sync)
    window.addEventListener('pageshow', sync)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener('blur', sync)
      window.removeEventListener('pagehide', sync)
      window.removeEventListener('pageshow', sync)
      // Account/project UI changes must not throw away the last fraction of foreground time.
      progress = advanceBreak(progress, preferences, Date.now(), Date.now() - lastAt, wasActive)
      persist()
    }
  }, [preferences])
  return remainingMs
}
