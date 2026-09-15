import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { desktopHostSpec } from './remote-desktop-host.ts'
import { HELPER_FILES } from '../native/remote-desktop/helper-version.mjs'
import { attachRemoteDesktopWebSocket } from './remote-desktop.ts'

// Explicit opt-in: a real logged-in Windows desktop is streamed in memory.
// No screenshot, title, signaling log, clipboard write or pointer/key action is saved/sent.
test('Windows login desktop streams through the production host and viewer connection', {
  skip: !process.env.MEW_DESKTOP_TEST_WINDOWS_VIDEO || !process.env.MEW_DESKTOP_TEST_WINDOWS_NODE || !domBrowserExecutable(), timeout: 60_000,
}, async () => {
  const exec = promisify(execFile), host = await desktopHostSpec()
  const installed = path.resolve(host.executable, '../../../..'), native = path.resolve(import.meta.dirname, '../native/remote-desktop')
  const root = await fs.mkdtemp(path.join(path.dirname(installed), 'desktop-video-test-'))
  const windowsRoot = (await exec('wslpath', ['-w', root])).stdout.trim(), windowsNode = process.env.MEW_DESKTOP_TEST_WINDOWS_NODE!
  for (const file of HELPER_FILES) await fs.copyFile(path.join(native, file), path.join(root, file))
  if (process.env.MEW_DESKTOP_TEST_WINDOWS_GDI) await fs.writeFile(path.join(root, 'capture-windows.mjs'), process.env.MEW_DESKTOP_TEST_WINDOWS_GDI === 'timeout'
    ? 'export function windowsCapture(koffi, bounds) { return { ...bounds, next() { return { width: bounds.width, height: bounds.height, changed: false } }, close() {} } }'
    : "export function windowsCapture() { throw new Error('DXGI unavailable fixture') }")
  await exec(windowsNode, ['-e', "require('node:fs').symlinkSync(process.argv[1],process.argv[2],'junction')", path.win32.join(path.win32.dirname(host.entry), 'node_modules'), path.win32.join(windowsRoot, 'node_modules')])
  let child: ReturnType<typeof spawn> | undefined
  const bridge = (await exec('wslpath', ['-w', path.join(native, 'windows-bridge.mjs')])).stdout.trim()
  const entry = `export {connectDesktop} from ${JSON.stringify(path.resolve(import.meta.dirname, '../src/utils/desktop-connection.ts'))}; export {desktopCursor} from ${JSON.stringify(path.resolve(import.meta.dirname, '../src/utils/desktop-cursor.ts'))}`
  const bundle = await build({ input: 'virtual:viewer', plugins: [{ name: 'viewer', resolveId: id => id === 'virtual:viewer' ? id : undefined, load: id => id === 'virtual:viewer' ? entry : undefined }], write: false, platform: 'browser', output: { format: 'iife', name: 'Desktop' } })
  const chunk = bundle.output.find(value => value.type === 'chunk')!
  const server = createServer((req, res) => {
    if (req.url === '/api/remote-desktop/status') { res.setHeader('Content-Type', 'application/json'); res.end('{"ready":true}'); return }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<div id="stage" style="position:relative;width:640px;height:360px"><video autoplay muted playsinline hidden></video><canvas style="width:100%;height:100%"></canvas><img id="cursor" alt="" hidden style="position:absolute;top:0;left:0;pointer-events:none"></div><script>${chunk.code}</script><script>
      window.state='starting';window.failure='';window.diagnostic={};window.frames=0;window.localCursor=false;window.cursorShape=false;window.cursorVisible=false;window.cursorUpdates=0;
      window.localPointer=Desktop.desktopCursor(document.querySelector('#stage'),document.querySelector('#cursor'),()=>document.querySelector('canvas'));
      const Peer=window.RTCPeerConnection;
      window.RTCPeerConnection=class extends Peer { constructor(...args){super({...args[0],iceTransportPolicy:'relay'});setInterval(async()=>{if(this.connectionState==='closed')return;const report=await this.getStats();const result={local:[],remote:[],pairs:[]};report.forEach(s=>{if(s.type==='local-candidate'||s.type==='remote-candidate')result[s.type==='local-candidate'?'local':'remote'].push({type:s.candidateType,protocol:s.protocol,mdns:s.address?.endsWith('.local')});if(s.type==='candidate-pair')result.pairs.push({state:s.state,requests:s.requestsSent,responses:s.responsesReceived})});window.diagnostic=result},250)} };
      window.connection=Desktop.connectDesktop({
        state:(s,m)=>{window.state=s;if(s==='error')window.failure=m},screens:()=>{},relative:()=>{},stats:()=>{},transport:m=>window.transport=m,
        localCursor:value=>{window.localCursor=value;window.localPointer.enable(value)},frame:f=>{const c=document.querySelector('canvas');c.width=f.displayWidth;c.height=f.displayHeight;c.getContext('2d').drawImage(f,0,0);window.frames++;window.localPointer.refresh()},
        pointer:(x,y,joystick)=>window.localPointer.point(x,y,joystick),
        cursor:value=>{window.cursorUpdates++;window.cursorVisible=value.visible;window.localPointer.shape(value);if(value.shape)window.cursorShape=true},
        stream:s=>document.querySelector('video').srcObject=s
      });</script>`)
  })
  attachRemoteDesktopWebSocket(server, {
    getAuth: () => ({ role: 'owner', email: 'fixture@example.test', mustChangePassword: false }), iceServers: () => [],
    spawnHost: async () => {
      const process = spawn(windowsNode, [bridge, path.win32.join(windowsRoot, 'main.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] })
      process.stderr.resume(); child = process; return process
    },
  })
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`)
    await page.waitForFunction(`window.state==='error'||(window.state==='connected'&&window.frames>=1)`, null, { timeout: 45000 })
    assert.equal(await page.evaluate('window.failure'), '', JSON.stringify(await page.evaluate('window.diagnostic')))
    assert.equal(await page.evaluate('window.state'), 'connected')
    assert.equal(await page.evaluate('window.transport'), 'server')
    if (process.env.MEW_DESKTOP_TEST_WINDOWS_LOCAL_CURSOR) assert.equal(await page.evaluate('window.localCursor'), true)
    await page.waitForTimeout(3500)
    assert.equal(await page.evaluate('window.state'), 'connected', 'native capture continues responding after the first frame: ' + await page.evaluate('window.failure'))
    assert.ok(await page.evaluate('window.frames>=1'))
    if (process.env.MEW_DESKTOP_TEST_WINDOWS_LOCAL_CURSOR || process.env.MEW_DESKTOP_TEST_WINDOWS_GDI) {
      assert.equal(await page.evaluate('window.localCursor'), true)
      await page.waitForFunction(`window.cursorShape&&document.querySelector('#cursor').naturalWidth>0`)
      // Exercise the real cursor DOM only; never send pointer motion to Windows.
      await page.evaluate('window.localPointer.point(.5,.5,true)')
      if (await page.evaluate('window.cursorVisible')) assert.equal(await page.locator('#cursor').isVisible(), true)
      assert.ok(await page.evaluate(`(()=>{const img=document.querySelector('#cursor'),c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return ctx.getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)})()`), 'cursor PNG contains visible pixels')
    }
    console.log('Windows video transport:', await page.evaluate('window.transport'), 'decoded relay frames:', await page.evaluate('window.frames'), 'local cursor:', await page.evaluate('window.localCursor'), 'cursor image:', await page.evaluate('window.cursorShape'))
    const exited = once(child!, 'close')
    await page.evaluate('window.connection.close()')
    await exited
  } finally {
    await browser.close()
    if (child && child.exitCode === null && child.signalCode === null) await new Promise<void>(resolve => {
      const timeout = setTimeout(() => child?.kill(), 3000)
      child!.once('close', () => { clearTimeout(timeout); resolve() })
    })
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    // Remove only the junction from Windows, then the owned source directory from WSL.
    // Never recursively traverse a junction into the installed runtime.
    await exec(windowsNode, ['-e', "const fs=require('node:fs');const p=require('node:path').join(process.argv[1],'node_modules');if(fs.existsSync(p))fs.rmdirSync(p)", windowsRoot])
    await exec(windowsNode, ['-e', "require('node:fs').rmSync(process.argv[1],{recursive:true,force:true,maxRetries:20,retryDelay:200})", windowsRoot])
  }
})
