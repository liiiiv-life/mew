import { DEFAULT_THEME_PALETTE, normalizeThemeSettings, parseThemeSettings, type ThemeSettings } from '../../shared/theme.ts'
import { loadThemeSettings, THEME_SETTINGS_KEY } from './theme-color.ts'

const LEGACY_ACCOUNT_KEY = 'mew:themes:legacy-account'
const accountKey = (account: string) => `${THEME_SETTINGS_KEY}:${JSON.stringify(account)}`
type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>

export function loadAccountThemeCache(account: string, storage: ThemeStorage, legacyStorage: ThemeStorage = storage): ThemeSettings {
  try {
    const cached = storage.getItem(accountKey(account))
    if (cached) return parseThemeSettings(JSON.parse(cached))
    const claimed = legacyStorage.getItem(LEGACY_ACCOUNT_KEY)
    if (!claimed || claimed === account) return loadThemeSettings(legacyStorage)
  } catch { /* The server remains authoritative when local storage is unavailable. */ }
  return { palette: DEFAULT_THEME_PALETTE, custom: [] }
}

export function saveAccountThemeCache(account: string, state: ThemeSettings, storage: ThemeStorage, legacyStorage: ThemeStorage = storage) {
  try {
    storage.setItem(accountKey(account), JSON.stringify(state))
    if (!legacyStorage.getItem(LEGACY_ACCOUNT_KEY)) legacyStorage.setItem(LEGACY_ACCOUNT_KEY, account)
  } catch { /* Account synchronization also works without browser storage. */ }
}

export function createAccountThemeSync(initial: ThemeSettings, options: {
  read: () => Promise<ThemeSettings | null>
  write: (value: ThemeSettings, initialize: boolean) => Promise<ThemeSettings>
  apply: (value: ThemeSettings) => void
  onError: (error: unknown) => void
}) {
  let value = initial, version = 0, dirty = false, requested = false, running = false, disposed = false
  const apply = (next: ThemeSettings) => { value = next; options.apply(next) }
  async function run() {
    if (running || disposed) return
    running = true
    try {
      while (requested && !disposed) {
        requested = false
        const revision = version
        try {
          if (dirty) {
            const saved = await options.write(value, false)
            if (disposed) return
            if (version === revision) { dirty = false; apply(saved) }
            // Reconcile changes committed on another device while this save was in flight.
            requested = true
          } else {
            let saved = await options.read()
            if (disposed) return
            if (version !== revision) { requested = true; continue }
            if (saved === null) saved = await options.write(value, true)
            if (!disposed && version === revision && !requested) apply(saved)
          }
        } catch (error) {
          if (!disposed) options.onError(error)
          // Keep unsaved explicit changes for the next reconnect, focus or edit.
          requested = false
        }
      }
    } finally { running = false }
  }
  return {
    refresh() { requested = true; void run() },
    change(next: ThemeSettings) {
      if (disposed) return
      version++
      dirty = true
      apply(normalizeThemeSettings(next))
      requested = true
      void run()
    },
    dispose() { disposed = true },
  }
}
