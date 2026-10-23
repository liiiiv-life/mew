import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('file tabs reveal lazy rows, repeat selection and explicitly reveal newly mounted Documents', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {FileTree} from '${root}/src/components/FileTree.tsx';
import {TabBar} from '${root}/src/components/TabBar.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
const noop=()=>{};
const file=path=>({path,name:path.split('/').pop(),type:'file'});
const dir=path=>({path,name:path.split('/').pop(),type:'dir'});
const target='folder/deep/target.md';
const tree=[...Array.from({length:35},(_,i)=>file('filler-'+i+'.md')),dir('folder')];
const saved={openDirs:[],scrollTop:0};
window.loads=[];window.handled=0;window.pins=0;window.closes=0;
function Fixture(){
  const [signal,setSignal]=React.useState(0);
  const [selected,setSelected]=React.useState(target);
  const [mounted,setMounted]=React.useState(true);
  const [pending,setPending]=React.useState(false);
  const [compact,setCompact]=React.useState(false);
  const props={project:'.workspace',tree,selectedPath:selected,readOnly:true,searchFocusSignal:0,newFileSignal:{n:0,parentPath:null},revealSignal:signal,presence:{},onSelect:noop,onFileCreated:noop,onFolderCreated:noop,onRenamed:noop,onDeleted:noop,onNotice:noop,registerSearchCancel:noop,accountState:saved};
  const activate=path=>{setSelected(path);setSignal(n=>n+1);setPending(true);setMounted(true)};
  return <><TabBar tabs={[{path:target,preview:false},{path:'filler-0.md',preview:false}]} activePath={selected} presence={{}} onActivate={activate} onPin={()=>window.pins++} onClose={()=>window.closes++} onReorder={noop}/>
  <button onClick={()=>{setMounted(false);setCompact(true)}}>Hide Documents</button>
  {mounted&&<div style={{height:240,width:300}}>{compact
    ? <FileTree {...props} selectedPath={null} roots={<FileTree {...props} compact revealOnMount={pending} onRevealHandled={()=>{setPending(false);window.handled++}} loadChildren={load}/>}/>
    : <FileTree {...props} revealOnMount={pending} onRevealHandled={()=>{setPending(false);window.handled++}} loadChildren={load}/>}
  </div>}</>;
}
async function load(path){window.loads.push(path);await new Promise(resolve=>setTimeout(resolve,120));return path==='folder'?[dir('folder/deep')]:[file(target)]}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const bundle = await build({ input: 'virtual:reveal.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:reveal.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) { if (id === 'virtual:reveal.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/FileTree.tsx', 'src/components/TabBar.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
    page.setDefaultTimeout(3000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://mew-reveal.test/**', route => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} })
      return route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    await page.goto('http://mew-reveal.test/')
    const tab = page.getByRole('tab').filter({ hasText: 'target.md' })
    await tab.waitFor()
    await page.waitForTimeout(300)
    assert.deepEqual(await page.evaluate('window.loads'), [], 'restoring an active tab keeps saved collapsed folders')
    const row = page.locator('button[data-path="folder/deep/target.md"]')
    const scroller = page.locator('[data-tree-key] > div').first()
    const visible = async () => page.waitForFunction(`(() => {
      const row = document.querySelector('button[data-path="folder/deep/target.md"]')
      const scroller = document.querySelector('[data-tree-key] > div')
      if (!row || !scroller) return false
      const r = row.getBoundingClientRect(), s = scroller.getBoundingClientRect()
      return r.height > 0 && r.top >= s.top && r.bottom <= s.bottom
    })()`)
    await tab.click()
    await visible()
    assert.deepEqual(await page.evaluate('window.loads'), ['folder', 'folder/deep'])
    assert.equal(await tab.getAttribute('aria-selected'), 'true')
    assert.equal(await page.evaluate('window.pins'), 0, 'single click does not pin')

    await scroller.evaluate(el => { el.scrollTop = 0 })
    await tab.click()
    await visible()
    assert.deepEqual(await page.evaluate('window.loads'), ['folder', 'folder/deep'], 'repeat selection reuses loaded children')

    await tab.getByRole('button').click()
    assert.equal(await page.evaluate('window.closes'), 1)
    const handled = await page.evaluate('window.handled')
    await page.waitForTimeout(50)
    assert.equal(await page.evaluate('window.handled'), handled, 'close does not reveal')

    await page.getByRole('button', { name: 'Hide Documents' }).click()
    await tab.click()
    await visible()
    await row.waitFor()
    assert.deepEqual(await page.evaluate('window.loads'), ['folder', 'folder/deep', 'folder', 'folder/deep'])

    // A background mobile sidebar waits until it is visible before scrolling.
    await page.reload()
    await tab.waitFor()
    const treeSurface = page.locator('[data-tree-key]').first()
    await treeSurface.evaluate(el => { el.style.display = 'none' })
    await tab.click()
    await row.waitFor({ state: 'attached' })
    assert.equal(await page.evaluate('window.handled'), 0)
    await treeSurface.evaluate(el => { el.style.display = '' })
    await visible()

    // A later tab choice wins while the previous file's directories are still loading.
    await page.reload()
    await tab.waitFor()
    await tab.click()
    await page.getByRole('tab').filter({ hasText: 'filler-0.md' }).click()
    await row.waitFor()
    await page.waitForTimeout(100)
    assert.equal(await scroller.evaluate(el => el.scrollTop), 0)

    // Manual navigation also cancels a pending reveal without waiting for the network.
    await page.reload()
    await tab.waitFor()
    await tab.click()
    await scroller.dispatchEvent('wheel')
    await row.waitFor()
    await page.waitForTimeout(100)
    assert.equal(await scroller.evaluate(el => el.scrollTop), 0)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
