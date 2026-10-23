param([string]$Target = (Join-Path $env:LOCALAPPDATA 'Mew\remote-desktop'))
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $target | Out-Null
. (Join-Path $PSScriptRoot 'windows-runtime.ps1')
$node = Get-MewDesktopNode -Target $target -PrivateOnly
$npm = Join-Path (Split-Path -Parent $node) 'npm.cmd'
$env:PATH = (Split-Path -Parent $node) + ';' + $env:PATH
$files = & $node (Join-Path $PSScriptRoot 'helper-version.mjs') files | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not read desktop file manifest' }
Remove-Item -LiteralPath (Join-Path $target '.mew-ready') -Force -ErrorAction SilentlyContinue
if ([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($target)) {
  foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $target $file) -Force }
}
# npm.cmd must start on a Windows drive, not the WSL UNC source directory.
Push-Location -LiteralPath $target
try {
  Write-Output '[1/3] Installing helper dependencies...'
  $reusable = & $node (Join-Path $target 'helper-version.mjs') dependencies
  $result = 0
  if ($LASTEXITCODE -eq 0 -and $reusable -eq 'true') { Write-Output 'Dependencies unchanged; reusing the installed runtime.' }
  else { & $npm ci --prefix $target --omit=dev --no-audit --no-fund; $result = $LASTEXITCODE }
  if ($result -eq 0) {
    Write-Output '[2/3] Checking native WebRTC and Windows input bindings...'
    & $node --input-type=module -e "import rtc from 'node-datachannel'; import koffi from 'koffi'; if (!rtc.getLibraryVersion() || !koffi.version) process.exit(1); rtc.cleanup();"
    $result = $LASTEXITCODE
    if ($result -eq 0) {
      Write-Output '[3/3] Compiling Windows GPU capture and H.264 encoder...'
      & (Join-Path $target 'install-windows-gpu.ps1') -Target $target
      Write-Output 'Preparing Windows UDP access for external desktop connections...'
      & (Join-Path $PSHOME 'powershell.exe') -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $target 'prepare-windows-network.ps1') -Target $target
      if ($LASTEXITCODE -ne 0) { Write-Warning 'Desktop files are ready, but Windows UDP access is not prepared. Run desktop-setup again to approve it.' }
      & $node (Join-Path $target 'helper-version.mjs') mark
      $result = $LASTEXITCODE
    }
  }
} finally { Pop-Location }
if ($result -ne 0) { exit $result }
