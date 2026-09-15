import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('sidebar create buttons target selected directories across root, Documents and subprojects', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {FileTree} from '${root}/src/components/FileTree.tsx';
import {SidebarCreateButtons} from '${root}/src/components/sidebar-create-buttons.tsx';
import {useSidebarCreate} from '${root}/src/hooks/use-sidebar-create.ts';
const noop=()=>{};const file=path=>({name:path.split('/').pop(),path,type:'file'});const dir=(path,children=[])=>({name:path.split('/').pop(),path,type:'dir',children});
function Fixture(){const [workspace,setWorkspace]=useState('/one');const [expanded,setExpanded]=useState({docs:false,'subproject:tools':false});const [guest,setGuest]=useState(false);const api=useSidebarCreate(workspace,scope=>setExpanded(old=>({...old,[scope]:true})));window.fixture={setWorkspace,setGuest};
const props={selectedPath:null,readOnly:guest,searchFocusSignal:0,newFileSignal:{n:0,parentPath:null},revealSignal:0,presence:{},onSelect:noop,onFileCreated:noop,onFolderCreated:noop,onRenamed:noop,onDeleted:noop,onGuestAccessChanged:noop,onNotice:noop,registerSearchCancel:noop};
const section=(scope,label,base,project,tree)=><section><button onClick={()=>{api.selectDirectory(scope,base);setExpanded(old=>({...old,[scope]:!old[scope]}))}}>{label}</button>{expanded[scope]&&<FileTree key={workspace+scope} {...props} {...api.treeProps(scope)} compact rootPath={base} project={project} tree={tree}/>}</section>;
return <aside className="flex h-dvh w-full max-w-sm flex-col bg-surface-deep text-ink"><div className="flex h-9 shrink-0 items-center gap-1 border-b border-edge px-2"><span>Explorer</span>{!guest&&<SidebarCreateButtons onCreate={api.create}/>}</div><FileTree key={workspace} {...props} {...api.treeProps('root')} project=".workspace" tree={[dir('src',[file('src/existing.ts')]),file('README.md')]} roots={<>{section('docs','Documents','','docs',[dir('notes',[file('notes/existing.md')])])}{section('subproject:tools','tools','tools','.workspace',[file('tools/existing.ts'),dir('tools/lib')])}</>}/></aside>}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const bundle = await build({ input: 'virtual:sidebar.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:sidebar.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) { if (id === 'virtual:sidebar.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/FileTree.tsx', 'src/components/sidebar-create-buttons.tsx', 'packages/ui/src/HoverTipLayer.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    page.setDefaultTimeout(3000)
    const errors: string[] = [], writes: Array<{ endpoint: string; project: string; relPath: string }> = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://mew-sidebar.test/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/new-document' || url.pathname === '/api/new-folder') {
        const payload = route.request().postDataJSON()
        writes.push({ endpoint: url.pathname, project: payload.project, relPath: payload.relPath })
        await route.fulfill({ json: { relPath: payload.relPath, hidden: false } }); return
      }
      if (url.pathname.startsWith('/api/')) { await route.fulfill({ json: {} }); return }
      await route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    await page.addInitScript("localStorage.setItem('mew:locale','en')")
    await page.goto('http://mew-sidebar.test/')
    const input = (kind: 'file' | 'folder') => page.getByPlaceholder(kind === 'file' ? '새 파일 이름' : '새 폴더 이름', { exact: true })
    const create = async (kind: 'file' | 'folder', name: string, project: string, parent = '') => {
      const count = writes.length
      await page.getByRole('button', { name: kind === 'file' ? 'New file' : 'New folder', exact: true }).click()
      assert.equal(await input(kind).count(), 1, 'exactly one tree accepts the request')
      await input(kind).fill(name)
      await input(kind).press('Enter')
      await input(kind).waitFor({ state: 'detached' })
      assert.equal(writes.length, count + 1)
      assert.deepEqual(writes.at(-1), { endpoint: kind === 'file' ? '/api/new-document' : '/api/new-folder', project, relPath: parent ? parent + '/' + name : name })
    }
    await create('file', 'plain', '.workspace')
    await page.getByRole('button', { name: 'src', exact: true }).click()
    await create('folder', 'nested', '.workspace', 'src')
    await page.locator('button[data-path="src/existing.ts"]').click()
    await create('file', 'new.ts', '.workspace', 'src')
    await page.getByRole('button', { name: 'Documents', exact: true }).click()
    await page.getByRole('button', { name: 'notes', exact: true }).click()
    await create('file', 'note.md', 'docs', 'notes')
    await page.getByRole('button', { name: 'Documents', exact: true }).click()
    await create('folder', 'archive', 'docs')
    await page.getByRole('button', { name: 'Documents', exact: true }).click()
    await page.getByRole('button', { name: 'Documents', exact: true }).click()
    assert.equal(await input('folder').count(), 0, 'consumed requests never replay on remount')
    await page.getByRole('button', { name: 'tools', exact: true }).click()
    await create('folder', 'bin', '.workspace', 'tools')
    await page.getByRole('button', { name: 'lib', exact: true }).click()
    await create('file', 'index.ts', '.workspace', 'tools/lib')
    await page.getByRole('button', { name: 'New folder', exact: true }).click()
    await input('folder').press('Escape')
    const beforeCancel = writes.length
    assert.equal(await input('folder').count(), 0)
    await page.evaluate("window.fixture.setWorkspace('/two')")
    await create('file', 'root.txt', '.workspace')
    assert.equal(writes.length, beforeCancel + 1)
    await page.getByRole('button', { name: 'New file', exact: true }).hover()
    await page.getByRole('tooltip').waitFor()
    await page.screenshot({ path: '/tmp/mew-sidebar-create-desktop.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'New folder', exact: true }).click()
    await input('folder').waitFor()
    await page.screenshot({ path: '/tmp/mew-sidebar-create-mobile.png' })
    await input('folder').press('Escape')
    await page.evaluate('window.fixture.setGuest(true)')
    assert.equal(await page.getByRole('button', { name: 'New file', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'New folder', exact: true }).count(), 0)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
