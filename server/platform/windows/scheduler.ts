import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { powershell, encodedPowerShell, quotePowerShell } from './storage.ts'
import { validCron } from '../common/cron.ts'
const execute = promisify(execFile)

export function scheduledTaskScript(directory: string, enabled: boolean): string {
  const name = `mew-${createHash('sha256').update(directory.toLowerCase()).digest('hex').slice(0, 24)}`
  if (!enabled) return `$ErrorActionPreference='Stop'; if(Get-ScheduledTask -TaskName '${name}' -ErrorAction SilentlyContinue){Unregister-ScheduledTask -TaskName '${name}' -Confirm:$false}`
  const runner = fileURLToPath(new URL('./schedule-runner.mjs', import.meta.url))
  const args = `"${runner}" ${Buffer.from(JSON.stringify({ directory, workspace: process.env.MEW_WORKSPACE })).toString('base64')}`
  return `$ErrorActionPreference='Stop'; $action=New-ScheduledTaskAction -Execute ${quotePowerShell(process.execPath)} -Argument ${quotePowerShell(args)}; $trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650); $principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited; $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; Register-ScheduledTask -TaskName '${name}' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null`
}
export async function readWindowsCrontab(directory: string): Promise<string> {
  try { return await fs.readFile(path.join(directory, 'windows-schedules.cron'), 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error }
}
export async function refreshWindowsScheduledTask(directory: string): Promise<void> {
  if (!(await readWindowsCrontab(directory)).trim()) return
  await execute(powershell(), encodedPowerShell(scheduledTaskScript(directory, true)), { windowsHide: true, timeout: 30_000 })
}
export async function writeWindowsCrontab(directory: string, text: string): Promise<void> {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const matched = /^\s*((?:\S+\s+){4}\S+)\s+(.+)$/.exec(line)
    if (!matched || !validCron(matched[1])) throw new Error('Windows 예약 작업은 유효한 5필드 크론식과 PowerShell 명령을 사용해야 합니다.')
  }
  await execute(powershell(), encodedPowerShell(scheduledTaskScript(directory, text.trim().length > 0)), { windowsHide: true, timeout: 30_000 })
  const file = path.join(directory, 'windows-schedules.cron')
  await fs.writeFile(`${file}.tmp-${process.pid}`, text, { mode: 0o600 }); await fs.rename(`${file}.tmp-${process.pid}`, file)
}
