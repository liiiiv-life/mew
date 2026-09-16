import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('subprojects can be created from desktop and mobile folder menus', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {FileTree} from '${root}/src/components/FileTree.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
const noop=()=>{};const dir=(path,children=[],project=false)=>({path,name:path.split('/').pop(),type:'dir',children,project});
function Fixture(){const [made,setMade]=useState(false);const [readOnly,setReadOnly]=useState(false);window.readOnly=setReadOnly;window.notices=[];
return <div className="h-dvh w-80"><FileTree project=".workspace" canUseCommands tree={[dir('abc',[dir('abc/def',[],made)],true),dir('plain'),dir('.mew'),{name:'note.md',path:'note.md',type:'file'}]} selectedPath={null} readOnly={readOnly} searchFocusSignal={0} newFileSignal={{n:0,parentPath:null}} revealSignal={0} presence={{}} onSelect={noop} onFileCreated={noop} onFolderCreated={()=>setMade(true)} onRenamed={noop} onDeleted={noop} onNotice={notice=>window.notices.push(notice)} registerSearchCancel={noop}/></div>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:subprojects.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:subprojects.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) { if (id === 'virtual:subprojects.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/FileTree.tsx', 'src/hooks/use-tree-touch-gesture.ts'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, hasTouch: true })
    const page = await context.newPage()
    page.setDefaultTimeout(3000)
    const writes: unknown[] = [], commands: string[] = [], errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://mew-projects.test/**', async route => {
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
    })
    await page.goto('http://mew-projects.test/')
    const menu = page.getByRole('button', { name: '하위 프로젝트로 만들기', exact: true })
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
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
