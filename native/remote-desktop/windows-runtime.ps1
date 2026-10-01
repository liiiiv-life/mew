# Private fallback runtime. No MSI, administrator rights, registry or global PATH changes.
function Get-MewDesktopNode([string]$Target, [switch]$PrivateOnly) {
  $private = Join-Path $Target 'runtime\node.exe'
  $candidates = @($private)
  if (-not $PrivateOnly) { $candidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe') }
  $onPath = if (-not $PrivateOnly) { (Get-Command node.exe -ErrorAction SilentlyContinue).Source } else { $null }
  if ($onPath) { $candidates += $onPath }
  foreach ($candidate in $candidates) {
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    $npm = Join-Path (Split-Path -Parent $candidate) 'npm.cmd'
    if (-not (Test-Path -LiteralPath $npm)) { continue }
    $version = & $candidate --version
    if ($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.(\d+)\.' -and ([int]$Matches[1] -gt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -ge 12))) { return $candidate }
  }
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
  $version = '24.21.0'
  # https://nodejs.org/dist/v24.21.0/SHASUMS256.txt
  $checksum = if ($arch -eq 'arm64') { '8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921' } else { '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541' }
  $name = "node-v$version-win-$arch"
  $temporary = Join-Path $Target ('runtime-download-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $temporary | Out-Null
  try {
    Write-Host 'Preparing the private Windows runtime...'
    $archive = Join-Path $temporary 'node.zip'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$version/$name.zip" -OutFile $archive -TimeoutSec 180
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $checksum) { throw 'Windows runtime checksum mismatch. Retry preparation.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $temporary
    $runtime = Join-Path $Target 'runtime'
    if (Test-Path -LiteralPath $runtime) { Remove-Item -LiteralPath $runtime -Recurse -Force }
    Move-Item -LiteralPath (Join-Path $temporary $name) -Destination $runtime
    return (Join-Path $runtime 'node.exe')
  } finally { Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue }
}
