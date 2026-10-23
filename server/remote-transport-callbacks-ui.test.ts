import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('socket callback errors are reported without closing sibling sockets or HTTP requests', { skip: !domBrowserExecutable(), timeout: 15_000 }, async t => {
  const bundle = await build({ input: new URL('../src/utils/remote-transport.ts', import.meta.url).pathname, write: false, platform: 'browser', output: { format: 'iife', name: 'Remote' } })
  const code = bundle.output.find(item => item.type === 'chunk')!.code
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  const page = await browser.newPage(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://mew-resilience.test/**', route => route.fulfill({ contentType: 'text/html', body: `<script>${code}</script><script>
class Wire extends EventTarget {readyState='open';bufferedAmount=0;frames=[];send(raw){this.frames.push(JSON.parse(raw))}close(){if(this.readyState==='closed')return;this.readyState='closed';this.dispatchEvent(new Event('close'))}}
window.channel=new Wire();window.transport=new Remote.DataChannelTransport(window.channel);
window.deliver=frame=>window.channel.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(frame)}));
</script>` }))
  await page.goto('https://mew-resilience.test/')
  const result = await page.evaluate(`(async()=>{
    const socket=window.transport.socket('/api/presence');
    const sibling=window.transport.socket('/api/agent/ws');
    await new Promise(resolve=>setTimeout(resolve,0));
    const [id,siblingId]=window.channel.frames.filter(f=>f.type==='socket').map(f=>f.id);
    let siblingMessages=0, callbackTarget=false, listenerMessages=0;
    sibling.onmessage=()=>siblingMessages++;
    socket.onopen=()=>{throw new Error('app-open-callback')};
    socket.onmessage=function(event){callbackTarget=this===socket&&event.currentTarget===socket;throw new Error('app-message-callback')};
    socket.addEventListener('message',()=>listenerMessages++);
    socket.onclose=()=>{throw new Error('app-close-callback')};
    window.deliver({type:'open',id});
    window.deliver({type:'open',id:siblingId});
    window.deliver({type:'message',id,data:btoa('message'),binary:false});
    window.deliver({type:'close',id,code:1000});
    window.deliver({type:'message',id:siblingId,data:btoa('sibling'),binary:false});
    if(window.transport.closed)return{closed:true,siblingMessages,callbackTarget,listenerMessages};
    const response=window.transport.fetch('/api/auth/me');
    await new Promise(resolve=>setTimeout(resolve,0));
    const request=window.channel.frames.find(f=>f.type==='request');
    window.deliver({type:'response',id:request.id,status:200,headers:{},responseWindow:8});
    window.deliver({type:'chunk',id:request.id,data:btoa('still-connected')});
    window.deliver({type:'end',id:request.id});
    const body=await(await response).text();
    sibling.onclose=()=>{throw new Error('app-shutdown-callback')};
    const final=window.transport.socket('/api/db/ws');
    let finalClosed=false;final.onclose=()=>finalClosed=true;
    window.transport.close();
    return{closedBeforeShutdown:false,siblingMessages,callbackTarget,listenerMessages,body,finalClosed,sockets:window.transport.sockets.size};
  })()`) as Record<string, unknown>
  assert.deepEqual(result, { closedBeforeShutdown: false, siblingMessages: 1, callbackTarget: true, listenerMessages: 1, body: 'still-connected', finalClosed: true, sockets: 0 })
  await page.waitForTimeout(20)
  assert.deepEqual(errors, ['app-open-callback', 'app-message-callback', 'app-close-callback', 'app-shutdown-callback'])
})

test('closing a socket while its Blob is read does not send messages after the close frame', { skip: !domBrowserExecutable(), timeout: 15_000 }, async t => {
  const bundle = await build({ input: new URL('../src/utils/remote-transport.ts', import.meta.url).pathname, write: false, platform: 'browser', output: { format: 'iife', name: 'Remote' } })
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route('https://mew-resilience.test/**', route => route.fulfill({ contentType: 'text/html', body: `<script>${bundle.output.find(item => item.type === 'chunk')!.code}</script>` }))
  await page.goto('https://mew-resilience.test/')
  const frames = await page.evaluate(`(async()=>{
    class Wire extends EventTarget{readyState='open';bufferedAmount=0;frames=[];send(raw){this.frames.push(JSON.parse(raw))}close(){}}
    const channel=new Wire(),transport=new Remote.DataChannelTransport(channel),socket=transport.socket('/api/presence');
    await new Promise(resolve=>setTimeout(resolve,0));
    const id=channel.frames[0].id;
    channel.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'open',id})}));
    let release;const blob=new Blob(['late-message']);blob.arrayBuffer=()=>new Promise(resolve=>release=resolve);
    socket.send(blob);
    await Promise.resolve();
    socket.close();
    release(new TextEncoder().encode('late-message').buffer);
    await socket.queue;
    const frames=channel.frames.map(f=>f.type);transport.close();return frames;
  })()`) as string[]
  assert.deepEqual(frames, ['socket', 'close'])
})
