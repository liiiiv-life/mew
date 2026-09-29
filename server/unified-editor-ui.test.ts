import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('Documents and root files share tabs and moved docking while writes retain each file scope', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `
import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {EditorPane} from '${root}/src/components/EditorPane.tsx';
import {DockWorkspace,DockPanel,DockGrip} from '${root}/src/components/DockWorkspace.tsx';
import {useTabs} from '${root}/src/hooks/useTabs.ts';
import {createEditorApi} from '${root}/src/api/client.ts';
const noop=()=>{};
const callbacks=Object.fromEntries(['registerHandle','registerElement','registerTabBar','onFocus','onOpenLink','onOpenHistory','onSetTocOpen','onOpenSidebar','onTabDragMove','onTabDrop'].map(key=>[key,noop]));
function Fixture(){
 const tabs=useTabs('.workspace',noop,noop,'/fixture');
 const [dock,setDock]=React.useState(()=>JSON.parse(localStorage.getItem('test-dock')||'null'));
 window.tabs=tabs;window.dock=dock;window.docsApi=createEditorApi('docs');window.rootApi=createEditorApi('.workspace');
 const saveDock=value=>{setDock(value);localStorage.setItem('test-dock',JSON.stringify(value))};
 return <><nav><button onClick={()=>tabs.openFile('mew:file:docs/README.md',{preview:false,viewMode:'plain'})}>Open Documents</button><button onClick={()=>tabs.openFile('README.md',{preview:false,viewMode:'plain'})}>Open root</button></nav>
 <DockWorkspace value={dock} onChange={saveDock} foreground="editor" apiRef={null} onEditorDrop={()=>'main'}>
 <DockPanel id="editor:main" kind="editor" tabs={tabs.panes[0].tabs.map(t=>t.path)}><EditorPane {...callbacks} pane={tabs.panes[0]} role="owner" authEmail="owner@test" project=".workspace" tree={[]} presence={{}} focused isGuest={false} canCollaborate={false} showSidebarButton={false} tocOpen={false} dropZone={null} onActivate={tabs.setActivePath} onPin={tabs.pinTab} onCloseTab={tabs.closeTab} onReorder={tabs.reorderTabs} onChangeContent={tabs.updateTabContent} onSetViewMode={tabs.setTabViewMode}/></DockPanel>
 <DockPanel id="terminal:fixture" kind="terminal"><div data-dock-tab-bar className="flex h-9"><DockGrip group="terminal:fixture"/>Terminal</div><div>Other panel</div></DockPanel>
 </DockWorkspace></>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const bundle = await build({ input: 'virtual:unified.tsx', write: false, platform: 'browser', output: { format: 'esm' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:unified.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) { if (id === 'virtual:unified.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/EditorPane.tsx', 'src/components/TabBar.tsx', 'src/components/DockWorkspace.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
    page.setDefaultTimeout(4000)
    const errors: string[] = [], writes: { path: string; project: string; content: string }[] = [], reads: { path: string; project: string }[] = []
    const bodies = new Map([['docs', 'Documents original'], ['.workspace', 'Root original']])
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://mew-unified.test/**', route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/file') {
        if (route.request().method() === 'PUT') {
          const body = route.request().postDataJSON(); writes.push(body); bodies.set(body.project, body.content)
          return route.fulfill({ json: { ok: true } })
        }
        const project = url.searchParams.get('project')!, path = url.searchParams.get('path')!
        reads.push({ project, path })
        return route.fulfill({ json: { path, content: bodies.get(project), editable: true } })
      }
      if (url.pathname === '/api/table-layout') return route.fulfill({ json: { tables: {} } })
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} })
      return route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><style>${css}[data-dock-workspace]{position:relative;height:650px}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` })
    })
    await page.goto('http://mew-unified.test/')
    await page.getByRole('button', { name: 'Open Documents', exact: true }).click()
    await page.locator('.cm-content').filter({ hasText: 'Documents original' }).waitFor()
    const panel = page.locator('[data-dock-panel="editor:main"]')
    const terminal = page.locator('[data-dock-panel="terminal:fixture"]')
    const target = (await terminal.boundingBox())!
    const transfer = await page.evaluateHandle('new DataTransfer()')
    await panel.locator('[draggable="true"]').first().dispatchEvent('dragstart', { dataTransfer: transfer })
    const point = { dataTransfer: transfer, clientX: target.x + target.width / 2, clientY: target.y + target.height - 10 }
    await terminal.dispatchEvent('dragover', point)
    await terminal.dispatchEvent('drop', point)
    await transfer.dispose()
    await page.waitForFunction('window.dock?.tree?.axis === "col"')
    const movedDock = await page.evaluate('JSON.stringify(window.dock.tree)')
    const movedBounds = (await panel.boundingBox())!
    assert.ok(movedBounds.y > (await terminal.boundingBox())!.y)

    await page.getByRole('button', { name: 'Open root', exact: true }).click()
    await page.locator('.cm-content').filter({ hasText: 'Root original' }).waitFor()
    assert.equal(await page.getByRole('tab').count(), 2)
    assert.equal(await page.evaluate('JSON.stringify(window.dock.tree)'), movedDock)
    assert.equal((await panel.boundingBox())!.y, movedBounds.y)
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.insertText('Root edited')
    await page.waitForFunction('window.tabs.activeTab.savedContent === "Root edited"')
    await page.getByRole('tab').nth(0).click()
    await page.locator('.cm-content').filter({ hasText: 'Documents original' }).waitFor()
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.insertText('Documents edited')
    await page.waitForFunction('window.tabs.activeTab.savedContent === "Documents edited"')
    assert.ok(writes.some(write => write.project === '.workspace' && write.path === 'README.md' && write.content === 'Root edited'))
    assert.ok(writes.some(write => write.project === 'docs' && write.path === 'README.md' && write.content === 'Documents edited'))
    await page.evaluate('Promise.all([window.docsApi.fetchFile("README.md"), window.rootApi.fetchFile("README.md")])')
    assert.deepEqual(reads.slice(-2), [{ project: 'docs', path: 'README.md' }, { project: '.workspace', path: 'README.md' }])

    await page.reload()
    await page.locator('.cm-content').filter({ hasText: 'Documents edited' }).waitFor()
    assert.equal(await page.getByRole('tab').count(), 2)
    await page.getByRole('tab').nth(1).click()
    await page.locator('.cm-content').filter({ hasText: 'Root edited' }).waitFor()
    assert.equal(await page.evaluate('JSON.stringify(window.dock.tree)'), movedDock)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
