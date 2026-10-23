import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('foreground menus and dialogs cover dock resize hit targets', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React,{useState,useRef} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {useOverlayDismiss} from '${root}/packages/ui/src/useOverlayDismiss.ts';
import {DockWorkspace,DockPanel,DockBody} from '${root}/src/components/DockWorkspace.tsx';
import {HeaderMenu} from '${root}/src/components/HeaderMenu.tsx';
import {TermButtonBar} from '${root}/src/components/TermButtonBar.tsx';
const noop=()=>{};
function Body(){const [open,setOpen]=useState(false);useOverlayDismiss(open&&(()=>setOpen(false)));return <><button onClick={()=>setOpen(true)}>Open panel dialog</button><TermButtonBar run={noop}/>{open&&<div data-panel-dialog className="fixed inset-0 z-50 bg-surface-raised p-8">Panel dialog</div>}</>}
function Fixture(){const [dock,setDock]=useState(null);const ref=useRef(null);window.dock=dock;return <div className="flex h-dvh flex-col bg-surface text-ink"><header className="flex h-10 shrink-0 items-center justify-end pr-2 md:h-12 md:pr-4"><HeaderMenu items={[{id:'action',label:'Menu action',icon:null,onSelect:()=>window.selected=true}]}/></header><DockWorkspace apiRef={ref} value={dock} onChange={setDock} foreground="terminal" onEditorDrop={()=>''}><DockPanel id="editor:main" kind="editor">Editor</DockPanel><DockPanel id="terminal" kind="terminal">Terminal</DockPanel><DockBody group="terminal" active><Body/></DockBody></DockWorkspace></div>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:layers.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:layers.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) { if (id === 'virtual:layers.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/DockWorkspace.tsx', 'src/components/HeaderMenu.tsx', 'src/components/TermButtonBar.tsx', 'src/components/IconPicker.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    page.setDefaultTimeout(3000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://mew-layers.test/**', route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/term-buttons') return route.fulfill({ json: { buttons: [] } })
      return route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html class="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    await page.addInitScript("localStorage.setItem('mew:locale','en')")
    await page.goto('http://mew-layers.test/')
    const separator = page.getByRole('separator')
    const box = await separator.boundingBox()
    assert.ok(box)
    const x = box.x + box.width / 2, y = 160
    const hit = (selector: string, atY = y) => page.evaluate(`!!document.elementFromPoint(${x},${atY})?.closest(${JSON.stringify(selector)})`)
    const cursor = (atY = y) => page.evaluate(`getComputedStyle(document.elementFromPoint(${x},${atY})).cursor`)
    assert.equal(await hit('[role="separator"]'), true)
    assert.equal(await cursor(), 'col-resize')
    await page.getByRole('button', { name: 'Open panel dialog', exact: true }).click()
    await page.locator('[data-panel-dialog]').waitFor()
    assert.equal(await hit('[data-panel-dialog]'), true, 'dialogs inside a DockBody escape below-separator stacking contexts')
    assert.notEqual(await cursor(), 'col-resize')
    const initialWidth = (await page.locator('[data-dock-panel="terminal"]').boundingBox())!.width
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 80, y); await page.mouse.up()
    assert.equal((await page.locator('[data-dock-panel="terminal"]').boundingBox())!.width, initialWidth)
    await page.keyboard.press('Escape')
    await page.waitForFunction('!history.state?.mewOverlayGuard')
    await page.getByRole('button', { name: 'Add command button', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Add command button' })
    await dialog.waitFor()
    assert.equal(await hit('[role="dialog"]'), true, 'the real terminal button editor covers the resize border')
    assert.notEqual(await cursor(), 'col-resize')
    const card = (await dialog.locator(':scope > div').boundingBox())!
    const cardY = card.y + 8
    assert.equal(await hit('[role="dialog"]', cardY), true)
    await page.mouse.move(x, cardY); await page.mouse.down(); await page.mouse.move(x + 80, cardY); await page.mouse.up()
    assert.equal((await page.locator('[data-dock-panel="terminal"]').boundingBox())!.width, initialWidth)
    await page.screenshot({ path: '/tmp/mew-overlay-layers-desktop.png' })
    await page.keyboard.press('Escape')
    await page.waitForFunction('!history.state?.mewOverlayGuard')
    assert.equal(await cursor(), 'col-resize')
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 80, y); await page.mouse.up()
    assert.ok((await page.locator('[data-dock-panel="terminal"]').boundingBox())!.width < initialWidth - 70, 'closing the overlay restores resizing')
    // Header menus remain clickable on both responsive layouts.
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 })
      const menuY = width >= 768 ? 68 : 60
      await page.reload()
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
      const menuX = width - 70
      assert.equal(await page.evaluate(`!!document.elementFromPoint(${menuX},${menuY})?.closest('[role="menu"]')`), true, 'header menu receives pointer input')
      await page.mouse.click(menuX, menuY)
      assert.equal(await page.evaluate('window.selected'), true)
      await page.waitForFunction('!history.state?.mewOverlayGuard')
    }
    // Mobile DockBody keeps its own stacking level; the editor still escapes it.
    await page.getByRole('button', { name: 'Add command button', exact: true }).click()
    await dialog.waitFor()
    assert.equal(await dialog.evaluate(el => el.parentElement === el.ownerDocument.body), true)
    await page.screenshot({ path: '/tmp/mew-overlay-layers-mobile.png' })
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
