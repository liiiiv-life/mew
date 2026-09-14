import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { desktopHostSpec, desktopWindowsBridgeSpec, DesktopHostLaunchError } from './remote-desktop-host.ts'
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
  let firewallBlocked = false
  const run = (async (command: string, args: string[]) => {
    calls.push([command, ...args])
    return { stdout: command === 'powershell.exe' ? JSON.stringify({ node: 'C:\\Program Files\\nodejs\\node.exe', session, firewallBlocked }) : args[0] === '-u' ? '/mnt/c/Program Files/nodejs/node.exe\n' : '\\\\wsl.localhost\\Ubuntu\\bridge.mjs\n', stderr: '' }
  }) as typeof exec
  const service = await desktopWindowsBridgeSpec(spec, run, () => 'powershell.exe')
  session = 1
  const bridge = await desktopWindowsBridgeSpec(spec, run, () => 'powershell.exe')
  assert.deepEqual(bridge, { executable: '/mnt/c/Program Files/nodejs/node.exe', args: ['\\\\wsl.localhost\\Ubuntu\\bridge.mjs', spec.entry] })
  assert.deepEqual(service, bridge)
  firewallBlocked = true
  const blocked = await desktopWindowsBridgeSpec(spec, run, () => 'powershell.exe')
  assert.match(blocked.networkHint!, /방화벽.*재설치는 필요하지/)
  assert.deepEqual(blocked.args, bridge.args, 'an inactive firewall profile or TURN may still permit a connection')
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
