import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import express from 'express'
import { createDesktopInstaller, DESKTOP_INSTALL_SESSION } from './remote-desktop-install.ts'
import { createRemoteDesktopRoutes } from './remote-desktop.ts'
import { installDesktopRuntime } from '../native/remote-desktop/install-runtime.mjs'
import { installDesktopHelper } from '../native/remote-desktop/install.mjs'
import { installMacCapture } from '../native/remote-desktop/install-macos.mjs'
import { wslPowerShell } from '../native/remote-desktop/wsl-powershell.mjs'
import { desktopHostSpec, desktopHostStatus } from './remote-desktop-host.ts'
import { HELPER_FILES, helperVersion, markHelperReady, dependenciesCurrent } from '../native/remote-desktop/helper-version.mjs'
import type { RequestAuth } from './reqAuth.ts'

const exec = promisify(execFile)

test('readiness distinguishes missing runtime, discovery failure, permission failure and success', async () => {
  const options = { platform: 'wsl' as const, env: {}, current: async () => true, getSpec: async () => ({ platform: 'wsl' as const, executable: '/fixture/electron.exe', entry: 'C:\\fixture\\main.mjs' }) }
  const missing = await desktopHostStatus({ ...options, access: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) } })
  assert.equal(missing.installable, true); assert.match(missing.message!, /준비/)
  const discovery = await desktopHostStatus({ ...options, getSpec: async () => { throw new Error('PowerShell unavailable') } })
  assert.equal(discovery.installable, false); assert.match(discovery.message!, /PowerShell unavailable/)
  const denied = await desktopHostStatus({ ...options, access: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) } })
  assert.equal(denied.installable, false)
  assert.equal((await desktopHostStatus({ ...options, access: async () => {} })).ready, true)
  const stale = await desktopHostStatus({ ...options, access: async () => {}, current: async () => false })
  assert.equal(stale.ready, false); assert.equal(stale.installable, true)
})

test('helper content updates invalidate readiness while unchanged dependencies can be reused', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-helper-version-'))
  try {
    for (const file of HELPER_FILES) await fs.copyFile(path.resolve(import.meta.dirname, '../native/remote-desktop', file), path.join(root, file))
    for (const name of ['electron', 'koffi', 'dbus-next']) {
      await fs.mkdir(path.join(root, 'node_modules', name), { recursive: true })
      await fs.writeFile(path.join(root, 'node_modules', name, 'package.json'), '{}')
    }
    markHelperReady(root)
    const before = helperVersion(root)
    assert.equal(dependenciesCurrent(root), true)
    await fs.appendFile(path.join(root, 'main.mjs'), '\n// update fixture\n')
    assert.notEqual(helperVersion(root), before)
    assert.equal(dependenciesCurrent(root), true)
    await fs.appendFile(path.join(root, 'package-lock.json'), '\n')
    assert.equal(dependenciesCurrent(root), false)
    markHelperReady(root)
    await fs.rm(path.join(root, 'node_modules/koffi/package.json'))
    assert.equal(dependenciesCurrent(root), false)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('Electron installation explicitly downloads and verifies the binary on every OS', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const executable = platform === 'win32' ? 'electron.exe' : platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron'
    const output: string[] = [], commands: string[][] = []
    const options = { target: '/fixture', platform, log: (line: string) => output.push(line), run: (command: string, args: string[]) => { commands.push([command, ...args]); return { status: 0 } }, exists: () => true, read: (file: string) => file.endsWith('package.json') ? '{"version":"44.3.0"}' : file.endsWith('path.txt') ? executable : '44.3.0' }
    assert.equal(installDesktopRuntime(options), 0)
    assert.deepEqual(commands, [[process.execPath, '/fixture/node_modules/electron/install.js']])
    assert.match(output.at(-1)!, /installed and verified/)
    assert.throws(() => installDesktopRuntime({ ...options, exists: () => false }), /executable is missing/)
    assert.throws(() => installDesktopRuntime({ ...options, exists: file => !file.endsWith('LICENSES.chromium.html') }), /distribution notice is missing/)
    assert.throws(() => installDesktopRuntime({ ...options, read: file => file.endsWith('package.json') ? '{"version":"43.0.0"}' : options.read(file) }), /does not match/)
    assert.equal(installDesktopRuntime({ ...options, run: () => ({ status: 19 }) }), 19)
    assert.throws(() => installDesktopRuntime({ ...options, run: () => ({ status: null, error: new Error('ETIMEDOUT') }) }), /network.*retry/)
  }
})

