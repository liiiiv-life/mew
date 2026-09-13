import fs from 'node:fs/promises'
import path from 'node:path'
import type { TmuxManager } from '../packages/tmux-term/src/server/tmux.ts'
import { DATA_DIR } from './dataDir.ts'
import { spawnSpecCommand } from './spawnSpecCommand.ts'
import { desktopPlatform } from './remote-desktop-host.ts'

export const DESKTOP_INSTALL_SESSION = 'mewcmd-desktop-install'
const APP_ROOT = path.resolve(import.meta.dirname, '..')

/** A fixed, server-owned installer. No command, cwd or session comes from HTTP input. */
export function createDesktopInstaller(tmux: Pick<TmuxManager, 'list' | 'startCommand' | 'kill'>, {
  directory = path.join(DATA_DIR, 'desktop-install'), appRoot = APP_ROOT,
  platform = desktopPlatform(), env = process.env,
} = {}) {
  const statusFile = path.join(directory, 'exit-code')
  const startedFile = path.join(directory, 'started')
  let starting: Promise<Awaited<ReturnType<typeof status>>> | null = null

  async function status() {
    const terminal = (await tmux.list()).some(item => item.name === DESKTOP_INSTALL_SESSION)
    const read = async (file: string) => fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
    const [raw, started] = await Promise.all([read(statusFile), read(startedFile)])
    const exitCode = raw !== null && /^\d{1,3}\s*$/.test(raw) ? Number(raw) : null
    const state = raw !== null ? (exitCode === 0 ? 'succeeded' : 'failed') : terminal ? 'running' : started ? 'interrupted' : 'idle'
    return { session: DESKTOP_INSTALL_SESSION, terminal, state, exitCode }
  }

  async function launch() {
    if (!platform || platform === 'windows') throw new Error('이 서버에서는 내부 tmux 설치를 사용할 수 없습니다.')
    const previous = await status()
    if (previous.state === 'running') return previous
    // Retry only a completed job. A clean shell avoids typing into a program opened in the old terminal.
    if (previous.terminal) await tmux.kill(DESKTOP_INSTALL_SESSION)
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    await fs.chmod(directory, 0o700)
    await fs.rm(statusFile, { force: true })
    await fs.writeFile(startedFile, 'started\n', { mode: 0o600 })
    const installer = spawnSpecCommand({ cmd: process.execPath, args: [path.join(appRoot, 'native/remote-desktop/install.mjs')] })
    // POSIX shell regardless of the user's interactive shell. EXIT also records Ctrl-C/HUP.
    const script = `trap 'mew_desktop_exit=$?; umask 077; printf "%s\\n" "$mew_desktop_exit" > "$1.tmp" && mv -f "$1.tmp" "$1"' EXIT; trap 'exit 130' INT; trap 'exit 129' HUP; ${installer}`
    const forwarded = { WSL_INTEROP: env.WSL_INTEROP, MEW_DESKTOP_HELPER_DIR: env.MEW_DESKTOP_HELPER_DIR, PATH: `${path.dirname(process.execPath)}:${env.PATH ?? '/usr/bin:/bin'}` }
    // env's -u options must precede assignments.
    const command = spawnSpecCommand({ cmd: '/bin/sh', args: ['-c', script, 'desktop-install', statusFile], env: Object.fromEntries(Object.entries(forwarded).sort((a, b) => Number(a[1] !== undefined) - Number(b[1] !== undefined))) })
    // Keep the output after completion, without starting the job through shell profile/send-keys races.
    try { await tmux.startCommand(DESKTOP_INSTALL_SESSION, `${command}; exec /bin/sh -i`, appRoot) }
    catch (error) { await fs.writeFile(statusFile, '125\n', { mode: 0o600 }); throw error }
    return status()
  }

  return {
    status,
    start() {
      if (!starting) starting = launch().finally(() => { starting = null })
      return starting
    },
  }
}
