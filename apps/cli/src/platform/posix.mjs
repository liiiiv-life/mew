import os from 'node:os'
import path from 'node:path'
export function hostPaths(env = process.env, home = os.homedir()) {
  const base = (key, fallback) => env[key] && path.isAbsolute(env[key]) ? env[key] : path.join(home, fallback)
  return { config: path.join(base('XDG_CONFIG_HOME', '.config'), 'mew'), data: path.join(base('XDG_DATA_HOME', '.local/share'), 'mew'), cache: path.join(base('XDG_CACHE_HOME', '.cache'), 'mew'), state: path.join(base('XDG_STATE_HOME', '.local/state'), 'mew') }
}
export const browserCommand = platform => platform === 'darwin' ? 'open' : 'xdg-open'
