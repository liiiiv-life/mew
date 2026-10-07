import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('mobile dock handles touch selection, swipes, reorder, cancellation, keyboard and themes', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {MobileDock} from '${root}/src/components/mobile-dock.tsx';
import {Mewcat} from '${root}/src/components/Mewcat.tsx';
import {useMobileKeyboard} from '${root}/src/hooks/use-mobile-keyboard.ts';
import {MOBILE_DOCK_ORDER} from '${root}/src/utils/mobile-dock.ts';
window.actions=[];
function Fixture(){const [vertical,setVertical]=React.useState(false);window.setVertical=setVertical;const [active,setActive]=React.useState('editor');const [available,setAvailable]=React.useState([...MOBILE_DOCK_ORDER]);window.setAvailable=setAvailable;const hidden=useMobileKeyboard();return <div className="mew-workspace" data-mobile-keyboard={hidden||undefined}><header style={{height:48,display:"flex",alignItems:vertical?"flex-start":"center",justifyContent:"flex-end",gap:12,paddingRight:8}}><MobileDock vertical={vertical} active={active} available={available} hidden={hidden} onSelect={id=>{setActive(id);window.actions.push(id)}} onNavigate={(dir,order)=>window.actions.push({dir,order})}/><button aria-label="Menu" style={{width:40,height:36}}>Menu</button></header><input aria-label="Message"/><Mewcat skin="mew"/></div>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:dock.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', async resolveId(id, importer) {
    if (id === 'virtual:dock.tsx') return id
    if (id.endsWith('.css')) return 'virtual:style'
    if (id.endsWith('?raw')) {
      const resolved = await this.resolve(id.slice(0, -4), importer, { skipSelf: true })
      if (resolved) return `${resolved.id}?raw`
    }
  }, async load(id) {
    if (id.endsWith('?raw')) return `export default ${JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))}`
    if (id === 'virtual:dock.tsx') return source
    if (id === 'virtual:style') return ''
  } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const content = (await Promise.all(['src/components/mobile-dock.tsx', 'packages/ui/src/HoverTipLayer.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    page.setDefaultTimeout(3000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript("localStorage.setItem('mew:locale','en');localStorage.setItem('mew:desktop-dock-position',JSON.stringify({x:200,y:600}))")
    await page.route('http://mew-dock.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${chunk.code}</script></html>` }))
    await page.goto('http://mew-dock.test/')
    const dock = page.getByRole('navigation', { name: 'Workspace dock' })
    const items = () => dock.locator('[data-dock-item]').evaluateAll(elements => elements.map(el => el.getAttribute('data-dock-item')))
    await dock.waitFor()
    assert.deepEqual(await items(), ['sidebar', 'editor', 'agent', 'terminal', 'git', 'browser', 'features', 'debugger', 'desktop', 'memo', 'tasks'])
    assert.equal(await dock.getByRole('button').last().getAttribute('data-dock-item'), 'tasks')
    const tooltip = page.getByRole('tooltip')
    const notice = page.locator('[data-dock-notice]')
    for (const id of ['sidebar', 'memo']) {
      const button = dock.locator(`[data-dock-item=${id}]`)
      await button.hover()
      await tooltip.waitFor()
      assert.equal(await tooltip.textContent(), await button.getAttribute('aria-label'))
      const tipBox = (await tooltip.boundingBox())!
      assert.ok(tipBox.x >= 0 && tipBox.x + tipBox.width <= 390, 'edge tooltips stay in the viewport')
      assert.ok(tipBox.y + tipBox.height < (await button.boundingBox())!.y)
    }
    await page.screenshot({ path: '/tmp/mew-dock-hover.png' })
    await page.mouse.move(195, 100)
    await tooltip.waitFor({ state: 'detached' })
    await page.clock.install()
    await page.clock.pauseAt(new Date(Date.now() + 1000))
    await dock.getByRole('button', { name: 'Remote desktop', exact: true }).tap()
    assert.deepEqual(await page.evaluate('window.actions'), ['desktop'])
    await notice.waitFor()
    assert.equal(await tooltip.count(), 0, 'touch does not produce a hover tooltip')
    const desktopNotice = (await notice.boundingBox())!
    assert.equal(desktopNotice.x + desktopNotice.width / 2, 195)
    assert.equal(desktopNotice.y + desktopNotice.height, (await dock.boundingBox())!.y - 8)
    await page.clock.runFor(499)
    assert.equal(await notice.count(), 1)
    await page.clock.runFor(1)
    assert.equal(await notice.count(), 0, 'touch toast disappears at 500ms')
    await dock.getByRole('button', { name: 'Features', exact: true }).tap()
    assert.equal(await page.evaluate('window.actions.at(-1)'), 'features')
    const featureNotice = (await notice.boundingBox())!
    assert.equal(featureNotice.x + featureNotice.width / 2, 195)
    assert.equal(featureNotice.y + featureNotice.height, desktopNotice.y + desktopNotice.height)
    await page.clock.runFor(250)
    await dock.getByRole('button', { name: 'Features', exact: true }).tap()
    await page.clock.runFor(250)
    assert.equal(await notice.textContent(), 'Features', 'repeated taps restart the toast lifetime')
    await page.screenshot({ path: '/tmp/mew-dock-touch-notice.png' })
    await page.clock.runFor(250)
    assert.equal(await notice.count(), 0)
    await page.clock.resume()
    await page.evaluate('window.actions=[]')
    const cdp = await page.context().newCDPSession(page)
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', x?: number, y?: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined || y === undefined ? [] : [{ x, y }] })
    await dock.getByRole('button', { name: 'Terminal', exact: true }).tap()
    assert.deepEqual(await page.evaluate('window.actions'), ['terminal'])
    const box = (await dock.boundingBox())!, y = box.y + box.height / 2
    await touch('touchStart', 170, y); await touch('touchMove', 245, y); await touch('touchEnd')
    assert.deepEqual(await page.evaluate('window.actions.at(-1)'), { dir: -1, order: ['sidebar', 'editor', 'agent', 'terminal', 'git', 'browser', 'features', 'debugger', 'desktop', 'memo', 'tasks'] })
    await touch('touchStart', 245, y); await touch('touchMove', 170, y); await touch('touchEnd')
    assert.equal(await page.evaluate('window.actions.at(-1).dir'), 1)
    assert.equal(await page.evaluate('window.actions.length'), 3, 'swiping never clicks an icon')
    assert.equal(await notice.count(), 0, 'swiping does not show a touch toast')
    let from = (await dock.locator('[data-dock-item=browser]').boundingBox())!
    let to = (await dock.locator('[data-dock-item=sidebar]').boundingBox())!
    const preview = dock.locator('.dock-drag-preview')
    await touch('touchStart', from.x + 22, y); await page.waitForTimeout(480)
    await preview.waitFor()
    const lifted = (await preview.boundingBox())!
    assert.ok(Math.abs(lifted.x - from.x) < 1)
    assert.ok(Math.abs(lifted.y - from.y + 8) < 1, 'long press lifts the grabbed icon')
    await touch('touchMove', to.x + 22, y - 60)
    const dockMotion = await dock.locator('[data-dock-item]').evaluateAll(elements => {
      const moving = elements.flatMap(el => el.getAnimations().map((animation: ReturnType<typeof el.getAnimations>[number]) => ({ el, animation })))
      const sample = moving.find(({ animation }) => animation.effect?.getTiming().duration === 180)
      if (!sample) return null
      sample.animation.pause(); sample.animation.currentTime = 90
      const transform = sample.el.ownerDocument.defaultView!.getComputedStyle(sample.el).transform
      for (const { animation } of moving) animation.play()
      return transform
    })
    assert.ok(dockMotion && dockMotion !== 'none' && dockMotion !== 'matrix(1, 0, 0, 1, 0, 0)', 'dock neighbors slide through intermediate positions')
    const followed = (await preview.boundingBox())!
    assert.ok(Math.abs(followed.x - to.x) < 1)
    assert.ok(Math.abs(followed.y - lifted.y + 60) < 1, 'icon follows the finger above the dock')
    assert.equal(await dock.locator('[data-dragging]').getAttribute('data-dock-item'), 'browser')
    assert.equal(await page.evaluate("localStorage.getItem('mew:mobile-dock-order')"), null, 'preview is not saved before release')
    await touch('touchMove', to.x + 23, y - 60)
    assert.equal((await items())[0], 'browser', 'small movement within the destination slot does not swap items back')
    await page.screenshot({ path: '/tmp/mew-dock-touch-reorder.png' })
    await touch('touchEnd')
    assert.equal(await preview.count(), 0)
    assert.deepEqual(await items(), ['browser', 'sidebar', 'editor', 'agent', 'terminal', 'git', 'features', 'debugger', 'desktop', 'memo', 'tasks'])
    assert.equal(await page.evaluate('window.actions.length'), 3, 'reordering does not navigate')
    assert.equal(await notice.count(), 0, 'reordering does not show a touch toast')
    await page.reload(); await dock.waitFor()
    assert.equal((await items())[0], 'browser', 'order persists')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    from = (await dock.locator('[data-dock-item=browser]').boundingBox())!
    to = (await dock.locator('[data-dock-item=git]').boundingBox())!
    await touch('touchStart', from.x + 22, y); await page.waitForTimeout(480)
    await touch('touchMove', to.x + 22, y)
    assert.equal(await dock.locator('[data-dock-item]').evaluateAll(elements => elements.reduce((sum, el) => sum + el.getAnimations().length, 0)), 0, 'reduced motion skips dock movement')
    await touch('touchCancel')
    assert.equal((await items())[0], 'browser', 'cancel rolls back the preview')
    await dock.locator('[data-dock-item=browser]').focus(); await page.keyboard.press('Alt+ArrowRight')
    assert.deepEqual((await items()).slice(0, 2), ['sidebar', 'browser'])
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate('window.actions.at(-1)'), 'browser')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    // The app exposes remote desktop in the menu, leaving ten dock panels at most.
    await page.evaluate("window.setAvailable(['sidebar','editor','agent','terminal','git','browser','features','debugger','memo','tasks'])")
    for (const width of [320, 390, 767]) for (const dark of [true, false]) {
      await page.setViewportSize({ width, height: 844 })
      await page.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`)
      const bounds = (await dock.boundingBox())!
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width)
      assert.equal(bounds.height, 48)
      for (const button of await dock.getByRole('button').all()) {
        const hit = (await button.boundingBox())!
        assert.ok(hit.width >= 30 && hit.height >= 44)
      }
      await page.waitForTimeout(60)
      const cat = (await page.locator('.mewcat').boundingBox())!
      assert.ok(cat.y + cat.height < bounds.y, 'cat stays above dock hit targets')
      await page.screenshot({ path: `/tmp/mew-dock-${width}-${dark ? 'dark' : 'light'}.png` })
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('textbox', { name: 'Message' }).focus()
    await page.setViewportSize({ width: 390, height: 500 })
    await dock.waitFor({ state: 'hidden' })
    await page.setViewportSize({ width: 390, height: 844 })
    await dock.waitFor({ state: 'visible' })
    // Zoom alone keeps the dock; a keyboard opening while zoomed must hide it.
    await page.getByRole('textbox', { name: 'Message' }).evaluate(el => {
      const win = el.ownerDocument.defaultView!
      Object.defineProperties(win.visualViewport!, {
        height: { configurable: true, value: 844 / 1.25 },
        scale: { configurable: true, value: 1.25 },
      })
      el.focus()
      el.ownerDocument.dispatchEvent(new win.Event('fullscreenchange'))
      win.visualViewport!.dispatchEvent(new win.Event('resize'))
    })
    await dock.waitFor({ state: 'visible' })
    await page.getByRole('textbox', { name: 'Message' }).evaluate(el => {
      const win = el.ownerDocument.defaultView!
      Object.defineProperty(win.visualViewport!, 'height', { configurable: true, value: 440 / 1.25 })
      win.visualViewport!.dispatchEvent(new win.Event('resize'))
    })
    await dock.waitFor({ state: 'hidden' })
    assert.equal(await page.locator('.mew-workspace').getAttribute('data-mobile-keyboard'), 'true')
    await page.getByRole('textbox', { name: 'Message' }).evaluate(el => {
      const win = el.ownerDocument.defaultView!
      Object.defineProperty(win.visualViewport!, 'height', { configurable: true, value: 844 / 1.25 })
      win.visualViewport!.dispatchEvent(new win.Event('scroll'))
    })
    await dock.waitFor({ state: 'visible' })
    await page.getByRole('textbox', { name: 'Message' }).evaluate(el => {
      const win = el.ownerDocument.defaultView!
      Reflect.deleteProperty(win.visualViewport!, 'height'); Reflect.deleteProperty(win.visualViewport!, 'scale')
      win.visualViewport!.dispatchEvent(new win.Event('resize'))
      el.ownerDocument.dispatchEvent(new win.Event('fullscreenchange'))
    })
    await page.evaluate("window.setAvailable(['sidebar','editor'])")
    assert.equal(await dock.getByRole('button').count(), 2)
    await page.getByRole('textbox', { name: 'Message' }).blur()
    await page.evaluate('window.setAvailable([...'+JSON.stringify(['sidebar', 'editor', 'agent', 'terminal', 'git', 'browser', 'features', 'debugger', 'desktop', 'memo', 'tasks'])+'])')
    await page.setViewportSize({ width: 1024, height: 844 })
    await dock.waitFor({ state: 'visible' })
    const assertDesktopCatGround = () => page.waitForFunction(`(() => {
      const cat = document.querySelector('.mewcat').getBoundingClientRect();
      const viewport = window.visualViewport;
      const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      return Math.abs(cat.bottom - 1 - bottom) < 1;
    })()`)
    await assertDesktopCatGround()
    assert.equal(await dock.locator('.dock-move-handle').count(), 0)
    const menu = page.getByRole('button', { name: 'Menu', exact: true })
    for (const dark of [true, false]) {
      await page.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`)
      const box = (await dock.boundingBox())!, menuBox = (await menu.boundingBox())!
      assert.ok(box.y >= 0 && box.y + box.height <= 48, 'desktop dock stays inside the header')
      assert.equal(menuBox.x - box.x - box.width, 12, 'dock sits immediately left of the menu')
      assert.equal(await dock.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).position), 'relative', 'saved floating coordinates do not apply')
      for (const id of ['sidebar', 'memo']) {
        const button = dock.locator(`[data-dock-item=${id}]`)
        await button.hover()
        await tooltip.waitFor()
        const tipBox = (await tooltip.boundingBox())!, buttonBox = (await button.boundingBox())!
        assert.ok(tipBox.y >= buttonBox.y + buttonBox.height, 'desktop tooltips open below the header icons')
        assert.ok(tipBox.x >= 0 && tipBox.x + tipBox.width <= 1024)
      }
      await page.screenshot({ path: `/tmp/mew-dock-desktop-${dark ? 'dark' : 'light'}.png` })
    }
    const initial = (await dock.boundingBox())!
    await page.evaluate('window.actions=[]')
    await dock.locator('[data-dock-item=terminal]').click()
    assert.deepEqual(await page.evaluate('window.actions'), ['terminal'])
    const beforeReorder = await items()
    from = (await dock.locator('[data-dock-item=memo]').boundingBox())!
    to = (await dock.locator('[data-dock-item=sidebar]').boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + 22)
    await page.mouse.down(); await page.waitForTimeout(480)
    await preview.waitFor()
    await page.mouse.move(to.x + to.width / 2, to.y + 65, { steps: 5 })
    assert.equal((await items())[0], 'memo', 'mouse long press reorders on desktop')
    assert.ok(Math.abs((await preview.boundingBox())!.x - to.x) < 1)
    await page.screenshot({ path: '/tmp/mew-dock-desktop-reorder.png' })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    assert.deepEqual(await items(), beforeReorder, 'Escape rolls back item order')
    await dock.locator('[data-dock-item]').evaluateAll(async elements => {
      await Promise.all(elements.flatMap(el => el.getAnimations().map((animation: ReturnType<typeof el.getAnimations>[number]) => animation.finished.catch(() => {}))))
    })
    assert.equal(await preview.count(), 0)
    assert.deepEqual(await page.evaluate('window.actions'), ['terminal'], 'cancel never selects a panel')
    await page.mouse.move(from.x + from.width / 2, from.y + 22)
    await page.mouse.down(); await page.waitForTimeout(480)
    await page.mouse.move(to.x + to.width / 2, to.y + 22, { steps: 5 })
    await page.mouse.up()
    assert.equal((await items())[0], 'memo')
    assert.equal(JSON.parse(await page.evaluate("localStorage.getItem('mew:mobile-dock-order')") as string)[0], 'memo')
    assert.deepEqual(await page.evaluate('window.actions'), ['terminal'], 'releasing an item never selects or swipes panels')
    await page.reload(); await dock.waitFor()
    assert.deepEqual(await dock.boundingBox(), initial, 'reordering and reload do not move the header dock')
    assert.equal((await items())[0], 'memo', 'desktop icon order survives reload')
    await page.setViewportSize({ width: 768, height: 500 })
    const compact = (await dock.boundingBox())!, menuBox = (await menu.boundingBox())!
    assert.ok(compact.x >= 0 && menuBox.x + menuBox.width <= 768)
    assert.ok(compact.y + compact.height <= 48)
    await assertDesktopCatGround()
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal((await dock.boundingBox())!.width, 390)
    assert.equal((await dock.boundingBox())!.height, 48)
    await page.waitForFunction(`document.querySelector('.mewcat').getBoundingClientRect().bottom < document.querySelector('.mobile-dock').getBoundingClientRect().top`)
    await page.setViewportSize({ width: 1024, height: 844 })
    assert.deepEqual(await dock.boundingBox(), initial)
    await assertDesktopCatGround()
    await page.evaluate('window.setVertical(true)')
    assert.equal(await dock.getAttribute('data-vertical'), 'true')
    const verticalItems = await dock.getByRole('button').all()
    const first = (await verticalItems[0].boundingBox())!
    const second = (await verticalItems[1].boundingBox())!
    assert.equal(first.x, second.x)
    assert.ok(second.y > first.y)
    await verticalItems[0].focus(); await page.keyboard.press('Alt+ArrowDown')
    assert.equal((await items())[1], 'memo', 'vertical keyboard reorder follows the column')
    await dock.locator('[data-dock-item]').evaluateAll(async elements => {
      await Promise.all(elements.flatMap(el => el.getAnimations().map((animation: ReturnType<typeof el.getAnimations>[number]) => animation.finished.catch(() => {}))))
    })
    from = (await dock.locator('[data-dock-item=memo]').boundingBox())!
    to = (await dock.getByRole('button').last().boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down(); await page.waitForTimeout(480)
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 })
    await page.mouse.up()
    assert.equal((await items()).at(-1), 'memo', 'vertical drag uses the target row')
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
