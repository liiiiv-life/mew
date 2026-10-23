import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { attachLiveWebSocket } from './live-socket.ts'
import { defaultDebugConfig } from '../shared/debugger.ts'

test('real code editor shares transparent line numbers with breakpoint controls on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 60_000 }, async t => {
  const code = ['message = "' + 'A long line to scroll horizontally. '.repeat(12) + '"', 'counter = 1', 'counter += 1', 'print(counter)', ...Array.from({ length: 24 }, (_, i) => `value_${i} = counter + ${i}`)].join('\n')
  const source = `import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {CodePane} from ${JSON.stringify(new URL('../src/components/CodePane.tsx', import.meta.url).pathname)};
import {I18nProvider} from ${JSON.stringify(new URL('../src/i18n.tsx', import.meta.url).pathname)};
import {applyThemePalette,THEME_PRESETS} from ${JSON.stringify(new URL('../src/utils/theme-color.ts', import.meta.url).pathname)};
const params=new URL(location.href).searchParams,offset=Number(params.get('offset'));
window.fixtureTheme=id=>applyThemePalette(THEME_PRESETS.find(p=>p.id===id).palette);
window.fixtureTheme(params.get('theme'));
createRoot(document.getElementById('root')).render(<I18nProvider><main className="mew-workspace h-full"><CodePane path="main.py" value={${JSON.stringify(code)}} readOnly={offset>0} lineOffset={offset} onChange={()=>{}} debuggerContext={{root:'/fixture',account:'gutter@example.test'}}/></main></I18nProvider>);`
  const bundle = await build({ input: 'virtual:gutter.tsx', write: false, platform: 'browser', output: { format: 'esm', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'gutter-fixture', resolveId(id) { if (id === 'virtual:gutter.tsx') return id; if (id.endsWith('.css')) return 'virtual:css' },
    load(id) { if (id === 'virtual:gutter.tsx') return source; if (id === 'virtual:css') return '' },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const cssSource = source + await fs.readFile(new URL('../src/components/CodePane.tsx', import.meta.url), 'utf8')
  const compiler = await compile(await fs.readFile(new URL('../src/index.css', import.meta.url), 'utf8'), { base: new URL('../src', import.meta.url).pathname, onDependency() {} })
  const css = compiler.build([...new Set(cssSource.match(/[A-Za-z0-9_@!&:/.[\]()%,-]+/g))])
  let config = defaultDebugConfig('custom', '/fixture'), offset = 0
  const status = () => ({ config, adapter: { installed: false, version: 'fixture' }, session: {
    id: 'fixture', state: 'stopped', reason: '', output: '', capabilities: {},
    frames: [{ id: 1, name: 'main', line: offset + 2, source: { path: '/fixture/main.py' } }],
    breakpoints: config.breakpoints.filter(bp => bp.line !== offset + 4).map(bp => ({ ...bp, verified: true })),
  } })
  const server = http.createServer(async (req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(chunk.type === 'chunk' ? chunk.code : ''); return }
    if (req.url?.startsWith('/api/debugger')) {
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/api/debugger/config') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        config = JSON.parse(Buffer.concat(chunks).toString()); res.end(JSON.stringify(config)); return
      }
      res.end(JSON.stringify(status())); return
    }
    res.setHeader('Content-Type', 'text/html')
    res.end(`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`)
  })
  attachLiveWebSocket(server, () => ({ key: 'gutter', interval: 100, allowed: () => true, async read() { return status() } }))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const wait = async (check: () => boolean) => { const deadline = Date.now() + 4000; while (!check()) { assert.ok(Date.now() < deadline, 'breakpoint state did not settle'); await new Promise(resolve => setTimeout(resolve, 10)) } }
  await fs.mkdir('/tmp/mew-editor-gutter', { recursive: true })
  for (const width of [1100, 390]) for (const theme of ['midnight', 'rose', 'ocean']) {
    offset = theme === 'ocean' ? 120 : 0
    config = { ...defaultDebugConfig('custom', '/fixture'), breakpoints: [
      { file: 'main.py', line: offset + 2, enabled: true },
      { file: 'main.py', line: offset + 3, enabled: false },
      { file: 'main.py', line: offset + 4, enabled: true },
      { file: 'main.py', line: 999, enabled: true },
    ] }
    const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: width === 390, hasTouch: width === 390, reducedMotion: 'reduce' })
    const page = await context.newPage(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(7000)
    await page.goto(`http://127.0.0.1:${address.port}/?theme=${theme}&offset=${offset}`)
    const gutter = page.locator('.cm-lineNumbers'), markers = gutter.locator('.cm-debugger-marker')
    await markers.first().waitFor()
    assert.equal(await page.locator('.cm-gutter').count(), 1, 'breakpoints occupy the line-number column without adding a gutter')
    assert.equal(await page.locator('.cm-debugger-gutter').count(), 0)
    assert.equal(await markers.count(), 3, 'out-of-range marks are ignored')
    assert.deepEqual(await markers.allTextContents(), [2, 3, 4].map(line => String(offset + line)), 'breakpoint styling preserves original line numbers including preview offsets')
    assert.equal(await markers.filter({ hasText: String(offset + 3) }).evaluate(el => el.classList.contains('cm-debugger-disabled')), true)
    const before = await gutter.boundingBox(); assert.ok(before)
    const visual = await page.locator('.cm-gutters').evaluate(el => {
      const view = el.ownerDocument.defaultView!, style = view.getComputedStyle(el)
      const canvas = el.ownerDocument.createElement('canvas'), context = canvas.getContext('2d')!
      context.fillStyle = style.backgroundColor; context.fillRect(0, 0, 1, 1)
      return { alpha: context.getImageData(0, 0, 1, 1).data[3] / 255, blur: style.backdropFilter, opacity: style.opacity, filter: style.filter }
    })
    assert.equal(visual.alpha, 0); assert.equal(visual.blur, 'none'); assert.equal(visual.opacity, '1'); assert.equal(visual.filter, 'none')
    const first = gutter.locator('.cm-gutterElement').filter({ hasText: new RegExp(`^${offset + 1}$`) })
    if (width === 390) await first.tap(); else await first.click()
    await wait(() => config.breakpoints.some(bp => bp.line === offset + 1))
    assert.equal(await first.innerText(), String(offset + 1))
    assert.equal((await gutter.boundingBox())?.width, before.width, 'adding a breakpoint does not shift code horizontally')
    if (width === 390) await first.tap(); else await first.click()
    await wait(() => !config.breakpoints.some(bp => bp.line === offset + 1))
    if (!offset) {
      await page.locator('.cm-content').click(); await page.locator('.cm-content').press('Control+Home'); await page.locator('.cm-content').press('F9')
      await wait(() => config.breakpoints.some(bp => bp.line === 1))
      await page.locator('.cm-content').press('F9')
      await wait(() => !config.breakpoints.some(bp => bp.line === 1))
      await page.locator('.cm-content').press('ArrowDown')
      const active = gutter.locator('.cm-debugger-verified.cm-activeLineGutter:not(.cm-debugger-disabled)')
      await active.waitFor()
      const colors = await active.evaluate(el => {
        const style = el.ownerDocument.defaultView!.getComputedStyle(el), context = el.ownerDocument.createElement('canvas').getContext('2d')!
        context.fillStyle = style.color; const actual = context.fillStyle
        context.fillStyle = style.getPropertyValue('--color-ink-on-accent'); return { actual, expected: context.fillStyle }
      })
      assert.equal(colors.actual, colors.expected, 'the current-line style preserves readable breakpoint numerals')
    }
    await page.locator('.cm-scroller').evaluate(el => { el.scrollLeft = 150 })
    const after = await gutter.boundingBox(); assert.ok(after)
    assert.equal(Math.round(before.x), Math.round(after.x), 'transparent line numbers remain pinned while code scrolls underneath')
    await page.locator('.cm-scroller').evaluate(el => { el.scrollLeft = 0 })
    await page.screenshot({ path: `/tmp/mew-editor-gutter/${theme}-${width}.png` })
    await page.locator('html').evaluate(el => (el.ownerDocument.defaultView as any).fixtureTheme('light'))
    const solid = await page.locator('.cm-gutters').evaluate(el => { const style = el.ownerDocument.defaultView!.getComputedStyle(el); return { background: style.backgroundColor, blur: style.backdropFilter } })
    assert.equal(solid.background, 'rgba(0, 0, 0, 0)'); assert.equal(solid.blur, 'none')
    assert.deepEqual(errors, [])
    await context.close()
  }
})
