import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('screen keyboards support multitouch, sticky modifiers, customization, persistence and release on lifecycle changes', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const source = `import React from '${root}/node_modules/react/index.js';import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {DesktopScreenKeyboard} from '${root}/src/components/desktop-screen-keyboard.tsx';import {desktopInput} from '${root}/src/utils/desktop-input.ts';import {readScreenKeyboard} from '${root}/src/utils/desktop-screen-keyboard.ts';
function Fixture(){const panel=React.useRef(null),[settings,setSettings]=React.useState(readScreenKeyboard),[open,setOpen]=React.useState(true),[disabled,setDisabled]=React.useState(false),[rotation,setRotation]=React.useState(0);
const input=React.useMemo(()=>{window.packets=[];const i=desktopInput();i.connect('control',{readyState:'open',bufferedAmount:0,send:raw=>window.packets.push(JSON.parse(raw))});window.release=()=>i.release();return i},[]);
return <div className="remote-desktop"><div ref={panel} className="desktop-panel" data-keyboard-only={open&&settings.keyboardOnly&&!disabled||undefined} data-screen-keyboard={open?settings.mode:undefined} style={{width:'100%',height:'100%',transform:'translate(-50%,-50%)'}}><header className="desktop-toolbar"><button onClick={()=>setOpen(v=>!v)}>Toggle</button><button onClick={()=>setDisabled(v=>!v)}>Disconnect</button><button onClick={()=>setRotation(v=>v+1)}>Rotate</button></header><div className="desktop-stage" tabIndex={0}/>{open&&<DesktopScreenKeyboard key={rotation} panel={panel} input={input} disabled={disabled} settings={settings} onSettings={setSettings} onClose={()=>setOpen(false)}/>}</div></div>};createRoot(document.getElementById('root')).render(<Fixture/>);`
  const candidates = [source], styles: string[] = []
  const bundle = await build({ input: 'virtual:screen-keys.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture',
    resolveId(id) { if (id === 'virtual:screen-keys.tsx') return id }, async load(id) {
      if (id === 'virtual:screen-keys.tsx') return source
      if (id.endsWith('.css')) { styles.push(await fs.readFile(id, 'utf8')); return { code: '', moduleType: 'js' } }
      if (id.endsWith('.tsx')) candidates.push(await fs.readFile(id, 'utf8'))
    },
  }] })
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + await fs.readFile(`${root}/src/components/remote-desktop.css`, 'utf8') + styles.join('\n')
  const chunk = bundle.output.find(item => item.type === 'chunk' && item.isEntry)!
  const code = chunk.type === 'chunk' ? chunk.code : ''
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: true })
      page.setDefaultTimeout(5000)
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
      await page.route('http://localhost:48979/**', route => route.fulfill(route.request().url().endsWith('/app.js') ? { contentType: 'text/javascript', body: code } : {
        contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`,
      }))
      await page.goto('http://localhost:48979/')
      assert.deepEqual(errors, [], 'fixture renders without runtime errors')
      const keyboard = page.getByRole('region', { name: '화면 키보드', exact: true }), key = (code: string) => keyboard.locator(`[data-screen-key="${code}"]`)
      const held = () => page.evaluate('window.packets.filter(p=>p.type==="input").at(-1)?.keys ?? []')
      await keyboard.waitFor().catch(async error => { throw new Error(`${error}\n${JSON.stringify({ errors, body: await page.locator('body').innerText() })}`) })
      assert.equal(await keyboard.locator('[data-screen-key]').count(), 106)
      await key('ControlLeft').click(); await key('KeyC').click()
      assert.deepEqual(await held(), ['ControlLeft'])
      assert.equal(await key('ControlLeft').getAttribute('aria-pressed'), 'true')
      await page.evaluate('window.release()')
      assert.equal(await key('ControlLeft').getAttribute('aria-pressed'), 'false')
      for (const theme of ['dark', 'light']) {
        await page.locator('html').evaluate((el, theme) => { el.className = theme }, theme)
        assert.equal(await keyboard.evaluate(el => el.scrollWidth <= el.clientWidth), true)
        await page.screenshot({ path: `/tmp/mew-screen-keyboard-full-${width}-${theme}.png` })
      }
      const only = keyboard.getByRole('button', { name: '키보드만 보기', exact: true })
      await only.click()
      assert.equal(await page.locator('.desktop-stage').isVisible(), false)
      assert.ok((await keyboard.boundingBox())!.height > 700)
      await key('KeyA').click()
      assert.deepEqual(await held(), [])
      await only.click()
      assert.equal(await page.locator('.desktop-stage').isVisible(), true)
      await keyboard.getByRole('button', { name: '게임용', exact: true }).click()
      assert.equal(await keyboard.locator('[data-screen-key]').count(), 9)
      const centre = async (code: string, id: number) => { const box = (await key(code).boundingBox())!; return { x: box.x + box.width / 2, y: box.y + box.height / 2, id } }
      const cdp = await page.context().newCDPSession(page), w = await centre('KeyW', 1), space = await centre('Space', 2)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [w] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [w, space] })
      assert.deepEqual((await held() as string[]).sort(), ['KeyW', 'Space'])
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [w] })
      assert.deepEqual(await held(), ['Space'])
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
      assert.deepEqual(await held(), [])
      await keyboard.getByRole('button', { name: '게임 키 설정', exact: true }).click()
      await keyboard.getByRole('combobox', { name: '게임 키 1', exact: true }).click()
      await page.getByRole('option', { name: 'R · KeyR', exact: true }).click()
      await keyboard.getByRole('button', { name: '키 추가', exact: true }).click()
      assert.equal(await keyboard.getByRole('combobox').count(), 10)
      await keyboard.getByRole('button', { name: '게임 키 10 삭제', exact: true }).click()
      await keyboard.getByRole('button', { name: '완료', exact: true }).click()
      assert.equal(await key('KeyR').count(), 1)
      assert.equal(await key('KeyQ').count(), 0)
      for (const theme of ['dark', 'light']) {
        await page.locator('html').evaluate((el, theme) => { el.className = theme }, theme)
        const box = (await keyboard.boundingBox())!
        assert.ok(box.x >= 0 && box.x + box.width <= width)
        await page.screenshot({ path: `/tmp/mew-screen-keyboard-game-${width}-${theme}.png` })
      }
      await only.click()
      await page.reload(); await key('KeyR').waitFor()
      assert.equal(await only.getAttribute('aria-pressed'), 'true')
      assert.equal(await page.locator('.desktop-stage').isVisible(), false)
      for (const theme of ['dark', 'light']) {
        await page.locator('html').evaluate((el, theme) => { el.className = theme }, theme)
        await page.screenshot({ path: `/tmp/mew-keyboard-only-${width}-${theme}.png` })
      }
      await keyboard.getByRole('button', { name: '풀키', exact: true }).click()
      assert.equal(await page.locator('.desktop-stage').isVisible(), false)
      await page.screenshot({ path: `/tmp/mew-keyboard-only-full-${width}.png` })
      await keyboard.getByRole('button', { name: '게임용', exact: true }).click()
      assert.equal(await keyboard.locator('[data-screen-key]').count(), 9)
      for (const boundary of ['blur', 'fullscreenchange', 'disconnect', 'rotate', 'close']) {
        const point = await centre('KeyW', 1)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
        assert.deepEqual(await held(), ['KeyW'])
        if (boundary === 'blur') await page.evaluate('window.dispatchEvent(new Event("blur"))')
        else if (boundary === 'fullscreenchange') await page.locator('html').evaluate(el => el.ownerDocument.dispatchEvent(new Event('fullscreenchange')))
        else if (boundary === 'disconnect') await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
        else if (boundary === 'rotate') await page.getByRole('button', { name: 'Rotate', exact: true }).click()
        else await keyboard.getByRole('button', { name: '화면 키보드 닫기', exact: true }).click()
        assert.deepEqual(await held(), [], boundary)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        if (boundary === 'disconnect') { assert.equal(await page.locator('.desktop-stage').isVisible(), true); await page.getByRole('button', { name: 'Disconnect', exact: true }).click() }
      }
      assert.equal(await page.locator('.desktop-stage').isVisible(), true, 'closing keyboard restores the screen')
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
