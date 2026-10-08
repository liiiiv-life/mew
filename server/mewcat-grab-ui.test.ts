import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('a thrown Mewcat keeps background input accessible and can be caught without jumping', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `
// This fixture covers cat behavior in a fullscreen-unavailable client.
Object.defineProperty(document,'fullscreenEnabled',{value:false});
import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {createPortal} from '${root}/node_modules/react-dom/index.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {Mewcat} from '${root}/src/components/Mewcat.tsx';
Math.random=()=>0.7;
window.backgroundClicks=0;
const remote = location.search.includes('remote');
const skin = new URLSearchParams(location.search).get('skin') || 'mew';
const host = remote ? document.body.appendChild(document.createElement('div')) : null;
if(host) { host.setAttribute('role','dialog'); document.getElementById('root').inert=true; }
const background=<button id="background" type="button" style={{position:'fixed',inset:0,width:'100%',height:'100%'}} onClick={()=>window.backgroundClicks++}>Background action</button>;
createRoot(document.getElementById('root')).render(<I18nProvider>{host?createPortal(background,host):background}<Mewcat skin={skin} portalTarget={host} onOpenSystemStats={()=>{}}/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:grab.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:grab.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:grab.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const skin of ['mew', 'kitten']) for (const remote of [false, true]) for (const touch of [false, true]) {
      const page = await browser.newPage({ viewport: { width: touch ? 390 : 800, height: 700 }, hasTouch: touch, isMobile: touch })
      await page.clock.install({ time: new Date('2026-09-22T00:00:00Z') })
      await page.clock.pauseAt(new Date('2026-09-22T00:00:01Z'))
      await page.route('http://mewcat-grab.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${compiler.build([])}</style><div id="root"></div><script>${chunk.code}</script></html>` }))
      await page.route('**/mewcat/**', async route => route.fulfill({ contentType: 'image/png', body: await fs.readFile(`${root}/public${new URL(route.request().url()).pathname}`) }))
      await page.goto(`http://mewcat-grab.test/?skin=${skin}${remote ? '&remote' : ''}`)
      const cat = page.locator('.mewcat')
      await cat.locator('.mewcat-sprite').waitFor()
      if (remote) {
        assert.equal(await page.locator('#root').evaluate(el => el.inert), true)
        assert.equal(await page.getByRole('dialog').locator('.mewcat').count(), 1)
      }
      const cdp = await page.context().newCDPSession(page)
      const down = async (x: number, y: number) => {
        if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
        else { await page.mouse.move(x, y); await page.mouse.down() }
      }
      const move = async (x: number, y: number) => {
        if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] })
        else await page.mouse.move(x, y)
      }
      const up = async () => {
        if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        else await page.mouse.up()
      }
      const start = (await cat.boundingBox())!
      await down(start.x + 24, start.y + 35)
      await move(start.x + 60, start.y - 180)
      await page.clock.runFor(16)
      await move(start.x + 80, start.y - 220)
      await up()
      assert.equal(await cat.getAttribute('data-activity'), 'jump')
      const ascentSource = await cat.locator('.mewcat-sprite').getAttribute('data-source')
      await page.clock.runFor(80)
      // The pointer was released: unrelated controls remain usable during the fall.
      await down(20, 20); await up()
      assert.equal(await page.evaluate('window.backgroundClicks'), 1)
      assert.equal(await cat.getAttribute('data-activity'), 'jump')
      const airborne = (await cat.boundingBox())!
      // This point is inside the SVG's rectangular box, outside its painted body.
      await down(airborne.x + 1, airborne.y + 1); await up()
      assert.equal(await page.evaluate('window.backgroundClicks'), 2, 'transparent cat space passes clicks and taps to the background')
      assert.equal(await cat.getAttribute('data-activity'), 'jump')
      await page.clock.runFor(450)
      assert.equal(await cat.getAttribute('data-activity'), 'fall', 'ascent switches to descent after the apex')
      assert.notEqual(await cat.locator('.mewcat-sprite').getAttribute('data-source'), ascentSource, 'ascent and descent use distinct sprite images')
      for (let catchIndex = 0; catchIndex < 3; catchIndex++) {
        const flying = (await cat.boundingBox())!
        assert.ok(flying.y < start.y - 100, 'cat is well above the ground')
        await down(flying.x + 24, flying.y + 35)
        assert.equal(await page.evaluate('window.backgroundClicks'), 2, 'the painted cat still catches the pointer')
        const caught = (await cat.boundingBox())!
        assert.ok(Math.abs(caught.x - flying.x) < 1 && Math.abs(caught.y - flying.y) < 1, `pointerdown must not snap the cat to the floor: ${JSON.stringify({ touch, catchIndex, flying, caught, activity: await cat.getAttribute('data-activity') })}`)
        assert.equal(await cat.getAttribute('data-activity'), 'struggle')
        await page.clock.runFor(500)
        const held = (await cat.boundingBox())!
        assert.ok(Math.abs(held.x - caught.x) < 1 && Math.abs(held.y - caught.y) < 1, 'stationary pointer holds both coordinates')
        await move(flying.x + 49, flying.y + 50)
        const moved = (await cat.boundingBox())!
        assert.ok(Math.abs(moved.x - flying.x - 25) < 1 && Math.abs(moved.y - flying.y - 15) < 1, 'moving preserves the original grab offset')
        await page.clock.runFor(150)
        await up()
        assert.equal(await cat.getAttribute('data-activity'), 'fall')
        await page.clock.runFor(40)
      }
      // Native tap suppression after a fast drag only reproduces with a running
      // clock; frozen physics alone misses the first background tap being lost.
      if (touch) {
        await page.clock.resume()
        const live = (await cat.boundingBox())!
        await down(live.x + 24, live.y + 35)
        await move(live.x + 40, live.y - 180)
        await up()
        assert.equal(await cat.getAttribute('data-activity'), 'jump')
        const clicks = await page.evaluate('window.backgroundClicks')
        await down(20, 20); await up()
        await page.waitForFunction(`window.backgroundClicks === ${Number(clicks) + 1}`)
        assert.equal(await page.evaluate('window.backgroundClicks'), Number(clicks) + 1, 'first live touch after throwing activates the background')
      }
      await page.close()
    }
  } finally { await browser.close() }
})
