import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
test('quota battery displays shortest headroom in desktop/mobile themes, coalesces reads, and keeps unknown distinct', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {AgentQuotaBattery} from '${root}/src/components/AgentQuotaBattery.tsx';
window.renderBattery=(runtime,account='test')=>root.render(React.createElement(I18nProvider,null,React.createElement('div',{className:'flex gap-1 bg-surface p-3'},[0,1].map(key=>React.createElement(AgentQuotaBattery,{key,runtime,account,enabled:true})))));
const root=createRoot(document.getElementById('root')); window.renderBattery('codex');`
  const bundle = await build({ input: 'virtual:quota', platform: 'browser', write: false, output: { format: 'esm' }, transform: { jsx: 'react-jsx' }, plugins: [{ name: 'quota-fixture', resolveId(id) { if (id === 'virtual:quota') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:quota') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const content = source + await fs.readFile(`${root}/src/components/AgentQuotaBattery.tsx`, 'utf8')
  const css = compiler.build([...new Set(content.match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 600 } })
      page.setDefaultTimeout(4000)
      let reads = 0, unavailable = false
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(() => localStorage.setItem('mew:locale', 'ko'))
      await page.route('http://mew-quota.test/**', route => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (pathname.startsWith('/api/agent-runtimes/')) {
          reads++
          const runtime = pathname.split('/')[3]
          const quota = unavailable ? [] : runtime === 'codex' ? [{ remainingPercent: 28, windowMinutes: 10080, resetsAt: null }]
            : runtime === 'claude' ? [{ remainingPercent: 0, windowMinutes: 300, resetsAt: null }, { remainingPercent: 90, windowMinutes: 10080, resetsAt: null }]
            : runtime === 'kimi' ? [{ remainingPercent: 99.8, windowMinutes: 300, resetsAt: null }] : []
          return route.fulfill({ json: { account: { runtime, quota } } })
        }
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="${width === 1100 ? 'dark' : ''}"><meta charset="utf-8"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-quota.test/')
      await page.getByRole('meter', { name: '구독 한도 1주 · 28% 남음' }).first().waitFor()
      assert.equal(reads, 1, 'multiple panels share one read')
      const meter = page.getByRole('meter').first()
      assert.equal(await meter.innerText(), '28')
      const bounds = await meter.boundingBox()
      assert.equal(bounds?.width, 40)
      assert.equal(bounds?.height, 20)
      assert.ok(await meter.evaluate(el => parseFloat(el.ownerDocument.defaultView!.getComputedStyle(el).borderRadius) >= 10))
      const fill = meter.locator('span').first()
      assert.ok(Math.abs((await fill.boundingBox())!.width / (bounds!.width - 2) * 100 - 28) < 1)
      await meter.click()
      const popup = page.getByRole('dialog', { name: '전체 구독 한도' })
      await popup.waitFor()
      assert.equal(await popup.getByText('28%', { exact: true }).isVisible(), true)
      const popupBounds = (await popup.boundingBox())!
      assert.ok(popupBounds.y > bounds!.y + bounds!.height)
      assert.ok(popupBounds.x >= 0 && popupBounds.x + popupBounds.width <= width)
      await page.screenshot({ path: path.join(os.tmpdir(), `mew-quota-popup-${width}.png`) })
      await page.keyboard.press('Escape')
      await popup.waitFor({ state: 'hidden' })
      await page.evaluate("window.renderBattery('claude')")
      await page.getByRole('meter', { name: '구독 한도 5시간 · 0% 남음' }).first().waitFor()
      assert.equal(await page.getByRole('meter').first().innerText(), '0')
      await page.getByRole('meter').first().click()
      await popup.waitFor()
      assert.equal(await popup.getByText('0%', { exact: true }).isVisible(), true)
      assert.equal(await popup.getByText('90%', { exact: true }).isVisible(), true)
      await page.getByRole('meter').first().click()
      await popup.waitFor({ state: 'hidden' })
      await page.getByRole('meter').first().click()
      await popup.waitFor()
      await page.mouse.click(width - 4, 550)
      await popup.waitFor({ state: 'hidden' })
      await page.evaluate("window.renderBattery('kimi')")
      await page.getByRole('meter', { name: '구독 한도 5시간 · 99% 남음' }).first().waitFor()
      await page.evaluate("window.renderBattery('codex','different-user')")
      await page.getByRole('meter', { name: '구독 한도 1주 · 28% 남음' }).first().waitFor()
      assert.equal(reads, 4, 'account switch uses a separate cache')
      unavailable = true
      await page.evaluate("window.renderBattery('codex','unknown')")
      await page.getByRole('img', { name: '구독 잔여량을 확인할 수 없음' }).first().waitFor()
      assert.equal(await page.getByRole('img').first().innerText(), '—')
      await page.evaluate("window.renderBattery('cursor')")
      assert.equal(await page.getByRole('meter').count(), 0)
      assert.equal(await page.getByRole('img').count(), 0)
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
