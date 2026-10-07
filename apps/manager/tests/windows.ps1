$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$source = Get-Content (Join-Path $PSScriptRoot '../src-tauri/scripts/windows.ps1') -Raw -Encoding UTF8
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
$unicodeError = 'WSL 테스트 오류 0x8007019e'
AssertEqual (DecodeWslBytes ([Text.Encoding]::UTF8.GetBytes($unicodeError))) $unicodeError 'UTF8 native error'
AssertEqual (DecodeWslBytes ([Text.Encoding]::Unicode.GetBytes($unicodeError))) $unicodeError 'UTF16 native error without BOM'
AssertEqual (DecodeWslBytes ([byte[]](255, 254) + [Text.Encoding]::Unicode.GetBytes($unicodeError))) $unicodeError 'UTF16 native error with BOM'
AssertEqual ((WslPrepareArguments 'install' '--install --no-distribution --web-download') -join ' ') '--install --no-distribution --web-download' 'Modern WSL flags'
AssertEqual ((WslPrepareArguments 'install' '--install --no-distribution') -join ' ') '--install --no-distribution' 'Do not pass unsupported download flag'
AssertEqual ((WslPrepareArguments 'update' '--update --web-download') -join ' ') '--update --web-download' 'Modern update preserves separate arguments'
AssertEqual ((WslPrepareArguments 'update' '--update') -join ' ') '--update' 'Legacy update without download flag'
$rejected = $false
try { WslPrepareArguments 'install' '--install --distribution' | Out-Null } catch { $rejected = $_.Exception.Message.Contains('배포판 없이') }
AssertEqual $rejected $true 'Never fall back to installing a default distribution'
$code = -99
$messages = @(CompleteWslPreparation @{ code = 3010; text = '재부팅 필요' } ([ref]$code))
AssertEqual $code 3010 'Reboot exit code is returned separately from logs'
AssertEqual ($messages -join '') '재부팅 필요' 'Preparation output reaches the log stream'
$failure = ''
try { CompleteWslPreparation @{ code = -1; text = 'WSL 원래 오류 0x8007019e' } ([ref]$code) | Out-Null } catch { $failure = $_.Exception.Message }
AssertEqual ($failure.Contains('0xFFFFFFFF') -and $failure.Contains('WSL 원래 오류 0x8007019e')) $true 'Preserve signed exit code and real WSL error'
$failure = ''
try { CompleteWslPreparation @{ code = 5; text = '' } ([ref]$code) | Out-Null } catch { $failure = $_.Exception.Message }
AssertEqual $failure.Contains('오류 내용을 반환하지') $true 'Empty native error is actionable'
$generatedPath = Join-Path ([IO.Path]::GetTempPath()) ("mew-manager-result-'공백-" + [guid]::NewGuid() + '.json')
$child = WslPreparationScript @('--install', '--no-distribution') $false $generatedPath
$childTokens = $null; $childErrors = $null
$childAst = [Management.Automation.Language.Parser]::ParseInput($child, [ref]$childTokens, [ref]$childErrors)
if ($childErrors.Count) { throw ($childErrors | Out-String) }
AssertEqual $child.Contains("@('--install','--no-distribution')") $true 'Elevated arguments remain literal'
AssertEqual $child.Contains($generatedPath.Replace("'", "''")) $true 'Result path safely quotes spaces, Unicode and apostrophes'
$withFeatures = WslPreparationScript @() $true $generatedPath
AssertEqual ($withFeatures.Contains('if ($True)') -and $withFeatures.Contains('exit $result.code')) $true 'Windows feature branch reports its true outcome'
# Exercise the generated child script in a separate PowerShell process with only WSL mocked.
$nativeReader = $childAst.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'WslText' }, $true)[0]
$fakeReader = "function WslText { param(`$Arguments, `$Timeout) return @{ code = -1; text = '테스트 WSL 오류 0x8007019e' } }"
$child = $child.Replace($nativeReader.Extent.Text, $fakeReader)
$child = $child.Replace("`$wsl = Join-Path `$env:SystemRoot 'System32\wsl.exe'", "`$wsl = 'unused-test-wsl'")
$childEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($child))
try {
    $shell = (Get-Process -Id $PID).Path
    & $shell -NoProfile -NonInteractive -EncodedCommand $childEncoded
    if ($LASTEXITCODE -eq 0) { throw 'Failed preparation must exit nonzero' }
    $result = Get-Content -LiteralPath $generatedPath -Raw -Encoding UTF8 | ConvertFrom-Json
    AssertEqual $result.code -1 'Elevated child preserves original signed code'
    AssertEqual $result.text '테스트 WSL 오류 0x8007019e' 'Elevated child preserves Korean error output'
} finally { Remove-Item -LiteralPath $generatedPath -Force -ErrorAction SilentlyContinue }
if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
$wsl = Join-Path $env:SystemRoot 'System32\wsl.exe'
$helpResult = WslText @('--help')
AssertEqual ($helpResult -is [Collections.IDictionary]) $true 'Native async reads must not contaminate result with task objects'
$savedBase = $base
$base = Join-Path ([IO.Path]::GetTempPath()) ('mew-manager-elevation-test-' + [guid]::NewGuid())
$wsl = $PSCommandPath
function WslText($Arguments) { return @{ code = 0; text = '--install --no-distribution --web-download --update' } }
function Start-Process($FilePath, $ArgumentList, $Verb, [switch]$Wait, [switch]$PassThru) {
    AssertEqual $Verb 'RunAs' 'Preparation still requests elevation'
    $generated = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($ArgumentList[-1]))
    $generatedTokens = $null; $generatedErrors = $null
    $generatedAst = [Management.Automation.Language.Parser]::ParseInput($generated, [ref]$generatedTokens, [ref]$generatedErrors)
    if ($generatedErrors.Count) { throw ($generatedErrors | Out-String) }
    $outputPath = $generatedAst.FindAll({ param($node) $node -is [Management.Automation.Language.StringConstantExpressionAst] -and $node.Value -like '*wsl-prepare-*.json' }, $true)[0].Value
    $script:preparationResultPath = $outputPath
    [IO.File]::WriteAllText($outputPath, (@{ code = $script:preparationCode; text = '준비 결과 테스트' } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    return [pscustomobject]@{ ExitCode = $script:preparationCode }
}
try {
    $script:preparationCode = 3010
    $code = 0; $output = @(ElevateWsl 'install' ([ref]$code))
    AssertEqual $code 3010 'Elevated result drives reboot journal'
    AssertEqual (($output -join "`n").Contains('준비 결과 테스트')) $true 'Elevated output is forwarded to GUI logs'
    AssertEqual (Test-Path -LiteralPath $script:preparationResultPath) $false 'Successful elevation removes temporary result'
    $script:preparationCode = -1
    $failure = ''
    try { ElevateWsl 'install' ([ref]$code) | Out-Null } catch { $failure = $_.Exception.Message }
    AssertEqual $failure.Contains('준비 결과 테스트') $true 'Failed elevated result reaches visible error'
    AssertEqual (Test-Path -LiteralPath $script:preparationResultPath) $false 'Failed elevation removes temporary result'
} finally {
    Remove-Item Function:\Start-Process
    Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue
    $base = $savedBase
}
}
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
 Write-Output 'PowerShell parser, quoting, elevated WSL diagnostics, compatibility, ownership, reboot and snapshot checks passed.'
} finally { Remove-Item $journalPath -Force -ErrorAction SilentlyContinue }
