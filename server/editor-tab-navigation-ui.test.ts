import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('editor floating navigation follows tab-local links and modified clicks open fresh tabs', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const files: Record<string, string> = {
    'one.md': '# One\n\n[Four](./nested/four.md)\n\n[Child](./children/Child/_Child.md)',
    'two.md': '# Two', 'three.md': '# Three',
    'nested/four.md': '# Four\n\n[Five](./five.md)\n\n[Branch](./branch.md)\n\n[Origin](../one.md)',
    'nested/five.md': '# Five', 'nested/branch.md': '# Branch',
    'children/Child/_Child.md': '# Child\n\n[Six](../../six.md)', 'six.md': '# Six',
  }
  const source = `import React from 'react';import {createRoot} from 'react-dom/client';
import {EditorPane} from '${root}/src/components/EditorPane.tsx';
import {useTabs} from '${root}/src/hooks/useTabs.ts';
import {I18nProvider} from '${root}/src/i18n.tsx';
const noop=()=>{}, stored={docs:{unifiedScopes:true,panes:[{id:'main',activePath:'one.md',tabs:['one.md','two.md','three.md'].map(path=>({path,preview:false,viewMode:'hotview'}))}],layout:{kind:'leaf',pane:'main'},focusedPaneId:'main'}};
const callbacks=Object.fromEntries(['registerHandle','registerElement','registerTabBar','onFocus','onOpenHistory','onSetTocOpen','onOpenSidebar','onTabDragMove','onTabDrop'].map(k=>[k,noop]));
window.notices=[];
function Fixture(){const tabs=useTabs('docs',noop,m=>window.notices.push(m),'/fixture',stored);window.tabs=tabs;
return <div className="flex h-dvh flex-col bg-surface-deep text-ink"><EditorPane {...callbacks} pane={tabs.panes[0]}
role="owner" authEmail="owner@example.test" canCollaborate={false} project="docs" tree={[]} presence={{}} focused isGuest={false} showSidebarButton={false} tocOpen={false} dropZone={null}
onActivate={(p,id)=>tabs.setActivePath(p,'main',id)} onPin={p=>tabs.pinTab(p,'main')} onCloseTab={(p,id)=>tabs.closeTab(p,'main',id)}
onReorder={(a,b)=>tabs.reorderTabs(a,b,'main')} onSetViewMode={(p,m)=>tabs.setTabViewMode(p,m,'main')} onChangeContent={tabs.updateTabContent}
onOpenLink={(p,o)=>tabs.openFile(p,{preview:false,forceNewTab:!!o?.newTab,replaceActive:!o?.newTab,paneId:'main'})}
onNavigateTab={d=>tabs.navigateTab(d,'main')}/></div>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const styles: string[] = []
  const bundle = await build({ input: 'virtual:editor-navigation.tsx', write: false, platform: 'browser', output: { format: 'esm', codeSplitting: false },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
      name: 'editor-navigation-fixture', resolveId(id) { if (id === 'virtual:editor-navigation.tsx') return id },
      async load(id) {
        if (id === 'virtual:editor-navigation.tsx') return source
        if (id.endsWith('.css')) { styles.push(await fs.readFile(id, 'utf8')); return { code: '', moduleType: 'js' } }
      },
    }],
  })
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const sources = await Promise.all(['src/components/EditorPane.tsx', 'src/components/TabBar.tsx', 'packages/editor/src/Editor.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))
  const css = compiler.build([...new Set((source + sources.join('\n')).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + styles.join('\n')
  const code = bundle.output.find(item => item.type === 'chunk')!.code
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const { width, dark } of [{ width: 1280, dark: true }, { width: 390, dark: false }]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } })
      page.setDefaultTimeout(6000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript("localStorage.setItem('mew:locale','ko')")
      await page.route('http://mew-editor-navigation.test/**', async route => {
        const url = new URL(route.request().url())
        if (url.pathname === '/api/file') {
          const file = url.searchParams.get('path')!
          return route.fulfill(file in files ? { json: { path: file, content: files[file], editable: true } } : { status: 404, json: { error: `Missing fixture: ${file}` } })
        }
        if (url.pathname === '/api/comments') return route.fulfill({ json: { threads: [] } })
        if (url.pathname === '/api/members') return route.fulfill({ json: { members: [] } })
        if (url.pathname === '/api/table-layout') return route.fulfill({ json: { tables: [] } })
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] })
        return route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: code } : { contentType: 'text/html', body: `<!doctype html><html class="${dark ? 'dark' : ''}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-editor-navigation.test/')
      const back = page.getByRole('button', { name: '뒤로가기', exact: true }), forward = page.getByRole('button', { name: '앞으로가기', exact: true })
      const heading = async (name: string) => {
        try {
          const target = Object.entries(files).find(([, content]) => content.startsWith(`# ${name}\n`) || content === `# ${name}`)![0]
          await page.waitForFunction(`window.tabs?.activePath === ${JSON.stringify(target)} && !window.tabs.activeTab.loading`)
          await page.locator('.ProseMirror').filter({ hasText: name }).waitFor()
        }
        catch (error) { assert.fail(`${error}\nPage errors: ${errors.join('\n')}\nBody: ${await page.locator('body').innerText()}\nState: ${await page.evaluate('JSON.stringify(window.tabs?.panes)')}`) }
      }
      const paths = () => page.evaluate<string[]>('window.tabs.tabs.map(tab=>tab.path)')
      await heading('One')
      assert.equal(await back.isDisabled(), true)
      assert.equal(await forward.isDisabled(), true)
      assert.notEqual(await page.locator('[data-editor-tools] > :first-child').getAttribute('data-editor-navigation'), null)
      const a = (await back.boundingBox())!, b = (await forward.boundingBox())!, c = (await page.getByRole('button', { name: '히스토리', exact: true }).boundingBox())!
      assert.ok(a.x < b.x && b.x < c.x)
      assert.equal(a.y, c.y); assert.equal(a.height, c.height)
      await page.getByRole('link', { name: 'Four', exact: true }).click(); await heading('Four')
      assert.deepEqual(await paths(), ['nested/four.md', 'two.md', 'three.md'])
      assert.equal(await back.isDisabled(), false); assert.equal(await forward.isDisabled(), true)
      await back.click(); await heading('One')
      assert.equal(await back.isDisabled(), true); assert.equal(await forward.isDisabled(), false)
      await forward.click(); await heading('Four')
      await page.getByRole('link', { name: 'Five', exact: true }).click(); await heading('Five')
      assert.equal(await page.evaluate('window.tabs.activePath'), 'nested/five.md', 'relative links use the current document after navigation')
      await back.click(); await heading('Four')
      await page.getByRole('link', { name: 'Branch', exact: true }).click(); await heading('Branch')
      assert.equal(await forward.isDisabled(), true, 'a new visit after going back truncates forward history')
      await page.getByRole('tab', { name: /^Two/ }).click(); await heading('Two')
      assert.equal(await back.isDisabled(), true); assert.equal(await forward.isDisabled(), true)
      await page.getByRole('tab', { name: /^Branch/ }).click(); await heading('Branch')
      await back.click(); await heading('Four'); await back.click(); await heading('One')
      for (const modifier of ['Control', 'Meta'] as const) {
        await page.getByRole('link', { name: 'Four', exact: true }).click({ modifiers: [modifier] }); await heading('Four')
        assert.equal((await paths()).length, 4)
        assert.equal(await back.isDisabled(), true, `${modifier}+click starts fresh history`); assert.equal(await forward.isDisabled(), true)
        await page.getByRole('tab', { name: /^Four/ }).getByRole('button').click(); await heading('One')
        assert.equal(await page.evaluate('window.tabs.activePath'), 'one.md', 'closing a linked tab returns to its origin rather than its neighbor')
      }
      await page.getByRole('link', { name: 'Child', exact: true }).click(); await heading('Child')
      assert.equal((await paths()).length, 3, 'child documents replace the active document')
      await page.getByRole('link', { name: 'Six', exact: true }).click(); await heading('Six')
      await back.click(); await heading('Child'); await back.click(); await heading('One')
      assert.equal(await back.isDisabled(), true); assert.equal(await forward.isDisabled(), false)
      const originalId = await page.evaluate<string>('window.tabs.activeTab.id')
      await page.getByRole('link', { name: 'Four', exact: true }).click(); await heading('Four')
      await page.getByRole('link', { name: 'Origin', exact: true }).click({ modifiers: ['Control'] }); await heading('One')
      const freshId = await page.evaluate<string>('window.tabs.activeTab.id')
      assert.notEqual(freshId, originalId)
      await page.locator(`[data-editor-tab-id="${originalId}"]`).click(); await heading('Four')
      await back.click(); await heading('One')
      assert.equal(await page.evaluate('window.tabs.activeTab.id'), originalId, 'history traversal keeps the original tab even when another tab shows the same document')
      assert.equal(await page.getByRole('tab', { selected: true }).count(), 1)
      assert.equal(await page.getByRole('tab', { name: /^One/ }).count(), 2)
      await forward.click(); await heading('Four')
      await page.locator(`[data-editor-tab-id="${freshId}"]`).click(); await heading('One')
      assert.equal(await back.isDisabled(), true); assert.equal(await forward.isDisabled(), true)
      await page.locator(`[data-editor-tab-id="${freshId}"]`).getByRole('button').click(); await heading('Four')
      assert.equal((await paths()).length, 3, 'closing one duplicate does not close the other logical tab')
      assert.equal(await page.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth), true)
      if (process.env.MEW_EDITOR_NAVIGATION_SCREENSHOTS) {
        await fs.mkdir(process.env.MEW_EDITOR_NAVIGATION_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: path.join(process.env.MEW_EDITOR_NAVIGATION_SCREENSHOTS, `navigation-${width}-${dark ? 'dark' : 'light'}.png`) })
      }
      assert.deepEqual(await page.evaluate('window.notices'), []); assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
