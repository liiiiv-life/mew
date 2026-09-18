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

test('Mewcat notices fit desktop/mobile themes, open their target and resume roaming after dismissal', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  // In-memory fixture only: no app build, server, authenticated workspace or dist changes.
  const source = `
import React from '${require.resolve('react')}';
import {createRoot} from '${require.resolve('react-dom/client')}';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {Mewcat} from '${root}/src/components/Mewcat.tsx';
import {MewcatNotificationSettings} from '${root}/src/components/mewcat-notifications.tsx';
import {publishMewcatNotice,clearMewcatNotices} from '${root}/src/utils/mewcat-notifications.ts';
localStorage.setItem('mew:locale','ko');
Math.random=()=>0.7;
window.clearNotices=clearMewcatNotices;
window.notify=()=>publishMewcatNotice({key:'sample',kind:'memory',level:'warning',source:'95%',target:'system'});
window.addEventListener('mew:open-notification',event=>window.openedTarget=event.detail.target);
createRoot(document.getElementById('root')).render(<I18nProvider><div style={{padding:24,maxWidth:480}}><MewcatNotificationSettings/></div><Mewcat skin="mew"/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:mewcat.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:mewcat.tsx') return id }, load(id) { if (id === 'virtual:mewcat.tsx') return source } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')
  assert.ok(chunk && chunk.type === 'chunk')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const uiSource = await fs.readFile(`${root}/src/components/mewcat-notifications.tsx`, 'utf8')
  const css = compiler.build(uiSource.match(/[A-Za-z0-9_:[\]/.%!#()-]+/g) ?? [])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const mobile of [false, true]) for (const light of [false, true]) {
      const width = mobile ? 390 : 1280
      const page = await browser.newPage({ viewport: { width, height: mobile ? 844 : 800 }, hasTouch: mobile })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mewcat.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html ${light ? '' : 'class="dark"'}><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${chunk.code}</script></html>` }))
      await page.goto('http://mewcat.test/')
      await page.waitForSelector('.mewcat')
      await page.evaluate('window.notify()')
      const bubble = page.locator('.mewcat-notifications')
      await bubble.waitFor()
      const box = await bubble.boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.y >= 0)
      assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
      await page.screenshot({ path: `/tmp/mewcat-${mobile ? 'mobile' : 'desktop'}-${light ? 'light' : 'dark'}.png` })
      await page.getByRole('button', { name: '시스템 자원 보기', exact: true }).click()
      assert.equal(await page.evaluate('window.openedTarget'), 'system')
      await bubble.waitFor({ state: 'detached' })
      await page.waitForFunction("document.querySelector('.mewcat').dataset.activity === 'run'")
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
