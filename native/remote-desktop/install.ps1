param([string]$Target = (Join-Path $env:LOCALAPPDATA 'Mew\remote-desktop'))
$ErrorActionPreference = 'Stop'
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) {
  # WSL/tmux can inherit PATH from before Node was installed on Windows.
  $candidate = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
  if (Test-Path -LiteralPath $candidate) { $npm = $candidate }
}
if (-not $npm) { throw 'Install Node.js 22.12+ on Windows, then retry. The Linux/WSL Node.js installation is not sufficient.' }
$env:PATH = (Split-Path -Parent $npm) + ';' + $env:PATH
New-Item -ItemType Directory -Force -Path $target | Out-Null
$files = @('package.json', 'package-lock.json', 'main.mjs', 'preload.cjs', 'app.html', 'sender.mjs', 'protocol.mjs', 'keys.mjs', 'input-native.mjs', 'input-portal.mjs')
if ([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($target)) {
  foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $target $file) -Force }
}
# npm.cmd must start on a Windows drive, not the WSL UNC source directory.
Push-Location -LiteralPath $target
try {
  & $npm ci --prefix $target --omit=dev --no-audit --no-fund
  $result = $LASTEXITCODE
} finally { Pop-Location }
if ($result -ne 0) { exit $result }
Write-Output 'Mew remote desktop helper installed on Windows. Close this terminal and reconnect.'
