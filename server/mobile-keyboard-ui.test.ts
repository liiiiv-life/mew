import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('dock returns after fullscreen keyboard use without blurring the input', { skip: !domBrowserExecutable(), timeout: 15_000 }, async () => {
  const hook = new URL('../src/hooks/use-mobile-keyboard.ts', import.meta.url).pathname
  const source = `import React from 'react';import {createRoot} from 'react-dom/client';
  import {useMobileKeyboard} from ${JSON.stringify(hook)};
  function Fixture(){const hidden=useMobileKeyboard();return <><textarea aria-label="Message"/><nav aria-label="Dock" hidden={hidden}>Dock</nav></>}
  createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:keyboard.tsx', write: false, platform: 'browser', output: { format: 'iife' },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:keyboard.tsx') return id }, load(id) { if (id === 'virtual:keyboard.tsx') return source } }],
  })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 760 } })
    page.setDefaultTimeout(3000)
    await page.route('http://mew-keyboard-state.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>${chunk.code}</script>` }))
    await page.goto('http://mew-keyboard-state.test/')
    const input = page.getByRole('textbox')
    const dock = page.getByRole('navigation', { name: 'Dock' })
    const update = async (fullscreen: boolean, innerHeight: number, height: number, event = 'resize', scale = 1) => {
      await input.evaluate((el, state) => {
        const doc = el.ownerDocument, win = doc.defaultView!
        Object.defineProperty(doc, 'fullscreenElement', { configurable: true, value: state.fullscreen ? doc.documentElement : null })
        Object.defineProperty(win, 'innerHeight', { configurable: true, value: state.innerHeight })
        Object.defineProperties(win.visualViewport!, {
          height: { configurable: true, value: state.height },
          scale: { configurable: true, value: state.scale },
        })
        if (state.event === 'fullscreenchange') doc.dispatchEvent(new win.Event(state.event))
        else win.visualViewport!.dispatchEvent(new win.Event(state.event))
      }, { fullscreen, innerHeight, height, event, scale })
    }
    await dock.waitFor({ state: 'visible' })
    await input.focus()
    // Fullscreen is 240px taller than the page with browser chrome.
    for (const overlay of [true, false]) {
      await update(true, 1000, 1000, 'fullscreenchange')
      await dock.waitFor({ state: 'visible' })
      await update(true, overlay ? 1000 : 440, 440)
      await dock.waitFor({ state: 'hidden' })
      // fullscreenchange can arrive while the old viewport still reports fullscreen sizes.
      await update(false, overlay ? 1000 : 440, 440, 'fullscreenchange')
      await dock.waitFor({ state: 'hidden' })
      await update(false, overlay ? 760 : 440, 440)
      await dock.waitFor({ state: 'hidden' })
      await update(false, 760, 760)
      await dock.waitFor({ state: 'visible' })
      assert.equal(await input.evaluate(el => el === el.ownerDocument.activeElement), true, 'closing keyboard never requires a blur to restore the dock')
    }
    // Closing the keyboard before leaving fullscreen also restores the normal baseline.
    await update(true, 1000, 1000, 'fullscreenchange')
    await update(true, 1000, 440)
    await dock.waitFor({ state: 'hidden' })
    await update(true, 1000, 1000)
    await dock.waitFor({ state: 'visible' })
    await update(false, 1000, 1000, 'fullscreenchange')
    await update(false, 760, 760)
    await dock.waitFor({ state: 'visible' })
    // Pinch zoom alone stays visible; an actual keyboard while zoomed still hides it.
    await update(false, 760, 760 / 1.5, 'resize', 1.5)
    await dock.waitFor({ state: 'visible' })
    await update(false, 760, 440 / 1.5, 'resize', 1.5)
    await dock.waitFor({ state: 'hidden' })
    await update(false, 760, 760 / 1.5, 'scroll', 1.5)
    await dock.waitFor({ state: 'visible' })
  } finally { await browser.close() }
})
