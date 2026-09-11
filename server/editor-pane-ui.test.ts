import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom.ts'

test('opening and switching files survives full or blocked tab storage', { skip: !domBrowserExecutable(), timeout: 45_000 }, async (t) => {
  const bundle = await build({
    input: 'virtual:editor-pane.tsx', output: { format: 'esm' }, platform: 'browser', write: false,
    transform: { define: { 'process.env.NODE_ENV': JSON.stringify('test') }, jsx: 'react-jsx' },
    plugins: [{ name: 'editor-pane-fixture', resolveId(id) {
      if (id === 'virtual:editor-pane.tsx') return id
      if (id.endsWith('.css')) return 'virtual:style'
    }, load(id) {
      if (id === 'virtual:style') return ''
      if (id !== 'virtual:editor-pane.tsx') return
      return `import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {I18nProvider} from ${JSON.stringify(new URL('../src/i18n.tsx', import.meta.url).pathname)};
import {EditorPane} from ${JSON.stringify(new URL('../src/components/EditorPane.tsx', import.meta.url).pathname)};
import {useTabs} from ${JSON.stringify(new URL('../src/hooks/useTabs.ts', import.meta.url).pathname)};
import {startBrowserStorageMaintenance} from '@mew/ui/browser-storage';
startBrowserStorageMaintenance();
const noop = () => {};
const saved = (project, state) => { window.savedTabs = state; };
const callbacks = Object.fromEntries(['registerHandle', 'registerElement', 'registerTabBar', 'onFocus', 'onActivate', 'onPin', 'onCloseTab', 'onReorder', 'onSetViewMode', 'onChangeContent', 'onOpenLink', 'onOpenHistory', 'onSetTocOpen', 'onOpenSidebar', 'onTabDragMove', 'onTabDrop'].map(key => [key, noop]));
function Fixture() {
  const tabs = useTabs('docs', noop, noop, '/fixture', undefined, saved);
  const open = (path, viewMode) => tabs.openFile(path, {viewMode});
  return <><nav><button onClick={() => open('first.md', 'hotview')}>Open markdown</button><button onClick={() => open('second.txt', 'plain')}>Open text</button><button onClick={() => open('third.md', 'hotview')}>Open another markdown</button></nav><EditorPane {...callbacks} pane={tabs.panes[0]} role="guest" authEmail={null} project="docs" tree={[]} presence={{}} focused isGuest showSidebarButton={false} tocOpen={false} dropZone={null}/></>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
    } }],
  })
  const chunk = bundle.output.find((item) => item.type === 'chunk')!
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(chunk.type === 'chunk' ? chunk.code : '')
    } else if (req.url?.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json')
      res.end(req.url.startsWith('/api/file?') ? JSON.stringify({path:'fixture', content:'# File content\n\nSelected file body', editable:true}) : '[]')
    } else {
      res.setHeader('Content-Type', 'text/html')
      res.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  t.after(async () => {
    await browser?.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.stack || error.message || error.name))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  await page.addInitScript(() => {
    localStorage.setItem('mew:content:legacy:large.md', 'x'.repeat(750_000))
    localStorage.setItem('mew:tree-children:legacy', 'x'.repeat(750_000))
    localStorage.setItem('mew:agent-input-drafts', '{"tab":"unsent draft"}')
  })
  await page.goto(origin)
  assert.equal(await page.evaluate(() => localStorage.getItem('mew:content:legacy:large.md')), null)
  assert.equal(await page.evaluate(() => localStorage.getItem('mew:tree-children:legacy')), null)
  assert.equal(await page.evaluate(() => localStorage.getItem('mew:agent-input-drafts')), '{"tab":"unsent draft"}')
  for (const [button, editor] of [['Open text', '.cm-content'], ['Open markdown', '.ProseMirror'], ['Open another markdown', '.ProseMirror']]) {
    await page.getByRole('button', { name: button, exact: true }).click()
    await page.waitForFunction("!!document.querySelector('.cm-content, .ProseMirror') || !document.querySelector('nav')")
    assert.deepEqual(errors, [], `opening ${button} must not crash`)
    await page.locator(editor).filter({ hasText: 'Selected file body' }).waitFor({ timeout: 5000 })
    assert.equal(await page.locator('nav').isVisible(), true)
  }
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('mew:open-tabs')) throw new DOMException('Storage is full', 'QuotaExceededError')
      return original.call(this, key, value)
    }
  })
  await page.getByRole('button', { name: 'Open text', exact: true }).click()
  await page.waitForFunction("document.querySelector('.cm-content')?.textContent?.includes('Selected file body') || !document.querySelector('nav')")
  assert.deepEqual(errors, [], 'local tab persistence must not unmount the app when storage is full')
  assert.equal(await page.locator('nav').isVisible(), true)
  assert.equal(await page.evaluate('window.savedTabs.panes[0].activePath'), 'second.txt', 'account sync still runs')

  // A fresh mount with unavailable local restore data must still open files and sync account tabs.
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem
    const setItem = Storage.prototype.setItem
    Storage.prototype.getItem = function (key) {
      if (key.startsWith('mew:open-tabs')) throw new DOMException('Storage is blocked', 'SecurityError')
      return getItem.call(this, key)
    }
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('mew:open-tabs')) throw new DOMException('Storage is blocked', 'SecurityError')
      return setItem.call(this, key, value)
    }
  })
  await page.reload()
  await page.getByRole('button', { name: 'Open markdown', exact: true }).click()
  await page.locator('.ProseMirror').filter({ hasText: 'Selected file body' }).waitFor({ timeout: 5000 })
  assert.deepEqual(errors, [])
  assert.equal(await page.evaluate('window.savedTabs.panes[0].activePath'), 'first.md')
})
