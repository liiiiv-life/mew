import { scopedBrowserStorage } from '@mew/ui/browser-storage-scope'
const keyFor = (account: string, workspace: string) => `mew:device-layout:${encodeURIComponent(account)}:${encodeURIComponent(workspace)}`
const fields = ['dock', 'tabs', 'chrome'] as const
export function restoreDeviceLayout(account: string, workspace: string, fallback: Record<string, unknown>): Record<string, unknown> {
  try {
    const saved = JSON.parse(scopedBrowserStorage().getItem(keyFor(account, workspace)) ?? 'null')
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return fallback
    return { ...fallback, ...Object.fromEntries(fields.filter(field => saved[field] && typeof saved[field] === 'object').map(field => [field, saved[field]])) }
  } catch { return fallback }
}
export function saveDeviceLayout(account: string, workspace: string, state: Record<string, unknown>): void {
  try { scopedBrowserStorage().setItem(keyFor(account, workspace), JSON.stringify(Object.fromEntries(fields.filter(field => state[field] !== undefined).map(field => [field, state[field]])))) } catch { /* restricted storage */ }
}
