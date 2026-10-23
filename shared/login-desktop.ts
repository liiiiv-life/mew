export const LOGIN_DESKTOP_WS = '/api/login-desktop/ws'
export const LOGIN_DESKTOP_LIMITS = Object.freeze({ minWidth: 320, maxWidth: 3840, minHeight: 240, maxHeight: 2160, frameBytes: 2 * 1024 * 1024, fps: 12, pasteChars: 4096 })

export type LoginDesktopInput =
  | { type: 'resize'; width: number; height: number }
  | { type: 'pointer'; x: number; y: number }
  | { type: 'button'; button: number; down: boolean; x?: number; y?: number }
  | { type: 'wheel'; deltaX: number; deltaY: number }
  | { type: 'key'; key: string; code: string; down: boolean }
  | { type: 'paste'; text: string }
  | { type: 'release' | 'close' | 'frame-ack' }

export type LoginDesktopState = { type: 'ready' | 'size'; width: number; height: number } | { type: 'error'; message: string } | { type: 'closed' }
export type LoginDesktopPage = { id: string; job: string; url: string; streamUrl: string }

export function loginDesktopSize(width: unknown, height: unknown) {
  const bounded = (value: unknown, min: number, max: number, fallback: number) => Math.max(min, Math.min(max, Math.round(Number(value) || fallback))) & ~1
  return { width: bounded(width, LOGIN_DESKTOP_LIMITS.minWidth, LOGIN_DESKTOP_LIMITS.maxWidth, 900), height: bounded(height, LOGIN_DESKTOP_LIMITS.minHeight, LOGIN_DESKTOP_LIMITS.maxHeight, 700) }
}

export function parseLoginDesktopInput(value: unknown): LoginDesktopInput {
  if (!value || typeof value !== 'object') throw new Error('invalid-input')
  const input = value as Record<string, unknown>
  const finite = (key: string) => typeof input[key] === 'number' && Number.isFinite(input[key]) && Math.abs(input[key] as number) <= 100_000
  if (input.type === 'close' || input.type === 'release' || input.type === 'frame-ack') return { type: input.type }
  if (input.type === 'resize' && finite('width') && finite('height')) return { type: 'resize', ...loginDesktopSize(input.width, input.height) }
  if (input.type === 'pointer' && finite('x') && finite('y')) return { type: 'pointer', x: input.x as number, y: input.y as number }
  if (input.type === 'button' && [0, 1, 2].includes(input.button as number) && typeof input.down === 'boolean' && (input.x === undefined || finite('x')) && (input.y === undefined || finite('y'))) return { type: 'button', button: input.button as number, down: input.down, ...(finite('x') && finite('y') ? { x: input.x as number, y: input.y as number } : {}) }
  if (input.type === 'wheel' && finite('deltaX') && finite('deltaY')) return { type: 'wheel', deltaX: input.deltaX as number, deltaY: input.deltaY as number }
  if (input.type === 'key' && typeof input.key === 'string' && input.key.length <= 64 && typeof input.code === 'string' && /^[A-Za-z0-9]{0,32}$/.test(input.code) && typeof input.down === 'boolean') return { type: 'key', key: input.key, code: input.code, down: input.down }
  if (input.type === 'paste' && typeof input.text === 'string' && input.text.length <= LOGIN_DESKTOP_LIMITS.pasteChars && !input.text.includes('\0')) return { type: 'paste', text: input.text }
  throw new Error('invalid-input')
}
