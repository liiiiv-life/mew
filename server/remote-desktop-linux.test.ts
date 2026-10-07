import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { attachRemoteDesktopWebSocket } from './remote-desktop.ts'
import { residentDesktopHost } from './desktop-resident-host.ts'
import type { DesktopHostProcess } from './remote-desktop-host.ts'
import { DEFAULT_VIDEO, videoSettings } from '../native/remote-desktop/video-settings.mjs'

// Opt-in only under an isolated Xvfb display/private D-Bus. This injects test
// input into that synthetic desktop; never run it on a user's actual display.
test('resident native Linux X11 host sends H.264, receives input, notifies and reuses only after capture stop', {
  skip: process.platform !== 'linux' || !process.env.MEW_DESKTOP_TEST_LINUX_HELPER || process.env.MEW_DESKTOP_TEST_LINUX_ISOLATED !== '1' || !domBrowserExecutable(), timeout: 35_000,
}, async () => {
  assert.ok(process.env.DISPLAY && process.env.DBUS_SESSION_BUS_ADDRESS && !process.env.WAYLAND_DISPLAY)
  const helper = process.env.MEW_DESKTOP_TEST_LINUX_HELPER!, require = createRequire(path.join(helper, 'package.json'))
  const video = videoSettings({ ...DEFAULT_VIDEO, fps: Number(process.env.MEW_DESKTOP_TEST_VIDEO_FPS ?? 60), quality: 'high' })
  const expectedFps = Number(process.env.MEW_DESKTOP_TEST_VIDEO_EXPECTED_FPS ?? video.fps)
  const dbus = require('dbus-next'), koffi = require('koffi'), notices: { summary: string; body: string }[] = []
  const bus = dbus.sessionBus()
  class Notifications extends dbus.interface.Interface {
    constructor() { super('org.freedesktop.Notifications') }
    GetCapabilities() { return ['body'] }
    GetServerInformation() { return ['Mew test', 'Mew', '1', '1.2'] }
    Notify(_app: string, _id: number, _icon: string, summary: string, body: string) { notices.push({ summary, body }); return notices.length }
    CloseNotification() {}
  }
  Notifications.configureMembers({ methods: {
    GetCapabilities: { outSignature: 'as' }, GetServerInformation: { outSignature: 'ssss' },
    Notify: { inSignature: 'susssasa{sv}i', outSignature: 'u' }, CloseNotification: { inSignature: 'u' },
  } })
  bus.export('/org/freedesktop/Notifications', new Notifications())
  await bus.requestName('org.freedesktop.Notifications', 0)
  let locked = false
  class ScreenSaver extends dbus.interface.Interface {
    constructor() { super('org.freedesktop.ScreenSaver') }
    GetActive() { return locked }
    ActiveChanged(value: boolean) { return value }
  }
  ScreenSaver.configureMembers({ methods: { GetActive: { outSignature: 'b' } }, signals: { ActiveChanged: { signature: 'b' } } })
  const saver = new ScreenSaver()
  bus.export('/ScreenSaver', saver)
  await bus.requestName('org.freedesktop.ScreenSaver', 0)
  const x11 = koffi.load('libX11.so.6'), display = x11.func('void *XOpenDisplay(const char *)')(null)
  assert.ok(display)
  const root = x11.func('ulong XDefaultRootWindow(void *)')(display)
  const pointer = x11.func('bool XQueryPointer(void *,ulong,void *,void *,void *,void *,void *,void *,void *)')
  const keymap = x11.func('int XQueryKeymap(void *,void *)')
  const code = x11.func('uchar XKeysymToKeycode(void *,uintptr)')(display, x11.func('uintptr XStringToKeysym(const char *)')('a'))
  const state = () => {
    const x = Buffer.alloc(4), y = Buffer.alloc(4), mask = Buffer.alloc(4), keys = Buffer.alloc(32)
    assert.ok(pointer(display, root, Buffer.alloc(8), Buffer.alloc(8), x, y, Buffer.alloc(4), Buffer.alloc(4), mask))
    keymap(display, keys)
    return { x: x.readInt32LE(), y: y.readInt32LE(), button: !!(mask.readUInt32LE() & 256), key: !!(keys[Math.floor(code / 8)] & 1 << (code % 8)) }
  }
  const wait = async (predicate: () => boolean, message: string) => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(20) }
    assert.fail(`${message}: ${JSON.stringify(state())}`)
  }
  let role: 'owner' | 'guest' = 'owner', binary = 0
  const hosts: ChildProcessWithoutNullStreams[] = []
  const ended: DesktopHostProcess[] = []
  const pool = residentDesktopHost(async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, XDG_SESSION_TYPE: 'x11' }; delete env.NODE_OPTIONS; delete env.WAYLAND_DISPLAY
    const child = spawn(process.execPath, [path.join(helper, 'native-host.mjs')], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stderr.resume(); hosts.push(child); return child
  })
  const entry = `export {connectDesktop} from ${JSON.stringify(path.resolve(import.meta.dirname, '../src/utils/desktop-connection.ts'))}`
  const bundle = await build({ input: 'virtual:linux', plugins: [{ name: 'linux', resolveId: id => id === 'virtual:linux' ? id : undefined, load: id => id === 'virtual:linux' ? entry : undefined }], write: false, platform: 'browser', output: { format: 'iife', name: 'Desktop' } })
  const chunk = bundle.output.find(value => value.type === 'chunk')!
  const server = createServer((req, res) => {
    if (req.url === '/api/remote-desktop/status') { res.setHeader('Content-Type', 'application/json'); res.end('{"ready":true}'); return }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<video autoplay muted playsinline></video><script>${chunk.code}</script><script>
      window.openDesktop=()=>{window.state='connecting';window.failure='';window.connection=Desktop.connectDesktop({state:(s,m)=>{window.state=s;if(s==='error')window.failure=m},screens(){},relative(){},stats(s){window.videoStatus=s},stream:s=>document.querySelector('video').srcObject=s},undefined,${JSON.stringify(video)})};window.openDesktop();
    </script>`)
  })
  attachRemoteDesktopWebSocket(server, {
    getAuth: () => ({ role, email: 'fixture@example.test', mustChangePassword: false }), iceServers: () => [], heartbeatMs: 200,
    spawnHost: async () => {
      const lease = await pool.acquire(); lease.once('exit', () => ended.push(lease)); return lease
    },
  })
  server.on('upgrade', (_req, socket) => {
    const write = socket.write.bind(socket)
    socket.write = ((data: unknown, ...args: unknown[]) => { if (Buffer.isBuffer(data) && data[0] === 0x82) binary++; return (write as (...args: unknown[]) => boolean)(data, ...args) }) as typeof socket.write
  })
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const page = await browser.newPage({ locale: 'ko-KR' })
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`)
    await page.waitForFunction(`window.failure||window.state==='connected'`, null, { timeout: 12_000 })
    assert.equal(await page.evaluate('window.failure'), '')
    await page.waitForFunction(`document.querySelector('video').videoWidth>0`)
    await page.waitForFunction(`window.videoStatus?.includes('목표 ${expectedFps} FPS')`, null, { timeout: 5000 }).catch(async () => assert.fail(await page.evaluate('window.videoStatus')))
    await wait(() => notices.length === 1, 'Linux notification service must receive a connection notice')
    assert.deepEqual(notices[0], { summary: 'mew 원격 데스크톱 연결됨', body: '이 PC에 원격으로 연결되었습니다.' })
    await page.evaluate('window.connection.input.point(.25,.75);window.connection.input.button(1,true);window.connection.input.key("KeyA",true)')
    await wait(() => { const value = state(); return value.button && value.key && Math.abs(value.x - 320) <= 1 && Math.abs(value.y - 539) <= 1 }, 'XTest must receive browser pointer/key transitions')
    role = 'guest'
    await wait(() => !state().button && !state().key, 'revocation must release native keys/buttons')
    await wait(() => ended.length === 1, 'revocation must wait for native capture stop acknowledgement')
    assert.equal(hosts[0].exitCode, null, 'the resident process stays warm with capture stopped')
    role = 'owner'
    await page.evaluate('window.openDesktop()')
    await page.waitForFunction(`window.failure||window.state==='connected'`, null, { timeout: 12_000 })
    assert.equal(await page.evaluate('window.failure'), '')
    await wait(() => notices.length === 2, 'a fresh native Linux session must notify once')
    locked = true; saver.ActiveChanged(true)
    await wait(() => ended.length === 2, 'locking the OS must stop capture without further input')
    await page.evaluate('window.connection.close()')
    locked = false; saver.ActiveChanged(false)
    await delay(50)
    await page.evaluate('window.openDesktop()')
    await page.waitForFunction(`window.failure||window.state==='connected'`, null, { timeout: 12_000 })
    assert.equal(await page.evaluate('window.failure'), '')
    await wait(() => notices.length === 3, 'unlocking permits a new session on the warm host')
    await page.evaluate('window.connection.close()')
    await wait(() => ended.length === 3, 'closing the viewer must release native capture')
    assert.equal(hosts.length, 1, 'reconnect must reuse the same resident process')
    assert.equal(notices.length, 3)
    assert.equal(binary, 0, 'video stays on direct WebRTC')
  } finally {
    await browser.close()
    await pool.close()
    for (const host of hosts) if (host.exitCode === null && host.signalCode === null) { host.stdin.end(); host.kill('SIGTERM') }
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    x11.func('int XCloseDisplay(void *)')(display); bus.disconnect()
  }
})
