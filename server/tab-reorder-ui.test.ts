import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('tab previews follow mouse and touch without clipping, stealing input or breaking scrolling', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {TabBar} from '${root}/src/components/TabBar.tsx';
window.actions=[];window.drops=[];
const initial=['a.md','a-much-longer-document-name.md','c.md','four.md','five.md','six.md','seven.md','eight.md','nine.md','ten.md'].map(path=>({path,preview:false}));
function Fixture(){const [tabs,setTabs]=React.useState(initial);const [shown,setShown]=React.useState(true);window.reset=()=>setTabs(initial);window.hide=()=>setShown(false);window.order=tabs.map(t=>t.path);return <div style={{paddingTop:80}}>{shown&&<TabBar tabs={tabs} activePath="a.md" presence={{}} onActivate={id=>window.actions.push(id)} onPin={()=>{}} onClose={()=>{}} onReorder={(from,to)=>setTabs(prev=>{const next=[...prev];next.splice(to,0,...next.splice(from,1));return next})} onDrop={(...args)=>window.drops.push(args)}/>}<button id="target" style={{marginTop:100}}>Drop target</button></div>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:tabs.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:tabs.tsx') return id }, load(id) { if (id === 'virtual:tabs.tsx') return source } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const content = await fs.readFile(`${root}/src/components/TabBar.tsx`, 'utf8')
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 }, hasTouch: true })
    page.setDefaultTimeout(3000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://mew-tabs.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${chunk.code}</script></html>` }))
    await page.goto('http://mew-tabs.test/')
    const first = page.getByRole('tab', { name: 'a.md', exact: false }).first()
    const preview = page.locator('[data-tab-drag-preview]')
    const placeholder = page.locator('[data-tab-drag-placeholder]')
    await first.waitFor()
    const from = (await first.boundingBox())!
    const x = from.x + from.width / 2, y = from.y + from.height / 2
    await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(530)
    await preview.waitFor()
    assert.equal(await page.getByRole('tab').count(), 10, 'visual copy is absent from the accessibility tree')
    assert.equal(await preview.getAttribute('inert'), '')
    assert.equal(await placeholder.count(), 1)
    assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-tab-drag-placeholder] span')).opacity"), '0')
    const lifted = (await preview.boundingBox())!
    assert.equal(lifted.width, from.width)
    assert.equal(lifted.y, from.y - 8)
    await page.mouse.move(x + 330, y + 100, { steps: 8 })
    const tabMotion = await page.getByRole('tab').evaluateAll(elements => {
      const moving = elements.flatMap(el => el.getAnimations().map((animation: ReturnType<typeof el.getAnimations>[number]) => ({ el, animation })))
      const sample = moving.find(({ animation }) => animation.effect?.getTiming().duration === 180)
      if (!sample) return null
      sample.animation.pause()
      sample.animation.currentTime = 90
      const style = sample.el.ownerDocument.defaultView!.getComputedStyle(sample.el)
      const result = { transform: style.transform, duration: sample.animation.effect!.getTiming().duration }
      for (const { animation } of moving) animation.play()
      return result
    })
    assert.ok(tabMotion && tabMotion.transform !== 'none' && tabMotion.transform !== 'matrix(1, 0, 0, 1, 0, 0)', 'tabs occupy intermediate positions while neighboring slots reorder')
    const moved = (await preview.boundingBox())!
    assert.ok(Math.abs(moved.x - lifted.x - 330) < 1)
    assert.ok(Math.abs(moved.y - lifted.y - 100) < 1, 'preview is visible outside the scroll container')
    assert.notEqual((await page.evaluate('window.order') as string[])[0], 'a.md')
    const order = await page.evaluate('window.order')
    await page.mouse.move(x + 330.2, y + 100)
    assert.deepEqual(await page.evaluate('window.order'), order, 'stationary preview does not keep swapping slots')
    assert.equal(await page.evaluate(`document.elementFromPoint(${x + 330}, ${y + 100})?.closest('[data-tab-drag-preview]') !== null`), false, 'preview never intercepts hit testing')
    await page.screenshot({ path: '/tmp/mew-tab-reorder-desktop.png' })
    await page.mouse.up()
    assert.equal(await preview.count(), 0)
    assert.equal(await placeholder.count(), 0)
    assert.deepEqual(await page.evaluate('window.actions'), [])
    assert.equal(await page.evaluate('window.drops[0][0]'), 'a.md', 'reordering preserves dragged tab identity on drop')
    await page.evaluate('window.reset()')
    await first.hover(); await page.mouse.down(); await page.mouse.move(x + 12, y + 10)
    await preview.waitFor()
    await page.keyboard.press('Escape'); await page.mouse.up()
    assert.equal(await preview.count(), 0)
    assert.equal(await placeholder.count(), 0)
    assert.equal(await page.evaluate('window.drops.length'), 1, 'Escape does not drop')
    assert.deepEqual(await page.evaluate('window.actions'), [])

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate('window.reset()')
    await first.hover(); await page.mouse.down(); await page.waitForTimeout(530)
    await page.mouse.move(x + 330, y + 100, { steps: 3 })
    await preview.waitFor()
    assert.equal(await page.getByRole('tab').evaluateAll(elements => elements.reduce((sum, el) => sum + el.getAnimations().length, 0)), 0, 'reduced motion reorders immediately')
    await page.mouse.up()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.evaluate("document.documentElement.classList.remove('dark')")
    await page.setViewportSize({ width: 390, height: 600 })
    await page.evaluate('window.reset()')
    const cdp = await page.context().newCDPSession(page)
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', tx?: number, ty?: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: tx === undefined || ty === undefined ? [] : [{ x: tx, y: ty }] })
    const mobile = (await first.boundingBox())!
    const tx = mobile.x + mobile.width / 2, ty = mobile.y + mobile.height / 2
    await touch('touchStart', tx, ty); await page.waitForTimeout(390)
    await preview.waitFor()
    await touch('touchMove', 220, ty + 50)
    assert.ok(Math.abs((await preview.boundingBox())!.y - mobile.y - 42) < 1)
    await page.screenshot({ path: '/tmp/mew-tab-reorder-mobile.png' })
    await touch('touchCancel')
    assert.equal(await preview.count(), 0)
    assert.equal(await placeholder.count(), 0)
    assert.deepEqual(await page.evaluate('window.actions'), [])

    await page.evaluate('window.reset()')
    await touch('touchStart', tx, ty); await touch('touchMove', tx + 20, ty)
    await page.waitForTimeout(400)
    assert.equal(await preview.count(), 0, 'moving before the hold leaves touch scrolling available')
    await touch('touchEnd')
    await page.evaluate("document.querySelector('[role=tab]').parentElement.scrollLeft=0")
    await first.hover(); await page.mouse.down(); await page.mouse.move(380, ty, { steps: 6 })
    await preview.waitFor()
    await page.waitForFunction("document.querySelector('[role=tab]').parentElement.scrollLeft>80")
    assert.ok((await preview.boundingBox())!.x > 300, 'edge scrolling does not move the ghost away from the pointer')
    await page.evaluate('window.hide()')
    await preview.waitFor({ state: 'detached' })
    await page.mouse.up()
    assert.equal(await placeholder.count(), 0)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
