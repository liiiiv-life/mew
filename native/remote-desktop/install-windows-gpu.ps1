param([Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$targetPath = [IO.Path]::GetFullPath($Target)
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Windows native desktop requires Visual Studio C++ Build Tools and the Windows SDK.' }
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $installation) { throw 'Install the Visual Studio C++ Build Tools with Windows SDK, then prepare the desktop again.' }
$architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$vcvars = Join-Path $installation 'VC\Auxiliary\Build\vcvarsall.bat'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('mew-gpu-check-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    $source = Join-Path $targetPath 'gpu-windows.cpp'
    $notification = Join-Path $targetPath 'notification-windows.cpp'
    if (-not (Test-Path -LiteralPath $source) -or -not (Test-Path -LiteralPath $notification)) { throw 'Windows native desktop source is missing.' }
    $library = Join-Path $temporary 'gpu-windows.dll'
    $command = 'call "' + $vcvars + '" ' + $architecture + ' >nul' + "`r`n" +
        'cl /nologo /std:c++17 /utf-8 /EHsc /O2 /LD /DUNICODE /D_UNICODE "' + $source + '" "' + $notification + '" /link /OUT:"' + $library + '" d3d11.lib dxgi.lib mfplat.lib mf.lib mfuuid.lib ole32.lib oleaut32.lib strmiids.lib user32.lib shell32.lib windowsapp.lib setupapi.lib'
    $script = Join-Path $temporary 'compile.cmd'
    [IO.File]::WriteAllText($script, $command, [Text.Encoding]::Default)
    Push-Location -LiteralPath $temporary
    try { & $env:ComSpec /d /c $script; if ($LASTEXITCODE -ne 0) { throw 'Windows GPU module compilation failed.' } }
    finally { Pop-Location }
    Move-Item -LiteralPath $library -Destination (Join-Path $targetPath 'gpu-windows.dll.tmp') -Force
    Move-Item -LiteralPath (Join-Path $targetPath 'gpu-windows.dll.tmp') -Destination (Join-Path $targetPath 'gpu-windows.dll') -Force
} finally { Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue }
