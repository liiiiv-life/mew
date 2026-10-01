param([Parameter(Mandatory=$true)][string]$Target, [switch]$Elevated)
$ErrorActionPreference = 'Stop'
$program = [IO.Path]::GetFullPath((Join-Path $Target 'runtime\node.exe'))
if (-not (Test-Path -LiteralPath $program -PathType Leaf) -or $program -notmatch '^[A-Za-z]:\\') { throw 'The installed private Windows Node is required.' }
$hash = [Security.Cryptography.SHA256]::Create()
try { $fingerprint = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($program.ToLowerInvariant()))).Replace('-', '').Substring(0,16) } finally { $hash.Dispose() }
$ruleName = 'Mew-RemoteDesktop-UDP-' + $fingerprint
try {
  $rules = @(Get-NetFirewallApplicationFilter -ErrorAction Stop | Where-Object { $_.Program -eq $program } | Get-NetFirewallRule -ErrorAction Stop | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' })
  if (@($rules | Where-Object { $_.Action -eq 'Block' }).Count) {
    Write-Warning 'An explicit Windows firewall block exists for Mew Node. It was preserved; review the blocking rule before external desktop connections.'
    exit 2
  }
  $existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
  if ($existing) {
    $app = $existing | Get-NetFirewallApplicationFilter
    $port = $existing | Get-NetFirewallPortFilter
    if ($app.Program -eq $program -and $existing.Enabled -eq 'True' -and $existing.Direction -eq 'Inbound' -and $existing.Action -eq 'Allow' -and $port.Protocol -eq 'UDP' -and $port.LocalPort -eq 'Any' -and $existing.Profile -eq 'Any') {
      Write-Output 'MEW_NETWORK_READY'; exit 0
    }
    Write-Warning 'A conflicting Mew firewall rule exists. It was preserved.'; exit 2
  }
  $admin = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) {
    if ($Elevated) { Write-Warning 'Windows did not grant administrator approval.'; exit 2 }
    Write-Output 'Preparing external desktop access. Approve the Windows UAC prompt for this app-specific UDP rule.'
    # Paths are existing Windows files; double quotes cannot occur in their names.
    $networkArguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Target "' + [IO.Path]::GetFullPath($Target) + '" -Elevated'
    try {
      $child = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $networkArguments -Verb RunAs -PassThru -Wait
      if ($child.ExitCode -ne 0) { Write-Warning 'External UDP access was not approved. Helper files are installed; network preparation is incomplete.'; exit 2 }
    } catch { Write-Warning 'Windows UAC was cancelled or blocked. Helper files are installed; external UDP access is not prepared.'; exit 2 }
    Write-Output 'MEW_NETWORK_READY'; exit 0
  }
  New-NetFirewallRule -Name $ruleName -DisplayName 'Mew Remote Desktop UDP' -Description 'Encrypted, authenticated Mew desktop direct connections; private Node executable only.' -Direction Inbound -Action Allow -Program $program -Protocol UDP -Profile Any -PolicyStore PersistentStore -ErrorAction Stop | Out-Null
  Write-Output 'MEW_NETWORK_READY'
} catch { Write-Warning 'Windows network preparation failed. Existing firewall policy was preserved.'; exit 2 }
