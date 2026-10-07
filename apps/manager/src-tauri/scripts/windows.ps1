$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$settings = $ManagerInput.settings
$base = Join-Path $env:LOCALAPPDATA 'Mew\Manager'
$wsl = Join-Path $env:SystemRoot 'System32\wsl.exe'
$journalPath = Join-Path $base 'last-operation.json'
$installRoot = Join-Path $base ('distros\' + $settings.distro)
function Frame($prefix, $value) {
    $json = ConvertTo-Json -InputObject $value -Compress -Depth 10
    Write-Output ($prefix + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))
}
function QuoteNative([string]$Value) {
    if ($Value -notmatch '[\s"]' -and $Value.Length) { return $Value }
    return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}
function WslProcess([string[]]$Arguments) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $wsl
    $start.Arguments = ($Arguments | ForEach-Object { QuoteNative $_ }) -join ' '
    $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = [Text.Encoding]::UTF8
    $start.StandardErrorEncoding = [Text.Encoding]::UTF8
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $start
    $null = $process.Start(); return $process
}
function DecodeWslBytes([byte[]]$Bytes) {
    $utf16 = $Bytes.Length -ge 2 -and $Bytes[0] -eq 255 -and $Bytes[1] -eq 254
    if (!$utf16 -and $Bytes.Length -gt 3) {
        $zeros = 0; for ($i = 1; $i -lt $Bytes.Length; $i += 2) { if ($Bytes[$i] -eq 0) { $zeros++ } }
        $utf16 = $zeros -gt ($Bytes.Length / 8)
    }
    $encoding = $(if ($utf16) { [Text.Encoding]::Unicode } else { [Text.Encoding]::UTF8 })
    return $encoding.GetString($Bytes).TrimStart([char]0xfeff).Replace([string][char]0, '')
}
function WslText([string[]]$Arguments, [int]$Timeout = 15000) {
    if (!(Test-Path $wsl)) { return @{ code = 127; text = 'WSL이 설치되지 않았습니다.' } }
    $process = WslProcess $Arguments
    $buffer = [IO.MemoryStream]::new(); $errorBuffer = [IO.MemoryStream]::new()
    try {
        $reading = $process.StandardOutput.BaseStream.CopyToAsync($buffer)
        $errors = $process.StandardError.BaseStream.CopyToAsync($errorBuffer)
        if (!$process.WaitForExit($Timeout)) { $process.Kill(); $process.WaitForExit(); throw 'WSL 상태 응답 시간이 초과되었습니다. 작업 로그와 WSL 서비스를 확인하세요.' }
        $null = $reading.GetAwaiter().GetResult(); $null = $errors.GetAwaiter().GetResult()
        $out = DecodeWslBytes $buffer.ToArray()
        $err = DecodeWslBytes $errorBuffer.ToArray()
        return @{ code = $process.ExitCode; text = (@($out.Trim(), $err.Trim()) | Where-Object { $_ }) -join "`n" }
    } finally { $buffer.Dispose(); $errorBuffer.Dispose(); $process.Dispose() }
}
function Registrations {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss'
    $rows = @()
    if (Test-Path $key) {
        foreach ($item in Get-ChildItem $key) {
            $p = Get-ItemProperty $item.PSPath
            if ($p.DistributionName) { $rows += @{ name = [string]$p.DistributionName; version = [int]$p.Version; basePath = [string]$p.BasePath } }
        }
    }
    return ,$rows
}
function NativeInfo {
    $os = Get-CimInstance Win32_OperatingSystem
    $computer = Get-CimInstance Win32_ComputerSystem
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $architecture = $(if ([int]$cpu.Architecture -eq 12) { 'ARM64' } else { $env:PROCESSOR_ARCHITECTURE })
    $version = WslText @('--version')
    $status = WslText @('--status')
    $rows = @(Registrations)
    $registered = @($rows | Where-Object { $_.name -eq $settings.distro })
    $running = @()
    if ($status.code -eq 0) { $running = (WslText @('--list', '--running', '--quiet')).text -split '\r?\n' }
    $managed = $false
    if ($registered.Count) { $managed = $registered[0].basePath.Replace('\\?\', '').TrimEnd('\') -eq $installRoot.TrimEnd('\') }
    $reboot = $false
    if (Test-Path $journalPath) {
        $last = Get-Content $journalPath -Raw | ConvertFrom-Json
        $reboot = $last.reboot -and $last.boot -eq $os.LastBootUpTime.ToString('o')
    }
    return @{ platform = 'windows'; supported = ([int]$os.BuildNumber -ge 19041 -and [Environment]::Is64BitOperatingSystem); os = $os.Caption; build = [string]$os.BuildNumber; architecture = $architecture; virtualization = [bool]($computer.HypervisorPresent -or $cpu.VirtualizationFirmwareEnabled); wslInstalled = ($status.code -eq 0); wslVersion = $version.text; distroInstalled = ($registered.Count -gt 0); distroVersion = $(if ($registered.Count) { $registered[0].version } else { 0 }); distroRunning = ($running -contains $settings.distro); managed = $managed; distributions = @($rows | ForEach-Object { @{ name = $_.name; version = $_.version } }); rebootRequired = [bool]$reboot; boot = $os.LastBootUpTime.ToString('o') }
}
function InvokeLinux([string]$UserName, [string]$Script, [string[]]$Arguments) {
    $process = WslProcess (@('--distribution', $settings.distro, '--user', $UserName, '--exec', 'bash', '-c', $Script, 'mew-manager') + $Arguments)
    try {
        $errors = $process.StandardError.ReadToEndAsync()
        while ($null -ne ($line = $process.StandardOutput.ReadLine())) { Write-Output $line }
        $process.WaitForExit()
        if ($errors.Result.Trim()) { [Console]::Error.WriteLine($errors.Result) }
        if ($process.ExitCode -ne 0) { throw "WSL 작업이 실패했습니다 (종료 코드 $($process.ExitCode)). 로그에서 마지막 오류를 확인하세요." }
    } finally { $process.Dispose() }
}
function Snapshot {
    $info = NativeInfo
    $linux = $null
    $httpOk = $false
    if ($info.distroInstalled -and $info.managed) {
        $user = WslText @('--distribution', $settings.distro, '--user', 'root', '--exec', 'id', '-u', 'mew')
        if ($user.code -eq 0) {
            $result = WslText @('--distribution', $settings.distro, '--user', 'mew', '--exec', 'bash', '-c', $ManagerInput.scripts.probe, 'mew-manager', $settings.installPath)
            if ($result.code -eq 0) {
                try { $linux = $result.text | ConvertFrom-Json } catch { throw '설치 상태 응답을 읽지 못했습니다. 로그를 확인하세요.' }
                $info.distroRunning = $true
                if ($linux.running) {
                    $attempts = $(if ($ManagerInput.action -in @('install', 'start', 'restart', 'update')) { 10 } else { 1 })
                    for ($i = 0; $i -lt $attempts; $i++) {
                        try { $response = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:' + $linux.port + '/api/auth/me') -TimeoutSec 2; $health = $response.Content | ConvertFrom-Json; $httpOk = $response.StatusCode -eq 200 -and $null -ne $health.capabilities -and $health.role -in @('guest', 'owner', 'manager', 'member') } catch { }
                        if ($httpOk) { break }; if ($i + 1 -lt $attempts) { Start-Sleep -Milliseconds 500 }
                    }
                }
            }
        }
    }
    $lastOperation = $null
    if (Test-Path $journalPath) { $lastOperation = Get-Content $journalPath -Raw | ConvertFrom-Json }
    Frame '::mew-snapshot::' @{ system = $info; settings = $settings; linux = $linux; httpOk = $httpOk; lastOperation = $lastOperation; checkedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
    if ($ManagerInput.action -in @('install', 'start', 'restart', 'update') -and !$info.rebootRequired -and !$httpOk) { throw 'mew의 Windows localhost 연결을 확인하지 못했습니다. 작업 로그와 WSL 네트워크 상태를 확인하고 서버를 다시 시작하세요.' }
}
function SaveJournal([bool]$Reboot, [string]$Status) {
    $os = Get-CimInstance Win32_OperatingSystem
    $updateFailed = $false
    if (Test-Path $journalPath) { $updateFailed = [bool](Get-Content $journalPath -Raw | ConvertFrom-Json).updateFailed }
    if ($ManagerInput.action -eq 'update' -and $Status -eq 'failed') { $updateFailed = $true }
    if ($ManagerInput.action -in @('update', 'install') -and $Status -eq 'completed') { $updateFailed = $false }
    $journal = @{ action = $ManagerInput.action; status = $Status; updateFailed = $updateFailed; reboot = $Reboot; boot = $os.LastBootUpTime.ToString('o'); time = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
    $temporary = $journalPath + '.tmp'
    $journal | ConvertTo-Json | Set-Content -Encoding UTF8 $temporary
    Move-Item $temporary $journalPath -Force
}
function WslPrepareArguments([string]$Action, [string]$HelpText) {
    if ($Action -notin @('install', 'update')) { throw '지원하지 않는 WSL 준비 작업입니다.' }
    if ($Action -eq 'install' -and !$HelpText.Contains('--no-distribution')) {
        throw '현재 WSL 명령은 배포판 없이 설치하는 옵션을 지원하지 않습니다. Windows 업데이트 또는 Microsoft의 최신 WSL 설치 후 다시 시도하세요. 기존 배포판은 변경하지 않았습니다.'
    }
    if ($Action -eq 'update' -and !$HelpText.Contains('--update')) { throw '현재 WSL 명령은 업데이트를 지원하지 않습니다. Windows 업데이트 또는 Microsoft의 최신 WSL 설치가 필요합니다.' }
    [string[]]$arguments = $(if ($Action -eq 'install') { @('--install', '--no-distribution') } else { @('--update') })
    if ($HelpText.Contains('--web-download')) { $arguments += '--web-download' }
    return ,$arguments
}
function WslPreparationScript([string[]]$Arguments, [bool]$EnableFeatures, [string]$ResultPath) {
    $helpers = (@('QuoteNative', 'WslProcess', 'DecodeWslBytes', 'WslText') | ForEach-Object { 'function ' + $_ + ' {' + (Get-Command $_ -CommandType Function).Definition + '}' }) -join "`n"
    $argumentLiterals = ($Arguments | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ','
    $pathLiteral = $ResultPath.Replace("'", "''")
    return @"
`$ErrorActionPreference = 'Stop'
`$ProgressPreference = 'SilentlyContinue'
`$wsl = Join-Path `$env:SystemRoot 'System32\wsl.exe'
$helpers
try {
    if (`$$EnableFeatures) {
        `$messages = @()
        `$messages += Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -All -NoRestart -ErrorAction Stop | Out-String
        `$messages += Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All -NoRestart -ErrorAction Stop | Out-String
        `$result = @{ code = 3010; text = (`$messages -join "`n") }
    } else {
        `$result = WslText @($argumentLiterals) 1800000
    }
} catch { `$result = @{ code = 1; text = `$_.Exception.Message } }
[IO.File]::WriteAllText('$pathLiteral', (ConvertTo-Json -InputObject `$result -Compress), [Text.UTF8Encoding]::new(`$false))
exit `$result.code
"@
}
function CompleteWslPreparation($Result, [ref]$ExitCode) {
    $code = [int]$Result.code
    $text = [string]$Result.text
    if ($text.Trim()) { Write-Output $text.Trim() }
    if ($code -notin @(0, 3010)) {
        $hex = '{0:X8}' -f ([long]$code -band 0xffffffffL)
        $detail = $(if ($text.Length -gt 2000) { $text.Substring($text.Length - 2000) } else { $text }).Trim()
        if (!$detail) { $detail = 'WSL이 오류 내용을 반환하지 않았습니다. Windows 버전과 wsl --status 출력을 확인하세요.' }
        throw "WSL 준비가 실패했습니다 (종료 코드 $code / 0x$hex).`n$detail"
    }
    $ExitCode.Value = $code
}
function ElevateWsl([string]$Action, [ref]$ExitCode) {
    Write-Output '::mew-stage::wsl'
    $enableFeatures = !(Test-Path $wsl)
    $arguments = @()
    if ($enableFeatures) {
        if ($Action -ne 'install') { throw 'WSL이 설치되지 않았습니다.' }
    } else {
        $help = WslText @('--help')
        $arguments = WslPrepareArguments $Action $help.text
    }
    Write-Output ('WSL 준비 명령: ' + $(if ($enableFeatures) { 'Windows 선택 기능 활성화' } else { 'wsl ' + ($arguments -join ' ') }))
    Write-Output 'Windows 권한 승인 창에서 WSL 준비를 허용하세요.'
    $tasks = Join-Path $base 'tasks'
    New-Item -ItemType Directory -Path $tasks -Force | Out-Null
    $resultPath = Join-Path $tasks ('wsl-prepare-' + [guid]::NewGuid() + '.json')
    $script = WslPreparationScript $arguments $enableFeatures $resultPath
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    try {
        try { $process = Start-Process -FilePath $powershell -ArgumentList @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) -Verb RunAs -Wait -PassThru }
        catch {
            if ($_.Exception.NativeErrorCode -eq 1223) { throw '관리자 권한 승인이 취소되었습니다. 다시 시도할 수 있습니다.' }
            throw ('WSL 관리자 프로세스를 실행하지 못했습니다: ' + $_.Exception.Message)
        }
        if (Test-Path -LiteralPath $resultPath) { $result = Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8 | ConvertFrom-Json }
        else { $result = @{ code = $(if ($process.ExitCode) { $process.ExitCode } else { 1 }); text = '관리자 프로세스의 결과를 읽지 못했습니다. Windows 정책·보안 프로그램과 관리자 실행 상태를 확인하세요.' } }
        CompleteWslPreparation $result $ExitCode
    } finally { Remove-Item -LiteralPath $resultPath -Force -ErrorAction SilentlyContinue }
}
function InstallDistribution {
    Write-Output '::mew-stage::ubuntu'
    $arch = $(if ((NativeInfo).architecture -eq 'ARM64') { 'arm64' } else { 'amd64' })
    $name = "ubuntu-24.04.5-wsl-$arch.wsl"
    $hash = $(if ($arch -eq 'amd64') { 'bb415d824822c4b878125729af451a5d18fb13d1cf5cbed9a7393ad64ac6039e' } else { '74478b5024d9047397ba79d17c27f73caf85ada4988f88cffc2892d65e6a806b' })
    $url = $(if ($arch -eq 'amd64') { "https://releases.ubuntu.com/24.04.5/$name" } else { "https://cdimages.ubuntu.com/releases/24.04.5/release/$name" })
    $cache = Join-Path $base 'downloads'; New-Item -ItemType Directory -Path $cache -Force | Out-Null
    $archive = Join-Path $cache $name
    if (!(Test-Path $archive) -or (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) {
        Write-Output 'Ubuntu 24.04 LTS를 다운로드합니다. 네트워크에 따라 몇 분 걸릴 수 있습니다.'
        $partial = $archive + '.partial'
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $partial -TimeoutSec 1800
        if ((Get-FileHash $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { Remove-Item $partial -Force; throw 'Ubuntu 다운로드 체크섬이 일치하지 않습니다. 다시 다운로드하세요.' }
        Move-Item $partial $archive -Force
    }
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    $result = WslText @('--import', $settings.distro, $installRoot, $archive, '--version', '2') 1800000
    Write-Output $result.text
    if ($result.code -ne 0) { throw 'Ubuntu 등록이 실패했습니다. 가상화·WSL 커널·재부팅 상태를 확인하세요.' }
}
New-Item -ItemType Directory -Path $base -Force | Out-Null
try {
    switch ($ManagerInput.action) {
        'inspect' { Snapshot; break }
        'install' {
            $info = NativeInfo
            if (!$info.supported) { throw 'Windows 10 빌드 19041 이상 또는 Windows 11의 64비트 환경이 필요합니다.' }
            if (!$info.virtualization) { throw 'BIOS/UEFI에서 CPU 가상화를 활성화한 뒤 다시 실행하세요.' }
            if ($info.rebootRequired) { throw 'Windows를 재부팅한 후 설치를 이어서 진행하세요.' }
            if (!$info.wslInstalled) {
                $code = 0; ElevateWsl 'install' ([ref]$code)
                SaveJournal $true 'reboot'
                Write-Output '::mew-stage::reboot'
                Write-Output 'Windows를 재부팅한 뒤 mew Manager를 다시 실행하고 설치를 이어서 진행하세요.'
                Snapshot
                break
            }
            if ($info.distroInstalled -and !$info.managed) { throw '같은 이름의 기존 배포판이 있습니다. 설정에서 새 배포판 이름을 지정하세요. 기존 배포판은 변경하지 않았습니다.' }
            if ($info.distroInstalled -and $info.distroVersion -ne 2) { throw '관리 배포판에 WSL 2가 필요합니다. WSL 상태를 확인하세요.' }
            SaveJournal $false 'running'
            if (!$info.distroInstalled) { InstallDistribution }
            InvokeLinux 'root' $ManagerInput.scripts.prepare @()
            InvokeLinux 'mew' $ManagerInput.scripts.install @($settings.installPath, $settings.workspace, [string]$settings.port, $settings.ownerEmail)
            SaveJournal $false 'completed'
            Snapshot
            break
        }
        'update-wsl' { $code = 0; ElevateWsl 'update' ([ref]$code); SaveJournal ($code -eq 3010) 'completed'; Snapshot; break }
        default {
            $info = NativeInfo
            if (!$info.distroInstalled -or !$info.managed) { throw '관리 앱에서 준비한 WSL 배포판이 필요합니다.' }
            SaveJournal $false 'running'
            InvokeLinux 'mew' $ManagerInput.scripts.action @($settings.installPath, $ManagerInput.action)
            SaveJournal $false 'completed'
            Snapshot
        }
    }
} catch {
    $failure = $_.Exception.Message
    if ($ManagerInput.action -ne 'inspect') {
        try {
            $keepReboot = $false
            if (Test-Path $journalPath) { $keepReboot = [bool](Get-Content $journalPath -Raw | ConvertFrom-Json).reboot }
            SaveJournal $keepReboot 'failed'
        } catch { }
    }
    Write-Error $failure
    exit 1
}
