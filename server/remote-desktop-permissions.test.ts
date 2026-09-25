import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { prepareDesktopPermissions, parsePermissionStatus, runPermissionHost } from '../native/remote-desktop/permissions.mjs'
import type { PermissionHostOptions, PermissionStatus } from '../native/remote-desktop/permissions.mjs'

const execute = promisify(execFile)
const granted: PermissionStatus = { accessibility: true, screen: 'granted' }
const denied: PermissionStatus = { accessibility: false, screen: 'not-determined' }

function scenario(sequence: PermissionStatus[]) {
  let time = 0, checks = 0
  const calls: PermissionHostOptions[] = [], logs: string[] = []
  const options = {
    platform: 'darwin', env: { MEW_DESKTOP_HELPER_DIR: "/tmp/Mew's $(false) helper" },
    loginUser: async () => true, log: (message: string) => logs.push(message),
    now: () => time, wait: async (ms: number) => { time += ms }, timeout: 10_000,
    run: async (args: PermissionHostOptions) => {
      calls.push(args)
      assert.equal((await fs.stat(args.profile)).isDirectory(), true)
      return args.mode === 'check' ? sequence[Math.min(checks++, sequence.length - 1)] : null
    },
  }
  return { options, calls, logs }
}

test('Mac permission setup finishes immediately without requests when already granted', async () => {
  const f = scenario([granted])
  await prepareDesktopPermissions(f.options)
  assert.deepEqual(f.calls.map(call => call.mode), ['check'])
  assert.match(f.logs.at(-1)!, /완료/)
  await assert.rejects(fs.stat(f.calls[0].profile), { code: 'ENOENT' })
})

test('Mac setup requests each missing permission once and verifies grants in fresh checks', async () => {
  const f = scenario([denied, denied, { accessibility: true, screen: 'denied' }, granted])
  await prepareDesktopPermissions(f.options)
  assert.deepEqual(f.calls.map(call => call.mode), ['check', 'accessibility', 'check', 'check', 'screen', 'check'])
  assert.ok(f.calls.every(call => call.target === f.options.env.MEW_DESKTOP_HELPER_DIR))
  assert.ok(f.logs.some(line => line.includes('서버 Mac의 데스크톱')))
  await assert.rejects(fs.stat(f.calls[0].profile), { code: 'ENOENT' })
})

test('setup only requests accessibility if screen permission already exists', async () => {
  const f = scenario([{ accessibility: false, screen: 'granted' }, granted])
  await prepareDesktopPermissions(f.options)
  assert.deepEqual(f.calls.map(call => call.mode), ['check', 'accessibility', 'check'])
})

test('a denied request times out without looping prompts or reporting success', async () => {
  const f = scenario([denied])
  await assert.rejects(prepareDesktopPermissions(f.options), /시간이 끝났습니다/)
  assert.equal(f.calls.filter(call => call.mode === 'accessibility').length, 1)
  assert.ok(!f.logs.some(line => line.includes('완료됐습니다')))
  await assert.rejects(fs.stat(f.calls[0].profile), { code: 'ENOENT' })
})

test('restricted screen access and the wrong login user stop without permission requests', async () => {
  const f = scenario([{ accessibility: true, screen: 'restricted' }])
  await assert.rejects(prepareDesktopPermissions(f.options), /관리 정책/)
  assert.deepEqual(f.calls.map(call => call.mode), ['check'])
  const wrongUser = scenario([denied])
  await assert.rejects(prepareDesktopPermissions({ ...wrongUser.options, loginUser: async () => false }), /sudo 없이/)
  assert.equal(wrongUser.calls.length, 0)
})

test('non-Mac setup never launches the permission app; relative helper paths are rejected on Mac', async () => {
  const f = scenario([denied])
  await prepareDesktopPermissions({ ...f.options, platform: 'linux', loginUser: async () => { throw new Error('not called') } })
  assert.equal(f.calls.length, 0)
  await assert.rejects(prepareDesktopPermissions({ ...f.options, env: { MEW_DESKTOP_HELPER_DIR: 'relative' } }), /절대 경로/)
})

