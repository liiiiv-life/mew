import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('project switcher keeps a compact current project and supports keyboard, touch, icons and owner boundaries', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const source = `import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {ProjectSwitcher} from '${root}/src/components/ProjectSwitcher.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {captureDesktopKeyboard} from '${root}/src/utils/desktop-keyboard.ts';
window.activations=[];window.remoteKeys=[];window.previews=[];window.opens=0;
window.startRemote=()=>captureDesktopKeyboard({input:{key:(...args)=>window.remoteKeys.push(args),release(){}},target:el=>el===document.querySelector('#remote-keys'),detected(){},copy:async()=>{},paste:async()=>{},status(){}});
function Fixture(){
const [paths,setPaths]=useState(['/alpha','/beta','/gamma','/delta']);
const [active,setActive]=useState('/alpha');const [enabled,setEnabled]=useState(true);const [dialog,setDialog]=useState(false);const [icons,setIcons]=useState({});
window.setPaths=setPaths;window.active=active;window.setEnabled=setEnabled;window.setDialog=setDialog;
return <main className="h-screen bg-surface text-ink"><header className="flex h-9 border-b border-edge"><ProjectSwitcher paths={paths} activePath={active} fallbackLabel="work" canOpen={enabled} canChangeIcon={enabled} icons={icons} onActivate={p=>{window.activations.push(p);setActive(p)}} onIconChange={(p,icon)=>setIcons(s=>({...s,[p]:icon}))} onOpen={()=>window.opens++} onPreview={p=>window.previews.push(p)}/></header><textarea id="project-input"/><div role="dialog" hidden={!dialog}><input id="project-modal"/><div id="remote-keys" tabIndex={0}/></div><button id="outside" style={{position:"fixed",right:8,bottom:8}} onClick={()=>window.outsideClicks=(window.outsideClicks??0)+1}>Outside</button></main>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:switcher.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:switcher.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) { if (id === 'virtual:switcher.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/ProjectSwitcher.tsx', 'packages/ui/src/dialog-frame.tsx', 'src/components/IconPicker.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 600 }, hasTouch: true })
    const page = await context.newPage()
    page.setDefaultTimeout(4000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://mew-project-switcher.test/**', route => route.fulfill(new URL(route.request().url()).pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` }))
    await page.addInitScript("localStorage.setItem('mew:locale','ko')")
    await page.goto('http://mew-project-switcher.test/')
    const trigger = page.locator('button[data-project-switcher]')
    const menu = page.getByRole('menu', { name: '프로젝트 선택', exact: true })
    const option = (project: string) => page.locator(`[data-project-option="${project}"]`)
    const active = () => page.evaluate('window.active')

    assert.equal(await trigger.textContent(), 'alpha')
    assert.equal(await page.locator('[data-project-tabs], [data-project-group], [data-project-drag]').count(), 0)
    assert.equal(await option('/beta').count(), 0, 'inactive projects are rendered only when the list opens')
    await trigger.click()
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
    assert.deepEqual(await page.locator('[data-project-option]').evaluateAll(elements => elements.map(element => element.getAttribute('data-project-option'))), ['/alpha', '/beta', '/gamma', '/delta'])
    assert.equal(await option('/alpha').getAttribute('aria-checked'), 'true')
    assert.equal(await menu.locator('button').last().textContent(), '프로젝트 추가')
    await option('/beta').focus()
    assert.equal(await active(), '/alpha', 'previewing a project does not activate it')
    assert.ok((await page.evaluate('window.previews') as string[]).includes('/beta'))
    await page.keyboard.press('Enter')
    await page.waitForFunction('window.active==="/beta"')
    assert.equal(await trigger.textContent(), 'beta')
    assert.equal(await menu.count(), 0)
    assert.equal(await trigger.evaluate(element => element === element.ownerDocument.activeElement), true)
    await trigger.click()
    await option('/beta').click()
    assert.deepEqual(await page.evaluate('window.activations'), ['/beta'], 'selecting the current project is a no-op')

    await trigger.focus(); await page.keyboard.press('ArrowDown')
    await page.keyboard.press('End')
    assert.equal(await menu.locator('button').last().evaluate(element => element === element.ownerDocument.activeElement), true)
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate('window.opens'), 1)
    await trigger.click(); await page.keyboard.press('Escape')
    assert.equal(await menu.count(), 0)
    assert.equal(await trigger.evaluate(element => element === element.ownerDocument.activeElement), true)
    await trigger.click(); await page.goBack()
    await menu.waitFor({ state: 'detached' })
    assert.equal(await trigger.evaluate(element => element === element.ownerDocument.activeElement), true)
    await trigger.click(); await page.locator('#outside').click()
    assert.equal(await menu.count(), 0)
    assert.equal(await page.evaluate('window.outsideClicks??0'), 0, 'dismissal does not click through the popup')

    await page.evaluate('window.setDialog(true)')
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 600 })
      await page.locator('#project-input').focus(); await page.keyboard.press('Alt+3')
      await page.waitForFunction('window.active==="/gamma"')
      await page.keyboard.press('Alt+Numpad2')
      await page.waitForFunction('window.active==="/beta"')
      for (const combo of ['Alt+9', 'Alt+0', 'Alt+Shift+1', 'Control+Alt+1', 'Meta+Alt+1']) await page.keyboard.press(combo)
      assert.equal(await active(), '/beta')
      await page.locator('#project-input').evaluate(element => element.dispatchEvent(new element.ownerDocument.defaultView!.KeyboardEvent('keydown', { key: '¡', code: 'Digit1', altKey: true, repeat: true, bubbles: true, cancelable: true })))
      assert.equal(await active(), '/beta')
      await page.locator('#project-modal').focus(); await page.keyboard.press('Alt+1')
      assert.equal(await active(), '/beta', 'modal input cannot switch the project behind it')
      await page.locator('#project-input').focus()
      await page.locator('#project-input').evaluate(element => element.dispatchEvent(new element.ownerDocument.defaultView!.KeyboardEvent('keydown', { key: '¡', code: 'Digit1', altKey: true, bubbles: true, cancelable: true })))
      await page.waitForFunction('window.active==="/alpha"')
    }
    await page.locator('#remote-keys').focus(); await page.evaluate('window.stopRemote=window.startRemote()')
    await page.keyboard.press('Alt+2')
    assert.equal(await active(), '/alpha', 'remote keyboard keeps priority over project selection')
    assert.deepEqual(await page.evaluate('window.remoteKeys'), [['AltLeft', true], ['Digit2', true], ['Digit2', false], ['AltLeft', false]])
    await page.evaluate('window.stopRemote();window.setDialog(false)')

    await page.setViewportSize({ width: 1100, height: 600 })
    await trigger.click({ button: 'right' })
    await page.getByRole('dialog', { name: '프로젝트 아이콘' }).waitFor()
    await page.keyboard.press('Escape')
    await trigger.focus(); await page.keyboard.press('Shift+F10')
    await page.getByRole('dialog', { name: '프로젝트 아이콘' }).waitFor()
    await page.keyboard.press('Escape')
    await trigger.click(); await option('/beta').click({ button: 'right' })
    await page.getByRole('dialog', { name: '프로젝트 아이콘' }).waitFor()
    assert.equal(await menu.count(), 0)
    await page.keyboard.press('Escape')

    for (const width of [1100, 320]) {
      await page.setViewportSize({ width, height: 600 })
      for (const theme of ['dark', 'light']) {
        await page.locator('html').evaluate((element, theme) => { element.className = theme }, theme)
        await trigger.tap()
        const box = await menu.boundingBox(); assert.ok(box)
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 600)
        await page.screenshot({ path: `/tmp/mew-project-switcher-${width}-${theme}.png` })
        await option('/gamma').tap()
        assert.equal(await active(), '/gamma')
      }
    }
    const cdp = await context.newCDPSession(page)
    const box = await trigger.boundingBox(); assert.ok(box)
    const touch = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] })
    await page.waitForTimeout(650)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.getByRole('dialog', { name: '프로젝트 아이콘' }).waitFor()
    await page.getByRole('dialog', { name: '프로젝트 아이콘' }).getByRole('button', { name: '닫기', exact: true }).tap()
    assert.equal(await menu.count(), 0, 'long press does not also open project selection')
    await page.waitForTimeout(1000)

    await page.evaluate('window.setPaths(["/a/shared","/b/shared",...Array.from({length:30},(_,i)=>"/a/project-"+i)])')
    await trigger.tap()
    assert.match(await option('/a/shared').textContent() ?? '', /\/a\/shared/)
    assert.match(await option('/b/shared').textContent() ?? '', /\/b\/shared/)
    assert.equal(await menu.evaluate(element => element.scrollHeight > element.clientHeight), true, 'long project lists scroll within the viewport')
    await page.keyboard.press('Escape')
    await page.evaluate('window.setPaths([])')
    await trigger.tap()
    assert.equal(await menu.locator('button').count(), 1)
    assert.equal(await menu.locator('button').textContent(), '프로젝트 추가')
    await page.evaluate('window.setEnabled(false)')
    await menu.waitFor({ state: 'detached' })
    assert.equal(await trigger.count(), 0, 'non-owners see a static current project')
    assert.equal(await page.locator('[data-current-project]').textContent(), 'gamma')
    await page.locator('#project-input').focus(); await page.keyboard.press('Alt+1')
    assert.equal(await active(), '/gamma')
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
