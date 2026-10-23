import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
test('install logs update before completion, retain errors and fit desktop/mobile', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {RuntimeInstallProgress} from '${root}/src/components/RuntimeInstallProgress.tsx';
import {subscribeAgentRuntimes} from '${root}/src/utils/agentPickerCache.ts';
function Fixture(){const [status,setStatus]=React.useState({installing:true});React.useEffect(()=>subscribeAgentRuntimes(items=>setStatus(items[0])),[]);return <RuntimeInstallProgress runtimeId="fixture" busy={status.installing} installation={status.installation}/>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:fixture.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'fixture', resolveId(id) { if (id === 'virtual:fixture.tsx') return id }, load(id) { if (id === 'virtual:fixture.tsx') return source },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const content = await fs.readFile(`${root}/src/components/RuntimeInstallProgress.tsx`, 'utf8')
  const css = compiler.build(content.match(/[A-Za-z0-9_:[\]./!%#()-]+/g) ?? [])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), headless: true, args: ['--no-sandbox'] })
  try {
    for (const [width, dark] of [[1100, true], [390, false]] as const) {
      const page = await browser.newPage({ viewport: { width, height: 700 } })
      let state = 'running', output = 'downloading\n', polls = 0
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-install.test/**', route => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (pathname === '/api/agent-runtimes') {
          polls++
          return route.fulfill({ json: { runtimes: [{ id: 'fixture', installing: state === 'running', installation: { state, output } }] } })
        }
        return route.fulfill({ contentType: 'text/html', body: `<html class="${dark ? 'dark' : ''}"><head><meta charset="utf-8"><style>${css}body{margin:0;padding:8px}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>` })
      })
      await page.goto('http://mew-install.test/')
      const log = page.locator('pre')
      await log.getByText('downloading', { exact: true }).waitFor()
      assert.equal(await page.getByRole('status').textContent(), '설치 중…')
      output += Array.from({ length: 80 }, (_, i) => `extracting ${i} ${'x'.repeat(120)}`).join('\n')
      await page.getByText(/extracting 79/).waitFor()
      assert.ok(await log.evaluate(el => el.scrollTop > 0), 'new logs follow the bottom')
      await log.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new el.ownerDocument.defaultView!.Event('scroll')) })
      output += '\nmore output'
      await page.getByText(/more output/).waitFor()
      assert.equal(await log.evaluate(el => el.scrollTop), 0, 'reading older logs preserves the scroll position')
      state = 'failed'; output += '\nfixture failed'
      await page.getByRole('status').getByText('실패', { exact: true }).waitFor()
      assert.match(await log.textContent() ?? '', /fixture failed/)
      assert.ok(await log.evaluate(el => el.getBoundingClientRect().height <= 161))
      assert.ok(await log.evaluate(el => el.ownerDocument.documentElement.scrollWidth <= el.ownerDocument.documentElement.clientWidth))
      const finalPolls = polls
      await page.waitForTimeout(1100)
      assert.equal(polls, finalPolls, 'polling stops after completion')
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
