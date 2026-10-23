export interface PortPreviewEntry { port: number; path: string }

export function portPreviewEntry(search: string): PortPreviewEntry | null {
  const query = new URLSearchParams(search), raw = query.get('preview')
  if (!raw || !/^[1-9]\d{0,4}$/.test(raw)) return null
  const port = Number(raw)
  if (port > 65535) return null
  const path = query.get('previewPath') || '/'
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || [...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null
  return { port, path }
}
