param(
  [Parameter(Mandatory=$true)][string]$Output,
  [string]$Wdk = (Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'),
  [string]$SdkVersion = '10.0.26100.0',
  [ValidateSet('x64','arm64')][string]$Architecture = 'x64'
)
$ErrorActionPreference = 'Stop'
$outPath = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $outPath) { throw 'Use a new output directory; existing packages are not overwritten.' }
$wdkPath = [IO.Path]::GetFullPath($Wdk)
$umdf = Join-Path $wdkPath 'Include\wdf\umdf\2.25'
$idd = Join-Path $wdkPath ('Include\' + $SdkVersion + '\um\iddcx\1.4')
$stub = Join-Path $wdkPath ('Lib\wdf\umdf\' + $Architecture + '\2.25\WdfDriverStubUm.lib')
$iddStub = Join-Path $wdkPath ('Lib\' + $SdkVersion + '\um\' + $Architecture + '\iddcx\1.4\iddcxstub.lib')
$catalog = Join-Path $wdkPath ('bin\' + $SdkVersion + '\x86\Inf2Cat.exe')
foreach ($file in @($umdf,$idd,$stub,$iddStub,$catalog)) { if (-not (Test-Path -LiteralPath $file)) { throw ('WDK component missing: ' + $file) } }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Visual Studio C++ Build Tools and a matching Windows SDK are required.' }
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('mew-display-build-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  $vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvarsall.bat'
  $compile = '@echo off' + "`r`n" + 'call "' + $vcvars + '" ' + $Architecture + ' >nul' + "`r`n" +
    'cl /nologo /std:c++17 /EHsc /O2 /MT /LD /DUNICODE /D_UNICODE /DUMDF_DRIVER /DUMDF_USING_NTSTATUS /DIDDCX_VERSION_MAJOR=1 /DIDDCX_VERSION_MINOR=4 /DIDDCX_MINIMUM_VERSION_REQUIRED=4 /I"' + $umdf + '" /I"' + $idd + '" "' + (Join-Path $PSScriptRoot 'virtual-display-driver.cpp') + '" /link /OUT:"' + (Join-Path $temporary 'mew-display.dll') + '" "' + $stub + '" "' + $iddStub + '" OneCoreUAP.lib ntdll.lib d3d11.lib dxgi.lib' + "`r`n" + 'exit /b %errorlevel%'
  $script = Join-Path $temporary 'compile.cmd'
  [IO.File]::WriteAllText($script,$compile,[Text.Encoding]::Default)
  Push-Location -LiteralPath $temporary
  try { & $env:ComSpec /d /c $script; if ($LASTEXITCODE -ne 0) { throw 'Virtual display compilation failed.' } }
  finally { Pop-Location }
  $inf = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'virtual-display.inf') -Raw).Replace('$ARCH$', $(if ($Architecture -eq 'x64') { 'amd64' } else { 'arm64' }))
  [IO.File]::WriteAllText((Join-Path $temporary 'mew-display.inf'),$inf,[Text.Encoding]::ASCII)
  $os = if ($Architecture -eq 'x64') { '10_VB_X64' } else { '10_VB_ARM64' }
  & $catalog ('/driver:' + $temporary) ('/os:' + $os)
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $temporary 'mew-display.cat'))) { throw 'Driver catalog validation failed.' }
  New-Item -ItemType Directory -Path $outPath | Out-Null
  foreach ($file in @('mew-display.dll','mew-display.inf','mew-display.cat')) { Copy-Item -LiteralPath (Join-Path $temporary $file) -Destination (Join-Path $outPath $file) }
  foreach ($file in @('LICENSE','virtual-display-origin-license')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $outPath $file) }
  Write-Output ('Unsigned package: ' + $outPath)
  Write-Output 'Release-sign the catalog before installing; member files must not change afterward. No certificate, driver or Windows setting was installed.'
} finally { Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue }
