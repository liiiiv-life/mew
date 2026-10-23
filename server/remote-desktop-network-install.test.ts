import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { wslPowerShell } from '../native/remote-desktop/wsl-powershell.mjs'
const run = promisify(execFile)

// Fixed firewall/UAC functions are mocked. This never changes Windows policy.
test('Windows UDP preparation preserves blocks/conflicts and asks UAC only for the private Node rule', {
  skip: process.platform !== 'linux' || !process.env.MEW_DESKTOP_TEST_WINDOWS_HELPER || !process.env.MEW_DESKTOP_TEST_WINDOWS_NODE, timeout: 15_000,
}, async () => {
  const helper = process.env.MEW_DESKTOP_TEST_WINDOWS_HELPER!
  const root = (await run('wslpath', ['-u', helper])).stdout.trim()
  const source = await fs.readFile('native/remote-desktop/prepare-windows-network.ps1', 'utf8')
  const target = path.join(root, 'network-policy-test.ps1'), wrapper = path.join(root, 'network-policy-wrapper.ps1')
  await fs.writeFile(target, source)
  const escaped = helper.replaceAll("'", "''")
  await fs.writeFile(wrapper, `param([string]$Case)
$target = '${escaped}'
$expectedProgram = Join-Path $target 'runtime\\node.exe'
function Get-NetFirewallApplicationFilter { @{Program=$expectedProgram} }
function Get-NetFirewallRule {
 param($Name,$ErrorAction)
 if($Case -eq 'blocked'){ return @{Enabled='True';Direction='Inbound';Action='Block'} }
 if($Name -and ($Case -eq 'ready' -or $Case -eq 'conflict')){ return @{Enabled='True';Direction='Inbound';Action=$(if($Case -eq 'ready'){'Allow'}else{'Block'});Profile='Any'} }
}
function Get-NetFirewallPortFilter { @{Protocol='UDP';LocalPort='Any'} }
function Start-Process {
 param($FilePath,$ArgumentList,$Verb,[switch]$PassThru,[switch]$Wait)
 if($Verb -ne 'RunAs' -or $ArgumentList -notmatch 'network-policy-test.ps1' -or $ArgumentList -notmatch '-Elevated'){throw 'Wrong UAC action'}
 Write-Host 'TEST_UAC_REQUESTED';throw 'UAC cancelled by fixture'
}
function New-NetFirewallRule {
 param($Name,$DisplayName,$Description,$Direction,$Action,$Program,$Protocol,$Profile,$PolicyStore,$ErrorAction)
 if($Program -ne $expectedProgram -or $Protocol -ne 'UDP' -or $Direction -ne 'Inbound' -or $Action -ne 'Allow' -or $Profile -ne 'Any' -or $PolicyStore -ne 'PersistentStore'){throw 'Wrong rule scope'}
 Write-Output 'TEST_RULE_DECLARED'
}
$errors=$null;$tokens=$null;[void][Management.Automation.Language.Parser]::ParseFile((Join-Path $target 'network-policy-test.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Invalid network preparation syntax'}
& (Join-Path $target 'network-policy-test.ps1') -Target $target
exit $LASTEXITCODE
`)
  try {
    for (const scenario of ['ready', 'blocked', 'conflict', 'missing']) {
      let output = '', status = 0
      try { output = (await run(wslPowerShell(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.win32.join(helper, 'network-policy-wrapper.ps1'), '-Case', scenario], { timeout: 5000 })).stdout }
      catch (error) { const value = error as { code: number; stdout: string }; status = value.code; output = value.stdout }
      if (scenario === 'ready') { assert.equal(status, 0); assert.match(output, /MEW_NETWORK_READY/); assert.ok(!output.includes('TEST_UAC')) }
      else if (scenario === 'missing') { assert.ok(status === 2 && output.includes('TEST_UAC_REQUESTED') || status === 0 && output.includes('MEW_NETWORK_READY'), `${scenario}: ${status}: ${output}`) }
      else { assert.equal(status, 2); assert.ok(!output.includes('TEST_UAC')); assert.ok(!output.includes('MEW_NETWORK_READY')) }
    }
  } finally { await Promise.all([fs.rm(target, { force: true }), fs.rm(wrapper, { force: true })]) }
})
