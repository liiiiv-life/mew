import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('browser start page opens only requested URLs, closes the last tab and retains shortcuts', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const source = `import React,{useState} from '${root}/node_modules/react/index.js';
    import {createRoot} from '${root}/node_modules/react-dom/client.js';
    import {I18nProvider} from '${root}/src/i18n.tsx';
    import {BrowserPanel} from '${root}/src/components/BrowserPanel.tsx';
    import {DockWorkspace} from '${root}/src/components/DockWorkspace.tsx';
    const panel=<BrowserPanel onClose={()=>{}}/>;
    function Fixture(){const [state,setState]=useState(null);return <I18nProvider><div className="flex h-dvh flex-col bg-surface-deep text-ink">{location.search.includes('dock')?<DockWorkspace value={state} onChange={setState} foreground="browser">{panel}</DockWorkspace>:panel}</div></I18nProvider>}
    createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:fixture.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture',
    resolveId(id) { if (id === 'virtual:fixture.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' },
    load(id) {
      if (id === 'virtual:fixture.tsx') return source
      if (id === 'virtual:style') return ''
      if (id.endsWith('/server-dom-browser.tsx')) return `import React from '${root}/node_modules/react/index.js';export function ServerDomBrowser({streamUrl}){return <div data-page={streamUrl} className="flex-1">Page</div>}`
    },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const targets = ['BrowserPanel.tsx', 'browser-start-page.tsx', 'DockWorkspace.tsx']
  const content = (await Promise.all(targets.map(file => fs.readFile(`${root}/src/components/${file}`, 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const mode of ['standalone', 'dock']) {
      const context = await browser.newContext({ viewport: { width: 1100, height: 850 } })
      const page = await context.newPage()
      page.setDefaultTimeout(5000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      let tabs: { id: string; url: string; title: string; streamUrl: string }[] = []
      const opened: string[] = []
      await page.addInitScript("localStorage.setItem('mew:locale','ko')")
      await page.route('http://localhost:48975/**', async route => {
        const url = new URL(route.request().url()), method = route.request().method()
        if (url.pathname === '/api/browser-dom/tabs') {
          if (method === 'GET') return route.fulfill({ json: tabs })
          const { id, url: target } = route.request().postDataJSON()
          opened.push(target)
          const tab = { id, url: target, title: new URL(target).host, streamUrl: `/stream/${id}` }
          tabs.push(tab)
          return route.fulfill({ json: tab })
        }
        if (method === 'DELETE') { tabs = tabs.filter(tab => !url.pathname.endsWith(tab.id)); return route.fulfill({ json: { ok: true } }) }
        return route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.type === 'chunk' ? chunk.code : '' } : { contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><div id="root"></div><script src="/app.js"></script></body></html>` })
      })
      await page.goto(`http://localhost:48975/?${mode}`)
      await page.getByRole('button', { name: 'liiiiv-life dev', exact: true }).waitFor()
      assert.deepEqual(opened, [], 'opening the panel must not start localhost:3100')
      assert.equal(await page.getByRole('tab').count(), 0)
      await page.getByRole('textbox', { name: '주소', exact: true }).fill('javascript:alert(1)')
      await page.getByRole('button', { name: '이동', exact: true }).click()
      await page.getByRole('alert').waitFor()
      assert.deepEqual(opened, [])
      await page.getByRole('button', { name: 'liiiiv-life dev', exact: true }).click()
      await page.locator('[data-page]').waitFor()
      assert.deepEqual(opened, ['http://localhost:3000/'])
      await page.getByRole('button', { name: '탭 닫기', exact: true }).click()
      await page.getByRole('button', { name: 'liiiiv-life dev', exact: true }).waitFor()
      assert.equal(tabs.length, 0)
      await page.getByRole('button', { name: '바로가기 추가', exact: true }).click()
      await page.getByRole('textbox', { name: '바로가기 이름' }).fill('Docs')
      await page.getByRole('textbox', { name: '주소', exact: true }).last().fill('example.com/docs')
      await page.getByRole('button', { name: '저장', exact: true }).click()
      await page.reload()
      await page.getByRole('button', { name: 'Docs', exact: true }).waitFor()
      if (process.env.MEW_UI_SCREENSHOT_DIR) {
        await fs.mkdir(process.env.MEW_UI_SCREENSHOT_DIR, { recursive: true })
        await page.screenshot({ path: path.join(process.env.MEW_UI_SCREENSHOT_DIR, `${mode}-desktop.png`) })
      }
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('textbox', { name: '주소', exact: true }).waitFor()
      assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
      if (process.env.MEW_UI_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.MEW_UI_SCREENSHOT_DIR, `${mode}-mobile.png`) })
      await page.getByRole('button', { name: 'Docs', exact: true }).click()
      await page.locator('[data-page]').waitFor()
      assert.equal(opened.at(-1), 'https://example.com/docs')
      await page.getByRole('button', { name: '새 탭', exact: true }).click()
      await page.getByRole('textbox', { name: '주소', exact: true }).waitFor()
      assert.equal(opened.length, 2, 'new tabs stay local until an address is submitted')
      await page.getByRole('textbox', { name: '주소', exact: true }).fill('localhost:4000')
      await page.getByRole('button', { name: '이동', exact: true }).click()
      await page.waitForFunction('document.querySelectorAll("[data-page]").length === 2')
      assert.equal(opened.at(-1), 'http://localhost:4000/')
      await page.reload()
      await page.locator('[data-page]').first().waitFor()
      assert.equal(opened.length, 3, 'restoring existing tabs does not open another page')
      while (await page.getByRole('button', { name: '탭 닫기', exact: true }).count()) {
        await page.getByRole('button', { name: '탭 닫기', exact: true }).first().click()
        await page.waitForFunction('document.querySelectorAll("[role=tab]").length === ' + tabs.length)
      }
      await page.getByRole('button', { name: 'liiiiv-life dev 바로가기 삭제', exact: true }).click()
      await page.getByRole('button', { name: 'Docs 바로가기 삭제', exact: true }).click()
      await page.reload()
      await page.getByRole('textbox', { name: '주소', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'liiiiv-life dev', exact: true }).count(), 0, 'deleted defaults stay deleted')
      assert.deepEqual(errors, [])
      await context.close()
    }
  } finally { await browser.close() }
})
