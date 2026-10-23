import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('desktop-site initial shrink-to-fit fills the phone viewport through focus, pinch zoom and rotation', { skip: !domBrowserExecutable(), timeout: 20_000 }, async () => {
  const root = new URL('..', import.meta.url).pathname
  const source = `import React from 'react';import {createRoot} from 'react-dom/client';
import {observeWorkspaceViewport} from '${root}/src/utils/workspace-viewport.ts';
import {useMobileKeyboard} from '${root}/src/hooks/use-mobile-keyboard.ts';
function Fixture(){const hidden=useMobileKeyboard();React.useEffect(observeWorkspaceViewport,[]);return <main><header><button data-fullscreen onClick={()=>document.documentElement.requestFullscreen()}>Fullscreen</button></header><section/><footer><textarea aria-label="Message"/><button>Send</button></footer><nav aria-label="Dock" hidden={hidden}>Dock</nav></main>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:desktop-site.tsx', write: false, platform: 'browser', output: { format: 'iife' },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'desktop-site-fixture', resolveId(id) { if (id === 'virtual:desktop-site.tsx') return id }, load(id) { if (id === 'virtual:desktop-site.tsx') return source } }],
  })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    // A fixed 980px mobile viewport reproduces a phone's desktop-site fit scale.
    // Use the real VisualViewport and page scale; no height/scale property mocks.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    page.setDefaultTimeout(4000)
    await page.route('http://mew-desktop-site.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=980,interactive-widget=resizes-content">
      <style>html,body,#root{height:100%;margin:0;overflow:hidden;background:#39134d}main{height:var(--app-height,100dvh);box-sizing:border-box;display:flex;flex-direction:column;background:#171717;color:white;padding-bottom:44px}header{height:40px;flex-shrink:0}section{flex:1;min-height:0}footer{height:140px;flex-shrink:0;display:flex}textarea{flex:1;font:16px sans-serif}nav{position:fixed;bottom:0;left:0;right:0;height:44px;background:#333}</style>
      <div id="root"></div><script>${chunk.code}</script>` }))
    await page.goto('http://mew-desktop-site.test/')
    const workspace = page.locator('main')
    const dock = page.getByRole('navigation', { name: 'Dock' })
    await workspace.waitFor()
    const layout = await workspace.evaluate(el => {
      const doc = el.ownerDocument, win = doc.defaultView!
      return { scale: win.visualViewport!.scale, width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight }
    })
    assert.equal(layout.width, 980)
    assert.ok(layout.scale < .5, 'Chromium is actually fitting a wide desktop site to a narrow phone')
    const assertFilled = async () => {
      await page.waitForFunction('Math.abs(document.querySelector("main").getBoundingClientRect().bottom-document.documentElement.clientHeight)<1')
      const bounds = await dock.evaluate(el => ({dock:el.getBoundingClientRect().top,composer:el.previousElementSibling!.getBoundingClientRect().bottom,root:el.ownerDocument.documentElement.clientHeight,inner:el.ownerDocument.defaultView!.innerHeight}))
      assert.ok(Math.abs(bounds.dock-bounds.composer) <= 1, `the composer meets the fixed dock without a blank strip: ${JSON.stringify(bounds)}`)
      await dock.waitFor({ state: 'visible' })
    }
    await assertFilled()
    await page.screenshot({ path: '/tmp/mew-desktop-site-portrait.png' })
    await page.getByRole('textbox', { name: 'Message' }).focus()
    await assertFilled()
    const cdp = await page.context().newCDPSession(page)
    for (const scale of [.8, 1, 1.5, 2, layout.scale]) {
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale })
      await assertFilled()
      assert.equal(await page.getByRole('textbox').evaluate(el => el === el.ownerDocument.activeElement), true)
    }
    await cdp.detach()
    // Content-resizing keyboards reduce the screen while the fitted CSS width
    // stays 980px. The dock returns without requiring the input to lose focus.
    await page.setViewportSize({ width: 390, height: 400 })
    await dock.waitFor({ state: 'hidden' })
    await page.setViewportSize({ width: 390, height: 844 })
    await assertFilled()
    for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 700 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)
      await assertFilled()
      assert.ok(await workspace.evaluate(el => el.ownerDocument.defaultView!.visualViewport!.scale < 1))
      await page.screenshot({ path: `/tmp/mew-desktop-site-${viewport.width}x${viewport.height}.png` })
    }
    await page.locator('[data-fullscreen]').click()
    await page.waitForFunction('document.fullscreenElement === document.documentElement')
    await assertFilled()
    await workspace.evaluate(el => el.ownerDocument.exitFullscreen())
    await page.waitForFunction('!document.fullscreenElement')
    await assertFilled()
    await page.close()
  } finally { await browser.close() }
})
