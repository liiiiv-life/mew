import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..'), require = createRequire(`${root}/package.json`)

for (const scenario of ['direct', 'server', 'native', 'native-direct'] as const) test(`fullscreen desktop decodes real ${scenario} video and controls a synthetic host on mobile`, { skip: !domBrowserExecutable(), timeout: 90_000 }, async () => {
  const transport = scenario === 'native' || scenario === 'server' ? 'server' : 'direct', nativeCapture = scenario.startsWith('native')
  const source = `
import React,{useState} from '${require.resolve('react')}';
import {createRoot} from '${require.resolve('react-dom/client')}';
import {MobileDock} from '${root}/src/components/mobile-dock.tsx';
import {RemoteDesktop} from '${root}/src/components/remote-desktop.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {createInputReceiver} from '${root}/native/remote-desktop/protocol.mjs';
const events=window.inputEvents=[], packets=window.inputPackets=[];
const receiver=createInputReceiver(Object.fromEntries(['move','moveTo','wheel','button','key'].map(name=>[name,(...args)=>events.push([name,...args])])));
let listener, socket;
const canvas=document.createElement('canvas'); canvas.width=1280;canvas.height=720;window.testCanvas=canvas;
const context=canvas.getContext('2d'); let frame=0;
setInterval(()=>{if(window.freeze)return;context.fillStyle='#16252b';context.fillRect(0,0,1280,720);context.fillStyle='#e0eaec';context.font='28px sans-serif';context.fillText('Synthetic desktop · WebRTC test',60,75);context.fillStyle='#26383f';context.fillRect(60,115,720,460);context.fillStyle='#d3dee1';context.font='20px sans-serif';context.fillText('No physical desktop is captured or controlled.',90,165);context.fillStyle='#789dad';context.fillRect(900+Math.sin(frame++/30)*50,300,20,20)},33);
window.captureCount=0;window.frameBytes=0;window.frameCount=0;window.switches=0;
navigator.mediaDevices.getUserMedia=async()=>{window.captureCount++;window.syntheticStream=canvas.captureStream(30);return window.syntheticStream};
const captureStream=HTMLCanvasElement.prototype.captureStream;
if(${nativeCapture})HTMLCanvasElement.prototype.captureStream=function(...args){window.syntheticStream=captureStream.apply(this,args);return window.syntheticStream};
let lastNativeFrame=-1;
const capture=async()=>{
  if(lastNativeFrame===-1){window.captureCount++;if('${scenario}'==='native-direct')window.freeze=true;const icon=document.createElement('canvas');icon.width=12;icon.height=16;const ctx=icon.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,4,16);socket.emit({type:'cursor',visible:true,seq:0,x:.5,y:.5,width:1280,height:720,shapeId:1,shape:{width:12,height:16,hotX:0,hotY:0,png:icon.toDataURL().split(',')[1]}})}
  if(lastNativeFrame===frame)return {width:1280,height:720};lastNativeFrame=frame;
  const pixels=new Uint8Array(context.getImageData(0,0,1280,720).data);for(let i=0;i<pixels.length;i+=4){const red=pixels[i];pixels[i]=pixels[i+2];pixels[i+2]=red}
  return {width:1280,height:720,pixels}
};
const accept=(value,reliable)=>{packets.push([value,reliable]);if(value.type==='input')receiver.accept(value,reliable)};
const withoutCandidates=value=>value.sdp?{...value,sdp:value.sdp.replace(/^a=candidate:.*\\r?\\n/gm,'')}:value;
window.desktopHost={capture,ready(){},onSignal(fn){listener=fn},signal(value){socket?.emit(value)},input:accept,frame(packet){window.frameCount++;window.frameBytes+=packet.byteLength;socket?.onmessage?.({data:packet.buffer.slice(packet.byteOffset,packet.byteOffset+packet.byteLength)})}};
class Socket {
 static OPEN=1;readyState=1;bufferedAmount=0;
 constructor(){socket=this;window.socket=this;setTimeout(()=>{this.emit({type:'config',iceServers:[]});this.emit({type:'sources',screens:[{id:'screen:0:0',label:'Test display',width:1280,height:720}]})},20)}
 emit(value){if(value.type==='offer')window.offerAt=performance.now();if('${transport}'==='server'&&value.type==='candidate')return;if(this.readyState===1)this.onmessage?.({data:JSON.stringify('${transport}'==='server'?withoutCandidates(value):value)})}
 send(raw){let value=JSON.parse(raw);if(value.type==='frame-ack'&&window.pauseAcks){window.pendingAck=raw;return}if(value.type==='relay-input'){accept(value.value,value.reliable);return}if(value.type==='relay'){window.relayWait=performance.now()-window.offerAt;window.switches++;receiver.pause()}if('${transport}'==='server'){if(value.type==='candidate')return;value=withoutCandidates(value)}listener(value.type==='select'?{type:'start',source:value.id,iceServers:[],relativeOnly:false,nativeCapture:${nativeCapture}}:value)}
 close(){if(this.readyState!==1)return;this.readyState=3;listener({type:'stop'});receiver.release();this.onclose?.()}
}
window.WebSocket=Socket;
function Fixture(){const[open,setOpen]=useState(false);const[host,setHost]=useState(null);return <><button id="open" onClick={()=>setOpen(true)}>Open desktop</button><MobileDock active={open?"desktop":"editor"} available={["editor","features","desktop"]} hidden={false} portalTarget={host} onSelect={id=>setOpen(id==="desktop")} onNavigate={()=>setOpen(false)}/>{open&&<RemoteDesktop onClose={()=>setOpen(false)} dockHostRef={setHost}/>}</>}
import('/sender.mjs').then(()=>createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>));`
  const bundle = await build({ input: 'virtual:desktop.tsx', write: false, platform: 'browser', output: { format: 'iife', inlineDynamicImports: true }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, external: ['/sender.mjs'], plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:desktop.tsx') return id; if (id === '@mew/tmux-term') return 'virtual:terminal.tsx'; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:desktop.tsx') return source; if (id === 'virtual:terminal.tsx') return 'export const isHiddenTmuxSession = () => false; export function TmuxTerminal({sessionName}){return <div className="xterm"><span>{sessionName}</span><textarea aria-label="설치 터미널 입력" defaultValue="fixture install output"/></div>}'; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')
  assert.ok(chunk && chunk.type === 'chunk')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const popupSource = await fs.readFile(`${root}/src/components/SessionTerminalPopup.tsx`, 'utf8')
  const dockSource = await fs.readFile(`${root}/src/components/mobile-dock.tsx`, 'utf8')
  const selectSource = await fs.readFile(`${root}/packages/ui/src/select-field.tsx`, 'utf8')
  const css = compiler.build((popupSource + dockSource + selectSource).match(/[A-Za-z0-9_:[\]/.%!#()-]+/g) ?? []) + await fs.readFile(`${root}/src/components/remote-desktop.css`, 'utf8')
  const sender = await fs.readFile(`${root}/native/remote-desktop/sender.mjs`, 'utf8')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'ko-KR' })
    page.setDefaultTimeout(8000)
    const errors: string[] = []
    let ready = true
    let installs = 0, stopped = 0
    let installState = 'idle'
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://localhost:48973/**', async route => {
      const p = new URL(route.request().url()).pathname
      if (['/direct-sender.mjs', '/relay-sender.mjs', '/relay-protocol.mjs', '/relay-adaptation.mjs', '/native-stream.mjs'].includes(p)) return route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(`${root}/native/remote-desktop${p}`, 'utf8') })
      if (p === '/api/remote-desktop/install') {
        if (route.request().method() === 'POST') { installs++; installState = 'running' }
        return route.fulfill({ json: { session: 'mewcmd-desktop-install', terminal: installState !== 'idle', state: installState, exitCode: installState === 'failed' ? 7 : installState === 'succeeded' ? 0 : null } })
      }
      if (p.startsWith('/api/tmux/') && route.request().method() === 'DELETE') { stopped++; return route.fulfill({ json: { ok: true } }) }
      return route.fulfill(p === '/api/remote-desktop/status' ? { json: { ready, installable: !ready, platform: 'linux', message: '서버에서 npm run desktop:install을 실행해 주세요.' } } : p === '/sender.mjs' ? { contentType: 'text/javascript', body: sender } : p === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html class="dark" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    await page.goto('http://localhost:48973/')
    await page.getByText('Open desktop').click()
    await page.waitForFunction(`document.querySelector('.desktop-status')?.dataset.connected==='true'`)
    await page.waitForFunction(transport === 'direct' ? `document.querySelector('video')?.videoWidth>0` : `document.querySelector('.desktop-stage canvas')?.width===1280`)
    if (nativeCapture) await page.waitForFunction(`document.querySelector('.desktop-cursor')?.hidden===false`, null, { timeout: 3000 })
    assert.equal(await page.evaluate('window.captureCount'), 1, 'fallback reuses the OS capture')
    assert.equal(await page.evaluate('window.switches'), transport === 'server' ? 1 : 0)
    if (scenario === 'native-direct') await page.evaluate('window.freeze=false')
    if (transport === 'server') {
      assert.ok(await page.evaluate('window.relayWait<2500'), 'blocked direct path falls back without the former four-second wait')
      console.log('Direct-to-server wait (ms):', await page.evaluate('Math.round(window.relayWait)'))
      assert.ok(await page.evaluate('window.frameBytes>0'))
      assert.equal(await page.evaluate(`document.querySelector('.desktop-stage canvas').getContext('2d').getImageData(10,10,1,1).data[3]`), 255)
      const before = await page.evaluate('window.pauseAcks=true;window.frameCount') as number
      await page.waitForTimeout(800)
      const paused = await page.evaluate('window.frameCount') as number
      assert.ok(paused - before <= 4, 'a stalled viewer cannot accumulate unbounded encoded frames')
      await page.evaluate('window.pauseAcks=false;window.socket.send(window.pendingAck)')
      await page.waitForFunction(`window.frameCount > ${paused}`)
    }
    assert.equal(await page.getByRole('dialog').count(), 1)
    assert.equal(await page.locator('[data-dock-panel]').count(), 0)
    assert.deepEqual(await page.getByRole('dialog').boundingBox(), { x: 0, y: 0, width: 390, height: 844 })
    assert.equal(await page.evaluate('document.querySelector("#root").inert'), true)
    const dock = page.locator('.mobile-dock')
    await dock.waitFor({ state: 'visible' })
    const dockBox = (await dock.boundingBox())!
    const stageBox = (await page.locator('.desktop-stage').boundingBox())!
    assert.ok(stageBox.y + stageBox.height <= dockBox.y, 'remote screen reserves dock space')
    await dock.locator('[data-dock-item=desktop]').tap()
    assert.equal(await page.evaluate('window.captureCount'), 1, 'active dock item stays usable without reconnecting')
    await page.screenshot({ path: `/tmp/mew-remote-dock-${scenario}.png` })
    await page.getByRole('button', { name: '도움말', exact: true }).click()
    assert.equal(await page.locator('[data-cursor-mode]').getAttribute('data-cursor-mode'), nativeCapture ? 'local' : 'video')
    await page.getByRole('button', { name: '도움말', exact: true }).click()
    const controls = page.getByRole('group', { name: '원격 데스크톱 조이스틱' })
    assert.deepEqual(await controls.getByRole('button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), ['좌클릭 조이스틱', '휠 조이스틱', '우클릭 조이스틱', '커서 이동 조이스틱', '화면 이동 조이스틱', '확대·축소 조이스틱', '조이스틱 위치 이동'])
    const mouse = page.locator('.desktop-mouse'), pad = page.getByRole('button', { name: '커서 이동 조이스틱', exact: true })
    const mouseBox = await mouse.boundingBox(), padBox = await pad.boundingBox()
    assert.ok(mouseBox && padBox && padBox.width === mouseBox.width)
    for (const name of ['좌클릭 조이스틱', '휠 조이스틱', '우클릭 조이스틱']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox()
      assert.ok(box && box.y === mouseBox.y && box.y + box.height === padBox.y)
    }
    const clear = () => page.evaluate('window.inputEvents.length=0;window.inputPackets.length=0')
    const cdp = await page.context().newCDPSession(page)
    const touchButton = await page.getByRole('button', { name: '좌클릭 조이스틱', exact: true }).boundingBox(); assert.ok(touchButton)
    const touch = { x: touchButton.x + 22, y: touchButton.y + 16, id: 1 }
    await clear()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForFunction('window.inputEvents.filter(e=>e[0]==="button").length===2')
    assert.deepEqual(await page.evaluate('window.inputEvents.filter(e=>e[0]==="button")'), [['button', 1, true], ['button', 1, false]])
    await clear()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] })
    await page.waitForTimeout(370)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touch, x: touch.x + 18 }] })
    await page.waitForTimeout(50)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await page.waitForFunction('window.inputEvents.filter(e=>e[0]==="button").length===2')
    assert.deepEqual(await page.evaluate('window.inputEvents.filter(e=>e[0]==="button")'), [['button', 1, true], ['button', 1, false]])
    const gesture = async (name: string, dx: number, dy: number, hold = false, cancel = false) => {
      const target = page.getByRole('button', { name, exact: true }), box = await target.boundingBox(); assert.ok(box)
      const x = box.x + box.width / 2, y = box.y + 18
      await page.mouse.move(x, y); await page.mouse.down()
      if (hold) await page.waitForTimeout(370)
      if (dx || dy) { await page.mouse.move(x + dx, y + dy); await page.waitForTimeout(100) }
      if (cancel) await target.dispatchEvent('pointercancel')
      await page.mouse.up(); await page.waitForTimeout(100)
    }
    const timedStroke = async (distance: number, duration: number) => {
      const target = page.getByRole('button', { name: '커서 이동 조이스틱', exact: true }), box = await target.boundingBox(); assert.ok(box)
      await page.evaluate(`document.querySelector('[data-kind=cursor]').addEventListener('pointerdown', event => {
        const element = event.currentTarget
        element.sample = { x: event.clientX, y: event.clientY, id: event.pointerId, time: event.timeStamp }
      }, { once: true })`)
      await page.mouse.move(box.x + box.width / 2, box.y + 18); await page.mouse.down()
      await page.evaluate(`(() => {
        const element = document.querySelector('[data-kind=cursor]')
        const distance = ${distance}, duration = ${duration}
        const start = element.sample
        const move = new PointerEvent('pointermove', { bubbles: true, pointerId: start.id, pointerType: 'mouse', clientX: start.x + distance, clientY: start.y })
        Object.defineProperty(move, 'timeStamp', { value: start.time + duration })
        element.dispatchEvent(move)
      })()`)
      await page.mouse.up(); await page.waitForTimeout(100)
    }
    await page.getByRole('button', { name: '원격 데스크톱 설정', exact: true }).click()
    assert.equal(await page.locator('select, datalist').count(), 0)
    const modifierField = page.getByRole('combobox', { name: '핫키 보조키', exact: true })
    await modifierField.click()
    await page.getByRole('option', { name: 'Cmd · Mac', exact: true }).tap()
    assert.equal(await page.getByRole('button', { name: '원격 Cmd+C', exact: true }).count(), 1)
    await modifierField.click(); await modifierField.press('Escape')
    assert.equal(await page.getByRole('listbox').count(), 0)
    assert.equal(await page.locator('#desktop-settings').isVisible(), true)
    await modifierField.click()
    await page.getByRole('option', { name: 'Ctrl · Windows / Linux', exact: true }).click()
    const screenField = page.getByRole('combobox', { name: '공유 화면', exact: true })
    await screenField.click()
    await page.getByRole('option', { name: 'Test display', exact: true }).click()
    const slider = page.getByLabel('마우스 커서 감도')
    assert.equal(await slider.inputValue(), '3')
    await slider.fill('1')
    await page.getByRole('button', { name: '설정 닫기', exact: true }).click()
    await clear(); await timedStroke(10, 50)
    if (!nativeCapture) assert.ok(await page.evaluate('window.inputEvents.some(e=>e[0]==="move"&&Math.abs(e[1]-20)<=1)'), JSON.stringify(await page.evaluate('({events:window.inputEvents,sample:document.querySelector("[data-kind=cursor]").sample,packets:window.inputPackets})')))
    if (!nativeCapture) {
      await clear(); await timedStroke(100, 500)
      assert.ok(await page.evaluate('Math.abs(window.inputEvents.filter(e=>e[0]==="move").reduce((n,e)=>n+e[1],0)-200)<=1'))
      await clear(); await timedStroke(100, 50)
      assert.ok(await page.evaluate('Math.abs(window.inputEvents.filter(e=>e[0]==="move").reduce((n,e)=>n+e[1],0)-2000)<=1'), 'ten times the finger speed produces ten times the cursor distance')
    }
    await page.getByRole('button', { name: '원격 데스크톱 설정', exact: true }).click()
    await slider.fill('3')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.remote-desktop').count(), 1, 'Escape closes settings before the desktop')
    await clear(); await timedStroke(10, 50)
    if (!nativeCapture) assert.ok(await page.evaluate('window.inputEvents.some(e=>e[0]==="move"&&Math.abs(e[1]-60)<=1)'), 'default gain is three times the old movement')

    await clear()
    await page.getByRole('button', { name: '원격 Ctrl+C', exact: true }).click()
    await page.waitForFunction('window.inputEvents.some(e=>e[0]==="key"&&e[1]==="KeyC"&&e[2]===false)')
    assert.deepEqual(await page.evaluate('window.inputEvents.filter(e=>e[0]==="key")'), [['key', 'ControlLeft', true], ['key', 'KeyC', true], ['key', 'KeyC', false], ['key', 'ControlLeft', false]])
    await page.getByRole('button', { name: '원격 Esc', exact: true }).click()
    assert.equal(await page.locator('.remote-desktop').count(), 1, 'remote Escape does not close the viewer')
    const keysBefore = await page.locator('.desktop-hotkeys').boundingBox(); assert.ok(keysBefore)
    await gesture('핫키 위치 이동', 90, 50)
    const keysAfter = await page.locator('.desktop-hotkeys').boundingBox(); assert.ok(keysAfter && keysAfter.x > keysBefore.x && keysAfter.y > keysBefore.y)
    await page.getByRole('button', { name: '원격 데스크톱 설정', exact: true }).click()
    await page.getByRole('button', { name: '버튼 위치 초기화' }).click()
    await page.getByRole('button', { name: '설정 닫기', exact: true }).click()
    await page.getByRole('button', { name: '화면 90도 회전' }).click()
    const media = page.locator(transport === 'direct' ? 'video' : '.desktop-stage canvas')
    const rotated = await media.boundingBox(); assert.ok(rotated && rotated.height > rotated.width, JSON.stringify(await page.evaluate('({video:document.querySelector("video").style.cssText,canvas:document.querySelector(".desktop-stage canvas").style.cssText,switches:window.switches})')))
    await clear(); await timedStroke(10, 50)
    if (!nativeCapture) assert.ok(await page.evaluate('window.inputEvents.some(e=>e[0]==="move"&&e[1]===0&&Math.abs(e[2]+60)<=1)'), 'rotated joystick motion follows the visible screen')
    await clear()
    // A visible top-right point in the clockwise-rotated desktop maps to native top-left.
    const point = { x: rotated.x + rotated.width * .8, y: rotated.y + rotated.height * .2 }
    await page.mouse.click(point.x, point.y)
    await page.waitForFunction('window.inputPackets.some(([v])=>v.buttons===1&&v.point)')
    const remotePoint = await page.evaluate('window.inputPackets.find(([v])=>v.buttons===1&&v.point)[0].point') as number[]
    assert.ok(Math.abs(remotePoint[0] - .2) < .01 && Math.abs(remotePoint[1] - .2) < .01)
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '화면 90도 회전' }).click()
    await page.getByRole('button', { name: '전체화면', exact: true }).click()
    await page.waitForFunction('!!document.fullscreenElement')
    await page.getByRole('button', { name: '원격 데스크톱 설정', exact: true }).click()
    await modifierField.click()
    const modifierList = page.getByRole('listbox', { name: '핫키 보조키', exact: true })
    const listBounds = await modifierList.boundingBox()
    assert.ok(listBounds && listBounds.x >= 0 && listBounds.x + listBounds.width <= 390 && listBounds.y >= 0 && listBounds.y + listBounds.height <= 844)
    await page.getByRole('option', { name: 'Cmd · Mac', exact: true }).click()
    await modifierField.click(); await page.evaluate('history.back()'); await modifierList.waitFor({ state: 'hidden' })
    assert.equal(await page.locator('#desktop-settings').isVisible(), true)
    await page.getByRole('button', { name: '설정 닫기', exact: true }).click()
    await dock.waitFor({ state: 'hidden' })
    assert.equal(await page.locator('.remote-desktop').getAttribute('data-dock'), null)
    await page.getByRole('button', { name: '전체화면 해제', exact: true }).click()
    await page.waitForFunction('!document.fullscreenElement')
    await dock.waitFor({ state: 'visible' })
    if (scenario === 'direct') {
      await page.evaluate('window.testCanvas.width=640;window.testCanvas.height=960')
      await page.waitForFunction('document.querySelector("video").videoWidth===640&&parseFloat(document.querySelector("video").style.height)>parseFloat(document.querySelector("video").style.width)')
      const resized = await page.locator('video').boundingBox(); assert.ok(resized)
      await clear(); await page.mouse.click(resized.x + resized.width * .75, resized.y + resized.height * .4)
      await page.waitForFunction('window.inputPackets.some(([v])=>v.buttons===1&&v.point)')
      const target = await page.evaluate('window.inputPackets.find(([v])=>v.buttons===1&&v.point)[0].point') as number[]
      assert.ok(Math.abs(target[0] - .75) < .01 && Math.abs(target[1] - .4) < .01, 'same-track resolution changes update click projection')
      await page.evaluate('window.testCanvas.width=1280;window.testCanvas.height=720')
      await page.waitForFunction('document.querySelector("video").videoWidth===1280&&parseFloat(document.querySelector("video").style.width)>parseFloat(document.querySelector("video").style.height)')
    }
    await clear(); await gesture('좌클릭 조이스틱', 0, 0)
    assert.deepEqual(await page.evaluate('window.inputEvents.filter(e=>e[0]==="button")'), [['button', 1, true], ['button', 1, false]])
    await clear(); await gesture('좌클릭 조이스틱', 20, -8)
    assert.ok(await page.evaluate('window.inputEvents.some(e=>(e[0]==="move"||e[0]==="moveTo")&&e[1]>0)'))
    assert.deepEqual(await page.evaluate('window.inputEvents.filter(e=>e[0]==="button")'), [['button', 1, true], ['button', 1, false]])
    await clear(); await gesture('우클릭 조이스틱', -15, 10, false, true)
    assert.deepEqual(await page.evaluate('window.inputEvents.filter(e=>e[0]==="button")'), [['button', 4, true], ['button', 4, false]])
    await clear(); await gesture('커서 이동 조이스틱', 20, -8, true)
    assert.ok(await page.evaluate('window.inputEvents.some(e=>e[0]==="move"||e[0]==="moveTo")'))
    assert.equal(await page.evaluate('window.inputEvents.some(e=>e[0]==="button"||e[0]==="wheel")'), false)
    await clear(); await gesture('커서 이동 조이스틱', 0, 0)
    assert.equal(await page.evaluate('window.inputEvents.some(e=>e[0]==="button")'), false)
    await clear()
    const padTouch = { x: padBox.x + padBox.width / 2, y: padBox.y + 20, id: 2 }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [padTouch] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...padTouch, x: padTouch.x + 20, y: padTouch.y - 8 }] })
    await page.waitForFunction('window.inputEvents.some(e=>e[0]==="move"||e[0]==="moveTo")')
    await page.waitForTimeout(150)
    const stationary = await page.evaluate('window.inputEvents.filter(e=>e[0]==="move"||e[0]==="moveTo")')
    await page.waitForTimeout(250)
    assert.deepEqual(await page.evaluate('window.inputEvents.filter(e=>e[0]==="move"||e[0]==="moveTo")'), stationary, 'holding a displaced finger must not keep the cursor moving')
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await clear()
    await page.getByRole('button', { name: '좌클릭 조이스틱', exact: true }).focus()
    await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowUp'); await page.keyboard.up('ArrowRight')
    await page.waitForTimeout(100)
    assert.deepEqual(await page.evaluate('window.inputEvents.filter(e=>e[0]==="button")'), [['button', 1, true]])
    await pad.focus(); await page.keyboard.up('ArrowUp'); await page.waitForTimeout(100)
    assert.deepEqual(await page.evaluate('window.inputEvents.filter(e=>e[0]==="button")'), [['button', 1, true], ['button', 1, false]])
    await clear(); await gesture('휠 조이스틱', 18, -20)
    assert.ok(await page.evaluate('window.inputEvents.some(e=>e[0]==="wheel"&&e[1]===0&&e[2]<0)'))
    assert.equal(await page.evaluate('window.inputEvents.some(e=>e[0]==="move")'), false)
    await clear(); await gesture('휠 조이스틱', 18, -20, true)
    assert.deepEqual(await page.evaluate('window.inputEvents.filter(e=>e[0]==="button")'), [['button', 2, true], ['button', 2, false]])
    assert.ok(await page.evaluate('window.inputEvents.some(e=>(e[0]==="move"||e[0]==="moveTo")&&e[1]>0)'))
    await clear(); await gesture('확대·축소 조이스틱', 0, -20)
    assert.notEqual(await page.locator('.desktop-scale').textContent(), '100%')
    await gesture('화면 이동 조이스틱', 18, 0)
    assert.deepEqual(await page.evaluate('window.inputEvents'), [], 'view controls never reach the host')
    if (scenario === 'direct') {
      for (const kind of ['wheel', 'zoom', 'pan']) {
        const ring = await page.locator(`[data-kind="${kind}"] .desktop-stick-ring`).boundingBox(); assert.ok(ring)
        const centre = { x: ring.x + ring.width / 2, y: ring.y + ring.height / 2 }
        const value = () => kind === 'wheel'
          ? page.evaluate('window.inputEvents.filter(e=>e[0]==="wheel").reduce((sum,e)=>sum+e[2],0)')
          : media.evaluate(el => el.style.transform)
        await page.mouse.move(centre.x, centre.y); await page.mouse.down()
        await page.mouse.move(centre.x + (kind === 'pan' ? -6 : 0), centre.y + (kind === 'pan' ? 0 : -12))
        await page.waitForTimeout(120); const first = await value()
        await page.waitForTimeout(120); assert.notEqual(await value(), first, `${kind} keeps moving without pointer events`)
        await page.mouse.move(centre.x, centre.y)
        await page.waitForTimeout(120); const neutral = await value()
        await page.waitForTimeout(120); assert.equal(await value(), neutral, `${kind} stops at its visual centre`)
        await page.mouse.move(centre.x + (kind === 'pan' ? -6 : 0), centre.y + (kind === 'pan' ? 0 : -12))
        await page.waitForTimeout(120); assert.notEqual(await value(), neutral)
        if (kind === 'pan') await page.evaluate('window.dispatchEvent(new Event("blur"))')
        else await page.mouse.up()
        await page.waitForTimeout(120); const released = await value()
        await page.waitForTimeout(120); assert.equal(await value(), released, `${kind} stops on release or blur`)
        await page.mouse.up()
      }
    }
    const before = await controls.boundingBox(); assert.ok(before)
    await gesture('조이스틱 위치 이동', -80, -100)
    const after = await controls.boundingBox(); assert.ok(after && after.x < before.x && after.y < before.y)
    if (transport === 'direct') {
      await clear(); await page.locator('.desktop-stage').focus(); await page.keyboard.down('Shift')
      await page.waitForFunction('window.inputEvents.some(e=>e[0]==="key"&&e[1]==="ShiftLeft"&&e[2]===true)')
      await page.evaluate(`window.socket.emit({type:'direct-failed'})`)
      await page.waitForFunction(`window.switches===1&&document.querySelector('.desktop-status')?.dataset.connected==='true'&&getComputedStyle(document.querySelector('.desktop-stage canvas')).display==='block'`)
      assert.equal(await page.evaluate('window.captureCount'), 1)
      assert.ok(await page.evaluate('window.inputEvents.some(e=>e[0]==="key"&&e[1]==="ShiftLeft"&&e[2]===false)'), 'transition releases held modifiers')
      await page.keyboard.up('Shift')
    }
    await page.getByRole('button', { name: '원격 데스크톱 설정', exact: true }).click()
    await page.getByRole('button', { name: '버튼 위치 초기화' }).click()
    await page.getByRole('button', { name: '설정 닫기', exact: true }).click()
    await page.getByTitle('화면에 맞추기').click()
    for (const theme of ['light', 'dark']) {
      await page.locator('html').evaluate((el, theme) => el.className = theme, theme)
      for (const selector of ['.desktop-mouse', '.desktop-view-controls', '.desktop-hotkeys', '.desktop-control-strip > .desktop-handle']) {
        const style = await page.locator(selector).evaluate(el => ({ background: el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor, opacity: el.ownerDocument.defaultView!.getComputedStyle(el).opacity }))
        assert.match(style.background, /(?:\/ 0\.78|, 0\.78)/, `${selector} is translucent in ${theme}: ${style.background}`)
        assert.equal(style.opacity, '1', 'text and icons stay opaque')
      }
    }
    const dir = process.env.MEW_DESKTOP_SCREENSHOTS
    if (dir) {
      await fs.mkdir(dir, { recursive: true }); await page.screenshot({ path: path.join(dir, 'mobile.png') })
      await page.locator('html').evaluate(el => el.className = 'light')
      await page.screenshot({ path: path.join(dir, 'mobile-light.png') })
      await page.locator('html').evaluate(el => el.className = 'dark')
      await page.getByRole('button', { name: '원격 데스크톱 설정', exact: true }).click()
      await page.screenshot({ path: path.join(dir, 'settings-mobile.png') })
      await page.getByRole('button', { name: '설정 닫기', exact: true }).click()
    }
    await page.setViewportSize({ width: 320, height: 568 })
    assert.equal(await page.locator('.desktop-tools').evaluate(el => el.scrollWidth > el.clientWidth), false)
    await page.setViewportSize({ width: 844, height: 390 })
    for (const selector of ['.desktop-hotkeys', '.desktop-control-strip']) {
      const box = await page.locator(selector).boundingBox(); assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 844 && box.y + box.height <= 390)
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    if (dir) await page.screenshot({ path: path.join(dir, 'desktop.png') })
    assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth'), false)
    if (nativeCapture) {
      assert.match(await page.locator('.desktop-stage').evaluate(el => el.style.cursor), /blob:/)
      await page.evaluate('window.freeze=true')
      await page.waitForTimeout(1200)
      const before = await page.evaluate('({frames:window.frameCount,bytes:window.frameBytes})') as { frames: number; bytes: number }
      await page.waitForTimeout(16_000)
      assert.equal(await page.locator('.desktop-status').getAttribute('data-connected'), 'true', 'idle capture survives the old 15 second frame watchdog')
      assert.equal(await page.evaluate('window.frameCount'), before.frames, 'static native capture sends no repeated video')
      assert.equal(await page.evaluate('window.frameBytes'), before.bytes)
      console.log('Static native video over 16s: 0 additional frames / 0 video payload bytes')
      await page.evaluate('window.socket.send(JSON.stringify({type:"frame-ack",seq:window.frameCount,keyframe:true}))')
      await page.waitForFunction(`window.frameCount>${before.frames}`, null, { timeout: 3000 })
      const recovered = await page.evaluate('window.frameCount') as number
      await clear()
      const area = await page.locator('.desktop-stage').boundingBox(); assert.ok(area)
      await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2)
      await page.mouse.down(); await page.mouse.move(area.x + area.width / 2 + 100, area.y + area.height / 2 + 50); await page.mouse.up()
      await page.waitForFunction('window.inputEvents.some(e=>e[0]==="button"&&e[2]===false)')
      assert.equal(await page.locator('.desktop-cursor').isVisible(), false, 'native mouse hides the joystick overlay')
      assert.ok(await page.evaluate('window.inputEvents.some(e=>e[0]==="moveTo")'))
      await page.evaluate('window.freeze=false')
      await page.waitForFunction(`window.frameCount>${recovered}`)
    }
    await page.getByRole('button', { name: '입력' , exact: true }).click()
    await page.getByLabel('원격 컴퓨터에 붙여넣기').fill('한글 input')
    await page.getByRole('button', { name: '붙여넣기', exact: true }).click()
    await page.waitForFunction('window.inputPackets.some(([v])=>v.type==="paste"&&v.text==="한글 input")')
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.waitForFunction('window.syntheticStream.getTracks().every(track=>track.readyState==="ended")')
    assert.equal(await page.evaluate('document.querySelector("#root").inert'), false)
    assert.equal(await page.evaluate('document.activeElement.id === "open"'), true)
    ready = false
    await page.getByText('Open desktop').click()
    await page.getByText('원격 데스크톱을 준비하고 있습니다. 처음에는 다운로드에 몇 분 걸릴 수 있습니다.').waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '준비 내역 보기', exact: true }).click()
    const popup = page.locator('[data-cmd-overlay]')
    await popup.waitFor()
    assert.equal(installs, 1)
    assert.equal(await page.evaluate('getComputedStyle(document.querySelector("[data-cmd-overlay]")).zIndex'), '1700')
    assert.equal(await page.locator('.remote-desktop').evaluate(element => element.inert), true)
    assert.equal(await popup.evaluate(element => element.inert), false)
    await page.getByLabel('설치 터미널 입력').fill('interactive input')
    await page.keyboard.press('Escape')
    assert.equal(await popup.count(), 1, 'terminal Escape does not close either popup')
    await popup.getByRole('button', { name: '닫기', exact: true }).click()
    await popup.waitFor({ state: 'hidden' })
    assert.equal(stopped, 0, 'close detaches without killing installation')
    assert.equal(await page.locator('.remote-desktop').evaluate(element => element.inert), false)
    await page.getByRole('button', { name: '준비 내역 보기' }).click()
    assert.equal(installs, 1, 'reopening does not rerun installation')
    installState = 'failed'
    await page.getByText(/준비 실패.*종료 코드 7/).waitFor()
    if (dir) await page.screenshot({ path: path.join(dir, 'install-mobile.png') })
    assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth'), false)
    await popup.getByRole('button', { name: '닫기', exact: true }).click()
    await page.getByRole('button', { name: '다시 연결', exact: true }).click()
    await page.getByRole('button', { name: '준비 내역 보기', exact: true }).click()
    await popup.waitFor(); assert.equal(installs, 2)
    ready = true
    installState = 'succeeded'
    await page.getByText(/준비 완료/).waitFor()
    await popup.getByRole('button', { name: '닫기', exact: true }).click()
    await page.waitForFunction(`document.querySelector('.desktop-status')?.dataset.connected==='true'`)
    await page.evaluate(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))`)
    await page.getByText('앱이 백그라운드로 이동해 연결을 종료했습니다.').waitFor()
    await page.waitForFunction('window.syntheticStream.getTracks().every(track=>track.readyState==="ended")')
    await page.getByRole('button', { name: '원격 데스크톱 설정', exact: true }).click()
    await page.goBack()
    await page.locator('#desktop-settings').waitFor({ state: 'hidden' })
    assert.equal(await page.locator('.remote-desktop').count(), 1)
    await page.goBack()
    await page.locator('.remote-desktop').waitFor({ state: 'hidden' })
    assert.equal(page.url(), 'http://localhost:48973/', 'repeated Back dismisses inner UI then viewer without navigating away')
    if (transport === 'server') {
      await page.evaluate('window.VideoDecoder=undefined')
      await page.getByText('Open desktop').click()
      await page.getByText(/이 브라우저는 서버 영상 연결에 필요한 VP8 재생을 지원하지 않습니다/).waitFor()
      await page.getByRole('button', { name: '원격 데스크톱 닫기' }).click()
    }
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
