import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { desktopWindowsBridgeSpec, desktopWindowsFirewallHint, desktopPathCache, desktopBridgeLookup, DesktopHostLaunchError } from './remote-desktop-host.ts'
import { attachRemoteDesktopWebSocket } from './remote-desktop.ts'

const exec = promisify(execFile)
const spec = { platform: 'wsl' as const, executable: '/fixture/electron.exe', entry: 'C:\\helper\\main.mjs' }

test('signaling forwards the actionable session diagnostic to the viewer', async () => {
  const server = createServer()
  attachRemoteDesktopWebSocket(server, { getAuth: () => ({ role: 'owner', email: 'fixture@example.test', mustChangePassword: false }), spawnHost: async () => { throw new DesktopHostLaunchError('Windows 세션(0): 바탕화면의 터미널에서 실행해 주세요.') } })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/api/remote-desktop/ws`, { origin })
  const messages: { type: string; message?: string }[] = []
  ws.on('message', data => messages.push(JSON.parse(data.toString())))
  try {
    await once(ws, 'close')
    assert.ok(messages.some(message => message.type === 'error' && message.message?.includes('Windows 세션(0)')))
  } finally { ws.terminate(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('WSL bridge preserves Windows entry paths in both service and interactive sessions', async () => {
  const calls: string[][] = []
  let session = 0
  const run = (async (command: string, args: string[]) => {
    calls.push([command, ...args])
    return { stdout: command === 'powershell.exe' ? JSON.stringify({ node: 'C:\\Program Files\\nodejs\\node.exe', session }) : args[0] === '-u' ? '/mnt/c/Program Files/nodejs/node.exe\n' : '\\\\wsl.localhost\\Ubuntu\\bridge.mjs\n', stderr: '' }
  }) as typeof exec
  const service = await desktopWindowsBridgeSpec(spec, run, () => 'powershell.exe')
  session = 1
  const bridge = await desktopWindowsBridgeSpec(spec, run, () => 'powershell.exe')
  assert.deepEqual(bridge, { executable: '/mnt/c/Program Files/nodejs/node.exe', args: ['\\\\wsl.localhost\\Ubuntu\\bridge.mjs', spec.entry] })
  assert.deepEqual(service, bridge)
  assert.ok(calls.every(call => !call.join(' ').includes('Get-NetFirewall')), 'launch never waits for firewall discovery')
})

test('optional firewall discovery reports blocks but tolerates unavailable diagnostics', async () => {
  const run = (async () => ({ stdout: '{"blocked":true,"allowed":false}', stderr: '' })) as unknown as typeof exec
  assert.match((await desktopWindowsFirewallHint(spec, run, () => 'powershell.exe'))!, /방화벽.*runtime\/node.exe/)
  const unavailable = (async () => { throw new Error('timeout') }) as unknown as typeof exec
  assert.equal(await desktopWindowsFirewallHint(spec, unavailable, () => 'powershell.exe'), undefined)
})

test('missing explicit inbound allowance is a hint, while allowed or unknown firewall state stays silent', async () => {
  for (const [state, expected] of [
    ['{"blocked":false,"allowed":false}', true],
    ['{"blocked":false,"allowed":true}', false],
    ['{}', false],
  ] as const) {
    const run = (async () => ({ stdout: state, stderr: '' })) as unknown as typeof exec
    const hint = await desktopWindowsFirewallHint(spec, run, () => 'powershell.exe')
    if (expected) assert.match(hint!, /명시적.*UDP 수신/)
    else assert.equal(hint, undefined)
  }
})

test('private Windows Node avoids PowerShell and overlaps the bridge path conversion', async () => {
  const calls: string[][] = []
  let finish!: (value: { stdout: string; stderr: string }) => void
  const pending = new Promise<{ stdout: string; stderr: string }>(resolve => { finish = resolve })
  const run = (async (command: string, args: string[]) => {
    calls.push([command, ...args])
    if (command === 'wslpath') return pending
    assert.equal(command, '/mnt/c/helper/runtime/node.exe')
    assert.deepEqual(args, ['--version'])
    return { stdout: 'v24.21.0\n', stderr: '' }
  }) as typeof exec
  const result = desktopWindowsBridgeSpec({ ...spec, executable: '/mnt/c/helper/node_modules/electron/dist/electron.exe' }, run, () => { assert.fail('PowerShell must not start') })
  assert.equal(calls.length, 2, 'both independent lookups start before either completes')
  finish({ stdout: '\\\\wsl.localhost\\Ubuntu\\bridge.mjs\n', stderr: '' })
  assert.deepEqual(await result, { executable: '/mnt/c/helper/runtime/node.exe', args: ['\\\\wsl.localhost\\Ubuntu\\bridge.mjs', spec.entry] })
})

test('missing and unsupported private Node retain Windows discovery and launch errors', async () => {
  for (const version of [null, 'v22.11.0', 'invalid']) {
    let powershell = 0
    const run = (async (command: string, args: string[]) => {
      if (command.endsWith('node.exe')) { if (version === null) throw new Error('ENOENT'); return { stdout: version, stderr: '' } }
      if (command === 'powershell.exe') { powershell++; return { stdout: JSON.stringify({ node: 'C:\\Node\\node.exe', session: 0 }), stderr: '' } }
      return { stdout: args[0] === '-u' ? '/mnt/c/Node/node.exe' : 'C:\\bridge.mjs', stderr: '' }
    }) as typeof exec
    assert.equal((await desktopWindowsBridgeSpec(spec, run, () => 'powershell.exe')).executable, '/mnt/c/Node/node.exe')
    assert.equal(powershell, 1)
  }
  const failed = (async () => { throw new Error('unavailable') }) as unknown as typeof exec
  await assert.rejects(desktopWindowsBridgeSpec(spec, failed, () => 'powershell.exe'))
})

test('bridge lookup shares successes only, invalidates on environment/entry changes and expires', async () => {
  let now = 0, probes = 0, broken = false
  const run = (async (command: string) => {
    if (command === 'wslpath') return { stdout: 'C:\\bridge.mjs', stderr: '' }
    probes++
    if (broken) throw new Error('unavailable')
    return { stdout: 'v24.21.0', stderr: '' }
  }) as typeof exec
  const lookup = desktopBridgeLookup(run, () => 'powershell.exe', () => now)
  const env = { PATH: '/one', WSL_INTEROP: '/socket1' }
  await Promise.all([lookup(spec, env), lookup(spec, env)]); assert.equal(probes, 1)
  now = 29_999; await lookup(spec, env); assert.equal(probes, 1)
  now = 30_000; await lookup(spec, env); assert.equal(probes, 2)
  await lookup(spec, { ...env, PATH: '/two' }); assert.equal(probes, 3)
  await lookup(spec, { ...env, WSL_INTEROP: '/socket2' }); assert.equal(probes, 4)
  await lookup({ ...spec, entry: 'C:\\new\\main.mjs' }, env); assert.equal(probes, 5)
  broken = true
  await assert.rejects(lookup(spec, env), DesktopHostLaunchError)
  const failedProbes = probes
  await assert.rejects(lookup(spec, env), DesktopHostLaunchError)
  assert.ok(probes > failedProbes, 'a failed lookup is retried')
  broken = false; await lookup(spec, env)
})

test('path lookup coalesces preparation and launch, expires and retries failures', async () => {
  let calls = 0, now = 0
  const lookup = desktopPathCache(async key => { calls++; if (key === 'bad') throw new Error('unmounted'); return key }, () => now, 100)
  assert.deepEqual(await Promise.all([lookup('a'), lookup('a')]), ['a', 'a']); assert.equal(calls, 1)
  now = 99; await lookup('a'); assert.equal(calls, 1)
  now = 100; await lookup('a'); assert.equal(calls, 2)
  await lookup('b'); assert.equal(calls, 3)
  await assert.rejects(lookup('bad')); await assert.rejects(lookup('bad')); assert.equal(calls, 5)
})

test('isolated Windows native host exchanges authenticated pipe input and cannot outlive its parent', {
  skip: !process.env.MEW_DESKTOP_TEST_WINDOWS_HELPER || !process.env.MEW_DESKTOP_TEST_WINDOWS_NODE, timeout: 50_000,
}, async () => {
  const node = process.env.MEW_DESKTOP_TEST_WINDOWS_NODE!, helper = process.env.MEW_DESKTOP_TEST_WINDOWS_HELPER!
  const local = async (file: string) => process.platform === 'win32' ? file : (await exec('wslpath', ['-u', file])).stdout.trim()
  const temp = (await exec(node, ['-p', 'require("node:os").tmpdir()'])).stdout.trim()
  const root = await fs.mkdtemp(path.join(await local(temp), 'mew-desktop-pipe-test-'))
  const windowsRoot = process.platform === 'win32' ? root : (await exec('wslpath', ['-w', root])).stdout.trim()
  const file = path.join(root, 'native-host.mjs'), native = path.resolve(import.meta.dirname, '../native/remote-desktop')
  let child: ReturnType<typeof spawn> | undefined
  try {
    await fs.mkdir(path.join(root, 'runtime'))
    await fs.copyFile(await local(path.win32.join(helper, 'runtime/node.exe')), path.join(root, 'runtime/node.exe'))
    for (const name of ['windows-session.ps1', 'windows-bridge.mjs', 'parent-channel.mjs']) await fs.copyFile(path.join(native, name), path.join(root, name))
    await fs.writeFile(file, `import {execFile} from 'node:child_process';import {parentChannel} from './parent-channel.mjs';const p=parentChannel();p.output.write('BOOT\\n');p.input.on('data',()=>p.output.write('INPUT\\n'));p.input.on('end',()=>process.exit(0));p.input.on('error',()=>process.exit(1));execFile('powershell.exe',['-NoProfile','-Command','[System.Diagnostics.Process]::GetCurrentProcess().SessionId'],(error,out)=>{if(error)process.exit(2);p.output.write('SESSION '+out.trim()+'\\nREADY\\n')});setTimeout(()=>process.exit(2),7000);`)
    const start = () => spawn(node, [path.win32.join(windowsRoot, 'windows-bridge.mjs'), path.win32.join(windowsRoot, 'native-host.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] })
    child = start()
    let output = '', error = ''
    child.stdout!.on('data', data => { output += data; if (['BOOT', 'INPUT', 'READY'].every(word => output.includes(word))) child!.stdin!.end() })
    child.stderr!.on('data', data => { error += data })
    child.stdin!.on('error', () => {}); child.stdin!.write('init\n')
    assert.equal(await new Promise(resolve => child!.once('close', resolve)), 0, error)
    for (const word of ['BOOT', 'INPUT', 'READY']) assert.match(output, new RegExp(word))
    assert.match(output, /SESSION [1-9]\d*/, 'the host runs in an interactive Windows session')
    // Neither pipe EOF nor a JS watchdog can rescue a blocked native call.
    await fs.writeFile(file, `import {parentChannel} from './parent-channel.mjs';const p=parentChannel();p.input.on('error',()=>{});p.output.write('HUNG '+process.pid+'\\n');setTimeout(()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0),100);`)
    child = start()
    let stalled = ''
    child.stdout!.on('data', data => { stalled += data; if (/HUNG \d+/.test(stalled)) child!.stdin!.end() })
    child.stderr!.resume(); child.stdin!.on('error', () => {}); child.stdin!.write('init\n')
    await once(child, 'close')
    const pid = stalled.match(/HUNG (\d+)/)?.[1]
    assert.ok(pid, stalled)
    const probe = `try{process.kill(${pid},0);console.log('alive')}catch{console.log('gone')}`
    let gone = false
    for (let i = 0; i < 30; i++) {
      if ((await exec(node, ['-e', probe])).stdout.trim() === 'gone') { gone = true; break }
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    assert.ok(gone, 'the stalled host must not outlive its parent')
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'close'); child.kill(); await exited }
    await exec(node, ['-e', 'require("node:fs").rmSync(process.argv[1],{recursive:true,force:true,maxRetries:20,retryDelay:200})', windowsRoot])
  }
})
