param([ValidateSet('Wsl','Windows')][string]$Mode = 'Wsl', [string]$Program, [switch]$CheckOnly, [switch]$Elevated)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ports = '55000-55031'
$creator = '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}'
$ruleName = 'Mewlink-ICE-UDP-55000-55031'

function Complete-MewNetwork([string]$State, [string]$Reason, [int]$Code) {
  @{ state = $State; reason = $Reason } | ConvertTo-Json -Compress
  exit $Code
}
function Test-MewAdministrator {
  return (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Test-MewPorts($Values) {
  foreach ($value in @($Values)) {
    foreach ($part in ([string]$value).Split(',')) {
      if ($part -eq 'Any' -or $part -eq '*') { return $true }
      if ($part -match '^(\d+)(?:-(\d+))?$') {
        $start = [int]$Matches[1]; $end = $start
        if ($Matches[2]) { $end = [int]$Matches[2] }
        if ($start -le 55031 -and $end -ge 55000) { return $true }
      }
    }
  }
  return $false
}
function Test-MewUdp($Protocol) { return ([string]$Protocol -in @('UDP','17','Any','256')) }
function Test-MewAny($Values) { return ((@($Values) -join ',') -in @('','Any','*')) }
function Test-MewAllProfiles($Values) { return ((Test-MewAny $Values) -or (@($Values) -join ',') -eq '0') }
function Test-MewSystemDefault($Rule) {
  # Windows emits effective defaults in ActiveStore alongside administrator rules.
  if ([string]$Rule.PolicyStoreSourceType -notin @('5','Generated','Hardcoded')) { return $false }
  if ($Rule.Name -match '^MPSSVC_DEFAULT_RULE_INBOUND_(DOMAIN|PRIVATE|PUBLIC)_\{[0-9A-F-]{36}\}$' -and $Rule.RulePriority -eq 65335) { return $true }
  return ($Rule.Name -eq 'MPSSVC_CONSTRAINED_INTERFACE_RULE_INBOUND_BLOCK' -and $Rule.RulePriority -eq 2 -and (Test-MewAllProfiles $Rule.Profiles))
}
function Get-MewProfileState {
  $active = @(Get-NetConnectionProfile -ErrorAction Stop | ForEach-Object {
    switch ([string]$_.NetworkCategory) { 'DomainAuthenticated' { 'Domain' }; 'Private' { 'Private' }; 'Public' { 'Public' } }
  } | Sort-Object -Unique)
  if (-not $active.Count) { return @{state='unknown';reason='policy-query-failed'} }
  if ($Mode -eq 'Wsl') {
    if (-not (Get-Command Get-NetFirewallHyperVProfile -ErrorAction SilentlyContinue)) { return @{state='unknown';reason='hyperv-unavailable'} }
    $profiles = @(Get-NetFirewallHyperVProfile -PolicyStore ActiveStore -Name $creator -ErrorAction Stop | Where-Object { [string]$_.Profile -in $active })
  } else {
    $profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction Stop | Where-Object { [string]$_.Name -in $active })
  }
  if ($profiles.Count -lt $active.Count) { return @{state='unknown';reason='policy-query-failed'} }
  if (@($profiles | Where-Object { [string]$_.Enabled -ne 'False' -and ([string]$_.AllowLocalFirewallRules -eq 'False' -or [string]$_.AllowInboundRules -eq 'False') }).Count) {
    return @{state='blocked';reason='policy-blocked'}
  }
  return $null
}
function Get-MewRuleState {
  $profileState = Get-MewProfileState
  if ($profileState) { return $profileState }
  if ($Mode -eq 'Wsl') {
    if (-not (Get-Command Get-NetFirewallHyperVRule -ErrorAction SilentlyContinue) -or -not (Get-Command New-NetFirewallHyperVRule -ErrorAction SilentlyContinue)) {
      return @{ state='unknown'; reason='hyperv-unavailable' }
    }
    $rules = @(Get-NetFirewallHyperVRule -PolicyStore ActiveStore -ErrorAction Stop)
    $scoped = @($rules | Where-Object { ($_.VMCreatorId -eq $creator -or (Test-MewAny $_.VMCreatorId)) -and $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' })
    if (@($scoped | Where-Object { $_.Action -eq 'Block' -and -not (Test-MewSystemDefault $_) -and (Test-MewUdp $_.Protocol) -and (Test-MewPorts $_.LocalPorts) }).Count) { return @{ state='blocked'; reason='explicit-block' } }
    $existing = @($rules | Where-Object { $_.Name -eq $ruleName })
    if ($existing.Count) {
      $rule = $existing[0]
      if ($existing.Count -ne 1 -or $rule.VMCreatorId -ne $creator -or $rule.Enabled -ne 'True' -or $rule.Direction -ne 'Inbound' -or $rule.Action -ne 'Allow' -or [string]$rule.Protocol -notin @('UDP','17') -or (@($rule.LocalPorts) -join ',') -ne $ports -or -not (Test-MewAny $rule.LocalAddresses) -or -not (Test-MewAny $rule.RemoteAddresses) -or -not (Test-MewAny $rule.RemotePorts) -or -not (Test-MewAllProfiles $rule.Profiles)) {
        return @{ state='blocked'; reason='rule-conflict' }
      }
      return @{ state='ready'; reason='wsl-udp-rule' }
    }
    $persistent = @(Get-NetFirewallHyperVRule -PolicyStore PersistentStore -ErrorAction Stop | Where-Object { $_.Name -eq $ruleName })
    if ($persistent.Count) { return @{ state='blocked'; reason='policy-blocked' } }
    return @{ state='blocked'; reason='approval-required' }
  }
  $rules = @(Get-NetFirewallRule -PolicyStore ActiveStore -ErrorAction Stop)
  $scoped = @($rules | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' })
  foreach ($rule in $scoped) {
    if ($rule.Action -ne 'Block') { continue }
    $app = $rule | Get-NetFirewallApplicationFilter -ErrorAction Stop
    $port = $rule | Get-NetFirewallPortFilter -ErrorAction Stop
    if ($app.Program -in @($Program,'Any') -and (Test-MewUdp $port.Protocol) -and (Test-MewPorts $port.LocalPort)) { return @{ state='blocked'; reason='explicit-block' } }
  }
  $existing = @($rules | Where-Object { $_.Name -eq $ruleName })
  if ($existing.Count) {
    $rule = $existing[0]; $app = $rule | Get-NetFirewallApplicationFilter -ErrorAction Stop; $port = $rule | Get-NetFirewallPortFilter -ErrorAction Stop; $address = $rule | Get-NetFirewallAddressFilter -ErrorAction Stop
    if ($existing.Count -ne 1 -or $rule.Enabled -ne 'True' -or $rule.Direction -ne 'Inbound' -or $rule.Action -ne 'Allow' -or $app.Program -ne $Program -or [string]$port.Protocol -notin @('UDP','17') -or (@($port.LocalPort) -join ',') -ne $ports -or [string]$rule.Profile -ne 'Any' -or -not (Test-MewAny $port.RemotePort) -or -not (Test-MewAny $address.LocalAddress) -or -not (Test-MewAny $address.RemoteAddress)) {
      return @{ state='blocked'; reason='rule-conflict' }
    }
    return @{ state='ready'; reason='windows-udp-rule' }
  }
  $persistent = @(Get-NetFirewallRule -PolicyStore PersistentStore -ErrorAction Stop | Where-Object { $_.Name -eq $ruleName })
  if ($persistent.Count) { return @{ state='blocked'; reason='policy-blocked' } }
  return @{ state='blocked'; reason='approval-required' }
}

try {
  if ($Mode -eq 'Windows') {
    if (-not $Program -or $Program -notmatch '^[A-Za-z]:\\' -or -not (Test-Path -LiteralPath $Program -PathType Leaf)) { Complete-MewNetwork 'unknown' 'program-unavailable' 3 }
    $Program = [IO.Path]::GetFullPath($Program)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $suffix = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Program.ToLowerInvariant()))).Replace('-','').Substring(0,16) } finally { $hash.Dispose() }
    $ruleName = 'Mewlink-ICE-UDP-' + $suffix
  } elseif ($Program) { Complete-MewNetwork 'unknown' 'program-unavailable' 3 }
  try { $status = Get-MewRuleState } catch {
    $status = @{ state='unknown'; reason='policy-query-failed' }
  }
  if ($status.state -eq 'ready') { Complete-MewNetwork $status.state $status.reason 0 }
  if ($CheckOnly -or $status.reason -notin @('approval-required','policy-query-failed')) { Complete-MewNetwork $status.state $status.reason 2 }
  $isAdministrator = Test-MewAdministrator
  if (-not $isAdministrator) {
    if ($Elevated) { Complete-MewNetwork 'blocked' 'elevation-failed' 5 }
    $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Mode ' + $Mode + ' -Elevated'
    if ($Mode -eq 'Windows') { $arguments += ' -Program "' + $Program + '"' }
    try {
      $child = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -Verb RunAs -PassThru -Wait
      if ($child.ExitCode -ne 0) { Complete-MewNetwork 'blocked' 'elevation-failed' 5 }
      # The fixed elevated child verifies ActiveStore before returning success.
      if ($Mode -eq 'Wsl') { Complete-MewNetwork 'ready' 'wsl-udp-rule' 0 }
      Complete-MewNetwork 'ready' 'windows-udp-rule' 0
    } catch {
      if ($_.Exception.NativeErrorCode -eq 1223 -or $_.Exception.InnerException.NativeErrorCode -eq 1223) { Complete-MewNetwork 'blocked' 'approval-cancelled' 4 }
      Complete-MewNetwork 'blocked' 'elevation-failed' 5
    }
  } else {
    if ($status.reason -eq 'policy-query-failed') { Complete-MewNetwork 'unknown' 'policy-query-failed' 3 }
    if ($Mode -eq 'Wsl') {
      New-NetFirewallHyperVRule -PolicyStore PersistentStore -Name $ruleName -DisplayName 'Mewlink ICE UDP 55000-55031 (WSL)' -Direction Inbound -VMCreatorId $creator -Protocol UDP -LocalPorts $ports -LocalAddresses Any -RemoteAddresses Any -RemotePorts Any -Action Allow -Enabled True -ErrorAction Stop | Out-Null
    } else {
      New-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -DisplayName 'Mewlink ICE UDP 55000-55031' -Direction Inbound -Program $Program -Protocol UDP -LocalPort $ports -LocalAddress Any -RemoteAddress Any -RemotePort Any -Action Allow -Enabled True -Profile Any -ErrorAction Stop | Out-Null
    }
  }
  $verified = @{ state='unknown' }
  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    if ($attempt -gt 0) { Start-Sleep -Milliseconds 200 }
    try { $verified = Get-MewRuleState } catch { $verified = @{ state='unknown' } }
    if ($verified.state -eq 'ready') { break }
  }
  if ($verified.state -ne 'ready') { Complete-MewNetwork 'blocked' 'verification-failed' 6 }
  Complete-MewNetwork $verified.state $verified.reason 0
} catch { Complete-MewNetwork 'unknown' 'policy-query-failed' 3 }
