import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Electron 44's npm package does not download its binary during npm ci. */
export function installDesktopRuntime({ target, platform = process.platform, run = spawnSync, exists = existsSync, read = file => readFileSync(file, 'utf8'), log = console.log }) {
  const electron = path.join(target, 'node_modules', 'electron')
  log('[2/3] Downloading and extracting Electron. A large download may take several minutes; progress appears after 30 seconds.')
  const result = run(process.execPath, [path.join(electron, 'install.js')], { stdio: 'inherit', cwd: target, timeout: 10 * 60 * 1000 })
  if (result.error) throw new Error(`Electron download failed: ${result.error.message}. Check the network and retry installation.`)
  if (result.status !== 0) return result.status ?? 1
  log('[3/3] Checking the installed Electron executable and version...')
  const executable = platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : platform === 'win32' ? 'electron.exe' : 'electron'
  if (!exists(path.join(electron, 'dist', executable))) throw new Error('Electron executable is missing after download. Installation is incomplete; retry installation.')
  const expected = JSON.parse(read(path.join(electron, 'package.json'))).version
  if (read(path.join(electron, 'dist', 'version')).trim().replace(/^v/, '') !== expected || read(path.join(electron, 'path.txt')).trim() !== executable) throw new Error('Electron version or executable path does not match. Retry installation.')
  log('Mew remote desktop helper installed and verified. Close this terminal and reconnect.')
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = installDesktopRuntime({ target: path.dirname(fileURLToPath(import.meta.url)) }) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
