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

for (const transport of ['direct', 'server'] as const) test(`fullscreen desktop decodes real ${transport} video and controls a synthetic host on mobile`, { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const source = `
import React,{useState} from '${require.resolve('react')}';
import {createRoot} from '${require.resolve('react-dom/client')}';
import {RemoteDesktop} from '${root}/src/components/remote-desktop.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {createInputReceiver} from '${root}/native/remote-desktop/protocol.mjs';
const events=window.inputEvents=[], packets=window.inputPackets=[];
const receiver=createInputReceiver(Object.fromEntries(['move','moveTo','wheel','button','key'].map(name=>[name,(...args)=>events.push([name,...args])])));
let listener, socket;
const canvas=document.createElement('canvas'); canvas.width=1280;canvas.height=720;
const context=canvas.getContext('2d'); let frame=0;
setInterval(()=>{context.fillStyle='#16252b';context.fillRect(0,0,1280,720);context.fillStyle='#e0eaec';context.font='28px sans-serif';context.fillText('Synthetic desktop · WebRTC test',60,75);context.fillStyle='#26383f';context.fillRect(60,115,720,460);context.fillStyle='#d3dee1';context.font='20px sans-serif';context.fillText('No physical desktop is captured or controlled.',90,165);context.fillStyle='#789dad';context.fillRect(900+Math.sin(frame++/30)*50,300,20,20)},33);
window.captureCount=0;window.frameBytes=0;window.frameCount=0;window.switches=0;
navigator.mediaDevices.getUserMedia=async()=>{window.captureCount++;window.syntheticStream=canvas.captureStream(30);return window.syntheticStream};
const accept=(value,reliable)=>{packets.push([value,reliable]);if(value.type==='input')receiver.accept(value,reliable)};
const withoutCandidates=value=>value.sdp?{...value,sdp:value.sdp.replace(/^a=candidate:.*\\r?\\n/gm,'')}:value;
window.desktopHost={ready(){},onSignal(fn){listener=fn},signal(value){socket?.emit(value)},input:accept,frame(packet){window.frameCount++;window.frameBytes+=packet.byteLength;socket?.onmessage?.({data:packet.buffer.slice(packet.byteOffset,packet.byteOffset+packet.byteLength)})}};
class Socket {
 static OPEN=1;readyState=1;bufferedAmount=0;
 constructor(){socket=this;window.socket=this;setTimeout(()=>{this.emit({type:'config',iceServers:[]});this.emit({type:'sources',screens:[{id:'screen:0:0',label:'Test display',width:1280,height:720}]})},20)}
 emit(value){if('${transport}'==='server'&&value.type==='candidate')return;if(this.readyState===1)this.onmessage?.({data:JSON.stringify('${transport}'==='server'?withoutCandidates(value):value)})}
 send(raw){let value=JSON.parse(raw);if(value.type==='frame-ack'&&window.pauseAcks){window.pendingAck=raw;return}if(value.type==='relay-input'){accept(value.value,value.reliable);return}if(value.type==='relay'){window.switches++;receiver.pause()}if('${transport}'==='server'){if(value.type==='candidate')return;value=withoutCandidates(value)}listener(value.type==='select'?{type:'start',source:value.id,iceServers:[],relativeOnly:false}:value)}
 close(){if(this.readyState!==1)return;this.readyState=3;listener({type:'stop'});receiver.release();this.onclose?.()}
}
window.WebSocket=Socket;
function Fixture(){const[open,setOpen]=useState(false);return <><button id="open" onClick={()=>setOpen(true)}>Open desktop</button>{open&&<RemoteDesktop onClose={()=>setOpen(false)}/>}</>}
import('/sender.mjs').then(()=>createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>));`
  const bundle = await build({ input: 'virtual:desktop.tsx', write: false, platform: 'browser', output: { format: 'iife', inlineDynamicImports: true }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, external: ['/sender.mjs'], plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:desktop.tsx') return id; if (id === '@mew/tmux-term') return 'virtual:terminal.tsx'; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:desktop.tsx') return source; if (id === 'virtual:terminal.tsx') return 'export const isHiddenTmuxSession = () => false; export function TmuxTerminal({sessionName}){return <div className="xterm"><span>{sessionName}</span><textarea aria-label="설치 터미널 입력" defaultValue="fixture install output"/></div>}'; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')
  assert.ok(chunk && chunk.type === 'chunk')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const popupSource = await fs.readFile(`${root}/src/components/SessionTerminalPopup.tsx`, 'utf8')
  const css = compiler.build(popupSource.match(/[A-Za-z0-9_:[\]/.%!#()-]+/g) ?? []) + await fs.readFile(`${root}/src/components/remote-desktop.css`, 'utf8')
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
      if (['/direct-sender.mjs', '/relay-sender.mjs', '/relay-protocol.mjs'].includes(p)) return route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(`${root}/native/remote-desktop${p}`, 'utf8') })
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
    assert.equal(await page.evaluate('window.captureCount'), 1, 'fallback reuses the OS capture')
    assert.equal(await page.evaluate('window.switches'), transport === 'server' ? 1 : 0)
    if (transport === 'server') {
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
    const controls = page.getByRole('group', { name: '원격 데스크톱 조이스틱' })
    assert.deepEqual(await controls.getByRole('button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), ['좌클릭 조이스틱', '휠 조이스틱', '우클릭 조이스틱', '화면 이동 조이스틱', '확대·축소 조이스틱', '조이스틱 위치 이동'])
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
    await clear(); await gesture('좌클릭 조이스틱', 0, 0)
    assert.deepEqual(await page.evaluate('window.inputEvents.filter(e=>e[0]==="button")'), [['button', 1, true], ['button', 1, false]])
    await clear(); await gesture('좌클릭 조이스틱', 20, -8)
    assert.ok(await page.evaluate('window.inputEvents.some(e=>e[0]==="move"&&e[1]>0)'))
    assert.equal(await page.evaluate('window.inputEvents.some(e=>e[0]==="button")'), false)
    await clear(); await gesture('우클릭 조이스틱', -15, 10, true, true)
    assert.deepEqual(await page.evaluate('window.inputEvents.filter(e=>e[0]==="button")'), [['button', 4, true], ['button', 4, false]])
    await clear(); await gesture('휠 조이스틱', 18, -20)
    assert.ok(await page.evaluate('window.inputEvents.some(e=>e[0]==="wheel"&&e[1]===0&&e[2]<0)'))
    assert.equal(await page.evaluate('window.inputEvents.some(e=>e[0]==="move")'), false)
    await clear(); await gesture('휠 조이스틱', 18, -20, true)
    assert.deepEqual(await page.evaluate('window.inputEvents.filter(e=>e[0]==="button")'), [['button', 2, true], ['button', 2, false]])
    assert.ok(await page.evaluate('window.inputEvents.some(e=>e[0]==="move"&&e[1]>0)'))
    await clear(); await gesture('확대·축소 조이스틱', 0, -20)
    assert.notEqual(await page.locator('.desktop-scale').textContent(), '100%')
    await gesture('화면 이동 조이스틱', 18, 0)
    assert.deepEqual(await page.evaluate('window.inputEvents'), [], 'view controls never reach the host')
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
    const dir = process.env.MEW_DESKTOP_SCREENSHOTS
    if (dir) { await fs.mkdir(dir, { recursive: true }); await page.screenshot({ path: path.join(dir, 'mobile.png') }) }
    await page.setViewportSize({ width: 1440, height: 900 })
    if (dir) await page.screenshot({ path: path.join(dir, 'desktop.png') })
    assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth'), false)
    await page.getByRole('button', { name: '입력', exact: true }).click()
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
    await page.getByRole('button', { name: '원격 데스크톱 닫기' }).click()
    if (transport === 'server') {
      await page.evaluate('window.VideoDecoder=undefined')
      await page.getByText('Open desktop').click()
      await page.getByText(/이 브라우저는 서버 영상 연결에 필요한 VP8 재생을 지원하지 않습니다/).waitFor()
      await page.getByRole('button', { name: '원격 데스크톱 닫기' }).click()
    }
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
