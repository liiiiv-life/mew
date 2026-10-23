param(
  [ValidateSet('broker', 'launch')][string]$Mode,
  [ValidatePattern('^mew-desktop-bootstrap-[a-f0-9]{48}$')][string]$BootstrapPipe,
  [int]$BridgePid = 0
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()

if ($Mode -eq 'launch') {
  # Task Scheduler supplies the interactive user's token, never a saved password.
  if ([Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0) { exit 2 }
  $pipe = New-Object IO.Pipes.NamedPipeClientStream('.', $BootstrapPipe, [IO.Pipes.PipeDirection]::InOut, [IO.Pipes.PipeOptions]::Asynchronous, [Security.Principal.TokenImpersonationLevel]::Identification)
  $child = $null
  try {
    $pipe.Connect(10000)
    $pipe.WriteByte(1); $pipe.Flush()
    $reader = New-Object IO.StreamReader($pipe)
    $config = $reader.ReadLine() | ConvertFrom-Json
    if ($config.token -notmatch '^[a-f0-9]{64}$' -or $config.pipe -notmatch '^\\\\\.\\pipe\\mew-desktop-[a-f0-9]{48}$') { throw 'Invalid bootstrap' }
    $entry = [IO.Path]::GetFullPath($config.entry)
    if ([IO.Path]::GetFileName($entry) -eq 'native-host.mjs') {
      $executable = Join-Path (Split-Path -Parent $entry) 'runtime\node.exe'
    } elseif ([IO.Path]::GetFileName($entry) -eq 'main.mjs') {
      $executable = Join-Path (Split-Path -Parent $entry) 'node_modules\electron\dist\electron.exe'
    } else { throw 'Invalid helper entry' }
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $executable
    $start.Arguments = '"' + $entry + '"'
    $start.WorkingDirectory = Split-Path -Parent $entry
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.EnvironmentVariables.Remove('NODE_OPTIONS')
    $start.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE')
    $start.EnvironmentVariables['MEW_DESKTOP_PIPE'] = $config.pipe
    $start.EnvironmentVariables['MEW_DESKTOP_PIPE_TOKEN'] = $config.token
    $child = [Diagnostics.Process]::Start($start)
    $pipe.WriteByte(2); $pipe.Flush()
    $config = $null
    # This supervisor remains in the interactive session. WSL can tear down
    # every process in the service-side job at once; pipe EOF still reaches us.
    $control = New-Object byte[] 1
    $reading = $pipe.BeginRead($control, 0, 1, $null, $null)
    while (-not $child.HasExited -and -not $reading.AsyncWaitHandle.WaitOne(250)) {}
    if (-not $child.HasExited) { $null = $child.WaitForExit(2000) }
  } finally {
    if ($child) { try { if (-not $child.HasExited) { $child.Kill() } } finally { $child.Dispose() } }
    $pipe.Dispose()
  }
  exit 0
}

if ($Mode -ne 'broker' -or $BridgePid -le 0) { exit 2 }
$taskName = 'Mew-Desktop-' + $BootstrapPipe.Substring(22)
$folder = $null; $registered = $false; $pipe = $null; $bridge = $null; $stage = 'configuration'
try {
  # All credentials arrive over parent-owned stdio and stay in memory.
  $config = [Console]::ReadLine() | ConvertFrom-Json
  if ($config.token -notmatch '^[a-f0-9]{64}$' -or $config.pipe -notmatch '^\\\\\.\\pipe\\mew-desktop-[a-f0-9]{48}$') { throw 'Invalid bootstrap' }
  $bridge = [Diagnostics.Process]::GetProcessById($BridgePid)
  $null = $bridge.Handle # Retain process identity even if the PID is later reused.
  $stage = 'pipe'
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class MewDesktopPipe {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint pid);
}
'@
  $security = New-Object IO.Pipes.PipeSecurity
  $security.SetAccessRuleProtection($true, $false)
  $network = New-Object Security.Principal.SecurityIdentifier([Security.Principal.WellKnownSidType]::NetworkSid, $null)
  $security.AddAccessRule((New-Object IO.Pipes.PipeAccessRule($network, [IO.Pipes.PipeAccessRights]::FullControl, [Security.AccessControl.AccessControlType]::Deny)))
  $security.AddAccessRule((New-Object IO.Pipes.PipeAccessRule($identity.User, [IO.Pipes.PipeAccessRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow)))
  # libuv's default pipe DACL can be tied to the service logon SID. Grant the
  # account SID explicitly so the authenticated Electron in another session can connect.
  $transport = New-Object IO.Pipes.NamedPipeClientStream('.', $config.pipe.Substring(9), ([IO.Pipes.PipeAccessRights]::ReadWrite -bor [IO.Pipes.PipeAccessRights]::ChangePermissions), [IO.Pipes.PipeOptions]::None, [Security.Principal.TokenImpersonationLevel]::Identification, [IO.HandleInheritability]::None)
  try { $transport.Connect(3000); $transport.SetAccessControl($security) } finally { $transport.Dispose() }
  $pipe = New-Object IO.Pipes.NamedPipeServerStream($BootstrapPipe, [IO.Pipes.PipeDirection]::InOut, 1, [IO.Pipes.PipeTransmissionMode]::Byte, [IO.Pipes.PipeOptions]::Asynchronous, 4096, 4096, $security)
  $waiting = $pipe.BeginWaitForConnection($null, $null)
  $stage = 'scheduler'
  $scheduler = New-Object -ComObject 'Schedule.Service'
  $scheduler.Connect()
  $folder = $scheduler.GetFolder('\')
  $definition = $scheduler.NewTask(0)
  $definition.Principal.UserId = $identity.User.Value
  $definition.Principal.LogonType = 3 # TASK_LOGON_INTERACTIVE_TOKEN
  $definition.Principal.RunLevel = 0 # No elevation
  $definition.Settings.DisallowStartIfOnBatteries = $false
  $definition.Settings.StopIfGoingOnBatteries = $false
  $definition.Settings.ExecutionTimeLimit = 'PT0S'
  $action = $definition.Actions.Create(0)
  $action.Path = Join-Path $PSHOME 'powershell.exe'
  $action.Arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Mode launch -BootstrapPipe ' + $BootstrapPipe
  # The task contains only code paths and a public, random pipe address.
  $stage = 'registration'
  $task = $folder.RegisterTaskDefinition($taskName, $definition, 2, $identity.User.Value, $null, 3)
  $registered = $true
  $stage = 'login'
  $null = $task.Run($null)
  $deadline = [DateTime]::UtcNow.AddSeconds(25)
  while (-not $waiting.AsyncWaitHandle.WaitOne(100)) {
    if ($bridge.HasExited) { throw 'Parent closed' }
    if ([DateTime]::UtcNow -gt $deadline) { throw 'No interactive session' }
  }
  $stage = 'authentication'
  $pipe.EndWaitForConnection($waiting)
  $handshake = New-Object byte[] 1
  $reading = $pipe.BeginRead($handshake, 0, 1, $null, $null)
  if (-not $reading.AsyncWaitHandle.WaitOne(3000) -or $pipe.EndRead($reading) -ne 1 -or $handshake[0] -ne 1) { throw 'Invalid client' }
  $account = New-Object Security.Principal.NTAccount($pipe.GetImpersonationUserName())
  $clientSid = $account.Translate([Security.Principal.SecurityIdentifier])
  [uint32]$clientPid = 0
  if ($clientSid.Value -ne $identity.User.Value -or -not [MewDesktopPipe]::GetNamedPipeClientProcessId($pipe.SafePipeHandle, [ref]$clientPid) -or (Get-Process -Id $clientPid).SessionId -eq 0) { throw 'Invalid interactive user' }
  $stage = 'launch'
  $writer = New-Object IO.StreamWriter($pipe, (New-Object Text.UTF8Encoding($false)), 4096, $true)
  $writer.WriteLine(($config | ConvertTo-Json -Compress)); $writer.Flush()
  $reading = $pipe.BeginRead($handshake, 0, 1, $null, $null)
  if (-not $reading.AsyncWaitHandle.WaitOne(5000) -or $pipe.EndRead($reading) -ne 1 -or $handshake[0] -ne 2) { throw 'Launch failed' }
  $config = $null
  $folder.DeleteTask($taskName, 0); $registered = $false
  [Console]::WriteLine('LAUNCHED')
  $reading = $pipe.BeginRead($handshake, 0, 1, $null, $null)
  while (-not $bridge.HasExited -and -not $reading.AsyncWaitHandle.WaitOne(250)) {}

} catch {
  # Do not serialize exceptions/configuration: authentication data stays private.
  [Console]::WriteLine('SESSION_LAUNCH_FAILED:' + $stage)
  exit 1
} finally {
  if ($pipe) { $pipe.Dispose() }
  if ($bridge) { $bridge.Dispose() }
  if ($registered) { try { $folder.DeleteTask($taskName, 0) } catch { [Console]::WriteLine('TASK_CLEANUP_FAILED') } }
}
