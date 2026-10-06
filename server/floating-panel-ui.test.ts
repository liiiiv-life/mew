import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
const root = path.resolve(import.meta.dirname, '..'), require = createRequire(`${root}/package.json`)
test('popup modes preserve content, resize, move, restore and return to mobile panels', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const source = `import React,{useState,useRef} from '${require.resolve('react')}';
import {createRoot} from '${require.resolve('react-dom/client')}';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {DockWorkspace,DockPanel} from '${root}/src/components/DockWorkspace.tsx';
import {useToolPresentation,setToolPresentation} from '${root}/src/hooks/use-tool-presentation.ts';
function Fixture(){ const [state,setState]=useState(null),ref=useRef(null),modes=useToolPresentation(); return <div className="flex h-dvh flex-col bg-surface text-ink"><button onClick={()=>setToolPresentation('memo',modes.memo==='tab'?'popup':'tab')}>mode</button><DockWorkspace apiRef={ref} value={state} onChange={setState} foreground="memo" onEditorDrop={()=>'main'}><DockPanel id="editor:main" kind="editor" tabs={['a']}><div>editor</div></DockPanel><DockPanel id="memo" kind="memo" floating={modes.memo==='popup'} storageKey="fixture:popup" tabs={['memo']} mobileSelected><div data-dock-tab-bar className="flex h-9 shrink-0">메모</div><textarea className="min-h-0 flex-1" defaultValue="draft" /></DockPanel></DockWorkspace></div>};createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:fixture.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:fixture.tsx') return id; if(id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:fixture.tsx') return source; if(id==='virtual:style') return '' } }] })
  const content = source + await fs.readFile(`${root}/src/components/DockWorkspace.tsx`, 'utf8')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set(content.match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
    await page.route('http://fixture/**', route => route.fulfill(route.request().url().endsWith('/app.js') ? { contentType: 'text/javascript', body: bundle.output[0].code } : { contentType: 'text/html', body: `<html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` }))
    await page.addInitScript(() => localStorage.setItem('mew:locale', 'ko'))
    await page.goto('http://fixture/')
    const memo = page.locator('[data-dock-panel="memo"]')
    await memo.locator('textarea').fill('preserved draft')
    await page.getByRole('button', { name: 'mode', exact: true }).click()
    await page.locator('[data-floating-panel]').waitFor()
    assert.equal(await memo.locator('textarea').inputValue(), 'preserved draft')
    const before = (await memo.boundingBox())!
    const handle = memo.getByRole('button', { name: '위치 이동', exact: true })
    const box = (await handle.boundingBox())!
    await page.mouse.move(box.x + 30, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + 110, box.y + box.height / 2 + 50); await page.mouse.up()
    const moved = (await memo.boundingBox())!
    assert.ok(moved.x > before.x + 60 && moved.y > before.y + 30)
    await memo.getByRole('button', { name: '크기 조절', exact: true }).focus()
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown')
    const resized = (await memo.boundingBox())!
    assert.ok(resized.width > moved.width && resized.height > moved.height)
    const saved = await page.evaluate("localStorage.getItem('fixture:popup')")
    await page.reload(); await page.locator('[data-floating-panel]').waitFor()
    assert.deepEqual(await memo.boundingBox(), resized)
    await page.screenshot({ path: '/tmp/mew-popup-desktop.png' })
    await page.setViewportSize({ width: 390, height: 720 })
    await memo.evaluate(el => new Promise<void>(resolve => { const check = () => { if (!el.hasAttribute('data-floating-panel')) resolve(); else setTimeout(check, 10) }; check() }))
    assert.ok((await memo.boundingBox())!.width <= 390)
    assert.equal(await page.evaluate("localStorage.getItem('fixture:popup')"), saved)
    await page.screenshot({ path: '/tmp/mew-popup-mobile.png' })
    await page.setViewportSize({ width: 1100, height: 800 })
    await page.locator('[data-floating-panel]').waitFor()
    await page.getByRole('button', { name: 'mode', exact: true }).click()
    await memo.evaluate(el => new Promise<void>(resolve => { const check = () => { if (!el.hasAttribute('data-floating-panel')) resolve(); else setTimeout(check, 10) }; check() }))
    assert.equal(await memo.locator('textarea').inputValue(), 'draft')
  } finally { await browser.close() }
})
