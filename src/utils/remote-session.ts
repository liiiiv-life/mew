import { parseRemoteFrame } from '../../shared/remote-access.ts'

export function validRemoteSession(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}

/** Session bearers stay in the trusted launcher and central parent, outside installed app code. */
export function stripRemoteSessionFrame(raw: string, onSession: (session: string) => void): string {
  const frame = parseRemoteFrame(raw)
  if (frame.type !== 'response') return raw
  const headers = { ...frame.headers }
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== 'x-mew-session') continue
    delete headers[name]
    if (value === '' || validRemoteSession(value)) onSession(value)
  }
  return JSON.stringify({ ...frame, headers })
}
