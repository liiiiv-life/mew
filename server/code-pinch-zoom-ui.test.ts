import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('code files pinch independently while preserving editing, scrolling and Markdown gestures', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const content = Array.from({ length: 120 }, (_, i) => `const line${i + 1} = "${'Long code line for horizontal scrolling. '.repeat(5)}";`).join('\n')
  const source = `
import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {EditorView} from '@codemirror/view';
import {CodePane} from ${JSON.stringify(path.join(root, 'src/components/CodePane.tsx'))};
function Fixture(){
 const [value,setValue]=React.useState(${JSON.stringify(content)}),[file,setFile]=React.useState('fixture.ts'),[readOnly,setReadOnly]=React.useState(false);
 window.fixtureValue=value; window.fixtureView=()=>EditorView.findFromDOM(document.querySelector('.cm-editor'));
 return <><header style={{height:40,display:'flex',gap:8}}><button onClick={()=>setFile('fixture.ts')}>Code</button><button onClick={()=>setFile('fixture.txt')}>Text</button><button onClick={()=>setFile('fixture.md')}>Markdown</button><button onClick={()=>setFile('fixture.mdx')}>MDX</button><button onClick={()=>setReadOnly(!readOnly)}>Read only</button></header>
 <main style={{height:window.innerHeight-40}}><CodePane path={file} value={value} onChange={setValue} readOnly={readOnly}/></main></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const styles: string[] = [], candidates = [source]
  const bundle = await build({ input: 'virtual:code-pinch.tsx', write: false, platform: 'browser', output: { format: 'esm', codeSplitting: false },
    onwarn(warning, defaultHandler) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') defaultHandler(warning) },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'code-pinch-fixture', resolveId(id) { if (id === 'virtual:code-pinch.tsx') return id },
      async load(id) {
        if (id === 'virtual:code-pinch.tsx') return source
        if (id.endsWith('.tsx')) candidates.push(await fs.readFile(id, 'utf8'))
        if (id.endsWith('.css')) { styles.push(await fs.readFile(id, 'utf8')); return { code: '', moduleType: 'js' } }
      },
    }],
  })
  const chunk = bundle.output.find(item => item.type === 'chunk' && item.isEntry)!
  assert.ok(chunk.type === 'chunk')
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + styles.join('\n')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const mobile of [true, false]) {
      const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1100, height: 800 }, hasTouch: mobile, isMobile: mobile })
      page.setDefaultTimeout(5000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-code-pinch.test/**', route => route.fulfill(route.request().url().includes('/api/')
        ? { contentType: 'application/json', body: '[]' }
        : route.request().url().endsWith('/app.js') ? { contentType: 'text/javascript', body: chunk.code }
        : { contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` }))
      await page.goto('http://mew-code-pinch.test/')
      const editor = page.locator('.cm-content'), scroller = page.locator('.cm-scroller')
      await editor.waitFor()
      const fontSize = () => scroller.evaluate(el => Number.parseFloat(el.ownerDocument.defaultView!.getComputedStyle(el).fontSize))
      const settle = () => page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      const snapshot = () => page.evaluate(`(() => {const view=window.fixtureView();return {content:view.state.doc.toString(),selection:view.state.selection.toJSON()}})()`)
      const emit = (type: string, points: { x: number; y: number; id: number }[], detached = false) => editor.evaluate((el, input) => {
        const win = el.ownerDocument.defaultView as any
        const target = input.detached ? win.detachedScroller : el
        const touches = input.points.map(point => new win.Touch({ identifier: point.id, target, clientX: point.x, clientY: point.y }))
        const event = new win.TouchEvent(input.type, { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: touches })
        target.dispatchEvent(event)
        return event.defaultPrevented
      }, { type, points, detached })
      const box = (await scroller.boundingBox())!
      const center = { x: box.x + 190, y: box.y + 280 }
      const points = (distance: number) => [{ x: center.x, y: center.y - distance / 2, id: 1 }, { x: center.x, y: center.y + distance / 2, id: 2 }]
      const pinch = async (from: number, to: number) => {
        await emit('touchstart', points(from)); await emit('touchmove', points(to)); await settle(); await emit('touchend', [])
      }
      assert.equal(await fontSize(), 14)
      await editor.click(); await page.keyboard.press('Control+Home'); await page.keyboard.type('typed ')
      await page.waitForFunction('window.fixtureValue.startsWith("typed ")')
      await page.evaluate('window.fixtureView().dispatch({selection:{anchor:6,head:16}})')
      const before = await snapshot()
      if (!mobile) {
        await scroller.evaluate(el => { el.scrollTop = 300; el.scrollLeft = 80 })
        await page.mouse.move(center.x, center.y)
        await page.mouse.wheel(0, 100)
        await settle()
        assert.equal(await fontSize(), 14, 'ordinary desktop scrolling keeps the configured text size')
        assert.deepEqual(await snapshot(), before)
        await editor.press('Control+z')
        assert.equal(await page.evaluate('window.fixtureValue'), content, 'desktop undo still works')
        assert.deepEqual(errors, [])
        await page.close()
        continue
      }

      await scroller.evaluate(el => { el.scrollTop = 500; el.scrollLeft = 150 })
      await settle()
      const anchor = await scroller.evaluate((el, point) => {
        const view = (el.ownerDocument.defaultView as any).fixtureView()
        const pos = view.posAtCoords(point)
        return { pos, coords: view.coordsAtPos(pos) }
      }, center)
      const scale = await scroller.evaluate(el => el.ownerDocument.defaultView!.visualViewport!.scale)
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(100) })
      for (const distance of [110, 125, 140, 155]) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(distance) })
        await page.waitForTimeout(20)
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForFunction('parseFloat(getComputedStyle(document.querySelector(".cm-scroller")).fontSize)>18')
      assert.deepEqual(await snapshot(), before, 'trusted pinch never edits the file or moves its selection')
      assert.equal(await scroller.evaluate(el => el.ownerDocument.defaultView!.visualViewport!.scale), scale, 'pinch changes the editor rather than the browser viewport')
      const afterAnchor = await scroller.evaluate((el, pos) => (el.ownerDocument.defaultView as any).fixtureView().coordsAtPos(pos), anchor.pos)
      assert.ok(anchor.coords && afterAnchor && Math.abs(afterAnchor.top - anchor.coords.top) < 35, `pinch keeps the same source near the gesture midpoint: ${JSON.stringify({ anchor, afterAnchor })}`)
      assert.ok(await scroller.evaluate(el => el.scrollTop) > 500, 'zoom preserves a scrolled reading position')

      const beforePan = await scroller.evaluate(el => el.scrollTop), zoomedSize = await fontSize()
      const panPoint = (dy: number) => [{ x: center.x, y: box.y + 550 + dy, id: 1 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: panPoint(0) })
      for (let step = 1; step <= 6; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: panPoint(-step * 25) })
        await page.waitForTimeout(20)
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForFunction(`document.querySelector('.cm-scroller').scrollTop > ${beforePan + 40}`)
      assert.equal(await fontSize(), zoomedSize, 'trusted one-finger swipes scroll the zoomed file without changing its size')
      await page.touchscreen.tap(385, 20)

      await pinch(100, 10000)
      assert.equal(await fontSize(), 40, 'zoom has an upper bound')
      await pinch(1000, 1)
      assert.equal(await fontSize(), 8, 'zoom has a lower bound')
      assert.deepEqual(await snapshot(), before)
      assert.equal(await emit('touchstart', [points(100)[0]]), false, 'one finger retains native interaction')
      assert.equal(await emit('touchmove', [points(120)[0]]), false, 'one-finger scrolling is not intercepted')
      await emit('touchend', [])

      await emit('touchstart', points(100))
      assert.equal(await emit('touchend', [points(100)[0]]), true, 'lifting one finger consumes the pinch ending')
      assert.equal(await emit('touchmove', [points(120)[0]]), true, 'the remaining finger cannot accidentally move the caret')
      await emit('touchend', [])

      await emit('touchstart', points(100)); await emit('touchcancel', [])
      assert.equal(await emit('touchmove', points(160)), false, 'cancelled gestures stop intercepting touches')
      assert.equal(await fontSize(), 8)
      await editor.press('Control+z')
      assert.equal(await page.evaluate('window.fixtureValue'), content, 'pinch preserves undo history')

      await page.evaluate('window.detachedScroller=window.fixtureView().scrollDOM')
      await page.getByRole('button', { name: 'Read only', exact: true }).click()
      assert.equal(await editor.getAttribute('contenteditable'), 'false')
      assert.equal(await emit('touchstart', points(100), true), false, 'destroying a view removes its touch listeners')
      await pinch(100, 160)
      assert.ok(await fontSize() > 20, 'read-only files support the same pinch gesture')
      assert.equal(await page.evaluate('window.fixtureValue'), content)

      for (const name of ['Markdown', 'MDX']) {
        await page.getByRole('button', { name, exact: true }).click()
        assert.equal(await fontSize(), 14)
        assert.equal(await emit('touchstart', points(100)), false, `${name} Plain retains its existing gestures`)
        await emit('touchmove', points(160)); await emit('touchend', [])
        assert.equal(await fontSize(), 14, `${name} is excluded from code pinch zoom`)
      }
      await page.getByRole('button', { name: 'Text', exact: true }).click()
      await scroller.evaluate(el => { el.scrollTop = 2000 })
      await settle()
      const wrappedAnchor = await scroller.evaluate((el, point) => {
        const view = (el.ownerDocument.defaultView as any).fixtureView()
        const pos = view.posAtCoords(point)
        return { pos, coords: view.coordsAtPos(pos) }
      }, center)
      await pinch(100, 160)
      assert.ok(await fontSize() > 20, 'wrapped ordinary text files also support pinch')
      const wrappedAfter = await scroller.evaluate((el, pos) => (el.ownerDocument.defaultView as any).fixtureView().coordsAtPos(pos), wrappedAnchor.pos)
      assert.ok(wrappedAnchor.coords && wrappedAfter && Math.abs(wrappedAfter.top - wrappedAnchor.coords.top) < 40, `wrapped text preserves the visible source while lines reflow: ${JSON.stringify({ wrappedAnchor, wrappedAfter })}`)
      assert.equal(await page.evaluate('window.fixtureValue'), content)
      assert.deepEqual(errors, [])
      await cdp.detach()
      await page.close()
    }
  } finally { await browser.close() }
})
