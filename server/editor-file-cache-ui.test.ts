import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('cached project files render before validation without editing or seeding collaboration', { skip: !domBrowserExecutable(), timeout: 45_000 }, async (t) => {
  const cachedAlpha = '# Alpha cached\n\nOriginal alpha body'
  const cachedBeta = '# Beta cached\n\nOld beta body'
  const latestBeta = '# Beta latest\n\nNew beta body'
  const source = `
import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {I18nProvider} from ${JSON.stringify(new URL('../src/i18n.tsx', import.meta.url).pathname)};
import {EditorPane} from ${JSON.stringify(new URL('../src/components/EditorPane.tsx', import.meta.url).pathname)};
import {useTabs} from ${JSON.stringify(new URL('../src/hooks/useTabs.ts', import.meta.url).pathname)};
import {setContentIdentity,setContentWorkspace,putCachedFile} from ${JSON.stringify(new URL('../src/utils/contentCache.ts', import.meta.url).pathname)};
setContentIdentity('owner@example.test');
setContentWorkspace('/fixture');
putCachedFile('alpha','README.md',{content:${JSON.stringify(cachedAlpha)},editable:true,version:{size:40,mtimeMs:1,tag:'alpha-v1'}});
putCachedFile('beta','README.md',{content:${JSON.stringify(cachedBeta)},editable:true,version:{size:34,mtimeMs:1,tag:'beta-v1'}});
putCachedFile('beta','denied.md',{content:'# Previously allowed',editable:true,version:{size:20,mtimeMs:1,tag:'denied-v1'}});
const noop=()=>{};
const callbacks=Object.fromEntries(['registerHandle','registerElement','registerTabBar','onFocus','onActivate','onPin','onCloseTab','onReorder','onSetViewMode','onChangeContent','onOpenLink','onOpenHistory','onSetTocOpen','onOpenSidebar','onTabDragMove','onTabDrop'].map(key=>[key,noop]));
const saved={panes:[{id:'main',tabs:[{path:'README.md',preview:false,viewMode:'hotview'}],activePath:'README.md'}],layout:{type:'leaf',id:'main'},focusedPaneId:'main'};
const accountTabs={alpha:saved,beta:saved};
function Fixture(){
  const [project,setProject]=React.useState('alpha');
  const tabs=useTabs(project,noop,message=>{window.lastNotice=message},'/fixture',accountTabs,noop);
  window.tabs=tabs;
  return <div style={{height:700,display:'flex',flexDirection:'column'}}><nav><button onClick={()=>setProject('alpha')}>Alpha</button><button onClick={()=>setProject('beta')}>Beta</button><button onClick={()=>tabs.openFile('fresh.txt')}>Fresh</button><button onClick={()=>tabs.openFile('denied.md')}>Denied</button></nav>
    <EditorPane {...callbacks} onChangeContent={tabs.updateTabContent} onSetViewMode={tabs.setTabViewMode} pane={tabs.panes[0]} role="owner" authEmail="owner@example.test" project={project} tree={[]} presence={{}} focused isGuest={false} showSidebarButton={false} tocOpen={false} dropZone={null}/></div>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const bundle = await build({
    input: 'virtual:editor-file-cache.tsx', write: false, platform: 'browser', output: { format: 'esm', codeSplitting: false },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'editor-file-cache-fixture', resolveId(id) {
      if (id === 'virtual:editor-file-cache.tsx') return id
      if (id.endsWith('.css')) return 'virtual:style'
    }, load(id) {
      if (id === 'virtual:editor-file-cache.tsx') return source
      if (id === 'virtual:style') return ''
    } }],
  })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
    page.setDefaultTimeout(5000)
    const errors: string[] = [], writes: string[] = [], sockets: string[] = [], updates: string[] = [], closed: string[] = []
    const reads: URL[] = []
    const closures = new Map<string, Promise<void>>()
    const releases = new Map<string, () => void>()
    const gates = new Map(['alpha:README.md', 'beta:README.md', 'beta:fresh.txt', 'beta:denied.md'].map(key => [key, new Promise<void>(resolve => releases.set(key, resolve))]))
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://mew-cache.test/**', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.pathname === '/api/file') {
        if (request.method() !== 'GET') { writes.push(request.postData() ?? ''); return route.fulfill({ json: { ok: true } }) }
        reads.push(url)
        const key = `${url.searchParams.get('project')}:${url.searchParams.get('path')}`
        await gates.get(key)
        if (key === 'beta:denied.md') return route.fulfill({ status: 403, json: { error: 'Permission denied' } })
        if (key === 'alpha:README.md') return route.fulfill({ json: { path: 'README.md', editable: true, version: { size: 40, mtimeMs: 1, tag: 'alpha-v1' }, unchanged: true, partial: false } })
        return route.fulfill({ json: { path: url.searchParams.get('path'), content: key === 'beta:README.md' ? latestBeta : 'Fresh response body', editable: true, version: { size: 35, mtimeMs: 2, tag: 'latest-v2' } } })
      }
      if (url.pathname === '/api/comments') return route.fulfill({ json: { threads: [] } })
      if (url.pathname === '/api/members') return route.fulfill({ json: { members: [] } })
      if (url.pathname === '/api/table-layout') return route.fulfill({ json: { tables: [] } })
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] })
      return route.fulfill(url.pathname === '/app.js'
        ? { contentType: 'text/javascript', body: chunk.code }
        : { contentType: 'text/html', body: '<!doctype html><html><meta charset="utf-8"><div id="root"></div><script type="module" src="/app.js"></script></html>' })
    })
    await page.routeWebSocket('**/api/collab?**', ws => {
      const room = new URL(ws.url()).searchParams.get('room') ?? ''
      sockets.push(room)
      closures.set(room, new Promise(resolve => ws.onClose(() => { closed.push(room); resolve() })))
      ws.onMessage(message => {
        if (typeof message !== 'string' && message[0] === 0 && message[1] === 2) updates.push(room)
        if (typeof message !== 'string' && message[0] === 0 && message[1] === 0) ws.send(Buffer.from([0, 1, 2, 0, 0]))
      })
    })
    await page.goto('http://mew-cache.test/')
    const markdown = page.locator('.ProseMirror')
    const assertReadableCache = async (body: string) => {
      await markdown.filter({ hasText: body }).waitFor()
      assert.equal(await page.locator('[data-editor-loading], [inert]').count(), 0, 'cached body can be read without a loading cover')
      assert.equal(await markdown.getAttribute('contenteditable'), 'false', 'unverified cached content cannot be edited')
      assert.equal(await page.evaluate('window.tabs.activeTab.revalidating'), true)
    }
    await assertReadableCache('Original alpha body')
    await page.waitForFunction('window.tabs.activeTab.revalidating === true')
    assert.ok(sockets.includes('alpha:README.md'), 'prepare collaboration while the file read is pending')
    assert.deepEqual(updates, [], 'an independently authorized socket cannot seed unverified cached content')
    await page.evaluate("window.tabs.updateTabContent('README.md', '# Stale editor update'); new Promise(resolve => requestAnimationFrame(resolve))")
    assert.equal(await page.evaluate('window.tabs.activeTab.content'), cachedAlpha, 'late editor callbacks cannot modify an unverified cached body')
    assert.equal(await page.evaluate('window.tabs.activeTab.savedContent'), cachedAlpha)
    assert.equal(reads[0].searchParams.get('version'), 'alpha-v1', 'restore requests reuse the persisted file version')
    releases.get('alpha:README.md')!()
    await page.waitForFunction('window.tabs.activeTab.revalidating !== true')
    await markdown.filter({ hasText: 'Original alpha body' }).waitFor()
    await page.waitForFunction("document.querySelector('.ProseMirror')?.getAttribute('contenteditable') === 'true'")
    assert.equal(await page.evaluate('window.tabs.activeTab.content'), cachedAlpha, 'unchanged responses preserve the exact cached Markdown')
    assert.ok(sockets.includes('alpha:README.md'))
    await page.getByRole('button', { name: 'Beta', exact: true }).click()
    await assertReadableCache('Old beta body')
    assert.ok(sockets.includes('beta:README.md'))
    assert.equal(updates.filter(room => room === 'beta:README.md').length, 0, 'do not seed the stale beta cache')
    await page.waitForFunction("performance.getEntriesByName('mew:file-open:' + window.tabs.activeTab.openTrace.id + ':first-paint', 'measure').length > 0")
    const timings = await page.evaluate(`({
      firstPaint: performance.getEntriesByName('mew:file-open:' + window.tabs.activeTab.openTrace.id + ':first-paint', 'measure')[0].duration,
      responses: performance.getEntriesByName('mew:file-open:' + window.tabs.activeTab.openTrace.id + ':file-response', 'measure').length
    })`) as { firstPaint: number; responses: number }
    assert.equal(timings.responses, 0, 'the cached editor reaches its first paint while the file response is still blocked')
    t.diagnostic(`Synthetic cached project switch first-paint: ${timings.firstPaint.toFixed(1)} ms (held file response; local fixture, not production latency)`)
    releases.get('beta:README.md')!()
    await markdown.filter({ hasText: 'New beta body' }).waitFor()
    await page.waitForFunction("document.querySelector('.ProseMirror')?.getAttribute('contenteditable') === 'true'")
    assert.equal(await page.evaluate('window.tabs.activeTab.content'), latestBeta)
    assert.equal(await page.evaluate('window.tabs.activeTab.savedContent'), latestBeta)
    assert.ok(sockets.includes('beta:README.md'))
    await page.getByRole('button', { name: 'Fresh', exact: true }).click()
    await page.locator('[data-editor-loading]').waitFor()
    releases.get('beta:fresh.txt')!()
    await page.locator('.cm-content').filter({ hasText: 'Fresh response body' }).waitFor()
    assert.equal(await page.locator('[data-editor-loading]').count(), 0)
    await page.getByRole('button', { name: 'Denied', exact: true }).click()
    await assertReadableCache('Previously allowed')
    assert.ok(sockets.includes('beta:denied.md'))
    assert.equal(updates.filter(room => room === 'beta:denied.md').length, 0)
    releases.get('beta:denied.md')!()
    await page.waitForFunction("window.lastNotice === 'Permission denied'")
    assert.equal(await page.evaluate('window.tabs.activeTab.content'), '', 'revoked access removes the cached body')
    assert.equal(await page.evaluate('window.tabs.activeTab.editable'), false)
    await closures.get('beta:denied.md')
    assert.ok(closed.includes('beta:denied.md'), 'failed file validation closes its prepared socket')
    assert.equal(updates.filter(room => room === 'beta:denied.md').length, 0, 'denied cached content is never seeded')
    assert.equal(await page.locator('[data-editor-loading]').count(), 0)
    assert.deepEqual(writes, [], 'validation and collaboration initialization never autosave stale cached text')
    assert.deepEqual(errors, [])
    await page.close()
  } finally { await browser.close() }
})
