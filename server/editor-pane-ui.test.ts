import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import { compile } from '@tailwindcss/node'
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
  return <div className="flex h-dvh flex-col"><nav><button onClick={() => open('first.md', 'hotview')}>Open markdown</button><button onClick={() => open('second.txt', 'plain')}>Open text</button><button onClick={() => open('third.md', 'hotview')}>Open another markdown</button><button onClick={() => open('loading.md', 'hotview')}>Open slow</button><button onClick={() => open('loading-later.txt', 'plain')}>Open later</button><button onClick={() => open('loading-empty.txt', 'plain')}>Open empty</button><button onClick={() => open('loading-error.txt', 'plain')}>Open failed</button></nav><EditorPane {...callbacks} pane={tabs.panes[0]} role="guest" authEmail={null} project="docs" tree={[]} presence={{}} focused isGuest showSidebarButton={false} tocOpen={false} dropZone={null}/></div>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
    } }],
  })
  const chunk = bundle.output.find((item) => item.type === 'chunk')!
  const cssFiles = ['../src/components/EditorPane.tsx', '../src/components/TabBar.tsx']
  const cssSource = (await Promise.all(cssFiles.map(file => fs.readFile(new URL(file, import.meta.url), 'utf8')))).join('\n') + ' flex h-dvh flex-col'
  const compiler = await compile(await fs.readFile(new URL('../src/index.css', import.meta.url), 'utf8'), { base: new URL('../src', import.meta.url).pathname, onDependency() {} })
  const css = compiler.build([...new Set(cssSource.match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const gates = new Map<string, Promise<void>>()
  const hold = (file: string) => {
    let release: () => void = () => {}
    gates.set(file, new Promise<void>(resolve => { release = resolve }))
    return release
  }
  const server = http.createServer(async (req, res) => {
    if (req.url === '/app.js') {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(chunk.type === 'chunk' ? chunk.code : '')
    } else if (req.url?.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json')
      const file = new URL(req.url, 'http://fixture').searchParams.get('path') ?? ''
      if (req.url.startsWith('/api/file?')) {
        await gates.get(file)
        if (file === 'loading-error.txt') { res.statusCode = 500; res.end(JSON.stringify({error:'Load failed'})); return }
      }
      res.end(req.url.startsWith('/api/file?') ? JSON.stringify({path:file, content:file === 'loading-empty.txt' ? '' : '# File content\n\nSelected file body', editable:true}) : '[]')
    } else {
      res.setHeader('Content-Type', 'text/html')
      res.end(`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`)
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
  page.setDefaultTimeout(5000)
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

  const overlay = page.locator('[data-editor-loading]')
  for (const [width, dark] of [[1100, true], [390, false]] as const) {
    await page.setViewportSize({ width, height: 800 })
    await page.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`)
    const release = hold('loading.md')
    await page.getByRole('button', { name: 'Open slow', exact: true }).click()
    await overlay.waitFor()
    assert.match(await overlay.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor), /^(?:rgba\(0, 0, 0, 0\.5\)|oklab\(0 0 0 \/ 0\.5\))$/)
    assert.equal(await overlay.locator('..').getAttribute('aria-busy'), 'true')
    assert.equal(await overlay.locator('..').locator('[inert]').count(), 1)
    const cover = await overlay.boundingBox(), body = await overlay.locator('..').boundingBox()
    assert.ok(cover && body && cover.width > 200 && cover.height > 100)
    assert.deepEqual(cover, body, 'the overlay covers exactly the editor body')
    assert.equal(await page.locator('[data-dock-tab-bar]').evaluate(el => el.closest('[inert]') === null), true)
    await page.screenshot({ path: `/tmp/mew-editor-loading-${width}.png` })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await overlay.locator('[aria-hidden=true]').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).animationName), 'none')
    release()
    await overlay.waitFor({ state: 'detached' })
    assert.equal(await page.locator('[inert]').count(), 0)
    await page.getByRole('button', { name: 'Open text', exact: true }).click()
    await page.locator('.cm-content').filter({ hasText: 'Selected file body' }).waitFor()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  }
  const releaseFirst = hold('loading.md'), releaseLater = hold('loading-later.txt')
  await page.getByRole('button', { name: 'Open slow', exact: true }).click()
  await overlay.waitFor()
  await page.getByRole('button', { name: 'Open later', exact: true }).click()
  await overlay.waitFor()
  const firstResponse = page.waitForResponse(response => response.url().includes('path=loading.md'))
  releaseFirst()
  await (await firstResponse).finished()
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  assert.equal(await overlay.count(), 1, 'an older file response does not clear the active file overlay')
  releaseLater()
  await overlay.waitFor({ state: 'detached' })
  for (const [file, button] of [['loading-empty.txt', 'Open empty'], ['loading-error.txt', 'Open failed']]) {
    const release = hold(file)
    await page.getByRole('button', { name: button, exact: true }).click()
    await overlay.waitFor()
    release()
    await overlay.waitFor({ state: 'detached' })
    assert.equal(await page.locator('[inert]').count(), 0, 'empty files and load failures both release the editor')
  }
  assert.deepEqual(errors, [])
})
