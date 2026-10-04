import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('custom calendar supports text, keyboard, themes, touch, viewport bounds and layered dismissal', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const source = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {DateField,useOverlayDismiss} from '@mew/ui';import {setUiLocale,uiText} from '@mew/ui/i18n-core';setUiLocale('ko');
function Fixture(){const [value,setValue]=useState('2026-10-15'),[open,setOpen]=useState(true),[readOnly,setReadOnly]=useState(false);
useOverlayDismiss(open&&(()=>setOpen(false)),{escapePhase:'bubble'});
return <main style={{padding:16,color:'var(--color-ink)'}}><button id='readonly' onClick={()=>setReadOnly(!readOnly)}>Read only</button><button id='english' onClick={()=>setUiLocale('en')}>English</button>
{open&&<section aria-label='fixture' style={{marginTop:50,padding:16,background:'var(--color-surface)',borderRadius:6,maxWidth:480}}><div style={{display:'flex',gap:16,alignItems:'center'}}><span style={{flex:1}}>릴리스 준비</span><DateField label={uiText('태스크 날짜')} value={value} readOnly={readOnly} onChange={setValue}/></div><button id='outside' style={{position:'fixed',bottom:16,left:16}}>Outside</button></section>}<output id='stored'>{value??'none'}</output></main>}
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`
  const bundle = await build({ input: 'virtual:date.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'date-fixture', resolveId(id) {
    if (id === 'virtual:date.tsx') return id
    if (id.endsWith('.css')) return 'virtual:style'
  }, load(id) { if (id === 'virtual:date.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const dateCss = await fs.readFile(path.join(root, 'packages/ui/src/date-field.css'), 'utf8')
  const css = compiler.build(['font-sans', ...Array.from(dateCss.matchAll(/--color-([a-z-]+)/g), match => `bg-${match[1]}`)]) + dateCss
  const app = express()
  app.get('/app.js', (_req, res) => res.type('js').send(chunk.code))
  app.get('/', (_req, res) => res.type('html').send(`<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  await fs.mkdir('/tmp/mew-date-field', { recursive: true })
  try {
    const desktop = await browser.newPage({ viewport: { width: 1100, height: 800 } })
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const errors: string[] = []
    for (const page of [desktop, mobile]) {
      page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message)); await page.goto(base)
      const input = page.getByRole('textbox', { name: '태스크 날짜' })
      const selection = () => input.evaluate(el => [el.selectionStart, el.selectionEnd])
      await input.focus(); await input.press('Control+a'); await input.press('Backspace')
      assert.equal(await input.inputValue(), '0000-00-00')
      await input.pressSequentially('2028')
      assert.deepEqual(await selection(), [5, 7], 'four year digits advance to month')
      await input.pressSequentially('10')
      assert.deepEqual(await selection(), [8, 10], 'two month digits advance to day')
      await input.pressSequentially('15')
      assert.equal(await input.inputValue(), '2028-10-15')
      assert.equal(await page.locator('#stored').textContent(), '2028-10-15')
      await input.press('Home'); await input.press('Tab')
      assert.deepEqual(await selection(), [5, 7])
      await input.press('Enter'); assert.deepEqual(await selection(), [8, 10])
      await input.press('Shift+Tab'); assert.deepEqual(await selection(), [5, 7])
      await input.press('ArrowLeft'); assert.deepEqual(await selection(), [0, 4])
      await input.press('ArrowDown'); assert.deepEqual(await selection(), [5, 7])
      await input.press('ArrowRight'); assert.deepEqual(await selection(), [8, 10])
      await input.press('ArrowUp'); assert.deepEqual(await selection(), [5, 7])
      await input.press('Home'); await input.pressSequentially('2030')
      await input.press('ArrowRight'); await input.press('Enter')
      assert.equal(await page.locator('#stored').textContent(), '2030-10-15')
      assert.equal(await page.getByRole('button', { name: '달력 열기' }).evaluate(el => el === el.ownerDocument.activeElement), true)
      await (page === mobile ? input.tap({ position: { x: 49, y: 14 } }) : input.click({ position: { x: 49, y: 14 } }))
      assert.deepEqual(await selection(), [5, 7], 'click selects only month')
      await input.pressSequentially('12')
      await input.press('Enter')
      assert.equal(await page.locator('#stored').textContent(), '2030-12-15')
      await (page === mobile ? input.tap({ position: { x: 73, y: 14 } }) : input.click({ position: { x: 73, y: 14 } }))
      assert.deepEqual(await selection(), [8, 10], 'click selects only day')
      await input.pressSequentially('07')
      assert.equal(await input.inputValue(), '2030-12-07')
      await input.press('Home')
      // Numeric touch keyboards can produce beforeinput without a keydown event.
      await input.evaluate(el => {
        const win = el.ownerDocument.defaultView!
        for (const digit of '20291231') el.dispatchEvent(new win.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: digit }))
      })
      assert.equal(await input.inputValue(), '2029-12-31')
      await input.press('Control+a'); await input.press('Delete'); await input.press('End'); await input.press('Enter')
      assert.equal(await page.locator('#stored').textContent(), 'none')
      assert.equal(await input.getAttribute('inputmode'), 'numeric')
      await input.focus(); await input.press('Control+a'); await input.press('Backspace')
      await input.pressSequentially('2026'); await input.pressSequentially('2'); await input.press('Enter')
      assert.deepEqual(await selection(), [8, 10])
      await input.pressSequentially('9'); await input.press('Enter')
      assert.equal(await input.inputValue(), '2026-02-09', 'Enter pads a single-digit month/day')
      assert.equal(await page.locator('#stored').textContent(), '2026-02-09')
      await input.fill('2028/2/29'); await input.press('Enter')
      assert.equal(await input.inputValue(), '2028-02-29')
      assert.equal(await page.locator('#stored').textContent(), '2028-02-29')
      await input.fill('2026-02-29'); await input.press('Enter')
      assert.equal(await input.getAttribute('aria-invalid'), 'true')
      assert.equal(await page.locator('#stored').textContent(), '2028-02-29')
      const errorBounds = (await page.getByRole('alert').boundingBox())!
      assert.ok(errorBounds.x >= 0 && errorBounds.x + errorBounds.width <= page.viewportSize()!.width, 'date error remains in the viewport')
      await input.press('Escape')
      assert.equal(await input.inputValue(), '2028-02-29')
      assert.equal(await page.getByRole('region', { name: 'fixture' }).isVisible(), true)
      await input.fill('2026-10-15'); await input.press('Tab')
      await page.getByRole('button', { name: '달력 열기' }).click()
      const calendar = page.getByRole('dialog', { name: '날짜 선택' })
      await calendar.waitFor()
      assert.equal(await calendar.locator('[data-selected]').getAttribute('data-date'), '2026-10-15')
      assert.equal(await calendar.locator('[data-date="2026-10-15"]').evaluate(el => el === el.ownerDocument.activeElement), true)
      const bounds = (await calendar.boundingBox())!
      const viewport = page.viewportSize()!
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height)
      if (page === mobile) await page.locator('html').evaluate(el => el.classList.remove('dark'))
      await page.screenshot({ animations: 'disabled', path: `/tmp/mew-date-field/${page === desktop ? 'desktop-dark' : 'mobile-light'}.png` })
      await calendar.locator('[data-date="2026-10-15"]').press('ArrowRight')
      assert.equal(await calendar.locator('[data-date="2026-10-16"]').evaluate(el => el === el.ownerDocument.activeElement), true)
      assert.equal(await page.locator('#stored').textContent(), '2026-10-15', 'navigation does not save')
      await page.keyboard.press('PageDown')
      assert.equal(await calendar.locator('[data-date="2026-11-16"]').evaluate(el => el === el.ownerDocument.activeElement), true)
      await page.keyboard.press('Enter')
      assert.equal(await page.locator('#stored').textContent(), '2026-11-16')
      await calendar.waitFor({ state: 'hidden' })
      assert.equal(await page.getByRole('button', { name: '달력 열기' }).evaluate(el => el === el.ownerDocument.activeElement), true)
      await page.getByRole('button', { name: '달력 열기' }).click()
      await calendar.getByRole('button', { name: '이전 달' }).click()
      assert.equal(await calendar.getByRole('grid').getAttribute('aria-label'), '2026년 10월')
      await page.keyboard.press('Escape')
      await calendar.waitFor({ state: 'hidden' })
      assert.equal(await page.getByRole('region', { name: 'fixture' }).isVisible(), true, 'only calendar closes')
      await page.getByRole('button', { name: '달력 열기' }).click()
      await page.locator('#outside').click()
      await calendar.waitFor({ state: 'hidden' })
      await page.getByRole('button', { name: '달력 열기' }).click()
      await calendar.waitFor(); await page.goBack()
      await calendar.waitFor({ state: 'hidden' })
      assert.equal(await page.getByRole('region', { name: 'fixture' }).isVisible(), true, 'Back leaves task panel open')
      await page.getByRole('button', { name: '달력 열기' }).click()
      await calendar.getByRole('button', { name: '날짜 지우기' }).click()
      assert.equal(await input.inputValue(), '0000-00-00')
      assert.equal(await page.locator('#stored').textContent(), 'none')
      await page.getByRole('button', { name: '달력 열기' }).click()
      await calendar.getByRole('button', { name: '내일', exact: true }).click()
      assert.match((await input.inputValue()), /^\d{4}-\d{2}-\d{2}$/)
      await page.locator('#english').click()
      await page.getByRole('button', { name: 'Open calendar' }).click()
      assert.equal(await page.getByRole('dialog', { name: 'Choose date' }).getByRole('columnheader').first().textContent(), 'Sun')
      await page.locator('#readonly').click()
      assert.equal(await page.getByRole('button', { name: 'Open calendar' }).count(), 0)
      assert.equal(await page.getByRole('textbox').getAttribute('readonly'), '')
      assert.equal(await page.getByRole('dialog').count(), 0)
    }
    await mobile.reload(); await mobile.setViewportSize({ width: 320, height: 568 })
    await mobile.getByRole('button', { name: '달력 열기' }).click()
    const narrow = (await mobile.getByRole('dialog').boundingBox())!
    assert.ok(narrow.x >= 8 && narrow.x + narrow.width <= 312 && narrow.y + narrow.height <= 568)
    assert.equal(await mobile.locator('input[type=date],select,datalist').count(), 0)
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
