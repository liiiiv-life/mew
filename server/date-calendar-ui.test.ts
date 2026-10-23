import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('shared calendar edits date segments and keeps valid ranges on desktop and touch', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const source = `import React from 'react';import {createRoot} from 'react-dom/client';import {DateCalendar} from '@mew/ui';
function Fixture(){const [range,setRange]=React.useState(['2026-10-02','2026-10-10']),[readOnly,setReadOnly]=React.useState(false);
return <main style={{padding:12,width:300}}><button onClick={()=>setReadOnly(!readOnly)}>Read only</button><DateCalendar start={range[0]} end={range[1]} readOnly={readOnly} onChange={(start,end)=>setRange([start,end])}/><output>{JSON.stringify(range)}</output></main>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:calendar.tsx', write: false, platform: 'browser', output: { format: 'esm' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'calendar-fixture', resolveId(id) {
    if (id === 'virtual:calendar.tsx') return id
    if (id.endsWith('.css')) return 'virtual:style'
  }, load(id) { if (id === 'virtual:calendar.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const dateCss = (await Promise.all(['date-field.css','date-calendar.css'].map(name=>fs.readFile(path.join(root,'packages/ui/src',name),'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(path.join(root,'src/index.css'),'utf8'), { base: path.join(root,'src'), onDependency() {} })
  const css = compiler.build(['font-sans', ...Array.from(dateCss.matchAll(/--color-([a-z-]+)/g), match=>`bg-${match[1]}`)]) + dateCss
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100,390]) {
      const page = await browser.newPage({ viewport: { width,height:844 }, hasTouch: width<500, isMobile: width<500 })
      const errors: string[] = []; page.on('pageerror',error=>errors.push(error.message))
      await page.route('http://mew-calendar.test/**',route=>route.fulfill(route.request().url().endsWith('/app.js') ? { contentType:'text/javascript',body:chunk.code } : {contentType:'text/html',body:`<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>`}))
      await page.goto('http://mew-calendar.test/')
      const start = page.getByRole('textbox',{name:'시작일',exact:true}), end = page.getByRole('textbox',{name:'종료일',exact:true})
      await start.focus(); await start.press('End'); await start.pressSequentially('12')
      assert.equal(await page.locator('output').textContent(),'["2026-10-12","2026-10-12"]')
      await end.click({ position: { x:75,y:14 } })
      assert.deepEqual(await end.evaluate(el=>[el.selectionStart,el.selectionEnd]),[8,10])
      await end.pressSequentially('05')
      assert.equal(await page.locator('output').textContent(),'["2026-10-05","2026-10-05"]')
      await start.focus(); await start.press('Tab'); await start.pressSequentially('02'); await start.pressSequentially('30')
      assert.equal(await start.getAttribute('aria-invalid'),'true')
      assert.equal(await page.locator('output').textContent(),'["2026-02-05","2026-10-05"]')
      await start.press('Escape'); await start.press('Control+a'); await start.press('Backspace'); await start.press('Tab'); await start.press('Tab'); await start.press('Tab')
      assert.equal(await page.locator('output').textContent(),'[null,"2026-10-05"]')
      await page.getByRole('button',{name:'Read only'}).click()
      assert.equal(await end.getAttribute('readonly'),'')
      await end.press('Home'); await end.pressSequentially('2030')
      assert.equal(await page.locator('output').textContent(),'[null,"2026-10-05"]')
      assert.equal(await page.locator('[aria-label="달력 열기"]').count(),0)
      assert.deepEqual(errors,[])
      await page.close()
    }
  } finally { await browser.close() }
})
