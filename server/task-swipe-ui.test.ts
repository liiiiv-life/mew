import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('task swipe reveals deletion without deleting and preserves taps, scrolling, cancellation and read-only access', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const source = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {TaskSwipeRow} from '${root}/src/components/task-swipe-row.tsx';
function Fixture(){const [items,setItems]=useState(['one','two','readonly']),[open,setOpen]=useState(null),[taps,setTaps]=useState(0);
return <><button id='outside'>Outside</button><output>{taps}</output>{items.map(id=><TaskSwipeRow key={id} id={id} done={false} enabled={id!=='readonly'} open={open===id} onReveal={value=>setOpen(value?id:null)} onDelete={()=>setItems(items.filter(item=>item!==id))}>
<label className='task-check'><input type='checkbox'/></label><div className='task-content'><textarea aria-label={id} defaultValue={id}/></div><button className='task-date-status' onClick={()=>setTaps(taps+1)}>D-Day</button></TaskSwipeRow>)}</>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:swipe.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:swipe.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:swipe.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const css = await fs.readFile(path.join(root, 'src/components/task-panel.css'), 'utf8')
  const app = express()
  app.get('/', (_req, res) => res.send(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--color-surface:#fff;--color-ink:#222;--color-danger:#c22;--color-accent:#26c}body{margin:8px;height:2000px;font:14px sans-serif}button{border:0}*{box-sizing:border-box}${css}</style><div id='root'></div><script>${bundle.output.find(item => item.type === 'chunk')!.code}</script>`))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const errors: string[] = []
    for (const mobile of [false, true]) {
      const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1100, height: 700 }, hasTouch: mobile, isMobile: mobile })
      page.setDefaultTimeout(3000)
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${address.port}`)
      const row = page.locator('[data-task-id=one]'), deletion = row.getByRole('button', { name: '태스크 삭제' })
      const swipe = async (target: string, dx: number, dy = 0, cancel = false) => {
        const area = (await page.locator(`[data-task-id=${target}] textarea`).boundingBox())!
        const x = area.x + area.width * .65, y = area.y + area.height / 2
        if (mobile) {
          const cdp = await page.context().newCDPSession(page)
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
          for (let step = 1; step <= 5; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 5, y: y + dy * step / 5 }] })
          await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] })
          await cdp.detach()
        } else {
          // Mouse text selection stays native; swipe the date control instead.
          const button = (await page.locator(`[data-task-id=${target}] .task-date-status`).boundingBox())!
          const mouseX = button.x + button.width / 2, mouseY = button.y + button.height / 2
          await page.mouse.move(mouseX, mouseY); await page.mouse.down()
          await page.mouse.move(mouseX + dx, mouseY + dy, { steps: 5 })
          await page.mouse.up()
        }
      }
      assert.equal(await deletion.isVisible(), false)
      await row.hover(); assert.equal(await deletion.isVisible(), false)
      await swipe('one', -60)
      await deletion.waitFor({ state: 'visible' })
      assert.equal(await page.locator('[data-task-id]').count(), 3, 'swipe alone does not delete')
      assert.equal(await page.locator('output').textContent(), '0', 'swipe does not activate date control')
      await swipe('one', 60)
      await deletion.waitFor({ state: 'hidden' })
      await swipe('one', -60, 90)
      assert.equal(await deletion.isVisible(), false, 'vertical gesture does not reveal deletion')
      await page.locator('body').evaluate(el => el.ownerDocument.defaultView!.scrollTo(0, 0))
      if (mobile) {
        await swipe('one', -60, 0, true)
        assert.equal(await deletion.isVisible(), false, 'cancel restores hidden action')
      }
      await swipe('readonly', -60)
      assert.equal(await page.locator('[data-task-id=readonly] .task-delete').count(), 0)
      await swipe('one', -60)
      await page.locator('#outside').click()
      await deletion.waitFor({ state: 'hidden' })
      await swipe('one', -60)
      await swipe('two', -60)
      await deletion.waitFor({ state: 'hidden' })
      await page.locator('[data-task-id=two] .task-delete').waitFor({ state: 'visible' })
      await page.locator('#outside').click()
      await row.locator('input').check()
      assert.equal(await row.locator('input').isChecked(), true, 'checkbox tap is preserved')
      await row.locator('.task-date-status').click()
      assert.equal(await page.locator('output').textContent(), '1', 'date click is preserved')
      await row.locator('textarea').press('Alt+Delete')
      await deletion.waitFor({ state: 'visible' })
      await deletion.evaluate(el => new Promise<void>(resolve => el.ownerDocument.defaultView!.requestAnimationFrame(() => resolve())))
      assert.equal(await deletion.evaluate(el => el === el.ownerDocument.activeElement), true)
      await deletion.press('Escape')
      await deletion.waitFor({ state: 'hidden' })
      await swipe('one', -60)
      if (mobile) { await page.waitForTimeout(350); await deletion.tap() } else await deletion.click()
      await row.waitFor({ state: 'detached' })
      assert.equal(await page.locator('textarea:focus').count(), 0, 'delete does not focus another input')
      await page.close()
    }
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
