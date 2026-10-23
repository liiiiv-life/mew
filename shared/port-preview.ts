export const PORT_PREVIEW_PREFIX = '/__mew_port_preview'
export const PORT_PREVIEW_WS_PREFIX = '/__mew_port_preview_ws'
export const PORT_PREVIEW_API = '/api/port-preview'
export type PortPreviewSession = { port: number; token: string; url: string }
export function validPreviewPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
}
export function previewEntryPath(port: number, path = '/'): string {
  if (!validPreviewPort(port) || !path.startsWith('/') || path.startsWith('//') || /[\\\r\n]/.test(path)) throw new Error('잘못된 미리보기 주소입니다')
  return `/${port}${path}`
}
export function previewRemotePath(path: unknown, socket = false): path is string {
  if (typeof path !== 'string' || path.length > 8192 || /[\\\r\n#]/.test(path) || /%(?:00|0d|0a|2f|5c)/i.test(path.split('?')[0])) return false
  const parsed = new URL(path, 'https://mew.invalid')
  if (parsed.origin !== 'https://mew.invalid' || parsed.pathname !== path.split('?')[0]) return false
  return socket ? parsed.pathname === `${PORT_PREVIEW_API}/ws` : /^\/api\/port-preview\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\/(?:raw\/.*|cookies)$/.test(parsed.pathname)
}
