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
  await exec(windowsNode, ['-e', "require('node:fs').symlinkSync(process.argv[1],process.argv[2],'junction')", path.win32.join(path.win32.dirname(host.entry), 'node_modules'), path.win32.join(windowsRoot, 'node_modules')])
  let child: ReturnType<typeof spawn> | undefined
  const bridge = (await exec('wslpath', ['-w', path.join(native, 'windows-bridge.mjs')])).stdout.trim()
  const bundle = await build({ input: path.resolve(import.meta.dirname, '../src/utils/desktop-connection.ts'), write: false, platform: 'browser', output: { format: 'iife', name: 'Desktop' } })
  const chunk = bundle.output.find(value => value.type === 'chunk')!
  const server = createServer((req, res) => {
    if (req.url === '/api/remote-desktop/status') { res.setHeader('Content-Type', 'application/json'); res.end('{"ready":true}'); return }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<video autoplay muted playsinline></video><canvas></canvas><script>${chunk.code}</script><script>
      window.state='starting';window.failure='';window.diagnostic={};window.frames=0;
      const Peer=window.RTCPeerConnection;
      window.RTCPeerConnection=class extends Peer { constructor(...args){super({...args[0],iceTransportPolicy:'relay'});setInterval(async()=>{if(this.connectionState==='closed')return;const report=await this.getStats();const result={local:[],remote:[],pairs:[]};report.forEach(s=>{if(s.type==='local-candidate'||s.type==='remote-candidate')result[s.type==='local-candidate'?'local':'remote'].push({type:s.candidateType,protocol:s.protocol,mdns:s.address?.endsWith('.local')});if(s.type==='candidate-pair')result.pairs.push({state:s.state,requests:s.requestsSent,responses:s.responsesReceived})});window.diagnostic=result},250)} };
      window.connection=Desktop.connectDesktop({
        state:(s,m)=>{window.state=s;if(s==='error')window.failure=m},screens:()=>{},relative:()=>{},stats:()=>{},transport:m=>window.transport=m,
        frame:f=>{const c=document.querySelector('canvas');c.width=f.displayWidth;c.height=f.displayHeight;c.getContext('2d').drawImage(f,0,0);window.frames++},
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
    await page.waitForFunction(`window.state==='error'||(window.state==='connected'&&window.frames>=10)`, null, { timeout: 45000 })
    assert.equal(await page.evaluate('window.failure'), '', JSON.stringify(await page.evaluate('window.diagnostic')))
    assert.equal(await page.evaluate('window.state'), 'connected')
    assert.equal(await page.evaluate('window.transport'), 'server')
    assert.ok(await page.evaluate('window.frames>=10'))
    console.log('Windows video transport:', await page.evaluate('window.transport'), 'decoded relay frames:', await page.evaluate('window.frames'))
    const exited = once(child!, 'close')
    await page.evaluate('window.connection.close()')
    await exited
  } finally {
    child?.kill(); await browser.close()
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    // Windows removes the junction itself, without walking into the installed runtime.
    await exec(windowsNode, ['-e', "require('node:fs').rmSync(process.argv[1],{recursive:true,force:true})", windowsRoot])
  }
})
