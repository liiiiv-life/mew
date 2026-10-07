import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
test('layout presets apply, save, reject duplicates, replace/reset/delete and restore with keyboard menus and themed SVGs', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {useTabs} from '${root}/src/hooks/useTabs.ts';
import {LayoutPresets} from '${root}/src/components/layout-presets.tsx';
import {factoryLayout,normalizeLayoutSnapshot,layoutPresetsKey,legacyLayoutPresetsKey} from '${root}/src/utils/layout-presets.ts';
const factory=factoryLayout(normalizeLayoutSnapshot({version:1,dock:{version:1,groups:[{id:'editor:main',kind:'editor'}],tree:{id:'editor:main'}}}));
function Fixture(){const editor=useTabs('.workspace',()=>{},()=>{},'/fixture');window.editor={panes:editor.panes,hydrated:editor.hydrated};window.openDocument=editor.openFile;window.splitDocument=()=>editor.splitEmptyPane(editor.panes[0].id,'right');window.editDocument=()=>editor.updateTabContent('b.md','DRAFT');window.restoreEditor=editor.restoreEditorPanes;const [current,setCurrent]=React.useState(factory),[scope,setScope]=React.useState('alpha'),[account,setAccount]=React.useState('first');window.otherAccount=()=>setAccount('second');window.custom=()=>setCurrent({...factory,sidebarWidth:320});window.other=()=>setScope('beta');window.actions=[];window.current=current;return <header className="flex h-12 items-center justify-end gap-2 p-2"><div className="hidden md:block"><LayoutPresets key={account+scope} storageKey={layoutPresetsKey(account)} legacyStorageKey={legacyLayoutPresetsKey(account,scope)} factory={factory} capture={()=>current} onApply={next=>{window.applied=next;setCurrent(next)}}/></div><button>Menu</button></header>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:presets.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:presets.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:presets.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const content = await fs.readFile(`${root}/src/components/layout-presets.tsx`, 'utf8')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const code = bundle.output.find(item => item.type === 'chunk')!.code
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
    page.setDefaultTimeout(3000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript("localStorage.setItem('mew:locale','ko')")
    await page.route('http://mew-layout.test/**', route => new URL(route.request().url()).pathname.startsWith('/api/') ? route.fulfill({ json: { content: 'ORIGINAL', editable: true, patterns: [], rules: {}, status: 'saved' } }) : route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><style>${css}</style><div id="root"></div><script>${code}</script></html>` }))
    await page.goto('http://mew-layout.test/')
    await page.waitForFunction('window.editor.hydrated')
    await page.evaluate("window.openDocument('a.md')")
    await page.waitForFunction("window.editor.panes[0].tabs.some(tab => tab.path === 'a.md' && tab.content === 'ORIGINAL')")
    await page.evaluate('window.splitDocument()')
    await page.waitForFunction('window.editor.panes.length === 2')
    await page.evaluate("window.openDocument('b.md')")
    await page.waitForFunction("window.editor.panes[1].tabs.some(tab => tab.path === 'b.md' && tab.content === 'ORIGINAL')")
    await page.evaluate("window.editDocument();window.restoreEditor(['main'])")
    await page.waitForFunction('window.editor.panes.length === 1')
    const documents = await page.evaluate('window.editor.panes[0].tabs.map(tab => ({path:tab.path,content:tab.content}))')
    assert.deepEqual(documents, [{ path: 'a.md', content: 'ORIGINAL' }, { path: 'b.md', content: 'DRAFT' }], 'merging editor panes retains opened documents and drafts')
    await page.evaluate("window.restoreEditor(['main','saved-split'])")
    await page.waitForFunction("window.editor.panes.some(pane => pane.id === 'saved-split')")
    const trigger = page.getByRole('button', { name: '레이아웃', exact: true })
    const dialog = page.getByRole('dialog', { name: '레이아웃' })
    const add = () => dialog.getByRole('button', { name: '현재 배치 추가' })
    const preset = (name: string) => dialog.getByRole('button', { name, exact: true })
    const context = (name: string) => preset(name).click({ button: 'right' })
    await trigger.click()
    assert.equal(await dialog.locator('[data-layout-preset]').count(), 3)
    assert.equal(await preset('기본값').getAttribute('aria-pressed'), 'true')
    const icons = await dialog.locator('[data-layout-preset] svg').evaluateAll(elements => elements.map(el => el.innerHTML))
    assert.equal(new Set(icons).size, 3)
    await add().click()
    assert.equal(await page.getByRole('status').textContent(), '같은 배치의 프리셋이 이미 있습니다.')
    assert.equal(await dialog.locator('[data-layout-preset]').count(), 3)
    await page.evaluate('window.custom()')
    await page.waitForFunction('window.current.sidebarWidth === 320')
    await add().click()
    await preset('프리셋 3').waitFor()
    assert.equal(await dialog.locator('[data-layout-preset]').count(), 4)
    const customIcon = await preset('프리셋 3').locator('svg').innerHTML()
    assert.notEqual(customIcon, icons[0])
    await preset('프리셋 1').click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate('window.applied.open.terminal'), false)
    await trigger.click(); await context('프리셋 2')
    assert.equal(await page.getByRole('menuitem').count(), 4)
    await page.getByRole('menuitem', { name: '현재 상태로 설정' }).click()
    assert.equal(await dialog.locator('[data-layout-preset]').count(), 4)
    await page.getByRole('status').waitFor()
    assert.equal(await page.getByRole('status').count(), 1, 'replacement rejects another saved layout')
    await context('프리셋 2'); await page.getByRole('menuitem', { name: 'mew 자체 기본값' }).click()
    await page.getByRole('status').waitFor()
    assert.equal(await page.getByRole('status').count(), 1, 'factory reset also rejects duplicates')
    await context('기본값'); await page.getByRole('menuitem', { name: '프리셋 삭제' }).click()
    assert.equal(await dialog.locator('[data-layout-preset]').count(), 3)
    await context('프리셋 2'); await page.getByRole('menuitem', { name: 'mew 자체 기본값' }).click()
    assert.equal(await preset('프리셋 2').locator('svg').innerHTML(), icons[0], 'factory replacement regenerates SVG')
    await page.evaluate('window.custom()')
    await page.waitForFunction('window.current.sidebarWidth === 320')
    await context('프리셋 1'); await page.getByRole('menuitem', { name: '현재 상태로 설정' }).click()
    await page.getByRole('status').waitFor()
    assert.equal(await page.getByRole('status').count(), 1)
    await context('프리셋 3'); await page.getByRole('menuitem', { name: '프리셋 삭제' }).click()
    await context('프리셋 1'); await page.getByRole('menuitem', { name: '현재 상태로 설정' }).click()
    assert.equal(await preset('프리셋 1').locator('svg').innerHTML(), customIcon, 'current replacement regenerates SVG')
    await preset('프리셋 1').focus(); await page.keyboard.press('Shift+F10')
    await page.getByRole('menu').waitFor()
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown')
    assert.equal(await page.getByRole('menuitem', { name: '현재 상태로 설정' }).evaluate(el => el === el.ownerDocument.activeElement), true)
    await page.keyboard.press('Escape'); await page.getByRole('menu').waitFor({ state: 'hidden' })
    assert.equal(await dialog.isVisible(), true, 'Esc closes the context menu first')
    assert.equal(await preset('프리셋 1').evaluate(el => el === el.ownerDocument.activeElement), true)
    await context('프리셋 1'); await page.getByRole('menuitem', { name: '이름 변경', exact: true }).click()
    const name = page.getByRole('textbox', { name: '레이아웃 이름' })
    await name.fill('취소할 이름'); await page.keyboard.press('Escape')
    assert.equal(await preset('프리셋 1').isVisible(), true)
    assert.equal(await preset('프리셋 1').evaluate(el => el === el.ownerDocument.activeElement), true)
    await context('프리셋 1'); await page.getByRole('menuitem', { name: '이름 변경', exact: true }).click()
    await name.fill(' 개발 화면 '); await page.keyboard.press('Enter')
    await preset('개발 화면').waitFor()
    for (const dark of [true, false]) {
      await page.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`)
      await page.screenshot({ path: `/tmp/mew-layout-presets-${dark ? 'dark' : 'light'}.png` })
      const bounds = (await dialog.boundingBox())!
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 1100)
    }
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
    assert.equal(await trigger.evaluate(el => el === el.ownerDocument.activeElement), true)
    await page.reload(); await trigger.click()
    assert.equal(await dialog.locator('[data-layout-preset]').count(), 2)
    assert.equal(await preset('개발 화면').locator('svg').innerHTML(), customIcon)
    await page.evaluate('window.other()'); await dialog.waitFor({ state: 'hidden' }); await trigger.click()
    assert.equal(await dialog.locator('[data-layout-preset]').count(), 2, 'another project shares the account presets')
    await preset('개발 화면').waitFor()
    await page.evaluate('window.otherAccount()'); await dialog.waitFor({ state: 'hidden' }); await trigger.click()
    assert.equal(await dialog.locator('[data-layout-preset]').count(), 3, 'another account has independent defaults')
    await page.setViewportSize({ width: 768, height: 500 }); await dialog.waitFor({ state: 'hidden' }); await trigger.click()
    const bounds = (await dialog.boundingBox())!
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 768)
    await page.setViewportSize({ width: 390, height: 700 })
    assert.equal(await trigger.isVisible(), false, 'mobile has no layout control')
    await dialog.waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
