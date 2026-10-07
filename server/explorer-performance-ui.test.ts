import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('explorer coalesces loads, keeps refreshed rows and windows large Files/Documents lists', { skip: !domBrowserExecutable(), timeout: 40_000 }, async t => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {FileTree} from '${root}/src/components/FileTree.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
const noop=()=>{}; const file=path=>({path,name:path.split('/').pop(),type:'file'}); const dir=path=>({path,name:path,type:'dir'});
const docs=location.search.includes('docs'); const restored=location.search.includes('restore');
window.loads=[]; window.waiting={}; window.block=false; window.notices=[];
window.items=(name,count=1000)=>Array.from({length:count},(_,i)=>file(name+'/item-'+String(i).padStart(4,'0')+'.md'));
const load=async name=>{window.loads.push(name);return window.block ? new Promise(resolve=>window.waiting[name]=resolve) : window.items(name)};
function Fixture(){
const [tree,setTree]=React.useState([dir('folder'),dir('other')]);const [invalidation,setInvalidation]=React.useState();const [selected,setSelected]=React.useState(null);const [signal,setSignal]=React.useState(0);const [refreshSignal,setRefreshSignal]=React.useState(0);window.refreshAll=()=>setRefreshSignal(n=>n+1);
window.closedFolders=()=>setTree(Array.from({length:1000},(_,i)=>dir('closed-'+String(i).padStart(4,'0'))));window.refresh=()=>setTree(tree=>[...tree]);window.remove=()=>setTree(tree=>tree.filter(node=>node.path!=='other'));
window.invalidate=parents=>setInvalidation(old=>({n:(old?.n??0)+1,project:'.workspace',parents}));
window.reveal=path=>{setSelected(path);setSignal(n=>n+1)};
return <div style={{height:480,width:320}}><FileTree project='.workspace' tree={tree} documentPages={docs} treeInvalidation={invalidation} refreshSignal={refreshSignal} selectedPath={selected} revealSignal={signal}
readOnly searchFocusSignal={0} newFileSignal={{n:0,parentPath:null}} presence={{}} registerSearchCancel={noop}
accountState={restored?{openDirs:['folder'],scrollTop:0,centerAnchor:{tree:'.workspace',path:'folder/item-0800.md',fraction:0.5},directoryChildren:{folder:window.items('folder')}}:{openDirs:[],scrollTop:0}} onSelect={path=>window.selected=path} onFileCreated={noop} onFolderCreated={noop} onRenamed={noop} onDeleted={noop} onNotice={text=>window.notices.push(text)} loadChildren={load}/></div>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const bundle = await build({ input: 'virtual:explorer.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:explorer.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) { if (id === 'virtual:explorer.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = await fs.readFile(`${root}/src/components/FileTree.tsx`, 'utf8')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  for (const docs of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 750 } })
    page.setDefaultTimeout(4000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://mew-explorer.test/**', route => route.fulfill(new URL(route.request().url()).pathname === '/app.js'
      ? { contentType: 'text/javascript', body: chunk.code }
      : { contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` }))
    await page.goto(`http://mew-explorer.test/${docs ? '?docs' : ''}`)
    const folder = page.locator('[data-path="folder"]').first()
    await folder.waitFor()
    if (docs) {
      await page.evaluate('window.block=true')
      await folder.click()
      await folder.locator('..').getByRole('button').first().click()
      await page.waitForFunction('!!window.waiting.folder')
      assert.deepEqual(await page.evaluate('window.loads'), ['folder'], 'page name and expand arrow share the pending request')
      await page.evaluate("window.waiting.folder(window.items('folder'));delete window.waiting.folder;window.block=false")
    } else await folder.click()
    await page.locator('[data-path="folder/item-0000.md"]').waitFor()
    await page.waitForTimeout(80)
    assert.deepEqual(await page.evaluate('window.loads'), ['folder'], 'cold expansion makes one request')
    assert.ok(await page.locator('[data-path^="folder/item-"]').count() < 100, '1000 leaf rows have bounded DOM')
    await page.evaluate('window.refresh()')
    await page.waitForTimeout(60)
    assert.ok(await page.locator('[data-path="folder/item-0000.md"]').count(), 'root refresh keeps unchanged cached children')
    assert.deepEqual(await page.evaluate('window.loads'), ['folder'])

    await page.evaluate("window.block=true;window.invalidate(['folder'])")
    await page.waitForFunction('!!window.waiting.folder')
    assert.ok(await page.locator('[data-path="folder/item-0000.md"]').count(), 'background refresh does not blank the list')
    await page.evaluate("window.invalidate(['folder'])")
    await page.waitForTimeout(30)
    await page.evaluate("const resolve=window.waiting.folder;delete window.waiting.folder;resolve(window.items('folder',2))")
    await page.waitForFunction('!!window.waiting.folder')
    assert.ok(await page.locator('[data-tree-virtual]').count(), 'invalidated in-flight result is never applied')
    await page.evaluate("window.waiting.folder(window.items('folder'));delete window.waiting.folder;window.block=false")
    await page.waitForTimeout(80)
    assert.deepEqual(await page.evaluate('window.loads'), ['folder', 'folder', 'folder'])

    await page.evaluate('window.block=true;window.refreshAll()')
    await page.waitForFunction('!!window.waiting.folder')
    assert.ok(await page.locator('[data-path="folder/item-0000.md"]').count(), 'explicit refresh also keeps cached rows')
    await page.evaluate("window.waiting.folder(window.items('folder'));delete window.waiting.folder;window.block=false")
    await page.waitForTimeout(60)
    assert.deepEqual(await page.evaluate('window.loads'), ['folder', 'folder', 'folder', 'folder'])
    await page.evaluate("window.reveal('folder/item-0999.md')")
    const last = page.locator('[data-path="folder/item-0999.md"]')
    await last.waitFor()
    await page.waitForFunction(`(() => {const row=document.querySelector('[data-path="folder/item-0999.md"]'); const list=document.querySelector('[data-tree-key] > div');const r=row.getBoundingClientRect(),s=list.getBoundingClientRect();return r.top>=s.top && r.bottom<=s.bottom})()`)
    await last.click()
    assert.equal(await page.evaluate('window.selected'), 'folder/item-0999.md')
    assert.ok(await page.locator('[data-path^="folder/item-"]').count() < 100)

    // An obsolete reply cannot resurrect a directory removed from the root.
    await page.evaluate("window.block=true;window.reveal('other/item-0000.md')")
    await page.waitForFunction('!!window.waiting.other')
    await page.evaluate('window.remove()')
    await page.waitForTimeout(30)
    await page.evaluate("window.waiting.other(window.items('other'));window.block=false")
    await page.waitForTimeout(60)
    assert.equal(await page.locator('[data-path^="other/"]').count(), 0)
    assert.deepEqual(await page.evaluate('window.notices'), [])
    assert.deepEqual(errors, [])
    await page.goto(`http://mew-explorer.test/?restore${docs ? '&docs' : ''}`)
    await page.waitForFunction(`(() => {const row=document.querySelector('[data-path="folder/item-0800.md"]'); const list=document.querySelector('[data-tree-key] > div'); if(!row)return false;const r=row.getBoundingClientRect(),s=list.getBoundingClientRect();return Math.abs((r.top+r.bottom)/2-(s.top+s.bottom)/2)<2})()`)
    await page.waitForTimeout(60)
    assert.deepEqual(await page.evaluate('window.loads'), ['folder'], 'StrictMode restored cache is refreshed once')
    // Keyboard focus reaches an unmounted neighbor, rather than skipping a virtual gap.
    await page.evaluate(`document.querySelector('[data-path="folder/item-0800.md"]').focus()`)
    for (let i = 0; i < 35; i++) await page.keyboard.press('Tab')
    assert.equal(await page.evaluate('document.activeElement.dataset.path'), 'folder/item-0835.md')
    for (let i = 0; i < 35; i++) await page.keyboard.press('Shift+Tab')
    assert.equal(await page.evaluate('document.activeElement.dataset.path'), 'folder/item-0800.md')
    await page.screenshot({ path: `/tmp/mew-explorer-${docs ? 'docs' : 'files'}-desktop.png` })
    await page.evaluate("document.documentElement.classList.add('dark')")
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: `/tmp/mew-explorer-${docs ? 'docs' : 'files'}-mobile.png` })
    assert.deepEqual(errors, [])
    await page.evaluate("window.closedFolders();document.querySelector('[data-tree-key] > div').scrollTop=0")
    await page.locator('[data-path="closed-0000"]').waitFor()
    assert.ok(await page.locator('[data-path^="closed-"]').count() < 100, 'closed folder runs are windowed too')
    await page.evaluate("window.reveal('closed-0999/item-0000.md')")
    await page.locator('[data-path="closed-0999/item-0000.md"]').waitFor()
    assert.deepEqual(await page.evaluate('window.loads'), ['folder', 'closed-0999'], 'reveal only loads the expanded target folder')
    await page.close()
  }
})
