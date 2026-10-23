export type RemoteLauncherRole = 'connect' | 'app' | 'dashboard'

export const REMOTE_LAUNCHER_PAGES: Readonly<Record<RemoteLauncherRole, string>> = Object.freeze({
  connect: '/connect.html',
  app: '/app.html',
  dashboard: '/dashboard.html',
})

export function remoteLauncherRole(pathname: string): RemoteLauncherRole {
  if (pathname.startsWith('/launch/')) return 'app'
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const preview = parts.length >= 3 && /^[0-9]{1,5}$/.test(parts[2]) && Number(parts[2]) >= 1 && Number(parts[2]) <= 65535
  return parts[0] !== 'register' && (parts.length === 2 || preview) ? 'connect' : 'dashboard'
}
