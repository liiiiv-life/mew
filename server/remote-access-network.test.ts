import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRemoteNetworkPreparation } from './remote-access-network.ts'
import { wslPowerShell } from '../native/remote-desktop/wsl-powershell.mjs'

const output = (state: string, reason: string) => ({ stdout: JSON.stringify({ state, reason }) })
const options = { platform: 'linux' as const, kernel: 'microsoft-standard-WSL2', resolvePowerShell: () => '/fixture/powershell.exe' }

test('WSL inspection is read-only, caches results and never converts failures into readiness', async () => {
  const calls: string[][] = []
  let clock = 100
  const preparation = createRemoteNetworkPreparation({ ...options, now: () => clock, run: async (command, args) => {
    calls.push([command, ...args])
    if (command === 'wslpath') return { stdout: '\\\\wsl.localhost\\Ubuntu\\repo\\server\\remote-access-network.ps1\n' }
    assert.ok(args.includes('-CheckOnly'))
    throw Object.assign(new Error('private command output must stay hidden'), output('blocked', 'approval-required'))
  } })
  const first = await preparation.check()
  assert.equal(first.state, 'blocked'); assert.equal(first.reason, 'approval-required')
  await preparation.check(); assert.equal(calls.length, 2)
  clock += 30_001
  await preparation.check(); assert.equal(calls.length, 4)
  assert.ok(!JSON.stringify(first).includes('private command output'))
})

test('concurrent explicit preparation waits for an existing check, deduplicates UAC and exposes preparing', async () => {
  let unblock!: () => void, preparingCalls = 0
  const barrier = new Promise<void>(resolve => { unblock = resolve })
  const preparation = createRemoteNetworkPreparation({ ...options, run: async (command, args) => {
    if (command === 'wslpath') return { stdout: 'C:\\fixture\\remote-access-network.ps1' }
    if (args.includes('-CheckOnly')) { await barrier; return output('blocked', 'approval-required') }
    preparingCalls++; return output('ready', 'wsl-udp-rule')
  } })
  const check = preparation.check(), first = preparation.prepare(), second = preparation.prepare()
  assert.equal(first, second)
  assert.deepEqual(await preparation.check(), { state: 'preparing' })
  assert.equal(preparingCalls, 0)
  unblock(); await check
  assert.deepEqual(await first, { state: 'ready', reason: 'wsl-udp-rule' })
  assert.equal(preparingCalls, 1)
  assert.equal((await preparation.check()).state, 'ready')
})