test('cancellation and failed status checks clean profiles and never declare success', async () => {
  const f = scenario([denied]), controller = new AbortController()
  await assert.rejects(prepareDesktopPermissions({ ...f.options, signal: controller.signal, wait: async () => { controller.abort(); controller.signal.throwIfAborted() } }), { name: 'AbortError' })
  await assert.rejects(fs.stat(f.calls[0].profile), { code: 'ENOENT' })
  let profile = ''
  await assert.rejects(prepareDesktopPermissions({ ...f.options, run: async args => { profile = args.profile; throw new Error('fixture failure') } }), /fixture failure/)
  await assert.rejects(fs.stat(profile), { code: 'ENOENT' })
  assert.ok(!f.logs.some(line => line.includes('완료됐습니다')))
})

test('permission wire rejects missing, duplicate and invalid states', () => {
  assert.deepEqual(parsePermissionStatus('noise\nMEW_DESKTOP_PERMISSIONS {"accessibility":true,"screen":"granted"}\n'), granted)
  for (const output of ['', 'MEW_DESKTOP_PERMISSIONS {}', 'MEW_DESKTOP_PERMISSIONS null', 'MEW_DESKTOP_PERMISSIONS {"accessibility":"yes","screen":"granted"}', 'MEW_DESKTOP_PERMISSIONS {"accessibility":true,"screen":"yes"}', 'MEW_DESKTOP_PERMISSIONS {}\nMEW_DESKTOP_PERMISSIONS {}']) assert.throws(() => parsePermissionStatus(output))
})

