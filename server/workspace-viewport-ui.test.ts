import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('workspace keeps bottom controls within fullscreen and keyboard viewport boundaries', { skip: !domBrowserExecutable(), timeout: 15_000 }, async () => {
  const bundle = await build({
    input: new URL('../src/utils/workspace-viewport.ts', import.meta.url).pathname,
    write: false, platform: 'browser', output: { format: 'esm' },
  })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await page.route('http://mew-viewport.test/**', route => route.fulfill({
      contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
      <style>html,body{margin:0;overflow:hidden}main{height:var(--app-height,100dvh);display:flex;flex-direction:column}header{height:40px;flex-shrink:0}section{flex:1;min-height:0}footer{height:140px;flex-shrink:0;display:flex}textarea{flex:1}</style>
      <main><header>mew</header><section></section><footer><textarea aria-label="Message"></textarea><button>Send</button></footer></main>
      <script type="module">${chunk.code}\nwindow.stopViewport=observeWorkspaceViewport();</script>`,
    }))
    await page.goto('http://mew-viewport.test/')
    const workspace = page.locator('main')
    const setViewport = async (height: number, offset: number, innerHeight: number, event: string) => {
      await workspace.evaluate((el, values) => {
        const win = el.ownerDocument.defaultView!
        Object.defineProperty(win, 'innerHeight', { configurable: true, value: values.innerHeight })
        Object.defineProperties(win.visualViewport!, {
          height: { configurable: true, value: values.height },
          offsetTop: { configurable: true, value: values.offset },
        })
        if (values.event === 'fullscreenchange') el.ownerDocument.dispatchEvent(new win.Event(values.event))
        else if (values.event === 'window') win.dispatchEvent(new win.Event('resize'))
        else win.visualViewport!.dispatchEvent(new win.Event(values.event))
      }, { height, offset, innerHeight, event })
      const bottom = Math.min(innerHeight, height + offset)
      await page.waitForFunction(`document.querySelector('main').getBoundingClientRect().bottom === ${bottom}`)
      for (const control of [page.getByRole('textbox'), page.getByRole('button', { name: 'Send' })]) {
        const box = (await control.boundingBox())!
        assert.ok(box.y >= offset && box.y + box.height <= bottom, 'input and send stay inside the visible viewport')
      }
    }
    await page.getByRole('textbox').focus()
    // Overlay keyboard: layout height stays unchanged.
    await setViewport(440, 0, 844, 'resize')
    // Browser pans to the focused input without a resize event.
    await setViewport(440, 60, 844, 'scroll')
    // Fullscreen can report an older, larger visual viewport than innerHeight.
    await setViewport(844, 0, 500, 'fullscreenchange')
    // Both viewports resize, then keyboard closes and fullscreen exits.
    await setViewport(480, 0, 480, 'window')
    await setViewport(844, 0, 844, 'fullscreenchange')
    await page.screenshot({ path: '/tmp/mew-workspace-viewport-mobile.png' })
    await page.setViewportSize({ width: 1280, height: 844 })
    await setViewport(844, 0, 844, 'resize')
    await workspace.evaluate(el => {
      const win = el.ownerDocument.defaultView! as typeof el.ownerDocument.defaultView & { stopViewport: () => void }
      // A queued update must not run after disposal.
      win.visualViewport!.dispatchEvent(new win.Event('resize'))
      win.stopViewport()
    })
    await page.waitForTimeout(40)
    assert.equal(await workspace.evaluate(el => el.ownerDocument.documentElement.style.getPropertyValue('--app-height')), '')
  } finally { await browser.close() }
})
