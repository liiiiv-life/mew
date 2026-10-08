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

test('startup fullscreen guide fits desktop/mobile, uses client OS, retries failures and returns on reload', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const source = `
import React from '${require.resolve('react')}';
import {createRoot} from '${require.resolve('react-dom/client')}';
import {I18nProvider,useI18n} from '${root}/src/i18n.tsx';
import {Mewcat} from '${root}/src/components/Mewcat.tsx';
localStorage.setItem('mew:locale','ko');
const query=new URLSearchParams(location.search);
Object.defineProperty(navigator,'platform',{value:query.get('mac')?'MacIntel':'Linux x86_64'});
Object.defineProperty(document,'fullscreenEnabled',{value:!query.has('unsupported')});
window.failFullscreen=true;
document.documentElement.requestFullscreen=async()=>{
  window.requests=(window.requests||0)+1;
  if(window.failFullscreen)throw new Error('blocked');
  Object.defineProperty(document,'fullscreenElement',{value:document.documentElement,configurable:true});
  document.dispatchEvent(new Event('fullscreenchange'));
};
window.exitFullscreen=()=>{
  Object.defineProperty(document,'fullscreenElement',{value:null,configurable:true});
  document.dispatchEvent(new Event('fullscreenchange'));
};
function Fixture(){window.setLocale=useI18n().setLocale;return <Mewcat skin={query.has('noCat')?null:'mew'}/>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:guide.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:guide.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:guide.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')
  assert.ok(chunk && chunk.type === 'chunk')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const ui = await fs.readFile(`${root}/src/components/mewcat-fullscreen-guide.tsx`, 'utf8')
  const css = compiler.build(ui.match(/[A-Za-z0-9_:[\]/.%!#()-]+/g) ?? [])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const mobile of [false, true]) {
      const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1100, height: 780 }, hasTouch: mobile })
      page.setDefaultTimeout(4000)
      await page.route('http://guide.test/**', route => route.fulfill({ contentType: 'text/html', body: `<html class="${mobile ? '' : 'dark'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${chunk.code}</script></html>` }))
      await page.goto(`http://guide.test/${mobile ? '?mac=1' : ''}`)
      const guide = page.locator('aside.mewcat-notifications')
      const action = guide.getByRole('button', { name: `전체화면으로 전환 (${mobile ? 'Option' : 'Alt'}+Enter)`, exact: true })
      await action.waitFor({ state: 'visible' })
      const box = await guide.boundingBox()
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= (mobile ? 390 : 1100) && box.y + box.height <= 780)
      assert.equal(await guide.evaluate(el => el.scrollWidth <= el.clientWidth), true)
      await page.screenshot({ path: `/tmp/mewcat-fullscreen-guide-${mobile ? 'mobile-light' : 'desktop-dark'}.png` })
      await action.click()
      await guide.getByRole('alert').waitFor()
      assert.equal(await action.isEnabled(), true)
      await page.evaluate('window.failFullscreen=false')
      await action.click()
      await guide.waitFor({ state: 'detached' })
      assert.equal(await page.evaluate('window.requests'), 2)
      await page.evaluate('window.exitFullscreen()')
      assert.equal(await guide.count(), 0, 'fullscreen exit does not repeat the startup guide')
      await page.reload()
      await action.waitFor({ state: 'visible' })
      await guide.getByRole('button', { name: '알림 닫기' }).click()
      await guide.waitFor({ state: 'detached' })
      await page.reload()
      await action.waitFor({ state: 'visible' })
      await page.evaluate("window.setLocale('en')")
      await guide.getByText('Use full screen so mew shortcuts work reliably.').waitFor()
      await page.goto('http://guide.test/?noCat=1')
      await guide.waitFor({ state: 'visible' })
      await page.goto('http://guide.test/?unsupported=1')
      await page.locator('.mewcat').waitFor()
      assert.equal(await guide.count(), 0)
      await page.close()
    }
  } finally { await browser.close() }
})