test('permission subprocess uses the installed executable, literal paths and sanitized environment', async () => {
  const options: PermissionHostOptions = { target: "/tmp/Mew's $(false)", profile: '/tmp/profile', mode: 'check', env: { NODE_OPTIONS: 'bad', ELECTRON_RUN_AS_NODE: '1', PATH: '/fixture' }, timeout: 10_000 }
  const result = await runPermissionHost(options, async (command, args, raw) => {
    const settings = raw as { env: NodeJS.ProcessEnv; cwd: string; timeout: number; killSignal: string }
    assert.equal(command, path.join(options.target, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'))
    assert.deepEqual(args, [path.join(options.target, 'permissions-host.mjs'), 'check'])
    assert.equal(settings.cwd, options.target)
    assert.equal(settings.timeout, 10_000)
    assert.equal(settings.killSignal, 'SIGKILL')
    assert.deepEqual(settings.env, { PATH: '/fixture', MEW_DESKTOP_PERMISSION_PROFILE: '/tmp/profile' })
    return { stdout: 'MEW_DESKTOP_PERMISSIONS {"accessibility":true,"screen":"granted"}\n' }
  })
  assert.deepEqual(result, granted)
  const quit = async () => { throw Object.assign(new Error('quit'), { signal: 'SIGTERM', stdout: 'MEW_DESKTOP_PERMISSION_REQUESTED\n' }) }
  assert.equal(await runPermissionHost({ ...options, mode: 'screen' }, quit), null)
  await assert.rejects(runPermissionHost(options, quit), /확인하지 못했습니다/)
  await assert.rejects(runPermissionHost({ ...options, mode: 'screen' }, async () => { throw new Error('spawn failure') }), /실행하거나/)
})

test('the permission host requests only the chosen OS permission without capture or input modules', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-permission-host-test-'))
  try {
    const host = path.join(root, 'permissions-host.mjs')
    await fs.copyFile(new URL('../native/remote-desktop/permissions-host.mjs', import.meta.url), host)
    for (const name of ['electron', 'koffi']) {
      await fs.mkdir(path.join(root, 'node_modules', name), { recursive: true })
      await fs.writeFile(path.join(root, 'node_modules', name, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }))
    }
    await fs.writeFile(path.join(root, 'node_modules/electron/index.js'), `
      export const app = {setPath(){}, setAppLogsPath(){}, whenReady: async()=>{}, dock:{hide(){}}, exit: code=>process.exit(code)};
      export const systemPreferences = {
        isTrustedAccessibilityClient(prompt){if(prompt) console.log('REQUEST_ACCESSIBILITY'); return process.env.GRANTED === '1';},
        getMediaAccessStatus(){return process.env.GRANTED === '1' ? 'granted' : 'not-determined';}
      };
      export const shell = {openExternal: async url=>console.log('SETTINGS:'+url)};
    `)
    await fs.writeFile(path.join(root, 'node_modules/koffi/index.js'), `
      export default {load(file){if(!file.endsWith('/CoreGraphics')) throw Error('Unexpected library'); return {
        func(signature){if(signature!=='bool CGRequestScreenCaptureAccess()') throw Error('Unexpected API'); return ()=>{console.log('REQUEST_SCREEN'); return false;};}
      };}};
    `)
    for (const mode of ['check', 'accessibility', 'screen']) {
      const script = `Object.defineProperty(process, 'platform', {value:'darwin'}); process.argv=[process.execPath, ${JSON.stringify(host)}, ${JSON.stringify(mode)}]; await import(${JSON.stringify(pathToFileURL(host).href)});`
      const result = await execute(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, GRANTED: '0', MEW_DESKTOP_PERMISSION_PROFILE: root }, timeout: 5000 })
      assert.deepEqual(parsePermissionStatus(result.stdout), denied)
      assert.equal(result.stdout.includes('REQUEST_ACCESSIBILITY'), mode === 'accessibility')
      assert.equal(result.stdout.includes('REQUEST_SCREEN'), mode === 'screen')
      assert.equal(result.stdout.includes('SETTINGS:'), mode !== 'check')
      if (mode !== 'check') assert.ok(result.stdout.includes(mode === 'screen' ? '?Privacy_ScreenCapture' : '?Privacy_Accessibility'))
    }
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('permission subprocess timeout and cancellation wait for the owned process to exit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-permission-lifetime-'))
  try {
    const binary = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    await fs.mkdir(path.dirname(binary), { recursive: true })
    await fs.symlink(process.execPath, binary)
    const pidFile = path.join(root, 'fixture.pid')
    await fs.writeFile(path.join(root, 'permissions-host.mjs'), `
      import fs from 'node:fs';
      fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
      console.log('READY');
      if(process.argv[2]!=='check') console.log('MEW_DESKTOP_PERMISSION_REQUESTED');
      setInterval(()=>{}, 1000);
    `)
    const options: PermissionHostOptions = { target: root, profile: root, mode: 'check', env: process.env, timeout: 1000 }
    await assert.rejects(runPermissionHost(options), /확인하지 못했습니다/)
    const assertExited = async () => {
      const pid = Number(await fs.readFile(pidFile, 'utf8'))
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
    }
    await assertExited()
    assert.equal(await runPermissionHost({ ...options, mode: 'screen' }), null)
    await assertExited()
    const controller = new AbortController()
    await assert.rejects(runPermissionHost({ ...options, signal: controller.signal }, (command, args, settings) => {
      const operation = execute(command, args, settings)
      operation.child.stdout!.once('data', () => controller.abort())
      return operation
    }), { name: 'AbortError' })
    await assertExited()
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('setup shell handles installation failure, permission failure and interruption without running real setup', async () => {
  const source = await fs.readFile(new URL('../mew', import.meta.url), 'utf8')
  const extract = (name: string) => `${name}() {${source.split(`${name}() {`)[1].split('\n}\n')[0]}\n}\n`
  const script = `set -euo pipefail
    say(){ printf '%s\\n' "$*"; }
    need_node(){ :; }; need_build_tools(){ :; }; load_config(){ :; }
    start_server(){ echo FIXTURE_START; }; create_first_owner(){ :; }; url(){ echo fixture; }
    npm(){ echo FIXTURE_NPM:"$*"; }
    node(){ case "$1" in */install.mjs) echo FIXTURE_INSTALL; return "$INSTALL_CODE";; */permissions.mjs) echo FIXTURE_PERMISSIONS; return "$PERMISSION_CODE";; *) return 99;; esac; }
    ${extract('prepare_desktop')}
    ${extract('cmd_setup')}
    cmd_setup
  `
  for (const [install, permission, aborted] of [[0, 0, false], [7, 0, false], [0, 1, false], [0, 130, true], [0, 143, true]] as const) {
    const result = await execute('/bin/bash', ['-c', script], { env: { ...process.env, APP: "/tmp/Mew's $(false)", CONFIG: path.resolve(import.meta.dirname, '../mew'), INSTALL_CODE: String(install), PERMISSION_CODE: String(permission) } }).then(value => ({ ...value, code: 0 }), error => ({ stdout: error.stdout as string, stderr: error.stderr as string, code: error.code as number }))
    assert.equal(result.code, aborted ? permission : 0)
    assert.equal(result.stdout.includes('FIXTURE_PERMISSIONS'), install === 0)
    assert.equal(result.stdout.includes('FIXTURE_START'), !aborted)
    assert.equal(result.stderr.includes('incomplete'), !aborted && (install !== 0 || permission !== 0))
  }
})
