import { useCallback, useEffect, useRef, useState } from 'react'
import { globalBrowserStorage, scopedBrowserStorage } from '@mew/ui/browser-storage-scope'
import { fetchAccountTheme, saveAccountTheme } from '../api/theme.ts'
import { applyThemePalette, loadThemeSettings, saveThemeSettings, type ThemeSettings } from '../utils/theme-color.ts'
import { createAccountThemeSync, loadAccountThemeCache, saveAccountThemeCache } from '../utils/account-theme.ts'

const unavailableStorage = { getItem: () => null, setItem: () => {} }
function themeStores() {
  try { return { storage: scopedBrowserStorage(), legacyStorage: globalBrowserStorage() } }
  catch { return { storage: unavailableStorage, legacyStorage: unavailableStorage } }
}

export function useAccountTheme(account: string | null, onError: (error: unknown) => void) {
  const [settings, setSettings] = useState(() => {
    const { storage, legacyStorage } = themeStores()
    return account ? loadAccountThemeCache(account, storage, legacyStorage) : loadThemeSettings(legacyStorage)
  })
  const sync = useRef<ReturnType<typeof createAccountThemeSync> | null>(null)
  const errorHandler = useRef(onError)
  errorHandler.current = onError
  useEffect(() => {
    const { storage, legacyStorage } = themeStores()
    const initial = account ? loadAccountThemeCache(account, storage, legacyStorage) : loadThemeSettings(legacyStorage)
    const apply = (value: ThemeSettings) => {
      applyThemePalette(value.palette)
      saveThemeSettings(value, legacyStorage)
      if (account) saveAccountThemeCache(account, value, storage, legacyStorage)
      setSettings(value)
    }
    apply(initial)
    if (!account) return
    const controller = createAccountThemeSync(initial, { read: fetchAccountTheme, write: saveAccountTheme, apply, onError: error => errorHandler.current(error) })
    sync.current = controller
    const refresh = () => controller.refresh()
    const onVisibility = () => { if (document.visibilityState !== 'hidden') refresh() }
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) refresh() }
    window.addEventListener('mew:theme-changed', refresh)
    window.addEventListener('mew:permissions-changed', refresh)
    window.addEventListener('online', refresh)
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', onVisibility)
    refresh()
    return () => {
      controller.dispose()
      sync.current = null
      window.removeEventListener('mew:theme-changed', refresh)
      window.removeEventListener('mew:permissions-changed', refresh)
      window.removeEventListener('online', refresh)
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [account])
  const change = useCallback((next: ThemeSettings) => sync.current?.change(next), [])
  return [settings, change] as const
}
