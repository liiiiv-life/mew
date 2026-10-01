import test from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error Host helper code runs as JavaScript in Electron.
import { configureHostPermissions } from '../native/remote-desktop/host-permissions.mjs'
import { desktopPlatform, desktopHostSpec, desktopHostStatus } from './remote-desktop-host.ts'
import { runtimeSupportError } from '../native/remote-desktop/runtime-support.mjs'
import { installDesktopHelper } from '../native/remote-desktop/install.mjs'

test('Mac/Linux capture and direct WebRTC permissions belong only to the active local main frame', () => {
  let request: Function = () => {}, check: Function = () => false, active = true
  const window = { webContents: { session: { setPermissionRequestHandler: (fn: Function) => { request = fn }, setPermissionCheckHandler: (fn: Function) => { check = fn } } } }
  configureHostPermissions(window, () => active)
  const granted = (contents: unknown, permission: string, details = { isMainFrame: true }) => {
    let result: boolean | undefined
    request(contents, permission, (value: boolean) => { result = value }, details)
    assert.equal(result, check(contents, permission, 'file://', details))
    return result
  }
  for (const permission of ['media', 'display-capture', 'local-network-access', 'local-network', 'loopback-network']) {
    assert.equal(granted(window.webContents, permission), true)
    assert.equal(granted({}, permission), false)
    assert.equal(granted(window.webContents, permission, { isMainFrame: false }), false)
  }
  for (const permission of ['clipboard-read', 'geolocation', 'notifications', 'fileSystem']) assert.equal(granted(window.webContents, permission), false)
  active = false
  assert.equal(granted(window.webContents, 'display-capture'), false, 'closed hosts cannot authorize a late capture')
})

test('native Mac/Linux resolve their own host and readiness without Windows discovery', async () => {
  assert.equal(desktopPlatform('darwin', 'Darwin'), 'mac')
  assert.equal(desktopPlatform('linux', '6.8.0-generic'), 'linux')
  assert.equal(desktopPlatform('linux', '6.6.87.2-microsoft-standard-WSL2'), 'wsl')
  for (const platform of ['mac', 'linux'] as const) {
    const env = { MEW_DESKTOP_HELPER_DIR: "/fixture/mew's helper", DISPLAY: ':17' }
    const spec = await desktopHostSpec({ platform, env, run: (async () => { throw new Error('Windows discovery must not run') }) as never })
    assert.equal(spec.entry, "/fixture/mew's helper/native-host.mjs")
    assert.ok(spec.executable.endsWith(platform === 'mac' ? '/MewDesktop.app/Contents/MacOS/MewDesktop' : '/runtime/node'))
    const accessed: string[] = []
    assert.equal((await desktopHostStatus({ platform, env, getSpec: async () => spec, current: async () => true, access: async file => { accessed.push(String(file)) } })).ready, true)
    assert.equal(accessed.some(file => file.endsWith('gpu-windows.dll')), false)
    assert.equal(accessed.some(file => file.endsWith(platform === 'mac' ? 'gpu-macos.dylib' : 'gpu-linux.so')), true)
  }
})

test('Mac/Linux platform support matches the pinned runtime and rejects unsupported Macs before installation', () => {
  for (const arch of ['x64', 'arm64']) {
    assert.equal(runtimeSupportError({ platform: 'darwin', arch, release: '22.6.0' }), undefined)
    assert.equal(runtimeSupportError({ platform: 'linux', arch, release: '6.8.0' }), undefined)
  }
  assert.match(runtimeSupportError({ platform: 'darwin', arch: 'x64', release: '21.6.0' })!, /macOS 13/)
  assert.match(runtimeSupportError({ platform: 'linux', arch: 'ia32', release: '6.8.0' })!, /64비트/)
  assert.throws(() => installDesktopHelper({ platform: 'darwin', release: '21.6.0', run: () => { assert.fail('unsupported Macs cannot download or launch the helper') } }), /macOS 13/)
})
