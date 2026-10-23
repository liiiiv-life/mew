import { PORT_PREVIEW_API, previewEntryPath, validPreviewPort } from '../../shared/port-preview.ts'
import { isRemoteMode, mewFetch } from './remote-transport.ts'

export type BranchPreviewContext = { remote: boolean; publicUrl?: string }

function safePath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//') || path.length > 8192 || path.includes('\\') || [...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false
  const pathname = path.split(/[?#]/, 1)[0]
  if (/%(?:00|0a|0d|2f|5c)/i.test(pathname)) return false
  try { return pathname.split('/').every(part => !['.', '..'].includes(decodeURIComponent(part))) }
  catch { return false }
}

/** Public entry URLs keep previews behind Mew's login and isolated app proxy. */
export function branchPreviewUrl(port: number, path = '/', context: BranchPreviewContext = { remote: isRemoteMode() }): string | null {
  if (!validPreviewPort(port) || !safePath(path)) return null
  const entry = previewEntryPath(port, path)
  if (!context.remote) return entry
  if (!context.publicUrl) return null
  try {
    const base = new URL(context.publicUrl)
    const prefix = base.pathname.replace(/\/$/, '')
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !/^\/[^/]+\/[^/]+$/.test(prefix) || !safePath(prefix)) return null
    return `${base.origin}${prefix}${entry}`
  } catch { return null }
}

/** Embedded Mewlink frames have a private app origin, so ask the host for its public device address. */
export async function loadBranchPreviewBase(): Promise<BranchPreviewContext> {
  if (!isRemoteMode()) return { remote: false }
  try {
    const response = await mewFetch(`${PORT_PREVIEW_API}/access-url`)
    if (!response.ok) return { remote: true }
    const value = await response.json() as { url?: unknown }
    return typeof value.url === 'string' ? { remote: true, publicUrl: value.url } : { remote: true }
  } catch { return { remote: true } }
}
