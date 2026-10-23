import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'rolldown'
import { chromium, type Route } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('editor tabs maintain MRU selection and independent document navigation', { skip: !domBrowserExecutable(), timeout: 45_000 }, async t => {
  const source = `import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {useTabs} from ${JSON.stringify(new URL('../src/hooks/useTabs.ts', import.meta.url).pathname)};
import {I18nProvider} from ${JSON.stringify(new URL('../src/i18n.tsx', import.meta.url).pathname)};
const noop=()=>{};
function Fixture(){const tabs=useTabs('docs',noop,message=>{window.lastNotice=message},'/fixture');window.tabs=tabs;return null}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const bundle = await build({ input: 'virtual:tab-navigation.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:tab-navigation.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:tab-navigation.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  const fixture = async (intercept?: (route: Route) => Promise<boolean>) => {
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    const errors: string[] = [], writes: { path: string; content: string; expectedContent: string }[] = []
    const disk = new Map<string, string>()
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://mew-tab-navigation.test/**', async route => {
      if (await intercept?.(route)) return
      const request = route.request(), url = new URL(request.url())
      if (url.pathname === '/api/file') {
        if (request.method() === 'GET') {
          const path = url.searchParams.get('path')!
          return route.fulfill({ json: { path, content: disk.get(path) ?? `Body ${path}`, editable: true } })
        }
        const input = request.postDataJSON()
        writes.push(input)
        disk.set(input.path, input.content)
        return route.fulfill({ json: { ok: true, content: input.content } })
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] })
      return route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: '<html><div id="root"></div><script src="/app.js"></script></html>' })
    })
    await page.goto('http://mew-tab-navigation.test/')
    await page.waitForFunction('window.tabs?.hydrated').catch(error => { throw new Error(`${error.message}; browser errors: ${errors.join('; ')}`) })
    const open = async (path: string, options = '{}') => {
      await page.evaluate(`window.tabs.openFile(${JSON.stringify(path)}, {preview:false, ...${options}})`)
      await page.waitForFunction(`window.tabs.activePath === ${JSON.stringify(path)} && !window.tabs.activeTab.revalidating`)
    }
    const navigate = async (direction: -1 | 1, path: string) => {
      await page.evaluate(`window.tabs.navigateTab(${direction})`)
      await page.waitForFunction(`window.tabs.activePath === ${JSON.stringify(path)} && !window.tabs.activeTab.revalidating`)
    }
    return { page, errors, writes, open, navigate }
  }
  try {
    await t.test('closing returns to the last used tab regardless of order, with fresh histories for new tabs', async () => {
      const { page, errors, open } = await fixture()
      for (const path of ['1.md', '2.md', '3.md']) await open(path)
      await page.evaluate("window.tabs.setActivePath('1.md')")
      await page.waitForFunction("window.tabs.activePath === '1.md'")
      await open('4.md', '{forceNewTab:true}')
      assert.equal(await page.evaluate('window.tabs.activeTab.navigation'), undefined)
      await page.evaluate("window.tabs.reorderTabs(0,2);window.tabs.closeTab('4.md')")
      await page.waitForFunction("window.tabs.activePath === '1.md'")
      await page.evaluate("window.tabs.closeTab('2.md')")
      assert.equal(await page.evaluate('window.tabs.activePath'), '1.md')
      assert.deepEqual(errors, [])
      await page.close()
    })
    await t.test('same-tab history traverses, branches, remaps, drops deleted paths and survives pane moves', async () => {
      const { page, errors, open, navigate } = await fixture()
      await open('a.md')
      const id = await page.evaluate('window.tabs.activeTab.id')
      await open('b.md', '{replaceActive:true}')
      await open('c.md', '{replaceActive:true}')
      assert.equal(await page.evaluate('window.tabs.tabs.length'), 1)
      assert.equal(await page.evaluate('window.tabs.activeTab.id'), id)
      await navigate(-1, 'b.md')
      await navigate(1, 'c.md')
      await navigate(-1, 'b.md')
      await open('d.md', '{replaceActive:true}')
      assert.deepEqual(await page.evaluate('window.tabs.activeTab.navigation'), { entries: ['a.md', 'b.md', 'd.md'], index: 2 })
      await page.evaluate("window.tabs.remapPaths('b.md','renamed.md','file');window.tabs.removePaths('a.md','file')")
      await page.waitForFunction('window.tabs.activeTab.navigation.entries.length === 2')
      await navigate(-1, 'renamed.md')
      assert.deepEqual(await page.evaluate('window.tabs.activeTab.navigation'), { entries: ['renamed.md', 'd.md'], index: 0 })
      await page.evaluate('window.tabs.navigateTab(-1)')
      assert.equal(await page.evaluate('window.tabs.activePath'), 'renamed.md')
      await open('new.md', '{forceNewTab:true}')
      assert.equal(await page.evaluate('window.tabs.activeTab.navigation'), undefined)
      await page.evaluate("window.tabs.splitWithTab('renamed.md','main','main','right')")
      await page.waitForFunction('window.tabs.panes.length === 2')
      assert.equal(await page.evaluate('window.tabs.activeTab.id'), id)
      await navigate(1, 'd.md')
      await page.evaluate("window.tabs.moveTabToPane('d.md',window.tabs.focusedPaneId,'main')")
      await page.waitForFunction('window.tabs.panes.length === 1')
      assert.equal(await page.evaluate('window.tabs.activeTab.id'), id)
      await navigate(-1, 'renamed.md')
      await open('new.md', '{replaceActive:true}')
      assert.equal(await page.evaluate('window.tabs.tabs.length'), 2)
      assert.equal(await page.evaluate('window.tabs.activeTab.id'), id, 'same-tab visits keep their logical tab even when the destination is already open')
      assert.deepEqual(await page.evaluate('window.tabs.activeTab.navigation'), { entries: ['renamed.md', 'new.md'], index: 1 })
      await navigate(-1, 'renamed.md')
      await page.evaluate("window.tabs.closeTab('new.md','main',window.tabs.tabs.find(tab=>tab.path === 'new.md').id)")
      assert.equal(await page.evaluate('window.tabs.activeTab.id'), id)
      assert.deepEqual(await page.evaluate('window.tabs.activeTab.navigation'), { entries: ['renamed.md', 'new.md'], index: 0 })
      assert.deepEqual(errors, [])
      await page.close()
    })
    await t.test('history remains in its own tab when the destination is open separately, including move, rename and close', async () => {
      const { page, errors, open, navigate } = await fixture()
      await open('a.md')
      const sourceId = await page.evaluate('window.tabs.activeTab.id')
      await open('b.md', '{replaceActive:true}')
      await open('a.md', '{forceNewTab:true}')
      const separateId = await page.evaluate('window.tabs.activeTab.id')
      assert.notEqual(sourceId, separateId)
      assert.equal(await page.evaluate('window.tabs.activeTab.navigation'), undefined)
      await page.evaluate(`window.tabs.setActivePath('b.md','main',${JSON.stringify(sourceId)})`)
      await page.waitForFunction(`window.tabs.activeTab.id === ${JSON.stringify(sourceId)}`)
      await navigate(-1, 'a.md')
      assert.equal(await page.evaluate('window.tabs.activeTab.id'), sourceId)
      assert.equal(await page.evaluate('window.tabs.panes[0].activeTabId'), sourceId)
      assert.deepEqual(await page.evaluate('window.tabs.activeTab.navigation'), { entries: ['a.md', 'b.md'], index: 0 })
      assert.equal(await page.evaluate("window.tabs.tabs.filter(tab=>tab.path === 'a.md').length"), 2)
      await page.evaluate("window.tabs.updateTabContent('a.md','Shared draft')")
      await page.waitForFunction("window.tabs.activeTab.content === 'Shared draft'")
      await navigate(1, 'b.md')
      assert.equal(await page.evaluate("window.tabs.tabs.find(tab=>tab.path === 'a.md').savedContent"), 'Shared draft')
      await navigate(-1, 'a.md')
      assert.equal(await page.evaluate('window.tabs.activeTab.content'), 'Shared draft', 'duplicate documents share their saved buffer without sharing navigation history')
      await page.evaluate(`window.tabs.splitWithTab('a.md','main','main','right',${JSON.stringify(sourceId)})`)
      await page.waitForFunction('window.tabs.panes.length === 2')
      await page.evaluate(`window.tabs.moveTabToPane('a.md',window.tabs.focusedPaneId,'main',${JSON.stringify(sourceId)})`)
      await page.waitForFunction('window.tabs.panes.length === 1')
      assert.equal(await page.evaluate('window.tabs.tabs.length'), 2, 'moving into a pane with the same document preserves both logical tabs')
      assert.equal(await page.evaluate('window.tabs.activeTab.id'), sourceId)
      await page.evaluate("window.tabs.remapPaths('a.md','renamed.md','file');window.tabs.removePaths('b.md','file')")
      await page.waitForFunction("window.tabs.activePath === 'renamed.md'")
      assert.equal(await page.evaluate('window.tabs.activeTab.id'), sourceId)
      assert.deepEqual(await page.evaluate('window.tabs.activeTab.navigation'), { entries: ['renamed.md'], index: 0 })
      await page.evaluate(`window.tabs.setActivePath('renamed.md','main',${JSON.stringify(separateId)})`)
      await page.waitForFunction(`window.tabs.activeTab.id === ${JSON.stringify(separateId)}`)
      await page.evaluate(`window.tabs.closeTab('renamed.md','main',${JSON.stringify(sourceId)})`)
      await page.waitForFunction('window.tabs.tabs.length === 1')
      assert.equal(await page.evaluate('window.tabs.activeTab.id'), separateId, 'closing an inactive duplicate removes only that logical tab')
      assert.equal(await page.evaluate('window.tabs.activeTab.navigation'), undefined)
      assert.deepEqual(errors, [])
      await page.close()
    })
    await t.test('session restore combines duplicate documents and starts without navigation history', async () => {
      const { page, errors, open, navigate } = await fixture()
      await open('a.md')
      const sourceId = await page.evaluate('window.tabs.activeTab.id')
      await open('b.md', '{replaceActive:true}')
      await open('a.md', '{forceNewTab:true}')
      await page.evaluate(`window.tabs.setActivePath('b.md','main',${JSON.stringify(sourceId)})`)
      await page.waitForFunction(`window.tabs.activeTab.id === ${JSON.stringify(sourceId)}`)
      await navigate(-1, 'a.md')
      assert.equal(await page.evaluate('window.tabs.tabs.length'), 2)
      await page.reload()
      await page.waitForFunction("window.tabs?.hydrated && window.tabs.activePath === 'a.md' && !window.tabs.activeTab.revalidating")
      assert.equal(await page.evaluate('window.tabs.tabs.length'), 1)
      assert.equal(await page.evaluate('window.tabs.activeTab.navigation'), undefined)
      assert.deepEqual(errors, [])
      await page.close()
    })
    await t.test('save failures retain the draft and history; a later successful save allows history navigation', async () => {
      let fail = true
      const { page, errors, open, navigate, writes } = await fixture(async route => {
        if (new URL(route.request().url()).pathname !== '/api/file' || route.request().method() === 'GET' || !fail) return false
        await route.fulfill({ status: 409, json: { error: 'Draft conflict' } })
        return true
      })
      await open('a.md')
      await open('b.md', '{replaceActive:true}')
      await page.evaluate("window.tabs.updateTabContent('b.md','Draft')")
      await page.waitForFunction("window.tabs.activeTab.content === 'Draft'")
      await page.evaluate('window.tabs.navigateTab(-1)')
      await page.waitForFunction("window.lastNotice === 'Draft conflict'")
      assert.equal(await page.evaluate('window.tabs.activePath'), 'b.md')
      assert.equal(await page.evaluate('window.tabs.activeTab.content'), 'Draft')
      assert.deepEqual(await page.evaluate('window.tabs.activeTab.navigation'), { entries: ['a.md', 'b.md'], index: 1 })
      fail = false
      await navigate(-1, 'a.md')
      assert.equal(writes.at(-1)?.content, 'Draft')
      assert.equal(writes.at(-1)?.expectedContent, 'Body b.md')
      await navigate(1, 'b.md')
      assert.equal(await page.evaluate('window.tabs.activeTab.content'), 'Draft')
      assert.deepEqual(errors, [])
      await page.close()
    })
    await t.test('a pending replacement cannot follow the user away and back to the source tab', async () => {
      let held: Route | undefined
      let arrived!: () => void
      const saveArrived = new Promise<void>(resolve => { arrived = resolve })
      const { page, errors, open } = await fixture(async route => {
        if (new URL(route.request().url()).pathname !== '/api/file' || route.request().method() === 'GET') return false
        held = route
        arrived()
        return true
      })
      await open('a.md')
      await open('other.md', '{forceNewTab:true}')
      await page.evaluate("window.tabs.setActivePath('a.md')")
      await page.waitForFunction("window.tabs.activePath === 'a.md'")
      await page.evaluate("window.tabs.updateTabContent('a.md','Draft')")
      await page.waitForFunction("window.tabs.activeTab.content === 'Draft'")
      await page.evaluate("window.tabs.openFile('b.md',{replaceActive:true,preview:false})")
      await saveArrived
      await page.evaluate("window.tabs.setActivePath('other.md');window.tabs.setActivePath('a.md')")
      await held!.fulfill({ json: { ok: true, content: 'Draft' } })
      await page.waitForFunction("window.tabs.activeTab.savedContent === 'Draft'")
      assert.equal(await page.evaluate('window.tabs.activePath'), 'a.md')
      assert.equal(await page.evaluate("window.tabs.tabs.some(tab=>tab.path === 'b.md')"), false)
      assert.deepEqual(errors, [])
      await page.close()
    })
    await t.test('late file reads cannot replace a document visited again or its local history', async () => {
      let held: Route | undefined, arrived!: () => void
      const readArrived = new Promise<void>(resolve => { arrived = resolve })
      let reads = 0
      const { page, errors, open, navigate } = await fixture(async route => {
        const url = new URL(route.request().url())
        if (url.pathname !== '/api/file' || route.request().method() !== 'GET' || url.searchParams.get('path') !== 'b.md') return false
        reads += 1
        if (reads > 1) return false
        held = route
        arrived()
        return true
      })
      await open('a.md')
      await page.evaluate("window.tabs.openFile('b.md',{replaceActive:true,preview:false})")
      await readArrived
      await open('c.md', '{replaceActive:true}')
      await navigate(-1, 'b.md')
      await held!.fulfill({ json: { path: 'b.md', content: 'Stale delayed body', editable: true } })
      await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      assert.equal(await page.evaluate('window.tabs.activeTab.content'), 'Body b.md')
      assert.deepEqual(await page.evaluate('window.tabs.activeTab.navigation'), { entries: ['a.md', 'b.md', 'c.md'], index: 1 })
      assert.equal(await page.evaluate('window.tabs.tabs.length'), 1)
      assert.deepEqual(errors, [])
      await page.close()
    })
  } finally { await browser.close() }
})
