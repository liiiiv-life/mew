import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { HostPaths } from '../contracts.ts'

export const powershell = () => path.win32.join(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
export const quotePowerShell = (value: string) => "'" + value.replaceAll("'", "''") + "'"
export const encodedPowerShell = (script: string) => ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); " + script, 'utf16le').toString('base64')]

export function hostPaths(env = process.env, home = os.homedir()): HostPaths {
  const root = path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'mew')
  return { config: path.win32.join(root, 'config'), data: path.win32.join(root, 'data'), cache: path.win32.join(root, 'cache'), state: path.win32.join(root, 'state') }
}

const protectedPaths = new Set<string>()
export function directoryAclScript(directory: string): string {
  return `$ErrorActionPreference='Stop'; $p=${quotePowerShell(directory)}; $item=Get-Item -LiteralPath $p -Force; if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Private directory must not be a reparse point'}; $acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true,$false); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl.SetOwner($sid); foreach($identity in @($sid,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))){ $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule) }; Set-Acl -LiteralPath $p -AclObject $acl`
}
export function protectDirectory(directory: string): void {
  const absolute = path.resolve(directory)
  fs.mkdirSync(absolute, { recursive: true })
  if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error('개인 상태 폴더에 junction 또는 심볼릭 링크를 사용할 수 없습니다.')
  if (protectedPaths.has(absolute)) return
  execFileSync(powershell(), encodedPowerShell(directoryAclScript(absolute)), { windowsHide: true, stdio: 'pipe', timeout: 15_000 })
  protectedPaths.add(absolute)
}
