import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { build } from 'rolldown'
import { domBrowserExecutable } from './browser-dom-executable.ts'

// Explicit opt-in; synthetic UDP NAT and input receiver, no desktop/GPU/input APIs,
// no real router requests or firewall changes. The helper must be an isolated copy.
for (const system of ['windows', 'posix'] as const) test(`${system} native WebRTC traverses an emulated UDP NAT with mapped candidates only and deletes each session mapping`, {
  skip: system === 'windows'
    ? !process.env.MEW_DESKTOP_TEST_WINDOWS_HELPER || !process.env.MEW_DESKTOP_TEST_WINDOWS_NODE || !process.env.MEW_DESKTOP_TEST_WINDOWS_CHROME
    : !['linux', 'darwin'].includes(process.platform) || !process.env.MEW_DESKTOP_TEST_NATIVE_HELPER || !domBrowserExecutable(), timeout: 35_000,
}, async () => {
  const helper = system === 'windows' ? process.env.MEW_DESKTOP_TEST_WINDOWS_HELPER! : process.env.MEW_DESKTOP_TEST_NATIVE_HELPER!
  const node = system === 'windows' ? process.env.MEW_DESKTOP_TEST_WINDOWS_NODE! : process.execPath
  const chrome = system === 'windows' ? process.env.MEW_DESKTOP_TEST_WINDOWS_CHROME! : domBrowserExecutable()!
  const entry = `export {desktopDirect} from ${JSON.stringify(path.resolve(import.meta.dirname, '../src/utils/desktop-direct.ts'))};export {desktopInput} from ${JSON.stringify(path.resolve(import.meta.dirname, '../src/utils/desktop-input.ts'))}`
  const bundle = await build({ input: 'virtual:nat', plugins: [{ name: 'nat', resolveId: id => id === 'virtual:nat' ? id : undefined, load: id => id === 'virtual:nat' ? entry : undefined }], write: false, platform: 'browser', output: { format: 'iife', name: 'Desktop' } })
  const code = bundle.output.find(value => value.type === 'chunk')!.code
  const url = (file: string) => system === 'windows' ? 'file:///' + path.win32.join(helper, file).replaceAll('\\', '/') : pathToFileURL(path.resolve(helper, file)).href
  const playwright = system === 'windows' ? url('node_modules/playwright-core/index.mjs') : pathToFileURL(path.resolve(import.meta.dirname, '../node_modules/playwright-core/index.mjs')).href
  const html = '<script>' + code + '</script>' + `<script>
 const Peer=window.RTCPeerConnection;window.RTCPeerConnection=class extends Peer{constructor(...args){super(...args);window.natPeer=this}};
 window.start=async()=>{window.ready=false;window.failure='';if(window.direct)window.direct.close();await fetch('/start');
 const input=Desktop.desktopInput(m=>window.failure=m);window.input=input;
 window.direct=Desktop.desktopDirect({iceServers:[],input,signal:v=>{if(v.type==='answer')fetch('/signal',{method:'POST',body:JSON.stringify(v)})},stream(){},connected:()=>{window.ready=true;input.key('KeyA',true);input.key('KeyA',false)},failed:()=>window.failure='ICE failed'});
 };window.poll=setInterval(async()=>{for(const v of await(await fetch('/events')).json()){if(v.type==='error')window.failure=v.message;else await window.direct?.message(v)}},20);
</script>`
  const script = `
import rtc from ${JSON.stringify(url('node_modules/node-datachannel/dist/esm/lib/index.mjs'))};
import {nativeDirect} from ${JSON.stringify(url('native-direct.mjs'))};
import {nativeConnectivity,desktopRoutes} from ${JSON.stringify(url('native-connectivity.mjs'))};
import {chromium} from ${JSON.stringify(playwright)};
import dgram from 'node:dgram';import {createServer} from 'node:http';
let direct,events=[],mapped=0,removed=0,forwarded=0,inputs=0;const packets={request:0,response:0,dtls:0};
const count=packet=>{if(packet[0]===0)packets.request++;else if(packet[0]===1)packets.response++;else if(packet[0]>=20&&packet[0]<=64)packets.dtls++};
const routes=(await desktopRoutes()).slice(0,1);if(!routes.length)throw Error('An OS-selected private IPv4 route is required for this isolated NAT test');
const strip=s=>s.split(/\\r?\\n/).filter(l=>!l.startsWith('a=candidate:')&&!l.startsWith('a=end-of-candidates')).join('\\r\\n');
async function map(route,port){
 const outside=dgram.createSocket('udp4'),flows=new Map();let closed=false;
 await new Promise(r=>outside.bind(0,'127.0.0.1',r));mapped++;
 // Preserve each source endpoint. Several browser interfaces can probe the
 // mapped port simultaneously; one shared return destination corrupts ICE.
 outside.on('message',(packet,sender)=>{
  if(closed)return;const key=sender.address+':'+sender.port;let flow=flows.get(key);
  if(!flow){const inside=dgram.createSocket('udp4');const ready=new Promise((resolve,reject)=>{inside.once('error',reject);inside.bind(0,route.address,()=>inside.connect(port,route.address,resolve))});flow={inside,ready};flows.set(key,flow);
   inside.on('message',packet=>{if(!closed){forwarded++;count(packet);outside.send(packet,sender.port,sender.address)}})}
  flow.ready.then(()=>{if(!closed){forwarded++;count(packet);flow.inside.send(packet)}}).catch(()=>{});
 });
 return{address:'127.0.0.1',port:outside.address().port,lease:120,renew:async()=>120,close:async()=>{if(closed)return;closed=true;await Promise.allSettled([...flows.values()].map(f=>f.ready));await Promise.all([new Promise(r=>outside.close(r)),...[...flows.values()].map(f=>new Promise(r=>f.inside.close(r)))]);removed++}}
}
const server=createServer(async(req,res)=>{
 if(req.url==='/events'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(events.splice(0)));return}
 if(req.url==='/signal'){let raw='';for await(const c of req)raw+=c;const value=JSON.parse(raw);if(value.type==='answer'){value.sdp=strip(value.sdp);direct.signal(value)}res.end('ok');return}
 if(req.url==='/start'){
  if(direct)await direct.close();events=[];
  direct=nativeDirect(rtc,{iceServers:[],input:()=>inputs++,keyframe(){},bitrate(){},fail:e=>events.push({type:'error',message:e.message}),
   connectivity:options=>nativeConnectivity({...options,delayMs:0,routes:async()=>routes,map:[map]}),
   emit:v=>{if(v.type==='offer'){v.sdp=strip(v.sdp);events.push(v)}else if(v.type==='candidate'&&v.candidate.candidate.includes('mew'))events.push(v)}});res.end('ok');return
 }
 res.setHeader('Content-Type','text/html');res.end(${JSON.stringify(html)})
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:${JSON.stringify(chrome)},chromiumSandbox:true});
let page;try{page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 for(let i=0;i<2;i++){await page.evaluate('window.start()');await page.waitForFunction('window.ready||window.failure',null,{timeout:12000});const error=await page.evaluate('window.failure');if(error)throw Error(error);
  // Real native wrappers close SCTP on finalization. Force collection while the
  // attempt is active, then require fresh input delivery through both sessions.
  global.gc();global.gc();await page.waitForTimeout(250);
  if(await page.evaluate('window.failure||window.natPeer.connectionState!=="connected"'))throw Error('Native input channels were lost during collection');
  await page.evaluate('window.input.key("KeyB",true);window.input.key("KeyB",false)');await page.waitForTimeout(100);
  await page.evaluate('window.direct.close()');await direct.close();direct=undefined}
 if(mapped!==2||removed!==2||!forwarded||inputs<8)throw Error('Mapped path or cleanup failed');console.log(JSON.stringify({mapped,removed,forwarded,inputs,hostCandidatesExchanged:0}));
}catch(error){const peer=await page?.evaluate(async()=>{const p=window.natPeer,s=await p.getStats();return{state:p.connectionState,ice:p.iceConnectionState,pairs:[...s.values()].filter(v=>v.type==='candidate-pair').map(v=>({state:v.state,requests:v.requestsSent,responses:v.responsesReceived,nominated:v.nominated}))}}).catch(()=>undefined);console.error(JSON.stringify({error:error.message,mapped,removed,forwarded,inputs,packets,peer}));throw error}
finally{await direct?.close();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));rtc.cleanup()}
`
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(node, ['--expose-gc', '--input-type=module'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), 32_000)
    child.stdout.on('data', chunk => { if (stdout.length < 65536) stdout += chunk.toString() })
    child.stderr.on('data', chunk => { if (stderr.length < 65536) stderr += chunk.toString() })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', (code, signal) => { clearTimeout(timer); if (code === 0) resolve(stdout); else reject(new Error(stderr || `Synthetic NAT child failed (${code ?? signal}): ${stdout}`)) })
    child.stdin.on('error', () => {}); child.stdin.end(script)
  })
  const summary = JSON.parse(output.trim())
  assert.equal(summary.mapped, 2); assert.equal(summary.removed, 2); assert.ok(summary.forwarded > 0); assert.ok(summary.inputs >= 8); assert.equal(summary.hostCandidatesExchanged, 0)
})