test('a dedicated installer starts in an isolated real tmux and keeps completion output', { timeout: 10000 }, async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-tmux-install-'))
  const appRoot = path.join(temporary, 'app')
  await fs.mkdir(path.join(appRoot, 'native/remote-desktop'), { recursive: true })
  await fs.writeFile(path.join(appRoot, 'native/remote-desktop/install.mjs'), 'console.log("INSTALL_FIXTURE_COMPLETE")')
  const script = `
    import { createTmuxManager } from ${JSON.stringify(new URL('../packages/tmux-term/src/server/tmux.ts', import.meta.url).href)};
    import { createDesktopInstaller } from ${JSON.stringify(new URL('./remote-desktop-install.ts', import.meta.url).href)};
    const tmux = createTmuxManager({cwd: ${JSON.stringify(appRoot)}});
    const installer = createDesktopInstaller(tmux, {appRoot: ${JSON.stringify(appRoot)}, directory: ${JSON.stringify(path.join(temporary, 'state'))}, platform:'linux'});
    try {
      await installer.start();
      for(let i=0;i<100;i++) { if((await installer.status()).state==='succeeded') break; await new Promise(r=>setTimeout(r,25)); }
      console.log(JSON.stringify(await installer.status()));
      console.log(await tmux.capture('mewcmd-desktop-install'));
    } finally { await tmux.kill('mewcmd-desktop-install'); }
  `
  try {
    const result = await exec(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TMUX: '', TMUX_TMPDIR: temporary }, timeout: 8000 })
    assert.match(result.stdout, /"state":"succeeded"/)
    assert.match(result.stdout, /"terminal":true/)
    assert.match(result.stdout, /INSTALL_FIXTURE_COMPLETE/)
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }
})

async function fixture() {
  // Shell metacharacters in a legitimate installation path must stay literal.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mew desktop's $(false)-"))
  const directory = path.join(root, 'state'), appRoot = path.join(root, 'app')
  await fs.mkdir(path.join(appRoot, 'native/remote-desktop'), { recursive: true })
  const entry = path.join(appRoot, 'native/remote-desktop/install.mjs')
  await fs.writeFile(entry, 'console.log("fixture only"); process.exitCode = 7')
  let alive = false, command = '', runs = 0, kills = 0
  const tmux = {
    async list() { return alive ? [{ name: DESKTOP_INSTALL_SESSION, createdAt: 0, windows: 1, attached: false }] : [] },
    async kill(name: string) { assert.equal(name, DESKTOP_INSTALL_SESSION); alive = false; kills++ },
    async startCommand(name: string, value: string, cwd: string) { assert.equal(name, DESKTOP_INSTALL_SESSION); assert.equal(cwd, appRoot); assert.ok(value.endsWith("; exec /bin/sh -i")); command = value.slice(0, -"; exec /bin/sh -i".length); alive = true; runs++ },
  }
  const options = { directory, appRoot, platform: 'wsl' as const, env: { PATH: process.env.PATH, WSL_INTEROP: '/fixture/socket' } }
  const installer = createDesktopInstaller(tmux, options)
  return { root, entry, directory, appRoot, installer, tmux, options, get runs() { return runs }, get kills() { return kills }, execute: () => exec('/bin/sh', ['-c', command], { cwd: appRoot }), remove: () => fs.rm(root, { recursive: true, force: true }) }
}

test('fixed tmux installer deduplicates starts, preserves failure output and survives server recreation', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.installer.status()).state, 'idle')
    const jobs = await Promise.all([f.installer.start(), f.installer.start(), f.installer.start()])
    assert.equal(f.runs, 1); assert.ok(jobs.every(job => job.state === 'running'))
    await assert.rejects(f.execute(), (error: Error & { code: number; stdout: string }) => error.code === 7 && error.stdout.includes('fixture only'))
    assert.deepEqual(await f.installer.status(), { session: DESKTOP_INSTALL_SESSION, terminal: true, state: 'failed', exitCode: 7 })
    assert.equal(f.kills, 0, 'completed output remains in tmux')
    const restored = createDesktopInstaller(f.tmux, f.options)
    assert.equal((await restored.status()).state, 'failed')
    await fs.writeFile(f.entry, 'console.log(process.env.WSL_INTEROP); console.log(process.env.MEW_DESKTOP_HELPER_DIR ?? "unset")')
    await restored.start()
    assert.equal(f.runs, 2); assert.equal(f.kills, 1)
    const result = await f.execute()
    assert.match(result.stdout, /\/fixture\/socket\nunset/)
    assert.equal((await restored.status()).state, 'succeeded')
    assert.equal((await fs.stat(path.join(f.directory, 'exit-code'))).mode & 0o777, 0o600)
    await restored.start(); await f.tmux.kill(DESKTOP_INSTALL_SESSION)
    assert.equal((await restored.status()).state, 'interrupted')
  } finally { await f.remove() }
})

