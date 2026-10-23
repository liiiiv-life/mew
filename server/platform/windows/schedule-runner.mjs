import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
const options = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'))
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
process.env.MEW_DATA_DIR = options.directory
if (options.workspace) process.env.MEW_WORKSPACE = options.workspace
process.env.MEW_MULTIPLEXER = path.join(app, 'bin/psmux.exe')
process.env.MEW_WINDOWS_PROCESS_HOST = path.join(app, 'native/windows/process-host.exe')
await import('../../config.ts')
const { cronMatches } = await import('../common/cron.ts')
const { powershell, encodedPowerShell } = await import('./storage.ts')
const execute = promisify(execFile)
const file = path.join(options.directory, 'windows-schedules.cron')
if (!fs.existsSync(file)) process.exit(0)
const now = new Date(), minute = Math.floor(now.getTime() / 60000)
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const matched = /^\s*((?:\S+\s+){4}\S+)\s+(.+)$/.exec(line)
  if (!matched || line.trim().startsWith('#') || !cronMatches(matched[1], now)) continue
  const stamp = path.join(options.directory, `.schedule-${crypto.createHash('sha256').update(line).digest('hex')}-${minute}`)
  try { fs.writeFileSync(stamp, '', { flag: 'wx', mode: 0o600 }) } catch (error) { if (error.code === 'EEXIST') continue; throw error }
  // Multiplexer control creates persistent sessions outside short-lived agent jobs.
  try { await execute(powershell(), encodedPowerShell(matched[2]), { cwd: options.workspace || options.directory, windowsHide: true, timeout: 30_000 }) }
  catch { console.error('[mew] Windows 예약 작업 호출에 실패했습니다.') }
}
for (const name of fs.readdirSync(options.directory)) {
  const matched = /^\.schedule-[a-f0-9]{64}-(\d+)$/.exec(name)
  if (matched && Number(matched[1]) < minute - 1440) fs.unlinkSync(path.join(options.directory, name))
}
