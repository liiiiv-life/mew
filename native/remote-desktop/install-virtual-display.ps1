param(
  [string]$Package,
  [string]$UserSid,
  [string]$SignerThumbprint,
  [switch]$Remove,
  [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
$signTool = Get-ChildItem -LiteralPath $sdk -Filter signtool.exe -Recurse | Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $Remove) {
  if (-not $Package -or $SignerThumbprint -notmatch '^[a-fA-F0-9]{40}$') { throw 'Provide a signed package and its trusted release signer SHA-1 certificate thumbprint.' }
  $packagePath = [IO.Path]::GetFullPath($Package)
  foreach ($name in @('mew-display.inf','mew-display.dll','mew-display.cat')) { if (-not (Test-Path -LiteralPath (Join-Path $packagePath $name) -PathType Leaf)) { throw ('Package file missing: ' + $name) } }
  if (-not $signTool) { throw 'Windows SDK SignTool is required to verify catalog membership.' }
  $cat = Join-Path $packagePath 'mew-display.cat'
  $signature = Get-AuthenticodeSignature -LiteralPath $cat
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $SignerThumbprint) { throw 'The package must have a valid trusted release signature from the specified signer.' }
  foreach ($name in @('mew-display.inf','mew-display.dll')) {
    & $signTool.FullName verify /pa /c $cat (Join-Path $packagePath $name)
    if ($LASTEXITCODE -ne 0) { throw ('Catalog integrity verification failed: ' + $name) }
  }
  if ($CheckOnly) { Write-Output 'Signature and catalog members verified. Nothing installed.'; return }
  if ($UserSid -notmatch '^S-\d+(-\d+){2,15}$') { throw 'Specify the Windows user SID that runs Mew; group SIDs are not accepted.' }
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this script in an elevated Windows PowerShell. The Mew host stays unelevated.' }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Visual Studio C++ Build Tools and Windows SDK are required.' }
$architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('mew-display-install-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  $exe = Join-Path $temporary 'mew-display-install.exe'
  $command = '@echo off' + "`r`n" + 'call "' + (Join-Path $vs 'VC\Auxiliary\Build\vcvarsall.bat') + '" ' + $architecture + ' >nul' + "`r`n" +
    'cl /nologo /std:c++17 /EHsc /O2 /MT /DUNICODE /D_UNICODE "' + (Join-Path $PSScriptRoot 'virtual-display-install.cpp') + '" /link /OUT:"' + $exe + '" setupapi.lib newdev.lib advapi32.lib' + "`r`n" + 'exit /b %errorlevel%'
  $script = Join-Path $temporary 'compile.cmd';[IO.File]::WriteAllText($script,$command,[Text.Encoding]::Default)
  Push-Location -LiteralPath $temporary
  try { & $env:ComSpec /d /c $script; if ($LASTEXITCODE -ne 0) { throw 'Device installer compilation failed.' } }
  finally { Pop-Location }
  if ($Remove) { & $exe remove } else { & $exe (Join-Path $packagePath 'mew-display.inf') $UserSid }
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 3010) { throw ('Device installation failed: ' + $LASTEXITCODE) }
} finally { Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue }
