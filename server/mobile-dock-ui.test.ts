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
function Fixture(){const [active,setActive]=React.useState('editor');const [available,setAvailable]=React.useState([...MOBILE_DOCK_ORDER]);window.setAvailable=setAvailable;const hidden=useMobileKeyboard();return <div className="mew-workspace" data-mobile-keyboard={hidden||undefined}><input aria-label="Message"/><MobileDock active={active} available={available} hidden={hidden} onSelect={id=>{setActive(id);window.actions.push(id)}} onNavigate={(dir,order)=>window.actions.push({dir,order})}/><Mewcat skin="mew"/></div>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:dock.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:dock.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:dock.tsx') return source; if (id === 'virtual:style') return '' } }] })
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
    await page.addInitScript("localStorage.setItem('mew:locale','en')")
    await page.route('http://mew-dock.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${chunk.code}</script></html>` }))
    await page.goto('http://mew-dock.test/')
    const dock = page.getByRole('navigation', { name: 'Workspace dock' })
    const items = () => dock.locator('[data-dock-item]').evaluateAll(elements => elements.map(el => el.getAttribute('data-dock-item')))
    await dock.waitFor()
    assert.deepEqual(await items(), ['sidebar', 'editor', 'agent', 'terminal', 'git', 'browser', 'features', 'desktop', 'memo', 'rag'])
    assert.equal(await dock.getByRole('button').last().getAttribute('data-dock-item'), 'rag')
    const tooltip = page.getByRole('tooltip')
    const notice = page.locator('[data-dock-notice]')
    for (const id of ['sidebar', 'rag']) {
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
    assert.deepEqual(await page.evaluate('window.actions.at(-1)'), { dir: -1, order: ['sidebar', 'editor', 'agent', 'terminal', 'git', 'browser', 'features', 'desktop', 'memo', 'rag'] })
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
    assert.deepEqual(await items(), ['browser', 'sidebar', 'editor', 'agent', 'terminal', 'git', 'features', 'desktop', 'memo', 'rag'])
    assert.equal(await page.evaluate('window.actions.length'), 3, 'reordering does not navigate')
    assert.equal(await notice.count(), 0, 'reordering does not show a touch toast')
    await page.reload(); await dock.waitFor()
    assert.equal((await items())[0], 'browser', 'order persists')
    from = (await dock.locator('[data-dock-item=browser]').boundingBox())!
    to = (await dock.locator('[data-dock-item=git]').boundingBox())!
    await touch('touchStart', from.x + 22, y); await page.waitForTimeout(480)
    await touch('touchMove', to.x + 22, y); await touch('touchCancel')
    assert.equal((await items())[0], 'browser', 'cancel rolls back the preview')
    await dock.locator('[data-dock-item=browser]').focus(); await page.keyboard.press('Alt+ArrowRight')
    assert.deepEqual((await items()).slice(0, 2), ['sidebar', 'browser'])
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate('window.actions.at(-1)'), 'browser')
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
    await page.evaluate("window.setAvailable(['sidebar','editor'])")
    assert.equal(await dock.getByRole('button').count(), 2)
    await page.getByRole('textbox', { name: 'Message' }).blur()
    await page.evaluate('window.setAvailable([...'+JSON.stringify(['sidebar', 'editor', 'agent', 'terminal', 'git', 'browser', 'features', 'desktop', 'memo', 'rag'])+'])')
    await page.setViewportSize({ width: 1024, height: 844 })
    await dock.waitFor({ state: 'visible' })
    const assertDesktopCatGround = () => page.waitForFunction(`(() => {
      const cat = document.querySelector('.mewcat').getBoundingClientRect();
      const viewport = window.visualViewport;
      const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      return Math.abs(cat.bottom - 1 - bottom) < 1;
    })()`)
    await assertDesktopCatGround()
    const handle = dock.getByRole('button', { name: 'Move dock', exact: false })
    await handle.waitFor()
    for (const dark of [true, false]) {
      await page.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`)
      const style = await page.evaluate(`(() => { const style = getComputedStyle(document.querySelector('.mobile-dock')); return { radius: style.borderRadius, background: style.backgroundColor, blur: style.backdropFilter }; })()`) as { radius: string; background: string; blur: string }
      assert.equal(style.radius, '9999px')
      assert.match(style.background, /0\.78/)
      assert.equal(style.blur, 'blur(16px)')
      await page.screenshot({ path: `/tmp/mew-dock-desktop-${dark ? 'dark' : 'light'}.png` })
    }
    const initial = (await dock.boundingBox())!
    assert.ok(Math.abs(initial.x + initial.width / 2 - 512) < 1)
    await page.evaluate('window.actions=[]')
    await dock.locator('[data-dock-item=terminal]').click()
    assert.deepEqual(await page.evaluate('window.actions'), ['terminal'])
    const beforeReorder = await items()
    from = (await dock.locator('[data-dock-item=rag]').boundingBox())!
    to = (await dock.locator('[data-dock-item=sidebar]').boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + 22)
    await page.mouse.down(); await page.waitForTimeout(480)
    await preview.waitFor()
    await page.mouse.move(to.x + to.width / 2, to.y - 35, { steps: 5 })
    assert.equal((await items())[0], 'rag', 'mouse long press reorders on desktop')
    assert.ok(Math.abs((await preview.boundingBox())!.x - to.x) < 1)
    await page.screenshot({ path: '/tmp/mew-dock-desktop-reorder.png' })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    assert.deepEqual(await items(), beforeReorder, 'Escape rolls back item order')
    assert.equal(await preview.count(), 0)
    assert.deepEqual(await page.evaluate('window.actions'), ['terminal'], 'cancel never selects a panel')
    await page.mouse.move(from.x + from.width / 2, from.y + 22)
    await page.mouse.down(); await page.waitForTimeout(480)
    await page.mouse.move(to.x + to.width / 2, to.y + 22, { steps: 5 })
    await page.mouse.up()
    assert.equal((await items())[0], 'rag')
    assert.equal(JSON.parse(await page.evaluate("localStorage.getItem('mew:mobile-dock-order')") as string)[0], 'rag')
    assert.deepEqual(await page.evaluate('window.actions'), ['terminal'], 'releasing an item never selects or swipes panels')
    const grip = (await handle.boundingBox())!
    await page.mouse.move(grip.x + grip.width / 2, grip.y + 22)
    await page.mouse.down()
    await page.mouse.move(grip.x + grip.width / 2 + 120, grip.y + 22 - 160, { steps: 5 })
    await page.mouse.up()
    const moved = (await dock.boundingBox())!
    assert.ok(Math.abs(moved.x - initial.x - 120) < 1)
    assert.ok(Math.abs(moved.y - initial.y + 160) < 1)
    await assertDesktopCatGround()
    assert.deepEqual(await page.evaluate('window.actions'), ['terminal'], 'handle movement never selects or swipes panels')
    await page.reload(); await dock.waitFor()
    assert.deepEqual(await dock.boundingBox(), moved, 'desktop position survives reload')
    await assertDesktopCatGround()
    await handle.focus()
    await page.keyboard.press('ArrowLeft')
    const keyboardPosition = (await dock.boundingBox())!
    assert.equal(keyboardPosition.x, moved.x - 8)
    await handle.hover(); await page.mouse.down(); await page.mouse.move(900, 100)
    await page.keyboard.press('Escape'); await page.mouse.up()
    assert.deepEqual(await dock.boundingBox(), keyboardPosition, 'Escape restores the previous position')
    await handle.hover(); await page.mouse.down(); await page.mouse.move(1020, 840); await page.mouse.up()
    await page.setViewportSize({ width: 768, height: 500 })
    const clamped = (await dock.boundingBox())!
    assert.ok(clamped.x >= 8 && clamped.x + clamped.width <= 760)
    assert.ok(clamped.y >= 8 && clamped.y + clamped.height <= 492)
    await assertDesktopCatGround()
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await handle.isVisible(), false)
    assert.equal((await dock.boundingBox())!.width, 390)
    assert.equal((await dock.boundingBox())!.height, 48)
    await page.waitForFunction(`document.querySelector('.mewcat').getBoundingClientRect().bottom < document.querySelector('.mobile-dock').getBoundingClientRect().top`)
    await page.setViewportSize({ width: 1024, height: 844 })
    await handle.waitFor()
    assert.equal((await dock.boundingBox())!.width, moved.width)
    await assertDesktopCatGround()
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
