import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

async function viewerBundle() {
  const entry = `export {connectDesktop} from ${JSON.stringify(path.resolve(import.meta.dirname, '../src/utils/desktop-connection.ts'))}`
  const result = await build({ input: 'virtual:viewer', plugins: [{ name: 'viewer', resolveId: id => id === 'virtual:viewer' ? id : undefined, load: id => id === 'virtual:viewer' ? entry : undefined }], write: false, platform: 'browser', output: { format: 'iife', name: 'Desktop' } })
  return result.output.find(value => value.type === 'chunk')!.code
}

test('viewer waits for both decoded video and input channels; missing video times out as a capture error', { skip: !domBrowserExecutable() }, async () => {
  const code = await viewerBundle()
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage()
    await page.route('http://localhost:48975/**', route => route.fulfill(new URL(route.request().url()).pathname === '/api/remote-desktop/status' ? { json: { ready: true } } : { contentType: 'text/html', body: '<html></html>' }))
    await page.goto('http://localhost:48975/')
    await page.addScriptTag({ content: `
      const timeout=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>timeout(fn,ms===20000?800:ms,...args);
      window.decoded=0;window.channelOpen=null;window.states=[];window.notices=[];
      window.WebSocket=class {
        static OPEN=1;readyState=1;bufferedAmount=0;
        constructor(){queueMicrotask(()=>{this.onmessage({data:JSON.stringify({type:'config',iceServers:[]})});this.onmessage({data:JSON.stringify({type:'offer',sdp:'fixture'})})})}
        send(){}close(){this.readyState=3}
      };
      window.RTCPeerConnection=class {
        async setRemoteDescription(){this.remoteDescription={};queueMicrotask(()=>{
          const motion={label:'motion',readyState:'open',bufferedAmount:0,send(){},close(){}};
          const control={...motion,label:'control',send(raw){if(JSON.parse(raw).type==='viewer-ready')window.notices.push(raw)}};this.ondatachannel({channel:motion});this.ondatachannel({channel:control});
          window.channelOpen=()=>{motion.onopen();control.onopen()};
        })}
        async addIceCandidate(){}async createAnswer(){return {type:'answer',sdp:'fixture'}}
        async setLocalDescription(v){this.localDescription=v}
        async getStats(){return new Map([['video',{type:'inbound-rtp',kind:'video',framesDecoded:window.decoded,bytesReceived:100,timestamp:performance.now()}]])}
        getReceivers(){return []}close(){}
      };
    ` })
    await page.addScriptTag({ content: code })
    const open = `window.connection=Desktop.connectDesktop({state:(s,m)=>{window.states.push(s);window.state=s;window.message=m},screens(){},stream(){},relative(){},stats(){}})`
    await page.evaluate(open)
    await page.waitForFunction('window.channelOpen')
    await page.evaluate('window.decoded=1')
    await page.waitForTimeout(150)
    assert.notEqual(await page.evaluate('window.state'), 'connected', 'decoding alone cannot enable input')
    assert.equal(await page.evaluate('window.notices.length'), 0)
    await page.evaluate('window.channelOpen()')
    await page.waitForFunction(`window.state==='connected'`)
    await page.waitForFunction('window.notices.length===1')
    await page.waitForTimeout(150)
    assert.equal(await page.evaluate('window.notices.length'), 1)
    await page.evaluate('window.connection.close();window.decoded=0;window.channelOpen=null;window.states=[]')
    await page.evaluate(open)
    await page.waitForFunction('window.channelOpen')
    await page.evaluate('window.channelOpen()')
    await page.waitForTimeout(150)
    assert.notEqual(await page.evaluate('window.state'), 'connected', 'open channels alone are not a visible desktop')
    await page.waitForFunction(`window.state==='error'`)
    assert.equal(await page.evaluate(`window.states.includes('connected')`), false)
    assert.match(await page.evaluate('window.message') as string, /활성 화면|active display/)
    assert.equal(await page.evaluate('window.notices.length'), 1, 'missing video must never send a host connection notice')
    await page.evaluate('window.decoded=1;window.channelOpen=null;window.states=[]')
    await page.evaluate(open)
    await page.waitForFunction('window.channelOpen')
    await page.evaluate('window.channelOpen()')
    await page.waitForFunction('window.notices.length===2')
    await page.evaluate('window.connection.close()')
  } finally { await browser.close() }
})

