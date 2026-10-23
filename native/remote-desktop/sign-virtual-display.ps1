param(
  [Parameter(Mandatory=$true)][string]$Package,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$CertificateThumbprint,
  [Parameter(Mandatory=$true)][ValidatePattern('^https://')][string]$TimestampUrl
)
$ErrorActionPreference = 'Stop'
$packagePath = [IO.Path]::GetFullPath($Package)
$cat = Join-Path $packagePath 'mew-display.cat'
foreach ($file in @('mew-display.cat','mew-display.inf','mew-display.dll')) { if (-not (Test-Path -LiteralPath (Join-Path $packagePath $file))) { throw ('Package file missing: ' + $file) } }
$certificate = Get-Item -LiteralPath ('Cert:\CurrentUser\My\' + $CertificateThumbprint)
if (-not $certificate.HasPrivateKey -or $certificate.NotAfter -le (Get-Date) -or $certificate.NotBefore -gt (Get-Date)) { throw 'An unexpired release certificate with its private key is required.' }
if (-not ($certificate.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.3')) { throw 'The certificate must permit code signing.' }
$chain = New-Object Security.Cryptography.X509Certificates.X509Chain
try { if (-not $chain.Build($certificate)) { throw 'The release certificate must chain to a trusted root. This script never installs certificates.' } }
finally { $chain.Dispose() }
$tool = Get-ChildItem -LiteralPath (Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin') -Filter signtool.exe -Recurse | Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $tool) { throw 'Windows SDK SignTool is required.' }
# The catalog already hashes the DLL and INF. Signing the catalog does not
# mutate its member files, so no INF edit or post-sign rewrite is needed.
& $tool.FullName sign /fd SHA256 /td SHA256 /tr $TimestampUrl /sha1 $CertificateThumbprint $cat
if ($LASTEXITCODE -ne 0) { throw 'Release signing failed.' }
& (Join-Path $PSScriptRoot 'install-virtual-display.ps1') -Package $packagePath -SignerThumbprint $CertificateThumbprint -CheckOnly
Write-Output 'Release catalog and members verified. The driver was not installed.'
