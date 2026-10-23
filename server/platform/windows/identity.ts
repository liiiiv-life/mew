import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { powershell, encodedPowerShell } from './storage.ts'
const execute = promisify(execFile)
export async function processCommandLine(pid: number): Promise<string> {
  if (!Number.isSafeInteger(pid) || pid < 1) return ''
  try {
    const { stdout } = await execute(powershell(), encodedPowerShell(`(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`), { windowsHide: true, timeout: 5000, maxBuffer: 32768 })
    return stdout.trim()
  } catch { return '' }
}

export async function userProcessCommands(): Promise<string> {
  const script = `$ErrorActionPreference='Stop'; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; Get-CimInstance Win32_Process | ForEach-Object { if($_.CommandLine){ $owner=Invoke-CimMethod -InputObject $_ -MethodName GetOwnerSid -ErrorAction SilentlyContinue; if($owner.Sid -eq $sid){ $_.CommandLine } } }`
  return (await execute(powershell(), encodedPowerShell(script), { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 })).stdout
}
