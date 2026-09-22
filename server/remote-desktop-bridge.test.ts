import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { desktopHostSpec, desktopWindowsBridgeSpec, desktopWindowsFirewallHint, desktopPathCache, desktopBridgeLookup, DesktopHostLaunchError } from './remote-desktop-host.ts'
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
  const run = (async () => ({ stdout: 'true', stderr: '' })) as unknown as typeof exec
  assert.match((await desktopWindowsFirewallHint(spec, run, () => 'powershell.exe'))!, /방화벽.*재설치는 필요하지/)
  const unavailable = (async () => { throw new Error('timeout') }) as unknown as typeof exec
  assert.equal(await desktopWindowsFirewallHint(spec, unavailable, () => 'powershell.exe'), undefined)
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

test('real Windows Electron starts in the login session, exchanges pipe input and exits with parent', { skip: !process.env.MEW_DESKTOP_TEST_WINDOWS_NODE, timeout: 50000 }, async () => {
  const host = await desktopHostSpec()
  const root = path.resolve(host.executable, '../../../../'), name = `mew-ipc-test-${process.pid}.mjs`, file = path.join(root, name)
  const source = `import {app, desktopCapturer} from 'electron'; import {parentChannel} from './parent-channel.mjs'; const p=parentChannel(); p.output.write('BOOT\\n'); p.input.on('data',()=>p.output.write('INPUT\\n')); p.input.on('end',()=>app.exit(0)); p.input.on('error',()=>app.exit(1)); app.whenReady().then(async()=>{const screens=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:0,height:0},fetchWindowIcons:false});p.output.write('SCREENS '+screens.length+'\\n');p.output.write('READY\\n')}); setTimeout(()=>app.exit(2),7000);`
  await fs.writeFile(file, source)
  const launcher = path.join(root, 'windows-session.ps1')
  const previous = await fs.readFile(launcher).catch(() => null)
  await fs.copyFile(path.resolve(import.meta.dirname, '../native/remote-desktop/windows-session.ps1'), launcher)
  let child: ReturnType<typeof spawn> | undefined
  try {
    const bridge = (await exec('wslpath', ['-w', path.resolve(import.meta.dirname, '../native/remote-desktop/windows-bridge.mjs')])).stdout.trim()
    child = spawn(process.env.MEW_DESKTOP_TEST_WINDOWS_NODE!, [bridge, path.win32.join(path.win32.dirname(host.entry), name)], { stdio: ['pipe', 'pipe', 'pipe'] })
    let output = '', error = ''
    child.stdout!.on('data', data => { output += data; if (['BOOT', 'INPUT', 'READY'].every(word => output.includes(word))) child!.stdin!.end() })
    child.stderr!.on('data', data => { error += data })
    child.stdin!.on('error', () => {})
    child.stdin!.write('init\n')
    const code = await new Promise(resolve => child!.once('close', resolve))
    assert.equal(code, 0, error)
    for (const word of ['BOOT', 'INPUT', 'READY']) assert.match(output, new RegExp(word))
    assert.match(output, /SCREENS [1-9]/, 'the interactive session exposes an actual screen')
    // Simulate a blocked native/event-loop call: pipe EOF and JS timers cannot
    // rescue it. The broker must terminate the exact process it launched.
    await fs.writeFile(file, `import {app} from 'electron';import {parentChannel} from './parent-channel.mjs';const p=parentChannel();p.input.on('error',()=>{});app.whenReady().then(()=>{p.output.write('HUNG '+process.pid+'\\n');setTimeout(()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0),100)});`)
    child = spawn(process.env.MEW_DESKTOP_TEST_WINDOWS_NODE!, [bridge, path.win32.join(path.win32.dirname(host.entry), name)], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stalled = ''
    child.stdout!.on('data', data => { stalled += data; if (/HUNG \d+/.test(stalled)) child!.stdin!.end() })
    child.stderr!.resume(); child.stdin!.on('error', () => {}); child.stdin!.write('init\n')
    await once(child, 'close')
    const pid = stalled.match(/HUNG (\d+)/)?.[1]
    assert.ok(pid, stalled)
    const probe = `try{process.kill(${pid},0);console.log('alive')}catch{console.log('gone')}`
    let gone = false
    for (let i = 0; i < 30; i++) {
      if ((await exec(process.env.MEW_DESKTOP_TEST_WINDOWS_NODE!, ['-e', probe])).stdout.trim() === 'gone') { gone = true; break }
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    assert.ok(gone, 'the stalled Electron must not outlive its parent')
  } finally {
    child?.kill(); await fs.rm(file, { force: true })
    if (previous) await fs.writeFile(launcher, previous); else await fs.rm(launcher, { force: true })
  }
})
