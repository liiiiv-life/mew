import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from '../../server/browser-dom-executable.ts'

test('login pixels map input through letterboxing, preserve Escape and clean up held keys', { skip: !domBrowserExecutable(), timeout: 25_000 }, async t => {
  const viewer = new URL('./LoginDesktopViewer.tsx', import.meta.url).pathname
  const floating = new URL('./FloatingLoginWindow.tsx', import.meta.url).pathname
  const react = import.meta.resolve('react'), reactDom = import.meta.resolve('react-dom/client')
  const result = await build({ input: 'virtual:login-fixture.tsx', write: false, platform: 'browser', output: { format: 'esm' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, plugins: [{
    name: 'isolated-login-viewer',
    resolveId(id) { if (id.startsWith('virtual:')) return id; if (id.endsWith('.css')) return 'virtual:style'; if (id.endsWith('/remote-transport')) return 'virtual:transport' },
    load(id) {
      if (id === 'virtual:style') return ''
      if (id === 'virtual:transport') return 'export function openMewSocket(url){return new window.LoginSocket(url)}'
      if (id === 'virtual:login-fixture.tsx') return `
        import React from ${JSON.stringify(react)};
        import {createRoot} from ${JSON.stringify(reactDom)};
        import {LoginDesktopViewer} from ${JSON.stringify(viewer)};
        import {FloatingLoginWindow} from ${JSON.stringify(floating)};
        window.packets=[];window.readyCount=0;window.closedCount=0;
        window.LoginSocket=class {readyState=0;send(value){window.packets.push(JSON.parse(value))}close(){this.readyState=3}constructor(url){this.url=url;window.socket=this;queueMicrotask(()=>{this.readyState=1;this.onopen?.(new Event('open'))})}};
        function Fixture(){const [open,setOpen]=React.useState(true);return <><button onClick={()=>setOpen(false)}>Unmount</button>{open&&<FloatingLoginWindow onClose={()=>{window.closedCount++;setOpen(false)}}><LoginDesktopViewer streamUrl="/api/login-desktop/ws?session=fixture" reopen={async()=>'/api/login-desktop/ws?session=reopened'} onReady={()=>window.readyCount++}/></FloatingLoginWindow>}</>}
        createRoot(document.getElementById('root')).render(<Fixture/>);`
    },
  }] })
  const scripts = new Map(result.output.filter(chunk => chunk.type === 'chunk').map(chunk => [`/${chunk.fileName}`, chunk.code]))
  const entry = result.output.find(chunk => chunk.type === 'chunk' && chunk.isEntry)!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, permissions: ['clipboard-read', 'clipboard-write'] })
  page.setDefaultTimeout(4000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://login-viewer.test/**', async route => {
    const script = scripts.get(new URL(route.request().url()).pathname)
    await route.fulfill(script !== undefined ? { contentType: 'text/javascript', body: script } : { contentType: 'text/html', body: `<html><head><style>body{margin:0}section[role=dialog]{position:absolute;display:flex;flex-direction:column}section[role=dialog]>header{height:36px;flex-shrink:0}section[role=dialog]>div{display:flex;flex-direction:column;flex:1;min-height:0}[data-login-desktop]{position:relative;width:100%;height:100%;min-height:0;flex:1;overflow:hidden}[data-login-desktop]>img{width:100%;height:100%;object-fit:contain}textarea{position:absolute;width:1px;height:1px;opacity:0}.relative{position:relative}.flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1}.h-full{height:100%}.min-h-0{min-height:0}</style></head><body><div id="root"></div><script type="module" src="/${entry.fileName}"></script></body></html>` })
  })
  await page.goto('https://login-viewer.test/')
  await page.waitForFunction('window.packets.some(p=>p.type==="resize")')
  const initial = await page.evaluate<any>('window.packets.find(p=>p.type==="resize")')
  assert.ok(initial.width > 0 && initial.height > 0)
  await page.evaluate(`(async()=>{window.socket.onmessage({data:JSON.stringify({type:'ready',width:800,height:400})});const canvas=document.createElement('canvas');canvas.width=800;canvas.height=400;const context=canvas.getContext('2d');context.fillStyle='#123456';context.fillRect(0,0,800,400);const frame=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));window.socket.onmessage({data:frame})})()`)
  await page.waitForFunction('window.readyCount===1')
  assert.equal(await page.evaluate('window.packets.filter(p=>p.type==="frame-ack").length'), 1)
  const stage = page.getByRole('application', { name: '로그인 화면', exact: true })
  const bounds = await stage.boundingBox()
  assert.ok(bounds)
  await stage.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } })
  const click = await page.evaluate<any>('window.packets.findLast(p=>p.type==="button"&&p.down)')
  assert.ok(Math.abs(click.x - 400) <= 1 && Math.abs(click.y - 200) <= 1)
  await stage.press('Escape')
  assert.equal(await page.evaluate('window.closedCount'), 0)
  assert.equal(await page.evaluate('window.packets.filter(p=>p.type==="key"&&p.key==="Escape").length'), 2)
  const pasteStart = await page.evaluate<number>('window.packets.length')
  await page.evaluate(`document.addEventListener('paste',event=>window.trustedPaste=event.isTrusted,{once:true,capture:true});navigator.clipboard.writeText('desktop clipboard 한글')`)
  await stage.press('Control+V')
  await page.waitForFunction('window.packets.some(p=>p.type==="paste"&&p.text==="desktop clipboard 한글")')
  const pastePackets = await page.evaluate<Array<{ type: string; code?: string; down?: boolean; text?: string }>>(`window.packets.slice(${pasteStart})`)
  assert.equal(await page.evaluate('window.trustedPaste'), true)
  assert.equal(pastePackets.filter(packet => packet.type === 'paste').length, 1)
  assert.equal(pastePackets.some(packet => packet.code === 'KeyV'), false)
  assert.deepEqual(pastePackets.filter(packet => packet.code === 'ControlLeft').map(packet => packet.down), [true, false])
  assert.ok(pastePackets.findIndex(packet => packet.code === 'ControlLeft' && !packet.down) < pastePackets.findIndex(packet => packet.type === 'paste'))
  await page.keyboard.down('Shift')
  await page.getByRole('button', { name: '다시 연결', exact: true }).focus()
  assert.equal(await page.evaluate('window.packets.some(p=>p.type==="key"&&p.code==="ShiftLeft"&&!p.down)'), true)
  await page.keyboard.up('Shift')
  await page.getByRole('button', { name: '키보드 입력', exact: true }).click()
  await page.getByRole('textbox', { name: '로그인 키보드 입력' }).fill('test input')
  assert.equal(await page.evaluate('window.packets.some(p=>p.type==="paste"&&p.text==="test input")'), true)
  await page.setViewportSize({ width: 390, height: 850 })
  await page.waitForFunction('(()=>{const bounds=document.querySelector("[role=dialog]").getBoundingClientRect();return bounds.left>=0&&bounds.right<=innerWidth})()')
  const mobileWindow = await page.getByRole('dialog').boundingBox()
  assert.ok(mobileWindow && mobileWindow.x >= 0 && mobileWindow.x + mobileWindow.width <= 390)
  await page.waitForFunction('window.packets.filter(p=>p.type==="resize").length>1')
  const resized = await page.evaluate<any>('window.packets.findLast(p=>p.type==="resize")')
  assert.ok(resized.width < initial.width)
  await page.evaluate(`window.socket.onmessage({data:JSON.stringify({type:'size',width:400,height:800})})`)
  const resizedBounds = await stage.boundingBox()
  assert.ok(resizedBounds)
  await stage.click({ position: { x: resizedBounds.width / 2, y: resizedBounds.height / 2 } })
  const resizedClick = await page.evaluate<any>('window.packets.findLast(p=>p.type==="button"&&p.down)')
  assert.ok(Math.abs(resizedClick.x - 200) <= 1 && Math.abs(resizedClick.y - 400) <= 1)
  assert.equal(await page.evaluate('window.readyCount'), 1)
  await page.getByRole('button', { name: '로그인 창 닫기' }).click()
  assert.equal(await page.evaluate('window.socket.readyState'), 3)
  assert.equal(await page.evaluate('window.closedCount'), 1)
  assert.deepEqual(errors, [])
})