test('install endpoints require a privileged role and ignore submitted commands/paths', async () => {
  const f = await fixture()
  let auth: RequestAuth = { role: 'guest', email: null, mustChangePassword: false }
  const app = express()
  app.use(express.json(), (req, _res, next) => { req.auth = auth; next() })
  app.use('/remote-desktop', createRemoteDesktopRoutes(f.tmux, f.installer))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/remote-desktop/install`
  try {
    assert.equal((await fetch(url)).status, 403)
    auth = { ...auth, role: 'member', email: 'fixture@example.test' }
    assert.equal((await fetch(url, { method: 'POST' })).status, 403)
    assert.equal(f.runs, 0)
    auth.role = 'manager'
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'touch /never-run', cwd: '/', session: 'other-session' }) })
    assert.equal(response.status, 200)
    assert.equal((await response.json() as { session: string }).session, DESKTOP_INSTALL_SESSION)
    assert.equal(f.runs, 1)
    auth.role = 'owner'
    assert.equal((await (await fetch(url)).json() as { state: string }).state, 'running')
    await fetch(url, { method: 'POST' }); assert.equal(f.runs, 1)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await f.remove() }
})

test('WSL installer uses Windows PowerShell and target, reports missing interop and forwards npm failure', () => {
  const calls: { command: string; args: string[] }[] = []
  const run = (command: string, args: string[]) => { calls.push({ command, args }); return { status: command === 'wslpath' ? 0 : 19, stdout: '\\\\wsl.localhost\\Ubuntu\\home\\fixture\\install.ps1\n' } }
  const target = "C:\\Users\\Test User\\Mew's helper"
  const resolvePowerShell = () => '/windows/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
  assert.equal(installDesktopHelper({ platform: 'linux', release: 'microsoft', env: { MEW_DESKTOP_HELPER_DIR: target }, run, resolvePowerShell }), 19)
  assert.equal(calls[1].command, resolvePowerShell())
  assert.ok(calls[1].args.includes('-File'))
  assert.deepEqual(calls[1].args.slice(-2), ['-Target', target])
  assert.throws(() => installDesktopHelper({ platform: 'linux', release: 'microsoft', env: { MEW_DESKTOP_HELPER_DIR: '/home/helper' }, run }), /Windows/)
  assert.throws(() => installDesktopHelper({ platform: 'linux', release: 'microsoft', env: {}, run: () => ({ status: 1 }) }), /interop/)
})

test('PowerShell discovery handles Linux-only PATH, escaped custom mounts and unavailable drives', () => {
  const suffix = '/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
  const reads: string[] = []
  const options = { env: { PATH: '/usr/bin:/bin' }, readMounts: () => 'D:\\134 /windows\\040drives/d 9p rw 0 0\nC:\\134tools /bind 9p rw 0 0', executable: (file: string) => { reads.push(file); return file === `/windows drives/d${suffix}` } }
  assert.equal(wslPowerShell(options), `/windows drives/d${suffix}`)
  assert.ok(!reads.includes(`/bind${suffix}`), 'Windows subdirectory binds are not drive roots')
  assert.equal(wslPowerShell({ ...options, env: { PATH: '/custom/bin' }, executable: file => file === '/custom/bin/powershell.exe', readMounts: () => { throw new Error('unneeded') } }), '/custom/bin/powershell.exe')
  assert.equal(wslPowerShell({ ...options, readMounts: () => { throw new Error('unavailable') }, executable: file => file === `/mnt/c${suffix}` }), `/mnt/c${suffix}`)
  assert.throws(() => wslPowerShell({ ...options, executable: () => false }), /드라이브.*마운트/)
})

test('WSL helper discovery uses the resolved PowerShell path before translating the Electron path', async () => {
  const commands: string[] = []
  const resolved = '/custom/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
  const spec = await desktopHostSpec({ platform: 'wsl', env: { PATH: '/bin' }, resolvePowerShell: ({ env } = {}) => { assert.equal(env?.PATH, '/bin'); return resolved }, run: (async (command: string) => {
    commands.push(command)
    return { stdout: command === resolved ? 'C:\\Users\\Example\\AppData\\Local\r\n' : '/mnt/c/helper/electron.exe\n', stderr: '' }
  }) as never })
  assert.deepEqual(commands, [resolved, 'wslpath'])
  assert.equal(spec.entry, 'C:\\Users\\Example\\AppData\\Local\\Mew\\remote-desktop\\main.mjs')
})

test('a found PowerShell that cannot execute reports interop failure without rerunning installation', () => {
  let starts = 0
  assert.throws(() => installDesktopHelper({ platform: 'linux', release: 'microsoft', env: {}, resolvePowerShell: () => '/mounted/powershell.exe', run: (command: string) => {
    if (command === 'wslpath') return { status: 0, stdout: 'C:\\fixture\\install.ps1' }
    starts++; return { status: null, error: new Error('ENOENT') }
  } }), /현재 세션의 WSL_INTEROP/)
  assert.equal(starts, 1)
})

test('Mac/Linux helper override receives the complete helper before npm ci', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-helper-target-'))
  try {
    for (const platform of ['darwin', 'linux']) {
      const target = path.join(directory, platform)
      let invoked = false, compiled = false
      const result = installDesktopHelper({ platform, release: '', env: { MEW_DESKTOP_HELPER_DIR: target }, installCapture: options => { assert.equal(options.target, target); compiled = true }, installRuntime: options => { assert.equal(options.target, target); assert.equal(options.platform, platform); return 0 }, run: (command: string, args: string[]) => {
        assert.equal(command, 'npm'); assert.deepEqual(args, ['ci', '--prefix', target, '--omit=dev', '--no-audit', '--no-fund']); invoked = true; return { status: 0 }
      } })
      assert.equal(result, 0); assert.equal(invoked, true)
      assert.equal(compiled, platform === 'darwin')
      assert.match(await fs.readFile(path.join(target, 'main.mjs'), 'utf8'), /electron/)
      assert.ok(await fs.stat(path.join(target, 'package-lock.json')))
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

test('Mac capture installation compiles the selected CPU, signs and atomically publishes only on success', () => {
  for (const arch of ['arm64', 'x64']) {
    const commands: { command: string; args: string[] }[] = [], published: string[][] = [], removed: string[] = []
    const target = "/fixture/Mew's $(literal) helper"
    const options = { target, arch, log() {}, exists: () => true, remove: (file: string) => removed.push(file), rename: (from: string, to: string) => { published.push([from, to]) },
      run: (command: string, args: string[]) => { commands.push({ command, args }); return { status: 0 } } }
    installMacCapture(options)
    assert.equal(commands[0].command, '/usr/bin/xcrun')
    assert.equal(commands[0].args[commands[0].args.indexOf('-arch') + 1], arch === 'x64' ? 'x86_64' : 'arm64')
    assert.ok(commands[0].args.includes(path.join(target, 'capture-macos.m')))
    assert.deepEqual(commands.slice(1).map(call => [call.command, ...call.args.slice(0, 2)]), [
      ['/usr/bin/codesign', '--force', '--sign'], ['/usr/bin/codesign', '--verify', '--strict'],
    ])
    assert.deepEqual(published, [[path.join(target, 'capture-macos.dylib.tmp'), path.join(target, 'capture-macos.dylib')]])
    for (const failure of [0, 1, 2]) {
      let step = 0; published.length = 0; removed.length = 0
      assert.throws(() => installMacCapture({ ...options, run: () => ({ status: step++ === failure ? 1 : 0 }) }), /Command Line Tools/)
      assert.equal(published.length, 0, 'a failed compiler/signature cannot replace the previous library')
      assert.equal(removed.at(-1), path.join(target, 'capture-macos.dylib.tmp'))
    }
    assert.throws(() => installMacCapture({ ...options, exists: () => false }), /생성되지/)
    assert.throws(() => installMacCapture({ ...options, arch: 'ia32' }), /64비트/)
  }
})

test('Mac compiler failure leaves helper unready and a missing capture binary requests preparation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-mac-install-failure-'))
  try {
    await fs.writeFile(path.join(root, '.mew-ready'), 'stale')
    assert.throws(() => installDesktopHelper({ platform: 'darwin', env: { MEW_DESKTOP_HELPER_DIR: root }, run: () => ({ status: 0 }),
      installRuntime: () => 0, installCapture: () => { throw new Error('compiler fixture failure') } }), /compiler fixture/)
    await assert.rejects(fs.access(path.join(root, '.mew-ready')))
    const result = await desktopHostStatus({ platform: 'mac', env: {}, current: async () => true,
      getSpec: async () => ({ platform: 'mac', executable: '/fixture/Electron', entry: '/fixture/main.mjs' }),
      access: async file => { if (String(file).endsWith('capture-macos.dylib')) throw Object.assign(new Error('missing'), { code: 'ENOENT' }) } })
    assert.equal(result.ready, false); assert.equal(result.installable, true)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
