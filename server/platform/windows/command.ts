import { encodedPowerShell, powershell, quotePowerShell } from './storage.ts'
import { processHostPath } from './process.ts'

/** User text stays in the job record; only server-owned paths enter wrapper syntax. */
export function windowsCommand(recordFile: string, completionFile: string, drainedFile: string): { cmd: string; args: string[] } {
  const user = `$ErrorActionPreference='Continue'; $record=Get-Content -LiteralPath ${quotePowerShell(recordFile)} -Raw -Encoding UTF8 | ConvertFrom-Json; $global:LASTEXITCODE=0; $code=1; try { & ([scriptblock]::Create($record.command)); $ok=$?; $code=if($ok){0}else{1}; if($global:LASTEXITCODE -ne 0){$code=$global:LASTEXITCODE} } catch { [Console]::Error.WriteLine($_.Exception.Message) }; exit $code`
  // A user 'exit' must exit the inner shell, leaving completion/drain owned by us.
  const script = `$code=1; try { & ${[powershell(), ...encodedPowerShell(user)].map(quotePowerShell).join(' ')}; $code=$LASTEXITCODE } finally { [Console]::Out.Flush(); [Console]::Error.Flush(); [IO.File]::WriteAllText(${quotePowerShell(completionFile)}, ('{"exitCode":'+$code+'}'), (New-Object Text.UTF8Encoding($false))); while(-not (Test-Path -LiteralPath ${quotePowerShell(drainedFile)})){Start-Sleep -Milliseconds 20} }; exit $code`
  return { cmd: processHostPath(), args: ['--parent-pid', String(process.pid), powershell(), ...encodedPowerShell(script)] }
}

export function windowsAuthCommand(command: string, temporary: string, status: string): string {
  return `$mew_auth_exit=1; try { ${command}; $mew_auth_exit=$LASTEXITCODE } finally { [IO.File]::WriteAllText(${quotePowerShell(temporary)}, [string]$mew_auth_exit, (New-Object Text.UTF8Encoding($false))); Move-Item -LiteralPath ${quotePowerShell(temporary)} -Destination ${quotePowerShell(status)} -Force }`
}
