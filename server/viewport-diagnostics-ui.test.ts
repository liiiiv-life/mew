import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('opt-in viewport diagnostics preserve keyboard focus and export geometry without workspace contents', { skip: !domBrowserExecutable(), timeout: 20_000 }, async () => {
  const entry = `import {installViewportDiagnostics} from '${new URL('../src/utils/viewport-diagnostics.ts', import.meta.url).pathname}';window.stopDiagnostics=installViewportDiagnostics();`
  const bundle = await build({ input: 'virtual:viewport-diagnostics', write: false, platform: 'browser', output: { format: 'iife' },
    plugins: [{ name: 'viewport-diagnostics', resolveId(id) { if (id === 'virtual:viewport-diagnostics') return id }, load(id) { if (id === 'virtual:viewport-diagnostics') return entry } }],
  })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [390, 1100]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width === 390 })
      page.setDefaultTimeout(4000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(`
        const keyboard=new EventTarget();keyboard.boundingRect=new DOMRect(0,480,${width},364);
        Object.defineProperty(keyboard,'overlaysContent',{get:()=>true,set:()=>{throw Error('diagnostics must not change keyboard policy')}});
        Object.defineProperty(navigator,'virtualKeyboard',{value:keyboard});window.keyboard=keyboard;
        Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{if(window.failClipboard)throw Error('blocked');window.report=text}}});
      `)
      await page.route('https://mew-viewport-diagnostics.test/**', route => {
        if (new URL(route.request().url()).pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PRIVATE_SENTINEL</title><style>html,body,#root{margin:0;height:100%;overflow:hidden}body{background:#142737;color:#eee}main{height:100%;display:flex;flex-direction:column}section{flex:1}footer{height:200px;display:flex}textarea{flex:1;min-width:0}</style><div id="root"><main class="mew-workspace PRIVATE_SENTINEL"><section></section><footer data-agent-composer><textarea id="PRIVATE_SENTINEL" data-file="PRIVATE_SENTINEL" aria-label="Message"></textarea></footer></main></div><div style="position:fixed;top:417px;height:15px;left:0;right:0;background:#1e1e1e;z-index:100"></div><script src="/app.js"></script>` })
      })
      await page.goto('https://mew-viewport-diagnostics.test/?token=PRIVATE_SENTINEL')
      assert.deepEqual(errors, [])
      assert.equal(await page.locator('[data-viewport-diagnostics]').count(), 1)
      assert.equal(await page.locator('[data-viewport-diagnostics]').getAttribute('aria-label'), '화면 진단 복사')
      const input = page.getByRole('textbox')
      await input.fill('PRIVATE_SENTINEL')
      await input.evaluate(el => {
        const win = el.ownerDocument.defaultView!
        Object.defineProperty(el.ownerDocument, 'fullscreenElement', { value: el.ownerDocument.documentElement, configurable: true })
        el.ownerDocument.dispatchEvent(new win.Event('fullscreenchange'))
      })
      await page.evaluate('for(let i=0;i<100;i++)window.keyboard.dispatchEvent(new Event("geometrychange"))')
      const copy = () => width === 390 ? page.getByRole('button', { name: '화면 진단 복사' }).tap() : page.getByRole('button', { name: '화면 진단 복사' }).click()
      await copy()
      await page.waitForFunction('window.report', undefined, { timeout: 4000 })
      const raw = await page.evaluate('window.report') as string
      const report = JSON.parse(raw)
      assert.equal(raw.includes('PRIVATE_SENTINEL'), false, 'no URL, text, values, ids or classes are included')
      assert.equal(report.format, 'mew-viewport-diagnostics/1')
      assert.equal(report.current.fullscreen, true)
      assert.equal(report.current.focusedTag, 'TEXTAREA')
      assert.equal(report.current.keyboard.box.height, 364)
      assert.equal(report.current.inner.height, 844)
      assert.equal(report.events.length, 80, 'event history is bounded')
      assert.ok(report.events.some((event: { event: string }) => event.event === 'geometrychange'))
      const band = report.elements.findIndex((element: { box: { y: number; height: number }; style: { backgroundColor: string } }) => element.box.y === 417 && element.box.height === 15 && element.style.backgroundColor === 'rgb(30, 30, 30)')
      assert.ok(band >= 0, 'a DOM band can be matched with the screenshot coordinates')
      assert.ok(report.samples.rows.find((row: { y: number }) => row.y === 420).hits.every((hits: number[]) => hits[0] === band))
      assert.equal(await input.evaluate(el => el.ownerDocument.activeElement === el), true, 'copy does not blur the input or dismiss the OS keyboard')
      assert.equal(await input.inputValue(), 'PRIVATE_SENTINEL')
      assert.equal(await page.locator('main').evaluate(el => el.getBoundingClientRect().height), 844)
      await page.screenshot({ path: `/tmp/mew-viewport-diagnostics-${width}.png` })
      await page.evaluate('window.failClipboard=true')
      const downloadPromise = page.waitForEvent('download')
      await copy()
      const download = await downloadPromise
      assert.equal(download.suggestedFilename(), 'mew-viewport-diagnostics.json')
      const downloaded = await fs.readFile((await download.path())!, 'utf8')
      assert.equal(JSON.parse(downloaded).format, report.format)
      assert.equal(downloaded.includes('PRIVATE_SENTINEL'), false)
      await page.evaluate('window.stopDiagnostics();window.keyboard.dispatchEvent(new Event("geometrychange"))')
      assert.equal(await page.locator('[data-viewport-diagnostics]').count(), 0)
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