test('UAC cancellation remains explicit and a later click can retry without automatic prompts', async () => {
  let runs = 0
  const preparation = createRemoteNetworkPreparation({ platform: 'win32', env: { SystemRoot: 'D:\\Windows' }, executable: "C:\\Mew's app\\node.exe", run: async (command, args, execution) => {
    assert.equal(command, 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    assert.deepEqual(args.slice(-4), ['-Mode', 'Windows', '-Program', "C:\\Mew's app\\node.exe"])
    assert.equal(execution.timeout, 180_000)
    runs++
    if (runs === 1) throw Object.assign(new Error('not for user'), output('blocked', 'approval-cancelled'))
    return output('ready', 'windows-udp-rule')
  } })
  assert.equal((await preparation.prepare()).reason, 'approval-cancelled')
  assert.equal((await preparation.check()).reason, 'approval-cancelled'); assert.equal(runs, 1)
  assert.equal((await preparation.prepare()).state, 'ready'); assert.equal(runs, 2)
})

test('unsupported platforms, interop failure, invalid paths and unexpected command output are unknown', async () => {
  for (const platform of ['darwin', 'linux'] as const) {
    const preparation = createRemoteNetworkPreparation({ platform, kernel: 'ordinary-kernel', run: async () => assert.fail('unmanaged OS must not run Windows preparation') })
    assert.deepEqual(await preparation.check(), { state: 'unknown', reason: 'platform-unmanaged' })
    assert.deepEqual(await preparation.prepare(), { state: 'unknown', reason: 'platform-unmanaged' })
  }
  const interop = createRemoteNetworkPreparation({ ...options, resolvePowerShell: () => { throw new Error('private host path') } })
  assert.equal((await interop.check()).reason, 'windows-unavailable')
  const invalid = createRemoteNetworkPreparation({ ...options, run: async () => ({ stdout: 'C:\\fixture\n-injected' }) })
  assert.equal((await invalid.prepare()).state, 'unknown')
  for (const stdout of ['secret trace', '{"state":"ready","reason":"anything"}', '{"state":"ready","reason":"approval-required"}']) {
    const preparation = createRemoteNetworkPreparation({ platform: 'win32', run: async () => ({ stdout }) })
    const status = await preparation.check()
    assert.equal(status.state, 'unknown'); assert.equal(status.reason, 'policy-query-failed')
    assert.ok(!JSON.stringify(status).includes('secret trace'))
  }
})

const execute = promisify(execFile)
let powerShell = ''
try { if (process.platform === 'linux') powerShell = wslPowerShell() } catch { /* Optional Windows parser/fixture coverage. */ }

async function executePowerShellFixture(source: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-network-policy-'))
  try {
    const filename = path.join(directory, 'fixture.ps1')
    await fs.writeFile(filename, source)
    const translated = await execute('wslpath', ['-w', filename], { timeout: 5000 })
    return await execute(powerShell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', translated.stdout.trim()], { timeout: 15_000, maxBuffer: 8192 })
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
}

test('fixed PowerShell preserves policy, scopes UDP and requests UAC once using mocked Windows commands', { skip: !powerShell, timeout: 30_000 }, async () => {
  const source = await fs.readFile(new URL('./remote-access-network.ps1', import.meta.url), 'utf8')
  const scenarios = ['check-missing', 'check-denied', 'prepare-denied', 'ready', 'block', 'conflict', 'restricted', 'profile', 'create', 'cancel', 'elevated-denied', 'policy-ignored', 'policy-delayed', 'local-rules-disabled', 'inactive-policy', 'local-rules-disabled-boolean', 'firewall-disabled-boolean', 'numeric-profiles', 'reserved-local-name', 'unknown-generated']
  await Promise.all(scenarios.map(async scenario => {
    const fixture = `
$case = '${scenario}'
$script:created = $false
$script:queries = 0
function Get-NetConnectionProfile { @{NetworkCategory='Public'} }
function Get-NetFirewallHyperVProfile {
  param($PolicyStore,$Name,$ErrorAction)
  @{Profile='Public';Enabled=$(if($case -eq 'firewall-disabled-boolean'){$false}elseif($case -match 'boolean'){$true}else{'True'});AllowLocalFirewallRules=$(if($case -eq 'local-rules-disabled'){'False'}elseif($case -match 'boolean'){$false}else{'True'})}
  if ($case -eq 'inactive-policy') { @{Profile='Domain';Enabled='True';AllowLocalFirewallRules='False'} }
}
function Get-NetFirewallHyperVRule {
  param($PolicyStore,$ErrorAction)
  if ($case -in @('check-denied','prepare-denied')) { throw 'Access denied' }
  if ($script:created -and $PolicyStore -eq 'ActiveStore') { $script:queries++ }
  if ($case -eq 'policy-delayed' -and $script:created -and $script:queries -lt 3) { return }
  if ($PolicyStore -eq 'ActiveStore') {
    foreach ($profile in @('DOMAIN','PRIVATE','PUBLIC')) { @{Name=('MPSSVC_DEFAULT_RULE_INBOUND_' + $profile + '_{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}');VMCreatorId='{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}';Enabled='True';Direction='Inbound';Action='Block';Protocol='Any';LocalPorts='Any';PolicyStoreSourceType=5;RulePriority=65335} }
    @{Name='MPSSVC_CONSTRAINED_INTERFACE_RULE_INBOUND_BLOCK';VMCreatorId='Any';Enabled='True';Direction='Inbound';Action='Block';Protocol='Any';LocalPorts='Any';PolicyStoreSourceType='Hardcoded';RulePriority=2;Profiles=0}
  }
  if ($case -in @('reserved-local-name','unknown-generated')) { return @{Name=$(if($case -eq 'reserved-local-name'){'MPSSVC_CONSTRAINED_INTERFACE_RULE_INBOUND_BLOCK'}else{'unknown-system-rule'});VMCreatorId='{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}';Enabled='True';Direction='Inbound';Action='Block';Protocol='UDP';LocalPorts='55000-55031';PolicyStoreSourceType=$(if($case -eq 'reserved-local-name'){1}else{5});RulePriority=2;Profiles=0} }
  if ($case -eq 'block') { return @{Name='unrelated';VMCreatorId='{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}';Enabled='True';Direction='Inbound';Action='Block';Protocol='UDP';LocalPorts='55007'} }
  if ($case -in @('ready','conflict','restricted','profile','local-rules-disabled','inactive-policy','local-rules-disabled-boolean','firewall-disabled-boolean','numeric-profiles') -or $script:created) { return @{Name='Mewlink-ICE-UDP-55000-55031';VMCreatorId='{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}';Enabled='True';Direction='Inbound';Action='Allow';Protocol=$(if($case -eq 'conflict'){'TCP'}else{'UDP'});LocalPorts='55000-55031';RemoteAddresses=$(if($case -eq 'restricted'){'127.0.0.1'}else{'Any'});Profiles=$(if($case -eq 'profile'){'Private'}elseif($case -eq 'numeric-profiles'){0}else{'Any'})} }
}
function New-NetFirewallHyperVRule {
  param($PolicyStore,$Name,$DisplayName,$Direction,$VMCreatorId,$Protocol,$LocalPorts,$LocalAddresses,$RemoteAddresses,$RemotePorts,$Action,$Enabled,$ErrorAction)
  if ($PolicyStore -ne 'PersistentStore' -or $Name -ne 'Mewlink-ICE-UDP-55000-55031' -or $Direction -ne 'Inbound' -or $VMCreatorId -ne '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -or $Protocol -ne 'UDP' -or $LocalPorts -ne '55000-55031' -or $LocalAddresses -ne 'Any' -or $RemoteAddresses -ne 'Any' -or $RemotePorts -ne 'Any' -or $Action -ne 'Allow' -or $Enabled -ne 'True') { throw 'Wrong rule scope' }
  if ($case -ne 'policy-ignored') { $script:created = $true }
}
function Start-Process {
  param($FilePath,$ArgumentList,$Verb,[switch]$PassThru,[switch]$Wait)
  if ($case -eq 'prepare-denied') { return @{ExitCode=0} }
  if ($case -ne 'cancel' -or $Verb -ne 'RunAs' -or $ArgumentList -notmatch '-Elevated' -or $ArgumentList -match '-Program') { throw 'Unexpected elevation' }
  throw (New-Object ComponentModel.Win32Exception(1223))
}
${source.replace(/^param\([^\n]+\)\n/, "$Mode='Wsl';$Program='';$CheckOnly=($case -in @('check-missing','check-denied'));$Elevated=($case -eq 'elevated-denied')\n").replace('$isAdministrator = Test-MewAdministrator', "$isAdministrator = ($case -in @('create','policy-ignored','policy-delayed'))")}
`
    let stdout = '', exitCode = 0
    try { stdout = (await executePowerShellFixture(fixture)).stdout }
    catch (error) { stdout = (error as { stdout: string }).stdout; exitCode = (error as { code: number }).code }
    const result = JSON.parse(stdout.trim())
    if (['ready', 'create', 'prepare-denied', 'policy-delayed', 'inactive-policy', 'firewall-disabled-boolean', 'numeric-profiles'].includes(scenario)) { assert.equal(exitCode, 0, scenario); assert.equal(result.state, 'ready', scenario) }
    else { assert.notEqual(exitCode, 0, scenario); assert.notEqual(result.state, 'ready', scenario) }
    if (scenario === 'check-missing') assert.equal(result.reason, 'approval-required')
    if (scenario === 'check-denied') assert.equal(result.reason, 'policy-query-failed')
    if (scenario === 'cancel') assert.equal(result.reason, 'approval-cancelled')
    if (['block', 'reserved-local-name', 'unknown-generated'].includes(scenario)) assert.equal(result.reason, 'explicit-block')
    if (['conflict', 'restricted', 'profile'].includes(scenario)) assert.equal(result.reason, 'rule-conflict')
    if (scenario === 'elevated-denied') assert.equal(result.reason, 'elevation-failed')
    if (scenario === 'policy-ignored') assert.equal(result.reason, 'verification-failed')
    if (scenario === 'local-rules-disabled' || scenario === 'local-rules-disabled-boolean') assert.equal(result.reason, 'policy-blocked')
  }))
})

test('native Windows preparation restricts the real Node path and preserves conflicting policy', { skip: !powerShell, timeout: 20_000 }, async () => {
  const source = await fs.readFile(new URL('./remote-access-network.ps1', import.meta.url), 'utf8')
  await Promise.all(['missing', 'ready', 'blocked', 'restricted', 'create', 'inbound-disabled', 'local-rules-disabled', 'inactive-policy', 'inbound-disabled-boolean', 'local-rules-disabled-boolean', 'firewall-disabled-boolean'].map(async scenario => {
    const fixture = `
$case='${scenario}';$script:created=$false
function Test-Path { param($LiteralPath,$PathType); return $true }
function Get-NetConnectionProfile { @{NetworkCategory='Public'} }
function Get-NetFirewallProfile {
  param($PolicyStore,$ErrorAction)
  @{Name='Public';Enabled=$(if($case -eq 'firewall-disabled-boolean'){$false}elseif($case -match 'boolean'){$true}else{'True'});AllowInboundRules=$(if($case -eq 'inbound-disabled'){'False'}elseif($case -eq 'inbound-disabled-boolean' -or $case -eq 'firewall-disabled-boolean'){$false}elseif($case -match 'boolean'){$true}else{'True'});AllowLocalFirewallRules=$(if($case -eq 'local-rules-disabled'){'False'}elseif($case -eq 'local-rules-disabled-boolean' -or $case -eq 'firewall-disabled-boolean'){$false}elseif($case -match 'boolean'){$true}else{'True'})}
  if ($case -eq 'inactive-policy') { @{Name='Domain';Enabled='True';AllowInboundRules='False';AllowLocalFirewallRules='False'} }
}
function Get-NetFirewallRule {
  param($PolicyStore,$ErrorAction)
  if ($case -eq 'blocked') { return @{Name='existing-denial';Enabled='True';Direction='Inbound';Action='Block';Profile='Any'} }
  if ($case -in @('ready','restricted','inbound-disabled','local-rules-disabled','inactive-policy','inbound-disabled-boolean','local-rules-disabled-boolean','firewall-disabled-boolean') -or $script:created) { return @{Name=$ruleName;Enabled='True';Direction='Inbound';Action='Allow';Profile='Any'} }
}
function Get-NetFirewallApplicationFilter { process { @{Program=$Program} } }
function Get-NetFirewallPortFilter { process { @{Protocol='UDP';LocalPort='55000-55031';RemotePort='Any'} } }
function Get-NetFirewallAddressFilter { process { @{LocalAddress='Any';RemoteAddress=$(if($case -eq 'restricted'){'127.0.0.1'}else{'Any'})} } }
function Start-Process { throw 'Must never elevate during a check or when already administrator' }
function New-NetFirewallRule {
  param($PolicyStore,$Name,$DisplayName,$Direction,$Program,$Protocol,$LocalPort,$LocalAddress,$RemoteAddress,$RemotePort,$Action,$Enabled,$Profile,$ErrorAction)
  if ($Program -ne 'C:\\Mew''s $(literal) app\\node.exe' -or $Name -notmatch '^Mewlink-ICE-UDP-[A-F0-9]{16}$' -or $PolicyStore -ne 'PersistentStore' -or $Direction -ne 'Inbound' -or $Protocol -ne 'UDP' -or $LocalPort -ne '55000-55031' -or $LocalAddress -ne 'Any' -or $RemoteAddress -ne 'Any' -or $RemotePort -ne 'Any' -or $Action -ne 'Allow' -or $Enabled -ne 'True' -or $Profile -ne 'Any') { throw 'Wrong Windows scope' }
  $script:created=$true
}
${source.replace(/^param\([^\n]+\)\n/, "$Mode='Windows';$Program='C:\\Mew''s $(literal) app\\node.exe';$CheckOnly=($case -eq 'missing');$Elevated=$false\n").replace('$isAdministrator = Test-MewAdministrator', '$isAdministrator = $true')}
`
    let stdout = '', code = 0
    try { stdout = (await executePowerShellFixture(fixture)).stdout }
    catch (error) { stdout = (error as { stdout: string }).stdout; code = (error as { code: number }).code }
    const result = JSON.parse(stdout.trim())
    if (['ready', 'create', 'inactive-policy', 'firewall-disabled-boolean'].includes(scenario)) { assert.equal(code, 0, scenario); assert.equal(result.reason, 'windows-udp-rule', scenario) }
    else { assert.notEqual(code, 0, scenario); assert.equal(result.reason, scenario === 'blocked' ? 'explicit-block' : scenario === 'restricted' ? 'rule-conflict' : scenario.includes('disabled') ? 'policy-blocked' : 'approval-required', scenario) }
  }))
})
