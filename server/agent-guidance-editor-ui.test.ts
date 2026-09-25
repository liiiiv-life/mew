import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('guidance editor refreshes clean tabs, preserves dirty drafts and advances the save baseline while typing', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {useTabs} from ${JSON.stringify(new URL('../src/hooks/useTabs.ts', import.meta.url).pathname)};
const noop=()=>{};
function Fixture(){const tabs=useTabs('docs',noop,noop,'/fixture');window.tabs=tabs;return <button onClick={()=>tabs.openExternalFile('/data/agent-guidance.md')}>Open</button>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:tabs.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:tabs.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:tabs.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(4000)
    let disk = 'Original', hold = false, releaseSave: (() => void) | undefined
    let saveStarted: () => void
    const saveArrived = new Promise<void>(resolve => { saveStarted = resolve })
    const writes: { content: string; expectedContent: string }[] = []
    await page.route('http://mew-guidance-editor.test/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/fs/file') {
        if (route.request().method() === 'GET') return route.fulfill({ json: { path: '/data/agent-guidance.md', content: disk } })
        const input = route.request().postDataJSON()
        writes.push(input)
        if (input.expectedContent !== disk && input.content !== disk) return route.fulfill({ status: 409, json: { error: 'File changed' } })
        disk = input.content
        if (hold) { hold = false; await new Promise<void>(resolve => { releaseSave = resolve; saveStarted() }) }
        return route.fulfill({ json: { ok: true } })
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] })
      return route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: '<html><div id="root"></div><script src="/app.js"></script></html>' })
    })
    await page.goto('http://mew-guidance-editor.test/')
    await page.getByRole('button', { name: 'Open' }).click()
    await page.waitForFunction('window.tabs.activeTab?.content === "Original"')
    const broadcast = () => page.evaluate(`window.dispatchEvent(new CustomEvent('mew:external-file-updated', {detail:{path:'/data/agent-guidance.md',content:${JSON.stringify(disk)}}}))`)
    disk = 'Settings update'
    await broadcast()
    await page.waitForFunction('window.tabs.activeTab?.content === "Settings update" && window.tabs.activeTab.savedContent === "Settings update"')
    await page.evaluate('window.tabs.updateTabContent(window.tabs.activePath, "My draft")')
    disk = 'Concurrent settings'
    await broadcast()
    await page.waitForFunction('window.tabs.activeTab.status === "error"')
    assert.equal(await page.evaluate('window.tabs.activeTab.content'), 'My draft')
    assert.equal(await page.evaluate('window.tabs.activeTab.savedContent'), 'Settings update')
    assert.equal(disk, 'Concurrent settings')
    await page.reload()
    await page.getByRole('button', { name: 'Open' }).click()
    await page.waitForFunction('window.tabs.activeTab?.savedContent === "Concurrent settings"')
    hold = true
    await page.evaluate('window.tabs.updateTabContent(window.tabs.activePath, "First edit")')
    await saveArrived
    await page.waitForFunction('window.tabs.activeTab.status === "saving"')
    await page.evaluate('window.tabs.updateTabContent(window.tabs.activePath, "Second edit")')
    releaseSave!()
    await page.waitForFunction('window.tabs.activeTab.savedContent === "First edit"')
    await page.waitForFunction('window.tabs.activeTab.savedContent === "Second edit"')
    assert.equal(disk, 'Second edit')
    assert.equal(writes.at(-1)?.expectedContent, 'First edit')
  } finally { await browser.close() }
})
