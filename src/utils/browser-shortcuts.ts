import { scopedBrowserStorage } from '@mew/ui/browser-storage-scope'
import { writeBrowserStorage } from '@mew/ui/browser-storage'

export type BrowserShortcut = { id: string; name: string; url: string }
const STORAGE_KEY = 'mew:browser-shortcuts'
const DEFAULT_SHORTCUTS: BrowserShortcut[] = [{ id: 'liiiiv-life-dev', name: 'liiiiv-life dev', url: 'http://localhost:3000/' }]

export function normalizeBrowserUrl(raw: string): string {
  const value = raw.trim()
  const local = /^(localhost|127\.[\d.]+|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value)
  const hostWithPort = /^[^/?#]+:\d+(?:[/?#]|$)/.test(value)
  const hasScheme = !hostWithPort && /^[a-z][a-z0-9+.-]*:/i.test(value)
  const url = new URL(hasScheme ? value : `${local || hostWithPort ? 'http' : 'https'}://${value}`)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('http-only')
  return url.href
}

export function readBrowserShortcuts(): BrowserShortcut[] {
  try {
    const raw = scopedBrowserStorage().getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_SHORTCUTS
    const saved: unknown = JSON.parse(raw)
    if (!Array.isArray(saved)) return DEFAULT_SHORTCUTS
    return saved.flatMap(item => {
      if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || !item.name.trim() || typeof item.url !== 'string') return []
      try { return [{ id: item.id, name: item.name, url: normalizeBrowserUrl(item.url) }] } catch { return [] }
    })
  } catch { return DEFAULT_SHORTCUTS }
}

export function writeBrowserShortcuts(shortcuts: BrowserShortcut[]): boolean {
  return writeBrowserStorage(STORAGE_KEY, JSON.stringify(shortcuts))
}
