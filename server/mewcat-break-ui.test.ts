import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(`${root}/package.json`)

test('giant cat breaks keep the workspace visible and usable outside painted paths, survive refresh, and end on expiry', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  // Route an isolated fixture; never build dist or start/restart the user's app.
  const source = `
import React from '${require.resolve('react')}';
import {createRoot} from '${require.resolve('react-dom/client')}';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {Mewcat} from '${root}/src/components/Mewcat.tsx';
import {MewcatBreakSettings} from '${root}/src/components/mewcat-break.tsx';
localStorage.setItem('mew:locale','ko');
window.focused=true;window.visible=true;window.keys=0;
Object.defineProperty(document,'hasFocus',{value:()=>window.focused});
Object.defineProperty(document,'visibilityState',{get:()=>window.visible?'visible':'hidden'});
window.addEventListener('keydown',()=>window.keys++);
createRoot(document.getElementById('root')).render(<I18nProvider><main style={{padding:24,maxWidth:480}}><input aria-label="문서" defaultValue="보존할 내용"/><MewcatBreakSettings/></main><Mewcat skin={null}/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:break.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:break.tsx') return id }, load(id) { if (id === 'virtual:break.tsx') return source } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')
  assert.ok(chunk && chunk.type === 'chunk')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const ui = await fs.readFile(`${root}/src/components/mewcat-break.tsx`, 'utf8')
  const css = compiler.build(ui.match(/[A-Za-z0-9_:[\]/.%!#()-]+/g) ?? [])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const mobile of [false, true]) for (const light of [false, true]) {
      const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1280, height: mobile ? 844 : 800 }, hasTouch: mobile })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.clock.install({ time: new Date('2026-09-18T00:00:00Z') })
      await page.route('http://mewcat-break.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html ${light ? '' : 'class="dark"'}><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${chunk.code}</script></html>` }))
      await page.goto('http://mewcat-break.test/')
      const toggle = page.getByRole('checkbox', { name: '강제 휴식 사용' })
      await toggle.waitFor()
      assert.equal(await toggle.isChecked(), false)
      await page.clock.runFor(65_000)
      assert.equal(await page.locator('[data-mewcat-break]').count(), 0)
      await toggle.check()
      await page.getByRole('spinbutton', { name: '사용 시간 분', exact: true }).fill('0')
      await page.getByRole('button', { name: '휴식 설정 저장' }).click()
      assert.match(await page.getByRole('alert').innerText(), /1분 이상/)
      await page.getByRole('spinbutton', { name: '사용 시간 분', exact: true }).fill('1')
      await page.getByRole('spinbutton', { name: '쉬는 시간 분', exact: true }).fill('1')
      await page.getByRole('button', { name: '휴식 설정 저장' }).click()
      await page.clock.runFor(30_000)
      await page.evaluate("window.focused=false;window.visible=false;window.dispatchEvent(new Event('blur'));document.dispatchEvent(new Event('visibilitychange'))")
      await page.clock.runFor(120_000)
      assert.equal(await page.locator('[data-mewcat-break]').count(), 0)
      await page.evaluate("window.focused=true;window.visible=true;window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'))")
      await page.getByRole('textbox', { name: '문서' }).focus()
      await page.clock.runFor(31_000)
      const layer = page.locator('[data-mewcat-break]')
      await layer.waitFor()
      await page.clock.runFor(1000)
      assert.equal(await page.evaluate("document.querySelector('[data-mewcat-break]').matches(':popover-open')"), true)
      assert.equal(await page.evaluate("document.activeElement.getAttribute('aria-label')"), '문서')
      await page.evaluate('window.keys=0')
      await page.keyboard.press('Escape')
      assert.equal(await layer.isVisible(), true)
      assert.equal(await page.evaluate('window.keys'), 1)
      // Top-left input remains visible and pointer-accessible even though the giant cat covers the middle.
      await page.getByRole('textbox', { name: '문서' }).click()
      await page.getByRole('textbox', { name: '문서' }).fill('휴식 중 입력')
      assert.equal(await page.getByRole('textbox', { name: '문서' }).inputValue(), '휴식 중 입력')
      assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-mewcat-break]')).backgroundColor"), 'rgba(0, 0, 0, 0)')
      assert.equal(await page.locator(':modal').count(), 0)
      // Fake JS timers do not advance compositor animations; finish the entrance before measuring it.
      await page.evaluate('document.getAnimations().forEach(animation => animation.finish())')
      const cat = await page.locator('.mewcat-break-cat').boundingBox()
      const graphic = await page.locator('.mewcat-break-cat svg').boundingBox()
      assert.ok(cat && graphic && graphic.width >= cat.width * .99)
      assert.ok(cat && cat.width > (mobile ? 390 : 800))
      assert.equal(await page.evaluate(`(() => {
        const svg = document.querySelector('.mewcat-break-cat svg')
        const box = svg.getBoundingClientRect()
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        return !!hit?.closest('.mewcat-break-cat')
      })()`), true)
      assert.equal(await page.evaluate(`(() => {
        const box = document.querySelector('.mewcat-break-cat svg').getBoundingClientRect()
        const hit = document.elementFromPoint(box.x + box.width / 2, Math.max(2, box.y + box.height * 2 / 48))
        return !!hit?.closest('.mewcat-break-cat')
      })()`), false)
      await page.screenshot({ path: `/tmp/mewcat-break-${mobile ? 'mobile' : 'desktop'}-${light ? 'light' : 'dark'}.png` })
      await page.reload()
      await layer.waitFor()
      await page.clock.runFor(1000)
      assert.equal(await page.evaluate("document.querySelector('[data-mewcat-break]').matches(':popover-open')"), true)
      await page.evaluate("window.focused=false;window.dispatchEvent(new Event('blur'))")
      await page.clock.runFor(61_000)
      assert.equal(await page.locator('[data-mewcat-break]').count(), 0)
      assert.equal(await toggle.isChecked(), true)
      await page.getByRole('textbox', { name: '문서' }).fill('계속 작업')
      assert.equal(await page.getByRole('textbox', { name: '문서' }).inputValue(), '계속 작업')
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
