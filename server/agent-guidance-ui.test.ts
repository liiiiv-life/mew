import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('common guidance opens by keyboard and recovers from errors on desktop and mobile', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React, {useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {AgentGuidanceFile} from '${root}/src/components/agent-guidance-file.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
function Fixture(){const [active,setActive]=useState(null);const [error,setError]=useState('');return <I18nProvider><aside style={{width:280}}><AgentGuidanceFile activePath={active} onOpen={p=>{window.opened=p;setActive('@fs:'+p)}} onError={setError}/><button className="flex w-full items-center gap-2 border-b border-edge px-2 py-1.5 text-left text-sm">Documents</button><p role="alert">{error}</p></aside></I18nProvider>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:guidance.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'fixture', resolveId(id) { if (id === 'virtual:guidance.tsx') return id }, load(id) { if (id === 'virtual:guidance.tsx') return source },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = await fs.readFile(`${root}/src/components/agent-guidance-file.tsx`, 'utf8')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, locale: 'ko-KR' })
      page.setDefaultTimeout(4000)
      let fail = true
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-guidance.test/**', async route => {
        const url = new URL(route.request().url())
        if (url.pathname === '/api/fs/agent-guidance') {
          await route.fulfill(fail ? { status: 403, body: '' } : { json: { path: '/data/agent-guidance.txt' } })
          return
        }
        await route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-guidance.test/')
      const button = page.getByRole('button', { name: '공통 에이전트 안내', exact: true })
      await button.focus()
      await page.keyboard.press('Enter')
      await page.getByRole('alert').filter({ hasText: '다시 시도' }).waitFor()
      assert.equal(await button.isEnabled(), true)
      fail = false
      await button.click()
      await page.waitForFunction('window.opened === "/data/agent-guidance.txt"')
      assert.equal(await button.getAttribute('aria-current'), 'page')
      await page.screenshot({ path: `/tmp/mew-agent-guidance-${width}.png` })
      assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
