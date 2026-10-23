import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { HostPaths } from '../contracts.ts'

export function hostPaths(env = process.env, home = os.homedir()): HostPaths {
  const base = (key: string, fallback: string) => env[key] && path.isAbsolute(env[key]!) ? env[key]! : path.join(home, fallback)
  return { config: path.join(base('XDG_CONFIG_HOME', '.config'), 'mew'), data: path.join(base('XDG_DATA_HOME', '.local/share'), 'mew'), cache: path.join(base('XDG_CACHE_HOME', '.cache'), 'mew'), state: path.join(base('XDG_STATE_HOME', '.local/state'), 'mew') }
}
export function protectDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.chmodSync(directory, 0o700)
}
