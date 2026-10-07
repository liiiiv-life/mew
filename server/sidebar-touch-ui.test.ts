import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('sidebar touch separates tap, stationary hold-for-menu and immediate drag after arming', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {FileTree} from '${root}/src/components/FileTree.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
localStorage.setItem('mew:locale','ko');
const noop=()=>{}; const file=path=>({path,name:path.split('/').pop(),type:'file'});
window.selected=[];window.renamed=[];window.drops=0;document.addEventListener('drop',()=>window.drops++,true);
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><div className="relative z-20 h-dvh w-80"><FileTree project=".workspace" tree={[file('note.md'),{path:'folder',name:'folder',type:'dir',children:[file('folder/child.md')]},...Array.from({length:40},(_,i)=>file('extra-'+i+'.md'))]} selectedPath={null} readOnly={false} searchFocusSignal={0} newFileSignal={{n:0,parentPath:null}} revealSignal={0} presence={{}} onSelect={path=>window.selected.push(path)} onFileCreated={noop} onFolderCreated={noop} onRenamed={(...args)=>window.renamed.push(args)} onDeleted={noop} onGuestAccessChanged={noop} onNotice={noop} registerSearchCancel={noop}/></div><div id="outside" style={{position:'fixed',right:0,top:0,width:60,height:300}} onDragOver={e=>e.preventDefault()} onDrop={e=>window.outsidePath=e.dataTransfer.getData('application/x-mew-path')}/><nav className="mobile-dock" aria-label="Test dock"><button>Files</button><button>Editor</button></nav></I18nProvider></React.StrictMode>);`
  const bundle = await build({ input: 'virtual:sidebar-touch.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:sidebar-touch.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) { if (id === 'virtual:sidebar-touch.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/file-action-menu.tsx', 'src/components/FileTree.tsx', 'src/hooks/use-tree-touch-gesture.ts'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await context.newPage()
    const errors: string[] = []
    const writes: unknown[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.setDefaultTimeout(3000)
    await page.route('http://mew-touch.test/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/rename') {
        writes.push(route.request().postDataJSON())
        await route.fulfill({ json: { ok: true, hidden: false } }); return
      }
      if (url.pathname.startsWith('/api/')) { await route.fulfill({ json: {} }); return }
      await route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    await page.goto('http://mew-touch.test/')
    const file = page.locator('button[data-path="note.md"]')
    const folder = page.locator('button[data-path="folder"]')
    const menu = page.getByRole('menuitem', { name: '잘라내기', exact: true })
    const center = async (el: Locator) => { const box = await el.boundingBox(); assert.ok(box); return { x: box.x + box.width / 2, y: box.y + box.height / 2 } }
    const cdp = await context.newCDPSession(page)
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', point?: { x: number; y: number }) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ ...point, id: 1 }] : [] })
    const clearMenu = async () => { await page.locator('#outside').click(); await menu.waitFor({ state: 'detached' }) }

    await file.tap()
    assert.deepEqual(await page.evaluate('window.selected'), ['note.md'])
    await page.evaluate('window.selected=[]')
    const start = await center(file)
    await touch('touchStart', start)
    await page.waitForTimeout(650)
    assert.equal(await file.getAttribute('data-touch-holding'), 'true')
    assert.equal(await file.getAttribute('draggable'), 'false', 'native touch drag cannot preempt the menu')
    assert.equal(await file.getAttribute('data-touch-dragging'), null)
    assert.equal(await menu.count(), 0, 'menu waits for release')
    await touch('touchEnd')
    await menu.waitFor()
    assert.equal(await file.getAttribute('data-menu-target'), 'true')
    assert.equal(await file.getAttribute('data-touch-holding'), null)
    assert.notEqual(await file.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)')
    await page.screenshot({ path: '/tmp/mew-sidebar-touch-menu.png' })
    assert.deepEqual(await page.evaluate('window.selected'), [])
    await clearMenu()
    assert.equal(await file.getAttribute('data-menu-target'), null)
    assert.equal(await file.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)')

    // A folder gets the same release-for-menu gesture, without toggling it open.
    await touch('touchStart', await center(folder))
    await page.waitForTimeout(650)
    await touch('touchEnd')
    await menu.waitFor()
    assert.equal(await folder.getAttribute('data-menu-target'), 'true')
    assert.equal(await page.locator('button[data-path="folder/child.md"]').count(), 0)
    await clearMenu()

    await touch('touchStart', start)
    await page.waitForTimeout(400)
    assert.equal(await file.getAttribute('data-touch-dragging'), null, 'hold arms without showing a drag preview')
    await touch('touchMove', await center(folder))
    assert.equal(await file.getAttribute('data-touch-dragging'), 'true', 'movement starts at the tab/dock hold threshold, before native long-press feedback')
    await page.screenshot({ path: '/tmp/mew-sidebar-touch-drag.png' })
    await touch('touchEnd')
    await page.waitForFunction('window.renamed.length === 1')
    assert.deepEqual(writes, [{ oldPath: 'note.md', newPath: 'folder/note.md', project: '.workspace' }])
    assert.equal(await menu.count(), 0)
    await file.dispatchEvent('click')
    assert.deepEqual(await page.evaluate('window.selected'), [], 'post-drag click must not open the old path')
    await file.tap()
    assert.deepEqual(await page.evaluate('window.selected'), ['note.md'], 'next deliberate tap is not swallowed')

    // Arming without movement must not dispatch a drop, including in nested trees.
    const drops = await page.evaluate('window.drops')
    await touch('touchStart', start)
    await page.waitForTimeout(1100)
    await touch('touchEnd')
    assert.equal(await page.evaluate('window.drops'), drops)
    await menu.waitFor()
    assert.equal(writes.length, 1, 'a stationary long hold opens the menu without moving')
    await clearMenu()

    // The existing path MIME contract also reaches non-tree drop targets.
    await touch('touchStart', start)
    await page.waitForTimeout(1100)
    await touch('touchMove', await center(page.locator('#outside')))
    await touch('touchEnd')
    assert.equal(await page.evaluate('window.outsidePath'), 'note.md')
    assert.equal(writes.length, 1)

    // Cancellation must release state and never move the item or open a menu.
    await touch('touchStart', start)
    await page.waitForTimeout(1100)
    await touch('touchMove', await center(folder))
    await touch('touchCancel')
    assert.equal(await file.getAttribute('data-touch-dragging'), null)
    assert.equal(writes.length, 1)
    assert.equal(await menu.count(), 0)

    // A second finger cancels the pending menu/drag timers.
    await touch('touchStart', start)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }, { x: start.x + 40, y: start.y, id: 2 }] })
    await page.waitForTimeout(1100)
    await touch('touchEnd')
    assert.equal(await file.getAttribute('data-touch-dragging'), null)
    assert.equal(await menu.count(), 0)
    assert.equal(writes.length, 1)

    // A quick swipe remains native scrolling, even after all earlier gestures.
    const scroller = page.locator('[data-tree-key] > div').first()
    const before = await scroller.evaluate(el => el.scrollTop)
    const swipeStart = await center(page.locator('button[data-path="extra-15.md"]'))
    await touch('touchStart', swipeStart)
    await touch('touchMove', { x: swipeStart.x, y: swipeStart.y - 140 })
    await touch('touchEnd')
    assert.ok(await scroller.evaluate(el => el.scrollTop) > before)
    await page.waitForTimeout(1100)
    assert.equal(await page.locator('[data-touch-dragging]').count(), 0)
    assert.equal(await menu.count(), 0)

    // Menus near the bottom stay above the real dock CSS, including safe-area height.
    const actionMenu = page.locator('[data-file-action-menu]')
    const assertAboveDock = async () => {
      await page.waitForFunction(`(() => {
        const menu = document.querySelector('[data-file-action-menu]').getBoundingClientRect()
        const dock = document.querySelector('.mobile-dock').getBoundingClientRect()
        return menu.bottom <= dock.top - 3 && menu.top >= 4 && menu.right <= innerWidth - 3
      })()`)
    }
    await file.dispatchEvent('pointerdown', { pointerType: 'mouse', button: 2 })
    await page.evaluate("document.querySelector('button[data-path=\"note.md\"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 380, clientY: 835 }))")
    await actionMenu.waitFor()
    await assertAboveDock()
    await page.evaluate("document.querySelector('.mobile-dock').style.paddingBottom = '36px'")
    await assertAboveDock()
    await page.screenshot({ path: '/tmp/mew-sidebar-menu-dock-mobile.png' })

    // An open menu reflows on rotation, scrolls internally, and its last action is reachable.
    await page.setViewportSize({ width: 640, height: 320 })
    await assertAboveDock()
    assert.ok(await actionMenu.evaluate(el => el.scrollHeight > el.clientHeight))
    const lastAction = actionMenu.locator('button').last()
    await lastAction.scrollIntoViewIfNeeded()
    const lastActionHit = await page.evaluate(`(() => {
      const el = document.querySelector('[data-file-action-menu] button:last-child')
      const rect = el.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return { reachable: el.contains(hit), rect: rect.toJSON(), hit: hit?.outerHTML }
    })()`) as { reachable: boolean; rect: unknown; hit?: string }
    assert.equal(lastActionHit.reachable, true, JSON.stringify(lastActionHit))
    await page.screenshot({ path: '/tmp/mew-sidebar-menu-dock-landscape.png' })

    // A hidden dock reserves no space; desktop uses the full viewport too.
    await page.evaluate("document.querySelector('.mobile-dock').hidden = true")
    await page.waitForFunction("document.querySelector('[data-file-action-menu]').getBoundingClientRect().bottom > innerHeight - 6")
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.evaluate("document.querySelector('.mobile-dock').hidden = false")
    await page.waitForFunction("document.querySelector('[data-file-action-menu]').getBoundingClientRect().bottom > innerHeight - 6")
    await clearMenu()

    // Mouse input on the same touch-capable device still uses native drag/right-click.
    await scroller.evaluate(el => { el.scrollTop = 0 })
    await page.setViewportSize({ width: 1200, height: 800 })
    await file.click({ button: 'right' })
    await menu.waitFor()
    await clearMenu()
    await file.dragTo(folder)
    await page.waitForFunction('window.renamed.length === 2')
    assert.equal(writes.length, 2)
    await page.screenshot({ path: '/tmp/mew-sidebar-touch-desktop.png' })
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
