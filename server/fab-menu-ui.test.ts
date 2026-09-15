import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('floating handle supports immediate mouse drag, persistent lock, instant tips and touch gestures', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {FabMenu} from '${root}/src/components/FabMenu.tsx';
import {HeaderMenu} from '${root}/src/components/HeaderMenu.tsx';
window.actions=[];const run=name=>()=>window.actions.push(name);
createRoot(document.getElementById('root')).render(<I18nProvider><div className="flex h-dvh flex-col bg-surface text-ink"><header className="flex h-10 items-center justify-end border-b border-edge pr-2 md:h-12 md:pr-4"><HeaderMenu items={[{id:'terminal',label:'Terminal',icon:null,onSelect:run('terminal')}]}/></header><FabMenu onFullscreen={run('fullscreen')} onToggleAgent={run('agent')} onNextWindowTab={run('next')} onToggleTerminal={run('terminal')} onPrevWindowTab={run('prev')} onOpenEditor={run('editor')} onToggleSidebar={run('sidebar')} onToggleBrowser={run('browser')}/></div></I18nProvider>);`
  const bundle = await build({ input: 'virtual:fab.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:fab.tsx') return id }, load(id) { if (id === 'virtual:fab.tsx') return source } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/FabMenu.tsx', 'src/components/HeaderMenu.tsx', 'packages/ui/src/HoverTipLayer.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true })
    await context.route('http://mew-fixture.test/**', route => route.fulfill(route.request().url().endsWith('/app.js') ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html class="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` }))
    await context.addInitScript("localStorage.setItem('mew:locale','en')")
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.setDefaultTimeout(3000)
    await page.goto('http://mew-fixture.test/')
    const handle = page.getByRole('button', { name: 'Handle menu', exact: true })
    const bounds = async (el: Locator) => { const box = await el.boundingBox(); assert.ok(box); return box }
    const drag = async (dx: number, dy: number) => {
      const box = await bounds(handle)
      await page.mouse.move(box.x + 24, box.y + 24)
      await page.mouse.down()
      await page.mouse.move(box.x + 24 + dx, box.y + 24 + dy)
      await page.mouse.up()
    }
    const before = await bounds(handle)
    await drag(-200, -150)
    const after = await bounds(handle)
    assert.equal(Math.round(before.x - after.x), 200)
    assert.equal(Math.round(before.y - after.y), 150)
    assert.deepEqual(await page.evaluate('window.actions'), [])
    await handle.click()
    const lock = page.getByRole('button', { name: 'Lock position', exact: true })
    await lock.waitFor()
    await page.getByRole('button', { name: 'Terminal', exact: true }).hover()
    await page.getByRole('tooltip').waitFor({ timeout: 250 })
    assert.equal(await page.getByRole('tooltip').textContent(), 'Terminal')
    await page.screenshot({ path: '/tmp/mew-handle-desktop.png' })
    await lock.click()
    assert.equal(await page.getByRole('button', { name: 'Unlock position' }).getAttribute('aria-pressed'), 'true')
    await page.keyboard.press('Escape')
    await page.waitForFunction("!history.state?.mewOverlayGuard")
    assert.equal(await handle.getAttribute('aria-expanded'), 'false')
    await drag(-100, -100)
    assert.deepEqual(await bounds(handle), after)
    await page.reload()
    await handle.click()
    await page.getByRole('button', { name: 'Unlock position' }).click()
    await page.keyboard.press('Escape')
    await page.waitForFunction("!history.state?.mewOverlayGuard")
    await handle.focus()
    await page.keyboard.press('Enter')
    await lock.waitFor()
    await page.keyboard.press('Escape')
    await page.waitForFunction("!history.state?.mewOverlayGuard")
    await page.getByRole('button', { name: 'Menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Terminal', exact: true }).click()
    await page.waitForFunction("!history.state?.mewOverlayGuard")
    assert.deepEqual(await page.evaluate('window.actions'), ['terminal'])
    assert.equal(await page.getByRole('button', { name: 'Menu', exact: true }).locator('span').isVisible(), true)
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.getByRole('button', { name: 'Menu', exact: true }).locator('span').isVisible(), false)
    const cdp = await context.newCDPSession(page)
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', x?: number, y?: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined || y === undefined ? [] : [{ x, y }] })
    // Real touch events retain directional commands and long-press repositioning.
    let box = await bounds(handle)
    await touch('touchStart', box.x + 24, box.y + 24)
    await touch('touchMove', box.x + 24, box.y - 36)
    await touch('touchEnd')
    await page.waitForFunction("!history.state?.mewOverlayGuard")
    assert.deepEqual(await page.evaluate('window.actions'), ['terminal', 'fullscreen'])
    box = await bounds(handle)
    await touch('touchStart', box.x + 24, box.y + 24)
    await page.waitForTimeout(380)
    await touch('touchMove', 180, 400)
    await touch('touchEnd')
    await page.keyboard.press('Escape')
    await page.waitForFunction("!history.state?.mewOverlayGuard")
    const moved = await bounds(handle)
    assert.equal(Math.round(moved.x + 24), 180)
    assert.equal(Math.round(moved.y + 24), 400)
    await handle.tap()
    await lock.click()
    await page.keyboard.press('Escape')
    await page.waitForFunction("!history.state?.mewOverlayGuard")
    await touch('touchStart', 180, 400)
    await page.waitForTimeout(380)
    await touch('touchMove', 230, 400)
    await touch('touchEnd')
    assert.deepEqual(await bounds(handle), moved)
    await page.waitForFunction("!history.state?.mewOverlayGuard")
    assert.deepEqual(await page.evaluate('window.actions'), ['terminal', 'fullscreen', 'next'])
    await handle.tap()
    for (const button of await page.locator('button').all()) {
      const b = await bounds(button)
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= 390 && b.y + b.height <= 844)
    }
    await page.screenshot({ path: '/tmp/mew-handle-mobile.png' })
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
