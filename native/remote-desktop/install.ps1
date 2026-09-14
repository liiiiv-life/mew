param([string]$Target = (Join-Path $env:LOCALAPPDATA 'Mew\remote-desktop'))
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $target | Out-Null
. (Join-Path $PSScriptRoot 'windows-runtime.ps1')
$node = Get-MewDesktopNode $target
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
    & $node (Join-Path $target 'install-runtime.mjs')
    $result = $LASTEXITCODE
    if ($result -eq 0) {
      & $node (Join-Path $target 'helper-version.mjs') mark
      $result = $LASTEXITCODE
    }
  }
} finally { Pop-Location }
if ($result -ne 0) { exit $result }
