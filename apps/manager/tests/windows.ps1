$ErrorActionPreference = 'Stop'
$source = Get-Content (Join-Path $PSScriptRoot '../src-tauri/scripts/windows.ps1') -Raw
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$ManagerInput = @{ action = 'inspect'; settings = @{ distro = 'Mew'; installPath = '/home/mew/My apps/mew' }; scripts = @{} }
$settings = $ManagerInput.settings
$base = [IO.Path]::GetTempPath()
$installRoot = Join-Path $base 'distros/Mew'
$body = ($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Extent.Text }) -join "`n"
Invoke-Expression $body
function AssertEqual($Actual, $Expected, $Message) { if ($Actual -cne $Expected) { throw "$Message : [$Actual] != [$Expected]" } }
AssertEqual (QuoteNative '') '""' 'Empty argument'
AssertEqual (QuoteNative 'simple') 'simple' 'Simple argument'
AssertEqual (QuoteNative 'a b') '"a b"' 'Spaces'
AssertEqual (QuoteNative 'a"b') '"a\"b"' 'Embedded quotes'
AssertEqual (QuoteNative 'C:\My apps\') '"C:\My apps\\"' 'Trailing slash'
AssertEqual (QuoteNative 'echo "hello"; printf "\n"') '"echo \"hello\"; printf \"\n\""' 'Bash quotes survive'
$script:registered = @(@{ name = 'Mew'; version = 2; basePath = ('\\?\' + $installRoot) })
function Registrations { return ,$script:registered }
function Get-CimInstance($ClassName) {
 switch ($ClassName) {
  'Win32_OperatingSystem' { return [pscustomobject]@{ BuildNumber = 26100; Caption = 'Test Windows'; LastBootUpTime = [datetime]'2026-10-07T00:00:00Z' } }
  'Win32_ComputerSystem' { return [pscustomobject]@{ HypervisorPresent = $true } }
  'Win32_Processor' { return [pscustomobject]@{ VirtualizationFirmwareEnabled = $true; Architecture = 9 } }
 }
}
function WslText($Arguments) { return @{ code = 0; text = $(if ($Arguments -contains '--running') { 'Mew' } else { 'WSL test' }) } }
$journalPath = Join-Path ([IO.Path]::GetTempPath()) ('mew-manager-test-' + [guid]::NewGuid() + '.json')
try {
 AssertEqual (NativeInfo).managed $true 'Managed path tolerates extended prefix'
 $script:registered[0].basePath = 'C:\somebody-else'
 AssertEqual (NativeInfo).managed $false 'Foreign distribution is rejected'
 SaveJournal $true 'reboot'
 AssertEqual (NativeInfo).rebootRequired $true 'Same boot requires reboot'
 $journal = Get-Content $journalPath -Raw | ConvertFrom-Json; $journal.boot = 'previous-boot'
 $journal | ConvertTo-Json | Set-Content $journalPath
 AssertEqual (NativeInfo).rebootRequired $false 'New boot resumes installation'
 $ManagerInput.action = 'inspect'
 $script:registered = @()
 $frame = Snapshot
 $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($frame.Substring('::mew-snapshot::'.Length))) | ConvertFrom-Json
 AssertEqual $decoded.system.distroInstalled $false 'Snapshot preserves missing distribution'
 AssertEqual $decoded.httpOk $false 'No invented server status'
 $ManagerInput.action = 'update'; SaveJournal $false 'failed'
 AssertEqual (Get-Content $journalPath -Raw | ConvertFrom-Json).updateFailed $true 'Failed update survives restart'
 $ManagerInput.action = 'check-update'; SaveJournal $false 'completed'
 AssertEqual (Get-Content $journalPath -Raw | ConvertFrom-Json).updateFailed $true 'Checking updates preserves failed build retry'
 $ManagerInput.action = 'update'; SaveJournal $false 'completed'
 AssertEqual (Get-Content $journalPath -Raw | ConvertFrom-Json).updateFailed $false 'Successful update clears retry'
 Write-Output 'PowerShell parser, quoting, ownership, reboot and snapshot checks passed.'
} finally { Remove-Item $journalPath -Force -ErrorAction SilentlyContinue }
