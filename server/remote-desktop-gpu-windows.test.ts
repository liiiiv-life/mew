import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { attachRemoteDesktopWebSocket } from './remote-desktop.ts'
import { residentDesktopHost } from './desktop-resident-host.ts'
import { hostReader } from '../native/remote-desktop/host-wire.mjs'

// Explicit opt-in. Streams the unlocked desktop in memory, with no screen saves,
// clipboard writes or pointer/key injection. Successful sessions can show the host
// connection notification. HELPER must be an isolated test copy.
test('resident Windows hardware H.264 reaches the browser twice without relaunch', {
  skip: !process.env.MEW_DESKTOP_TEST_WINDOWS_HELPER || !process.env.MEW_DESKTOP_TEST_WINDOWS_NODE || !domBrowserExecutable(), timeout: 60_000,
}, async () => {
  const helper = process.env.MEW_DESKTOP_TEST_WINDOWS_HELPER!, node = process.env.MEW_DESKTOP_TEST_WINDOWS_NODE!
  let launches = 0, binary = 0
  const nativeErrors: string[] = []
  const pool = residentDesktopHost(async () => {
    launches++
    const child = spawn(node, [path.win32.join(helper, 'windows-bridge.mjs'), path.win32.join(helper, 'native-host.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] })
    const errors = hostReader(value => { if (value.type === 'error' && nativeErrors.length < 8) nativeErrors.push(String(value.message)) }, () => {})
    child.stdout.on('data', chunk => errors(chunk))
    child.stderr.resume(); return child
  })
  const entry = `export {connectDesktop} from ${JSON.stringify(path.resolve(import.meta.dirname, '../src/utils/desktop-connection.ts'))}`
  const bundle = await build({ input: 'virtual:viewer', plugins: [{ name: 'viewer', resolveId: id => id === 'virtual:viewer' ? id : undefined, load: id => id === 'virtual:viewer' ? entry : undefined }], write: false, platform: 'browser', output: { format: 'iife', name: 'Desktop' } })
  const chunk = bundle.output.find(value => value.type === 'chunk')!
  const server = createServer((req, res) => {
    if (req.url === '/api/remote-desktop/status') { res.setHeader('Content-Type', 'application/json'); res.end('{"ready":true}'); return }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<video autoplay muted playsinline></video><script>${chunk.code}</script><script>
      const Peer=window.RTCPeerConnection;window.RTCPeerConnection=class extends Peer {
        constructor(...args){super(...args);window.peer=this;window.trace=[];
          this.addEventListener('connectionstatechange',()=>window.trace.push('peer:'+this.connectionState));
          this.addEventListener('iceconnectionstatechange',()=>window.trace.push('ice:'+this.iceConnectionState));
          this.addEventListener('datachannel',e=>{e.channel.addEventListener('close',()=>window.trace.push(e.channel.label+':closed'));e.channel.addEventListener('error',()=>window.trace.push(e.channel.label+':error'))})}
        async setRemoteDescription(value){try{return await super.setRemoteDescription(value)}catch(e){console.error('SDP:',e.message);throw e}}
        async addIceCandidate(value){try{return await super.addIceCandidate(value)}catch(e){console.error('ICE:',e.message);throw e}}
      };
      window.openDesktop=()=>{
        window.failure='';window.state='starting';window.frames=0;window.openedAt=performance.now();window.firstFrame=0;window.nativeCursor=false;
        const video=document.querySelector('video');
        if(window.paintId)video.cancelVideoFrameCallback(window.paintId);video.srcObject=null;
        const painted=()=>{window.frames++;if(!window.firstFrame)window.firstFrame=performance.now()-window.openedAt;window.paintId=video.requestVideoFrameCallback(painted)};
        window.paintId=video.requestVideoFrameCallback(painted);
        window.connection=Desktop.connectDesktop({state:(s,m)=>{window.state=s;if(s==='error')window.failure=m},screens:()=>{},relative:()=>{},stats:()=>{},transport:m=>window.transport=m,localCursor:v=>window.nativeCursor=v,stream:s=>{video.srcObject=s}});
      };window.openDesktop();</script>`)
  })
  attachRemoteDesktopWebSocket(server, { getAuth: () => ({ role: 'owner', email: 'fixture@example.test', mustChangePassword: false }), iceServers: () => [], spawnHost: () => pool.acquire() })
  server.on('upgrade', (_req, socket) => { const write = socket.write.bind(socket); socket.write = ((data: unknown, ...args: unknown[]) => { if (Buffer.isBuffer(data) && data[0] === 0x82) binary++; return (write as (...args: unknown[]) => boolean)(data, ...args) }) as typeof socket.write })
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    await pool.warm()
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    if (process.env.MEW_DESKTOP_TEST_WINDOWS_CHROME) {
      const source = `import {chromium} from ${JSON.stringify('file:///' + path.win32.join(helper, 'node_modules/playwright-core/index.mjs').replaceAll('\\', '/'))};
        const b=await chromium.launch({executablePath:${JSON.stringify(process.env.MEW_DESKTOP_TEST_WINDOWS_CHROME)},chromiumSandbox:true});
        try{const p=await b.newPage();p.on('console',m=>{if(m.type()==='error')console.log(m.text())});await p.goto(${JSON.stringify(url)});
        for(let i=0;i<2;i++){if(i)await p.evaluate('window.openDesktop()');await p.waitForFunction('window.failure||window.frames>0',null,{timeout:25000});
        const value=await p.evaluate('({failure:window.failure,transport:window.transport,firstFrame:window.firstFrame,frames:window.frames})');console.log(JSON.stringify(value));if(value.failure||!value.frames)throw Error(value.failure||'No frame');
        await p.waitForFunction('window.state==="connected"&&window.nativeCursor');await p.waitForTimeout(1700);
        if(await p.evaluate('window.failure'))throw Error(await p.evaluate('JSON.stringify({failure:window.failure,frames:window.frames,peer:window.peer.connectionState,ice:window.peer.iceConnectionState,trace:window.trace})'));
        await p.evaluate('window.connection.close()');await p.waitForTimeout(250)}
        }finally{await b.close()}`
      const result = await promisify(execFile)(node, ['--input-type=module', '-e', source], { timeout: 55_000 }).catch(error => { throw new Error([...nativeErrors, error.stderr, error.stdout].filter(Boolean).join('\n') || error.message) })
      console.log('Windows browser GPU results:', result.stdout.trim()); assert.equal(launches, 1); assert.equal(binary, 0); return
    }
    const page = await browser.newPage()
    page.on('console', message => { if (message.type() === 'error') console.log('Browser:', message.text()) })
    await page.goto(url)
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await page.evaluate('window.openDesktop()')
      await page.waitForFunction(`window.failure||window.frames>0`, null, { timeout: 25_000 })
      const diagnostic = await page.evaluate(`(async()=>{const stats=await window.peer.getStats(),result={state:window.peer.connectionState,ice:window.peer.iceConnectionState,local:[],remote:[],pairs:[]};stats.forEach(s=>{if(s.type==='local-candidate'||s.type==='remote-candidate')result[s.type==='local-candidate'?'local':'remote'].push({type:s.candidateType,protocol:s.protocol,mdns:s.address?.endsWith('.local')});if(s.type==='candidate-pair')result.pairs.push({state:s.state,requests:s.requestsSent,responses:s.responsesReceived})});return result})()`)
      assert.equal(await page.evaluate('window.failure'), '', JSON.stringify(diagnostic))
      assert.equal(await page.evaluate('window.transport'), 'direct')
      await page.waitForFunction(`window.state==='connected'&&window.nativeCursor`)
      console.log('Windows GPU direct first frame (ms):', await page.evaluate('Math.round(window.firstFrame)'))
      await page.waitForTimeout(1700)
      assert.equal(await page.evaluate('window.failure'), '')
      await page.evaluate('window.connection.close()')
      await page.waitForTimeout(250)
    }
    assert.equal(launches, 1); assert.equal(binary, 0, 'media never enters signaling')
  } finally {
    await browser.close(); await pool.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
