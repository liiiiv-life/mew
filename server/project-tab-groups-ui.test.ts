import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('project tabs group, reorder, restore and cancel with mouse, keyboard and real touch', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const source = `import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {RootProjectTabs} from '${root}/src/components/RootProjectTabs.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
function Fixture(){
const [layout,setLayout]=useState(()=>JSON.parse(localStorage.getItem('fixture')||'{"paths":["/alpha","/beta","/gamma","/delta"],"groups":[]}'));
const [active,setActive]=useState('/alpha');const [enabled,setEnabled]=useState(true);
window.setLayout=setLayout;window.layout=layout;window.active=active;window.setEnabled=setEnabled;
return <main className="h-screen bg-surface text-ink"><header className="flex h-12 border-b border-edge"><RootProjectTabs {...layout} activePath={active} fallbackLabel="work" canOpen={enabled} canChangeIcon={enabled} icons={{}} onActivate={setActive} onClose={p=>setLayout(s=>({...s,paths:s.paths.filter(x=>x!==p)}))} onIconChange={()=>{}} onOpen={()=>{}} onLayoutChange={next=>{setLayout(next);localStorage.setItem('fixture',JSON.stringify(next))}}/></header></main>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:groups.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:groups.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) { if (id === 'virtual:groups.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/RootProjectTabs.tsx', 'packages/ui/src/dialog-frame.tsx', 'src/components/IconPicker.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 600 }, hasTouch: true })
    const page = await context.newPage()
    page.setDefaultTimeout(3000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://mew-tab-groups.test/**', route => route.fulfill(new URL(route.request().url()).pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` }))
    await page.addInitScript("localStorage.setItem('mew:locale','ko')")
    await page.goto('http://mew-tab-groups.test/')
    const button = (name: string) => page.locator(`[data-project-drag="/${name}"]`)
    const tab = (name: string) => page.locator(`[data-project-path="/${name}"]`)
    const group = page.locator('[data-project-group]')
    const state = () => page.evaluate(() => (globalThis as unknown as { layout: { paths: string[]; groups: { id: string; paths: string[]; collapsed: boolean }[] } }).layout)
    async function point(locator: Locator, ratio = 0.5) { const box = await locator.boundingBox(); assert.ok(box); return { x: box.x + box.width * ratio, y: box.y + box.height / 2 } }
    async function hold(name: string) { const p = await point(button(name)); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(1050) }
    async function over(locator: Locator, ratio = 0.5) { const p = await point(locator, ratio); await page.mouse.move(p.x, p.y); await page.waitForTimeout(30) }
    async function settle() { await page.waitForTimeout(60) }

    await hold('alpha')
    await over(tab('beta'))
    assert.equal((await state()).groups.length, 0, 'hover is only a preview')
    assert.match(await tab('beta').getAttribute('class') ?? '', /outline-dashed/)
    await page.screenshot({ path: '/tmp/mew-project-group-preview-desktop.png' })
    await page.mouse.up(); await settle()
    assert.deepEqual((await state()).groups[0].paths, ['/beta', '/alpha'])
    assert.equal(await page.evaluate(() => (globalThis as unknown as { active: string }).active), '/alpha', 'drop never activates its target')
    await page.waitForTimeout(650)
    assert.equal(await page.locator('[data-project-group-toggle]').count(), 0)
    const stripBox = await page.locator('[data-project-tabs]').boundingBox()
    const groupBox = await group.boundingBox()
    assert.ok(stripBox && groupBox)
    assert.equal(groupBox.y, stripBox.y)
    assert.equal(groupBox.height, stripBox.height, 'group has no vertical spacing')
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('fixture')!)
      saved.groups[0].collapsed = true
      localStorage.setItem('fixture', JSON.stringify(saved))
    })
    await page.reload()
    assert.equal(await tab('alpha').isVisible(), true, 'previously collapsed groups show all tabs')
    assert.equal(await tab('beta').isVisible(), true)
    await hold('gamma')
    await over(tab('beta'))
    await page.mouse.up(); await settle()
    assert.deepEqual((await state()).groups[0].paths, ['/beta', '/alpha', '/gamma'])
    assert.equal((await state()).groups[0].collapsed, false)
    await hold('gamma'); await over(tab('beta'), 0.1)
    assert.doesNotMatch(await group.getAttribute('class') ?? '', /outline-dashed/)
    await page.mouse.up(); await settle()
    assert.deepEqual((await state()).groups[0].paths, ['/gamma', '/beta', '/alpha'])
    await hold('beta'); await over(page.locator('[data-project-drop-end]')); await page.mouse.up(); await settle()
    assert.deepEqual((await state()).groups[0].paths, ['/gamma', '/alpha'])
    assert.equal((await state()).paths.at(-1), '/beta')
    await page.reload()
    assert.deepEqual((await state()).groups[0].paths, ['/gamma', '/alpha'])
    const beforeCancel = await state()
    await hold('delta'); await over(tab('beta')); await page.keyboard.press('Escape'); await page.mouse.up(); await settle()
    assert.deepEqual(await state(), beforeCancel)
    await hold('delta'); await page.mouse.move(500, 200); await page.mouse.up(); await settle()
    assert.deepEqual(await state(), beforeCancel, 'off-strip drops cancel')
    await button('beta').focus(); await page.keyboard.press('Alt+Shift+ArrowLeft'); await settle()
    assert.equal((await state()).groups.length, 2)
    await page.keyboard.press('Alt+ArrowDown'); await settle()
    assert.equal((await state()).groups.length, 1)
    await page.waitForTimeout(650)
    await button('beta').click({ button: 'right' })
    await page.getByRole('dialog').waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.screenshot({ path: '/tmp/mew-project-groups-desktop.png' })

    await page.setViewportSize({ width: 390, height: 600 })
    const cdp = await context.newCDPSession(page)
    async function touchStart(name: string) { const p = await point(button(name)); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 1 }] }) }
    async function touchOver(locator: Locator, ratio = 0.5) { const p = await point(locator, ratio); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...p, id: 1 }] }); await settle() }
    async function touchEnd() { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await settle() }
    await touchStart('beta'); await page.waitForTimeout(650); await touchEnd()
    await page.getByRole('dialog').waitFor()
    await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).tap()
    await page.waitForTimeout(650)
    await touchStart('beta'); await page.waitForTimeout(1050); await touchOver(tab('gamma'))
    await page.screenshot({ path: '/tmp/mew-project-group-preview-mobile.png' })
    await touchEnd()
    assert.deepEqual((await state()).groups[0].paths, ['/gamma', '/alpha', '/beta'])
    await touchStart('beta'); await page.waitForTimeout(1050); await touchOver(tab('gamma'), 0.1); await touchEnd()
    assert.deepEqual((await state()).groups[0].paths, ['/beta', '/gamma', '/alpha'])
    const beforeTouchCancel = await state()
    await touchStart('delta'); await page.waitForTimeout(1050); await touchOver(tab('alpha'))
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await settle()
    assert.deepEqual(await state(), beforeTouchCancel)
    await page.screenshot({ path: '/tmp/mew-project-groups-mobile.png' })
    await page.evaluate(() => (globalThis as unknown as { setLayout: (v: unknown) => void }).setLayout({ paths: Array.from({ length: 24 }, (_, i) => '/project-' + i), groups: [] }))
    await settle()
    await touchStart('project-4')
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 30, y: 24, id: 1 }] })
    await touchEnd(); await page.waitForTimeout(1100)
    assert.ok(await page.locator('[data-project-tabs]').evaluate(el => el.scrollLeft) > 0, 'ordinary touch swipe scrolls the strip')
    assert.equal(await page.locator('[data-project-drop-end]').count(), 0)
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal((await state()).groups.length, 0)
    await page.evaluate(() => (globalThis as unknown as { setEnabled: (v: boolean) => void }).setEnabled(false))
    await button('project-8').focus(); await page.keyboard.press('Alt+Shift+ArrowRight')
    assert.equal((await state()).groups.length, 0, 'non-owner cannot arrange')
    await page.evaluate(() => (globalThis as unknown as { setEnabled: (v: boolean) => void }).setEnabled(true))
    await page.locator('[data-project-tabs]').evaluate(el => { el.scrollLeft = 0 })
    await hold('project-0')
    await page.mouse.move(385, 24); await page.waitForTimeout(250)
    assert.ok(await page.locator('[data-project-tabs]').evaluate(el => el.scrollLeft) > 0, 'dragging at the edge auto-scrolls to hidden tabs')
    await page.keyboard.press('Escape'); await page.mouse.up()
    assert.equal((await state()).groups.length, 0)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
