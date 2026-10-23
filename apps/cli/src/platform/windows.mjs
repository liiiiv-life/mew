import os from 'node:os'
import path from 'node:path'
export function hostPaths(env = process.env, home = os.homedir()) {
  const root = path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'mew')
  return { config: path.win32.join(root, 'config'), data: path.win32.join(root, 'data'), cache: path.win32.join(root, 'cache'), state: path.win32.join(root, 'state') }
}
export function windowsEnvironment(env) {
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [key.toUpperCase(), value]))
}
export function browserArgs(url) {
  const literal = "'" + url.replaceAll("'", "''") + "'"
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(`Start-Process ${literal}`, 'utf16le').toString('base64')]
}
