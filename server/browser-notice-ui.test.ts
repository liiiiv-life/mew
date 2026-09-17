import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('browser status uses a spinner and bottom toasts without resizing the page', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React,{useState} from '${root}/node_modules/react/index.js';
    import {createRoot} from '${root}/node_modules/react-dom/client.js';
    import {I18nProvider} from '${root}/src/i18n.tsx';
    import {ServerDomBrowser} from '${root}/src/components/server-dom-browser.tsx';
    function Fixture(){const [message,setMessage]=useState(null);window.setNotice=setMessage;
      return <I18nProvider><div className="flex h-dvh flex-col"><ServerDomBrowser streamUrl="/stream" notice={message?{message,onDismiss:()=>setMessage(null)}:undefined} reopen={async()=>{window.retries=(window.retries||0)+1;if(window.failRetry)throw Error('failed');return '/stream'}}/></div></I18nProvider>}
    createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:fixture.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture',
    resolveId(id) { if (id === 'virtual:fixture.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' },
    load(id) {
      if (id === 'virtual:fixture.tsx') return source
      if (id === 'virtual:style') return ''
      if (id.endsWith('/browser-dom-view.ts')) return `export function mountDomBrowser(root,url,report){window.publish=report;report({state:'connecting'});return Object.assign(()=>{},{command:()=>{}})}`
    },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['server-dom-browser.tsx', 'browser-notice.tsx'].map(file => fs.readFile(`${root}/src/components/${file}`, 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } })
      page.setDefaultTimeout(5000)
      await page.addInitScript("localStorage.setItem('mew:locale','ko')")
      await page.route('http://localhost:48976/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><div id="root"></div><script>${chunk.type === 'chunk' ? chunk.code : ''}</script></body></html>` }))
      await page.goto('http://localhost:48976/')
      await page.getByLabel('페이지 불러오는 중').waitFor()
      assert.equal(await page.getByText('페이지 여는 중…').count(), 0)
      assert.equal(await page.getByRole('status').count(), 0)
      const area = await page.locator('.mew-dom-browser').boundingBox()
      assert.ok(area && area.height === 844)
      await page.evaluate("window.publish({state:'error',message:'페이지를 불러오지 못했습니다. 주소와 네트워크를 확인해 주세요.'})")
      const toast = page.getByRole('status')
      await toast.waitFor()
      assert.equal(await page.getByLabel('페이지 불러오는 중').count(), 0)
      assert.deepEqual(await page.locator('.mew-dom-browser').boundingBox(), area)
      const box = await toast.boundingBox()
      assert.ok(box && box.y > 600 && box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 844)
      if (process.env.MEW_UI_SCREENSHOT_DIR) {
        await fs.mkdir(process.env.MEW_UI_SCREENSHOT_DIR, { recursive: true })
        await page.screenshot({ path: path.join(process.env.MEW_UI_SCREENSHOT_DIR, `browser-notice-${width}.png`) })
      }
      await page.evaluate('window.failRetry=true')
      await page.getByRole('button', { name: '다시 연결', exact: true }).click()
      await page.getByText('다시 연결하지 못했습니다. 주소를 확인하고 다시 시도해 주세요.').waitFor()
      await page.evaluate('window.failRetry=false')
      await page.getByRole('button', { name: '다시 연결', exact: true }).click()
      await toast.waitFor({ state: 'hidden' })
      assert.equal(await page.evaluate('window.retries'), 2)
      await page.getByLabel('페이지 불러오는 중').waitFor()
      await page.evaluate("window.publish({state:'ready',message:'파일당 8 MB, 최대 4개까지 선택할 수 있습니다.'})")
      await toast.waitFor()
      await page.getByRole('button', { name: '닫기', exact: true }).click()
      await page.evaluate("window.publish({state:'ready',message:'파일당 8 MB, 최대 4개까지 선택할 수 있습니다.'})")
      assert.equal(await toast.count(), 0, 'periodic identical status must not reopen a dismissed notice')
      await page.clock.install()
      await page.evaluate("window.setNotice('올바른 주소를 입력해 주세요.')")
      await toast.waitFor()
      await page.clock.fastForward(6100)
      await toast.waitFor({ state: 'hidden' })
      await page.close()
    }
  } finally { await browser.close() }
})
