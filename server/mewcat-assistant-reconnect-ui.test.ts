import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('assistant reconnect preserves conversation, resumes its session, never resends prompts and cleans up retries', { skip: !domBrowserExecutable(), timeout: 20_000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..')
  const source = `
import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {useMewcatAssistant} from '${root}/src/hooks/use-mewcat-assistant.ts';
window.sockets=[];window.actionCalls=0;
class Socket {
  static CONNECTING=0;static OPEN=1;static CLOSED=3;readyState=0;frames=[];
  constructor(url){this.url=url;window.sockets.push(this)}
  open(){this.readyState=1;this.onopen?.()}
  receive(message){this.onmessage?.({data:JSON.stringify(message)})}
  send(raw){this.frames.push(JSON.parse(raw))}
  close(){if(this.readyState===3)return;this.readyState=3;this.onclose?.()}
}
window.WebSocket=Socket;
function Harness(){window.assistant=useMewcatAssistant({account:'owner@test',enabled:true,runtime:'codex',projectRoot:'/project',onAction:()=>{window.actionCalls++;return new Promise(resolve=>window.finishAction=resolve)}});return null}
const app=createRoot(document.getElementById('root'));let key=0;
window.mount=()=>app.render(React.createElement(Harness,{key:++key}));window.unmount=()=>app.unmount();window.mount();`
  const bundle = await build({ input: 'virtual:assistant-reconnect.ts', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id, importer) {
    if (id === 'virtual:assistant-reconnect.ts') return id
    if (id === '../i18n' && importer?.endsWith('/use-mewcat-assistant.ts')) return 'virtual:i18n'
  }, load(id) { if (id === 'virtual:assistant-reconnect.ts') return source; if (id === 'virtual:i18n') return `export function useI18n(){return {locale:'ko'}}` } }] })
  const code = bundle.output.find(item => item.type === 'chunk')!.code
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  const page = await browser.newPage(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') })
  await page.clock.pauseAt(new Date('2030-01-01T00:00:01Z'))
  await page.route('https://assistant-reconnect.test/**', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script>${code}</script>` }))
  await page.goto('https://assistant-reconnect.test/')
  await page.waitForFunction('window.sockets.length===1')
  await page.evaluate(`window.sockets[0].open();window.sockets[0].receive({type:'meta',meta:{sessionId:'session-one',busy:false}})`)
  await page.waitForFunction('window.assistant.ready')
  await page.evaluate(`window.assistant.ask('run-once');window.sockets[0].receive({type:'update',update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:'run-once'}}});window.sockets[0].receive({type:'update',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'saved reply'}}});window.stale=window.sockets[0].onmessage;window.sockets[0].close()`)
  await page.waitForFunction('!window.assistant.ready && window.assistant.messages.length===2')
  await page.clock.runFor(499)
  assert.equal(await page.evaluate('window.sockets.length'), 1)
  await page.clock.runFor(1)
  await page.waitForFunction('window.sockets.length===2')
  assert.equal(await page.evaluate(`new URL(window.sockets[1].url).searchParams.get('resume')`), 'session-one')
  assert.equal(await page.evaluate('window.assistant.messages[1].text'), 'saved reply')
  await page.evaluate(`window.sockets[1].open();window.sockets[1].receive({type:'meta',meta:{sessionId:'session-one',busy:false}});window.stale({data:JSON.stringify({type:'mewcat_action',id:'old',action:{kind:'open_panel',panel:'documents'}})})`)
  await page.waitForFunction('window.assistant.ready && window.assistant.error===null')
  assert.equal(await page.evaluate('window.actionCalls'), 0)
  await page.evaluate(`window.sockets[1].receive({type:'mewcat_action',id:'pending',action:{kind:'open_panel',panel:'documents'}});window.sockets[1].close();window.dispatchEvent(new Event('online'))`)
  await page.waitForFunction('window.sockets.length===3')
  await page.evaluate(`window.sockets[2].open();window.sockets[2].receive({type:'meta',meta:{sessionId:'session-one',busy:false}});window.finishAction()`)
  await page.waitForFunction('window.assistant.ready')
  assert.equal(await page.evaluate(`window.sockets.flatMap(socket=>socket.frames).filter(frame=>frame.type==='prompt').length`), 1)
  assert.equal(await page.evaluate(`window.sockets[2].frames.some(frame=>frame.type==='mewcat_action_result')`), false)
  await page.evaluate(`window.sockets[2].receive({type:'fatal',message:'access stopped'});window.sockets[2].close();window.dispatchEvent(new Event('online'))`)
  await page.clock.runFor(60_000)
  assert.equal(await page.evaluate('window.sockets.length'), 3, 'terminal server errors require an explicit retry')
  await page.evaluate('window.mount()')
  await page.waitForFunction('window.sockets.length===4')
  await page.evaluate('window.sockets[3].close();window.unmount();window.dispatchEvent(new Event("online"))')
  await page.clock.runFor(60_000)
  assert.equal(await page.evaluate('window.sockets.length'), 4, 'unmount removes retry timers and online listeners')
  assert.deepEqual(errors, [])
})
