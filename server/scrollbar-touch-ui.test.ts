import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('native scrollbars retain their size while touch thumbs drag without blocking content gestures', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const source = `import {startScrollbarTouchDragging} from '${root}/src/utils/scrollbar-touch.ts';
window.stopScrollbarTouchDragging=startScrollbarTouchDragging();
window.pointerStarts=0;window.ancestorPointerStarts=0;window.dragStarts=0;window.buttonClicks=0;
document.querySelector('main').addEventListener('pointerdown',()=>window.ancestorPointerStarts++,true);
document.addEventListener('mew:scrollbar-drag-start',()=>window.dragStarts++);
document.querySelectorAll('.content').forEach(element=>element.addEventListener('pointerdown',()=>window.pointerStarts++));
document.querySelector('#ordinary').addEventListener('click',()=>window.buttonClicks++);
window.setCase=name=>{document.querySelectorAll('.case').forEach(element=>element.classList.toggle('active',element.id===name+'-case'));document.querySelectorAll('.scroller').forEach(element=>{element.scrollTop=0;element.scrollLeft=0});window.pointerStarts=0;window.ancestorPointerStarts=0;window.dragStarts=0};`
  const bundle = await build({ input: 'virtual:scrollbar-touch.ts', write: false, platform: 'browser', output: { format: 'iife' }, plugins: [{ name: 'scrollbar-touch-fixture', resolveId(id) { if (id === 'virtual:scrollbar-touch.ts') return id }, load(id) { if (id === 'virtual:scrollbar-touch.ts') return source } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build(['no-scrollbar'])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true })
    page.setDefaultTimeout(3000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://mew-scrollbar-touch.test/**', route => route.fulfill(route.request().url().endsWith('/app.js')
      ? { contentType: 'text/javascript', body: chunk.code }
      : { contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
body{margin:0;overflow:hidden;background:var(--color-surface);color:var(--color-ink);font:14px sans-serif}main{padding:20px}.case{display:none}.case.active{display:block}.scroller{width:280px;height:200px;overflow:auto;background:var(--color-surface-deep)}.content{position:relative;background:repeating-linear-gradient(to bottom,transparent 0px,transparent 39px,var(--color-edge) 40px)}.vertical-content{height:2000px}#ordinary{position:absolute;top:80px;left:12px;padding:8px;background:var(--color-surface-raised)}.wide-content{width:1600px;height:100%;background:repeating-linear-gradient(to right,transparent 0px,transparent 79px,var(--color-edge) 80px)}#outer{height:220px}.outer-content{height:1400px}#inner{width:100%;height:200px}
</style><main><h1>스크롤 영역</h1>
<section id="vertical-case" class="case active"><div id="vertical" class="scroller"><div class="content vertical-content"><button id="ordinary" type="button">문서 열기</button></div></div></section>
<section id="horizontal-case" class="case"><div id="horizontal" class="scroller"><div class="content wide-content"></div></div></section>
<section id="rtl-case" class="case"><div id="rtl" class="scroller" dir="rtl"><div class="content wide-content"></div></div></section>
<section id="nested-case" class="case"><div id="outer" class="scroller"><div class="content outer-content"><div id="inner" class="scroller"><div class="content vertical-content"></div></div></div></div></section>
</main><script src="/app.js"></script></html>` }))
    await page.goto('http://mew-scrollbar-touch.test/')
    const vertical = page.locator('#vertical')
    await vertical.waitFor()
    const reservedWidth = await vertical.evaluate(element => element.getBoundingClientRect().width - element.clientWidth)
    assert.ok(reservedWidth === 0 || reservedWidth === 6, 'native overlay and reserved scrollbars keep their existing layout')
    const touch = await page.context().newCDPSession(page)
    const point = (x: number, y: number) => [{ x, y, id: 1 }]
    const drag = async (x: number, y: number, dx: number, dy: number) => {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(x, y) })
      for (let step = 1; step <= 6; step++) {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(x + dx * step / 6, y + dy * step / 6) })
        await page.waitForTimeout(16)
      }
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(80)
    }
    for (const width of [390, 1100]) for (const dark of [true, false]) {
      await page.setViewportSize({ width, height: 700 })
      await page.locator('html').evaluate((element, enabled) => element.classList.toggle('dark', enabled), dark)
      assert.deepEqual(await vertical.evaluate(element => {
        const style = element.ownerDocument.defaultView!.getComputedStyle(element, '::-webkit-scrollbar')
        return { width: style.width, height: style.height, reservedWidth: element.getBoundingClientRect().width - element.clientWidth }
      }), { width: '6px', height: '6px', reservedWidth }, 'touch support does not widen the native scrollbar or reduce content width')
      await page.screenshot({ path: `/tmp/mew-scrollbar-touch-${width}-${dark ? 'dark' : 'light'}.png` })
    }
    await page.setViewportSize({ width: 390, height: 700 })
    const verticalBox = (await vertical.boundingBox())!
    const thumbX = verticalBox.x + verticalBox.width - 12
    await drag(thumbX, verticalBox.y + 12, 0, 90)
    assert.ok(await vertical.evaluate(element => element.scrollTop) > 500, 'a trusted touch outside the visible 6px thumb drags the scrollbar down')
    assert.equal(await page.evaluate('window.pointerStarts'), 0, 'thumb touches do not start content pointer actions')
    assert.equal(await page.evaluate('window.ancestorPointerStarts'), 1, 'ancestor pointer capture still receives touches for panel focus')
    assert.equal(await page.evaluate('window.dragStarts'), 1, 'manual scrollbar navigation bubbles a drag-start event')
    await vertical.evaluate(element => { element.scrollTop = 0 })
    await drag(thumbX, verticalBox.y + 28, 0, 80)
    assert.ok(await vertical.evaluate(element => element.scrollTop) > 500, 'the short thumb has a usable minimum touch length')

    await page.evaluate('window.setCase("vertical")')
    const button = (await page.getByRole('button', { name: '문서 열기', exact: true }).boundingBox())!
    await page.touchscreen.tap(button.x + button.width / 2, button.y + button.height / 2)
    assert.equal(await page.evaluate('window.buttonClicks'), 1, 'ordinary buttons still receive touch clicks')
    await vertical.evaluate(element => {
      const button = element.ownerDocument.createElement('button')
      button.id = 'edge-action'
      button.textContent = '×'
      button.style.cssText = 'position:absolute;top:0;right:0;width:28px;height:28px'
      button.addEventListener('click', () => { button.dataset.clicked = 'true' })
      element.firstElementChild!.append(button)
    })
    await page.touchscreen.tap(thumbX, verticalBox.y + 12)
    assert.equal(await page.locator('#edge-action').getAttribute('data-clicked'), 'true', 'small controls beside a scrollbar keep their touch target')
    await page.locator('#edge-action').evaluate(element => element.remove())
    await page.mouse.move(thumbX, verticalBox.y + 12)
    await page.mouse.down()
    await page.mouse.move(thumbX, verticalBox.y + 100, { steps: 4 })
    await page.mouse.up()
    assert.equal(await vertical.evaluate(element => element.scrollTop), 0, 'mouse input does not use the enlarged touch area')
    await drag(verticalBox.x + 90, verticalBox.y + 150, 0, -100)
    assert.ok(await vertical.evaluate(element => element.scrollTop) > 40, 'ordinary content swipes retain native scrolling')
    assert.ok(Number(await page.evaluate('window.pointerStarts')) > 0)
    await page.touchscreen.tap(350, 500)

    for (const hidden of ['class', 'width', 'overflow']) {
      await page.evaluate('window.setCase("vertical")')
      await vertical.evaluate((element, mode) => {
        element.classList.toggle('no-scrollbar', mode === 'class')
        element.style.scrollbarWidth = mode === 'width' ? 'none' : ''
        element.style.overflow = mode === 'overflow' ? 'hidden' : 'auto'
      }, hidden)
      await drag(thumbX, verticalBox.y + 12, 0, 80)
      assert.equal(await vertical.evaluate(element => element.scrollTop), 0, `${hidden}: hidden scrollbars do not acquire touch drags`)
      assert.ok(Number(await page.evaluate('window.pointerStarts')) > 0, `${hidden}: content receives pointer input`)
    }
    await vertical.evaluate(element => { element.classList.remove('no-scrollbar'); element.style.removeProperty('scrollbar-width'); element.style.removeProperty('overflow') })
    for (const degrees of [90, 180, 270]) {
      await page.evaluate('window.setCase("vertical")')
      await vertical.evaluate((element, angle) => {
        element.parentElement!.style.width = '280px'
        element.parentElement!.style.transform = `rotate(${angle}deg)`
      }, degrees)
      const rotatedBox = (await vertical.boundingBox())!
      await drag(rotatedBox.x + rotatedBox.width - 12, rotatedBox.y + 12, 0, 60)
      assert.equal(await page.evaluate('window.dragStarts'), 0, `${degrees}°: rotated scroll areas retain their original touch handling`)
      assert.ok(Number(await page.evaluate('window.pointerStarts')) > 0, `${degrees}°: rotation does not block content pointer actions`)
      await page.touchscreen.tap(350, 500)
    }
    await vertical.evaluate(element => { element.parentElement!.style.removeProperty('width'); element.parentElement!.style.removeProperty('transform') })

    await page.evaluate('window.setCase("horizontal")')
    const horizontal = page.locator('#horizontal'), horizontalBox = (await horizontal.boundingBox())!
    await drag(horizontalBox.x + 12, horizontalBox.y + horizontalBox.height - 12, 90, 0)
    assert.ok(await horizontal.evaluate(element => element.scrollLeft) > 350, 'horizontal thumbs drag from the enlarged area')
    await page.evaluate('window.setCase("rtl")')
    const rtl = page.locator('#rtl'), rtlBox = (await rtl.boundingBox())!
    await drag(rtlBox.x + rtlBox.width - 12, rtlBox.y + rtlBox.height - 12, -90, 0)
    assert.ok(await rtl.evaluate(element => element.scrollLeft) < -350, 'RTL thumbs preserve the negative scrollLeft direction')
    await page.evaluate('window.setCase("nested")')
    const inner = page.locator('#inner'), innerBox = (await inner.boundingBox())!
    await drag(innerBox.x + innerBox.width - 12, innerBox.y + 12, 0, 80)
    assert.ok(await inner.evaluate(element => element.scrollTop) > 400, 'the deepest overlapping scrollbar receives the drag')
    assert.equal(await page.locator('#outer').evaluate(element => element.scrollTop), 0)
    await page.evaluate('window.setCase("nested")')
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(innerBox.x + innerBox.width - 12, innerBox.y + 12) })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(innerBox.x + innerBox.width - 12, innerBox.y + 52) })
    await inner.evaluate(element => element.remove())
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(innerBox.x + innerBox.width - 12, innerBox.y + 92) })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    assert.equal(await page.locator('#outer').evaluate(element => element.scrollTop), 0, 'removing an active scroller does not transfer its drag to a parent')

    await page.evaluate('window.setCase("vertical")')
    const twoTouches = (dy: number) => [{ x: thumbX, y: verticalBox.y + 12 + dy, id: 1 }, { x: verticalBox.x + 80, y: verticalBox.y + 12 + dy, id: 2 }]
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: twoTouches(0) })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: twoTouches(60) })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    assert.equal(await vertical.evaluate(element => element.scrollTop), 0, 'multitouch does not start a thumb drag')

    await page.evaluate('window.setCase("vertical")')
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(thumbX, verticalBox.y + 12) })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(thumbX, verticalBox.y + 52) })
    const beforeBlur = await vertical.evaluate(element => element.scrollTop)
    assert.ok(beforeBlur > 0)
    await page.evaluate('window.dispatchEvent(new Event("blur"))')
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(thumbX, verticalBox.y + 92) })
    assert.equal(await vertical.evaluate(element => element.scrollTop), beforeBlur, 'blur cancels a thumb drag')
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await page.evaluate('window.setCase("vertical");window.stopScrollbarTouchDragging()')
    await drag(thumbX, verticalBox.y + 12, 0, 80)
    assert.equal(await vertical.evaluate(element => element.scrollTop), 0, 'cleanup removes the touch interception')
    assert.ok(Number(await page.evaluate('window.pointerStarts')) > 0)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
