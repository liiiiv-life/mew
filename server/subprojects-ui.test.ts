import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Route } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('subprojects can be created and opened in the project switcher on desktop and mobile', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {FileTree} from '${root}/src/components/FileTree.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {ProjectSwitcher} from '${root}/src/components/ProjectSwitcher.tsx';
const icon='svg:<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>';
const noop=()=>{};const dir=(path,children=[],project=false)=>({path,name:path.split('/').pop(),type:'dir',children,project,icon:project?icon:undefined});
function Fixture(){
const [made,setMade]=useState(false);const [readOnly,setReadOnly]=useState(false);const [navigation,setNavigation]=useState(false);const [canOpen,setCanOpen]=useState(true);
const [paths,setPaths]=useState(['/work']);const [active,setActive]=useState('/work');
window.readOnly=setReadOnly;window.enableNavigation=()=>setNavigation(true);window.setCanOpen=setCanOpen;
window.notices??=[];window.opened??=[];window.loads??=[];
const open=path=>{window.opened.push(path);setPaths(previous=>[...new Set([...previous,'/work/'+path])]);setActive('/work/'+path)};
return <><header className="flex h-12"><ProjectSwitcher paths={paths} activePath={active} fallbackLabel="work" canOpen={canOpen} canChangeIcon={false} icons={Object.fromEntries(paths.map(path=>[path,icon]))} onActivate={setActive} onIconChange={noop} onOpen={noop}/></header>
<div className="h-[700px] w-80"><FileTree project=".workspace" canUseCommands tree={[dir('abc',[dir('abc/def',[{name:'inside.md',path:'abc/def/inside.md',type:'file'}],made)],true),{path:'direct',name:'direct',type:'dir',project:true,icon},dir('plain',[dir('plain/nested',[],true)]),dir('.mew'),dir('docs',[{name:'guide.md',path:'docs/guide.md',type:'file'}]),{name:'note.md',path:'note.md',type:'file'}]} selectedPath={null} readOnly={readOnly} searchFocusSignal={0} newFileSignal={{n:0,parentPath:null}} revealSignal={0} presence={{}} onSelect={noop} onFileCreated={noop} onFolderCreated={()=>setMade(true)} onRenamed={noop} onDeleted={noop} onNotice={notice=>window.notices.push(notice)} registerSearchCancel={noop}
documentsFolder={{path:'docs',onOpen:()=>window.docsOpened=(window.docsOpened??0)+1}} canOpenProjects={canOpen} onOpenProject={navigation?open:undefined} loadChildren={async path=>{window.loads.push(path);return path==='direct'?[{name:'child.ts',path:'direct/child.ts',type:'file'}]:[]}}/></div></>}


createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:subprojects.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:subprojects.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) { if (id === 'virtual:subprojects.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/ProjectIcon.tsx', 'src/components/file-action-menu.tsx', 'src/hooks/use-external-file-actions.tsx', 'src/components/FileTree.tsx', 'src/components/subproject-link.tsx', 'src/components/ProjectSwitcher.tsx', 'src/hooks/use-tree-touch-gesture.ts'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, hasTouch: true })
    const page = await context.newPage()
    page.setDefaultTimeout(3000)
    const writes: unknown[] = [], commands: string[] = [], errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const serveFixture = async (route: Route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/subprojects') {
        writes.push({ project: url.searchParams.get('project'), ...route.request().postDataJSON() })
        await route.fulfill({ json: { ok: true } }); return
      }
      if (url.pathname === '/api/cmd-buttons') {
        commands.push(url.searchParams.get('path') ?? '')
        await route.fulfill({ json: { buttons: [] } }); return
      }
      if (url.pathname.startsWith('/api/')) { await route.fulfill({ json: {} }); return }
      await route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    }
    await page.route('http://mew-projects.test/**', serveFixture)
    await page.addInitScript("localStorage.setItem('mew:locale','ko')")
    await page.goto('http://mew-projects.test/')
    const menu = page.getByRole('menuitem', { name: '하위 프로젝트로 만들기', exact: true })
    const row = (path: string) => page.locator(`button[data-path="${path}"]`)
    await row('abc').click()
    await row('abc/def').click({ button: 'right' })
    await menu.waitFor()
    await page.screenshot({ path: '/tmp/mew-subprojects-desktop.png' })
    await menu.click()
    await row('abc/def').getByText('Project', { exact: true }).waitFor()
    assert.deepEqual(writes, [{ project: '.workspace', path: 'abc/def' }])
    await row('abc/def').click({ button: 'right' })
    assert.equal(await menu.count(), 0, 'existing projects cannot be promoted again')
    await page.mouse.click(350, 760)
    await row('abc/def').locator('..').getByRole('button', { name: 'abc/def 명령어 버튼' }).click()
    await page.getByText('아직 명령이 없습니다.').waitFor()
    assert.equal(commands.at(-1), 'abc/def')
    await page.mouse.click(350, 760)
    for (const path of ['note.md', '.mew']) {
      await row(path).click({ button: 'right' })
      assert.equal(await menu.count(), 0)
      await page.mouse.click(350, 760)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    const box = await row('plain').boundingBox(); assert.ok(box)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 50, y: box.y + box.height / 2, id: 1 }] })
    await page.waitForTimeout(650)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await menu.waitFor()
    await page.screenshot({ path: '/tmp/mew-subprojects-mobile.png' })
    await menu.tap()
    assert.deepEqual(writes.at(-1), { project: '.workspace', path: 'plain' })
    // Project folders stay in the same tree; only the adjacent arrow changes projects.
    await page.setViewportSize({ width: 1100, height: 800 })
    await row('abc/def').click()
    await row('abc/def/inside.md').waitFor()
    await page.evaluate(() => (globalThis as unknown as { enableNavigation: () => void }).enableNavigation())
    const arrow = (path: string) => page.locator(`[data-subproject-link="${path}"]`)
    await arrow('abc').waitFor()
    await row('abc/def/inside.md').waitFor()
    assert.equal(await row('abc').getAttribute('aria-expanded'), 'true', 'open project folders remain expanded')
    assert.equal(await page.getByRole('button', { name: 'abc 명령어 버튼', exact: true }).count(), 0)
    assert.ok((await row('abc').boundingBox())!.y < (await row('direct').boundingBox())!.y)
    assert.ok((await row('direct').boundingBox())!.y < (await row('plain').boundingBox())!.y)
    const rightSide = async (path: string, touch = false) => {
      const box = await row(path).locator('..').boundingBox(); assert.ok(box)
      const x = box.x + box.width - 6, y = box.y + box.height / 2
      if (touch) await page.touchscreen.tap(x, y)
      else await page.mouse.click(x, y)
    }
    for (const path of ['direct', 'docs']) {
      const box = await row(path).locator('..').boundingBox(); assert.ok(box)
      await rightSide(path)
      assert.equal(await row(path).getAttribute('aria-expanded'), 'true', 'right-side click expands the folder')
      await rightSide(path)
      assert.equal(await row(path).getAttribute('aria-expanded'), 'false', 'right-side click collapses the folder')
    }
    const desktop = await browser.newContext({ viewport: { width: 1100, height: 800 } })
    try {
      const hoverPage = await desktop.newPage()
      await hoverPage.route('http://mew-projects.test/**', serveFixture)
      await hoverPage.goto('http://mew-projects.test/')
      await hoverPage.evaluate(() => (globalThis as unknown as { enableNavigation: () => void }).enableNavigation())
      for (const path of ['direct', 'docs']) {
        const folder = hoverPage.locator(`button[data-path="${path}"]`)
        const box = await folder.locator('..').boundingBox(); assert.ok(box)
        await hoverPage.mouse.move(box.x + box.width - 6, box.y + box.height / 2)
        const highlight = await folder.evaluate(element => {
          const style = element.ownerDocument.defaultView!.getComputedStyle(element, '::before')
          return { width: parseFloat(style.width), background: style.backgroundColor }
        })
        assert.ok(Math.abs(highlight.width - box.width) < 1, 'highlight spans the entire folder row')
        assert.notEqual(highlight.background, 'rgba(0, 0, 0, 0)', 'right-side hover highlights the folder')
      }
      await hoverPage.screenshot({ path: '/tmp/mew-folder-row-desktop.png' })
    } finally { await desktop.close() }
    await page.locator('[data-documents-link]').click()
    assert.equal(await page.evaluate(() => (globalThis as unknown as { docsOpened: number }).docsOpened), 1)
    assert.equal(await row('docs').getAttribute('aria-expanded'), 'false', 'Documents arrow does not toggle the folder')
    await row('direct').click()
    await row('direct/child.ts').waitFor()
    assert.deepEqual(await page.evaluate(() => (globalThis as unknown as { opened: string[] }).opened), [], 'expansion does not switch projects')
    assert.ok((await page.evaluate(() => (globalThis as unknown as { loads: string[] }).loads)).includes('direct'))
    await row('abc/def').click({ button: 'right' })
    await page.getByRole('menuitem', { name: '새 파일', exact: true }).click()
    await page.getByPlaceholder('새 파일 이름').waitFor()
    await page.keyboard.press('Escape')
    assert.deepEqual(await page.evaluate(() => (globalThis as unknown as { opened: string[] }).opened), [], 'creation stays inside the current project tree')
    await arrow('direct').click()
    await page.locator('[data-current-project="/work/direct"]').waitFor()
    await arrow('direct').click()
    await page.locator('[data-project-switcher]').click()
    assert.equal(await page.locator('[data-project-option="/work/direct"]').count(), 1)
    assert.equal(await page.locator('[data-project-option="/work"]').count(), 1, 'parent remains selectable')
    await page.keyboard.press('Escape')
    await row('abc').focus()
    await page.keyboard.press('Enter')
    assert.equal(await row('abc/def').count(), 0, 'Enter on the folder collapses it')
    await page.keyboard.press('Space')
    await row('abc/def/inside.md').waitFor()
    await arrow('abc').focus()
    await page.keyboard.press('Enter')
    await page.locator('[data-current-project="/work/abc"]').waitFor()
    await row('plain').click()
    await arrow('plain/nested').focus()
    await page.keyboard.press('Space')
    await page.locator('[data-current-project="/work/plain/nested"]').waitFor()
    await page.locator('[data-project-switcher]').click()
    for (const project of ['direct', 'abc', 'plain/nested']) {
      const mask = await row(project).locator('span[style*="mask-image"]').evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).maskImage)
      const tabMask = await page.locator(`[data-project-option="/work/${project}"] span[style*="mask-image"]`).evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).maskImage)
      assert.notEqual(mask, 'none')
      assert.equal(tabMask, mask, 'sidebar and project menu render the same SVG')
    }
    await page.screenshot({ path: '/tmp/mew-subproject-switcher-desktop.png' })
    await page.keyboard.press('Escape')
    await row('abc/def/inside.md').waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await rightSide('direct', true)
    assert.equal(await row('direct/child.ts').count(), 0)
    await rightSide('direct', true)
    await row('direct/child.ts').waitFor()
    await arrow('plain/nested').tap()
    await page.screenshot({ path: '/tmp/mew-subproject-switcher-mobile.png' })
    const count = await page.evaluate(() => (globalThis as unknown as { opened: string[] }).opened.length)
    await page.evaluate(() => (globalThis as unknown as { setCanOpen: (value: boolean) => void }).setCanOpen(false))
    await arrow('abc').focus()
    await page.keyboard.press('Enter')
    await arrow('direct').tap({ force: true })
    assert.equal(await page.evaluate(() => (globalThis as unknown as { opened: string[] }).opened.length), count)
    await row('direct').tap()
    await row('direct').tap()
    await row('direct/child.ts').waitFor()
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