test('viewer keeps signaling during STUN failover and ignores decoded frames from the retired peer', { skip: !domBrowserExecutable(), timeout: 10_000 }, async () => {
  const code = await viewerBundle(), browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage()
    await page.route('http://localhost:48976/**', route => route.fulfill(new URL(route.request().url()).pathname === '/api/remote-desktop/status' ? { json: { ready: true } } : { contentType: 'text/html', body: '<html></html>' }))
    await page.goto('http://localhost:48976/')
    await page.addScriptTag({ content: `
      window.peers=[];window.signals=[];window.decoded=0;window.notices=0;
      window.WebSocket=class {
        static OPEN=1;readyState=1;bufferedAmount=0;
        constructor(){window.signaling=this;queueMicrotask(()=>{
          this.emit({type:'config',iceServers:[{urls:['stun:first.test:3478','stun:second.test:3478']}]});
          this.emit({type:'offer',native:true,negotiation:0,sdp:'fixture'});
        })}
        emit(value){this.onmessage({data:JSON.stringify(value)})}
        send(raw){window.signals.push(JSON.parse(raw))}close(){this.readyState=3}
      };
      window.RTCPeerConnection=class {
        constructor(){this.index=window.peers.length;this.candidates=[];window.peers.push(this)}
        async setRemoteDescription(){this.remoteDescription={};const peer=this;queueMicrotask(()=>{
          const motion={label:'motion',readyState:'connecting',bufferedAmount:0,send(){},close(){this.readyState='closed'}};
          const control={...motion,label:'control',send(raw){if(JSON.parse(raw).type==='viewer-ready')window.notices++}};
          this.ondatachannel({channel:motion});this.ondatachannel({channel:control});
          peer.open=()=>{motion.readyState=control.readyState='open';motion.onopen();control.onopen()};
        })}
        async addIceCandidate(value){this.candidates.push(value.candidate)}async createAnswer(){return {type:'answer',sdp:'fixture'}}
        async setLocalDescription(value){this.localDescription=value}
        getStats(){const report=()=>new Map([['video',{type:'inbound-rtp',kind:'video',framesDecoded:window.decoded,bytesReceived:100,timestamp:performance.now()}]]);
          if(this.index===0)return new Promise(resolve=>{window.finishOldStats=()=>resolve(new Map([['video',{type:'inbound-rtp',kind:'video',framesDecoded:1,bytesReceived:100,timestamp:performance.now()}]]))});
          return Promise.resolve(report())
        }
        getReceivers(){return []}close(){this.closed=true}
      };
    ` })
    await page.addScriptTag({ content: code })
    await page.evaluate(`window.connection=Desktop.connectDesktop({state:(s,m)=>{window.state=s;window.message=m},screens(){},stream(){},relative(){},stats(){}})`)
    await page.waitForFunction('window.signals.some(s=>s.type==="answer"&&s.negotiation===0)&&window.finishOldStats')
    await page.evaluate(`window.peers[0].connectionState='failed';window.peers[0].onconnectionstatechange()`)
    assert.notEqual(await page.evaluate('window.state'), 'error', 'browser must wait for the host to retry its ICE agent')
    assert.equal(await page.evaluate('window.signaling.readyState'), 1)
    await page.evaluate(`
      window.signaling.emit({type:'candidate',negotiation:1,candidate:{candidate:'new-route'}});
      window.signaling.emit({type:'offer',native:true,negotiation:1,sdp:'fixture'});
      window.signaling.emit({type:'candidate',negotiation:0,candidate:{candidate:'retired-route'}});
    `)
    await page.waitForFunction('window.signals.some(s=>s.type==="answer"&&s.negotiation===1)&&window.peers[1].candidates.length===1')
    assert.equal(await page.evaluate('window.peers[0].closed'), true)
    assert.deepEqual(await page.evaluate('window.peers[1].candidates'), ['new-route'])
    await page.evaluate('window.finishOldStats();window.peers[1].open()')
    await page.waitForTimeout(250)
    assert.notEqual(await page.evaluate('window.state'), 'connected', 'old decoded video cannot mark the replacement as visible')
    assert.equal(await page.evaluate('window.notices'), 0)
    await page.evaluate('window.decoded=1')
    await page.waitForFunction('window.state==="connected"&&window.notices===1')
    await page.evaluate(`window.peers[1].connectionState='failed';window.peers[1].onconnectionstatechange()`)
    await page.waitForFunction('window.state==="error"')
    assert.equal(await page.evaluate('window.signaling.readyState'), 3, 'an established control session ends immediately on failure')
  } finally { await browser.close() }
})
