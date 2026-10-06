import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { DocumentPages } from './document-pages.ts'

const repo = path.resolve(import.meta.dirname, '..')

test('Documents pages navigate in place, open modifier tabs, and preserve edits across promotion', { skip: !domBrowserExecutable(), timeout: 40_000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-pages-ui-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (rel: string, body: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body) }
  write('MOC.md', '[dev](dev/MOC.md) [notes](notes.md)')
  write('dev/MOC.md', 'Development body'); write('dev/access-control.md', 'Access body')
  write('empty/_empty.md', 'Empty page body')
  write('notes.md', 'Notes body'); write('other.md', 'Other body')
  const pages = new DocumentPages(root)
  const source = `
    import React from '${repo}/node_modules/react/index.js';
    import {createRoot} from '${repo}/node_modules/react-dom/client.js';
    import {FileTree} from '${repo}/src/components/FileTree.tsx';
    import {useTabs} from '${repo}/src/hooks/useTabs.ts';
    import {I18nProvider} from '${repo}/src/i18n.tsx';
    import {editorTabPath,editorFile} from '${repo}/src/utils/editor-files.ts';
    function Fixture(){
      const [tree,setTree]=React.useState([]),[revision,setRevision]=React.useState(0),[notice,setNotice]=React.useState('');
      const tabs=useTabs('.workspace',()=>{},setNotice,'fixture');
      const refresh=()=>fetch('/api/tree?path=').then(r=>r.json()).then(({entries})=>{setTree(entries);setRevision(n=>n+1)});
      React.useEffect(()=>{refresh()},[]);
      const loadChildren=React.useCallback(rel=>fetch('/api/tree?path='+encodeURIComponent(rel)).then(r=>r.json()).then(r=>r.entries),[]);
      const selected=tabs.activePath?editorFile(tabs.activePath).path:null;
      const created=rel=>{refresh();tabs.openFile(editorTabPath('docs',rel),{preview:false})};
      return <div style={{display:'flex',height:'100vh',background:'var(--color-surface)',color:'var(--color-ink)'}}>
        <aside style={{width:280,flexShrink:0,display:'flex',minHeight:0}}><FileTree tree={tree} project="docs" documentPages stateKey="fixture" workspacePath="fixture"
          accountState={{openDirs:[]}} selectedPath={selected} readOnly={false} presence={{}} loadChildren={loadChildren}
          searchFocusSignal={0} newFileSignal={{n:0,parentPath:null}} revealSignal={0}
          treeInvalidation={{n:revision,project:'docs',version:revision,parents:['','dev','notes']}}
          onOpenGraph={()=>setNotice('graph')} onSelect={(rel,opts)=>tabs.openFile(editorTabPath('docs',rel),opts)}
          onBeforePageMutation={tabs.prepareDocumentPageMutation} onPageMutation={result=>{tabs.applyDocumentPageMutation(result);refresh()}}
          onFileCreated={created} onFolderCreated={refresh} onRenamed={()=>{}} onDeleted={(rel,type)=>{tabs.removePaths(editorTabPath('docs',rel),type);refresh()}}
          onNotice={setNotice} onOpenGit={()=>{}} registerSearchCancel={()=>{}} /></aside>
        <main style={{padding:12,flex:1,minWidth:0}}><div data-active={tabs.activePath||''} data-tabs={JSON.stringify(tabs.tabs.map(t=>t.path))}/>
          <div>{tabs.tabs.map(t=><button key={t.path} data-test-tab={t.path} onClick={()=>tabs.setActivePath(t.path)}>{editorFile(t.path).path}</button>)}</div>
          {tabs.activeTab&&<textarea aria-label="문서 본문" style={{width:'100%',height:220}} value={tabs.activeTab.content} onChange={e=>tabs.updateTabContent(tabs.activePath,e.target.value)}/>}
          <span role="status">{notice}</span>
        </main>
      </div>
    }
    createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);
  `
  const bundle = await build({ input: 'virtual:pages.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:pages.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:pages.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const compiler = await compile(fs.readFileSync(`${repo}/src/index.css`, 'utf8'), { base: `${repo}/src`, onDependency() {} })
  const content = ['src/components/FileTree.tsx', 'src/components/tree-scroll-center.ts', 'packages/ui/src/HoverTipLayer.tsx', 'packages/ui/src/dialog-frame.tsx', 'packages/ui/src/ConfirmDialog.tsx'].filter(file => fs.existsSync(`${repo}/${file}`)).map(file => fs.readFileSync(`${repo}/${file}`, 'utf8')).join('\n')
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
  page.setDefaultTimeout(3000)
  const errors: string[] = []
  const saves: string[] = []
  let releasePromotion: (() => void) | undefined
  let markPromotion: (() => void) | undefined
  const promotionStarted = new Promise<void>(resolve => { markPromotion = resolve })
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => { localStorage.setItem('mew:locale', 'ko'); localStorage.setItem('mew:ui-locale', 'ko') })
  await page.route('http://mew-pages.test/**', async route => {
    const url = new URL(route.request().url()), method = route.request().method()
    const json = (value: unknown) => route.fulfill({ json: value })
    if (url.pathname === '/api/tree') {
      const rel = url.searchParams.get('path') || ''
      const entries = fs.existsSync(path.join(root, rel)) ? fs.readdirSync(path.join(root, rel), { withFileTypes: true }).filter(entry => !entry.name.startsWith('.')).map(entry => ({ name: entry.name, path: rel ? `${rel}/${entry.name}` : entry.name, type: entry.isDirectory() ? 'dir' : 'file' })) : []
      return json({ entries, state: 'ready', version: 1 })
    }
    if (url.pathname.startsWith('/api/docs/pages/')) {
      const body = route.request().postDataJSON()
      const result = url.pathname.endsWith('/create') ? pages.create(body.path, body.name)
        : url.pathname.endsWith('/rename') ? pages.rename(body.path, body.name) : pages.delete(body.path)
      if (body.path === 'notes.md') { markPromotion!(); await new Promise<void>(resolve => { releasePromotion = resolve }) }
      return json(result)
    }
    if (url.pathname === '/api/file') {
      const rel = url.searchParams.get('path') || route.request().postDataJSON()?.path
      if (method === 'PUT') { const body = route.request().postDataJSON(); saves.push(body.path); write(body.path, body.content); return json({ ok: true, commit: null }) }
      if (!fs.existsSync(path.join(root, rel))) return route.fulfill({ status: 404, json: { error: 'missing file' } })
      return json({ content: fs.readFileSync(path.join(root, rel), 'utf8'), editable: true })
    }
    if (url.pathname === '/api/rules') return json({ violations: [], archived: false })
    if (url.pathname === '/api/file-access') return json({ view: true, edit: true })
    if (url.pathname.startsWith('/api/')) return json({})
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<html class="dark"><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"></div><script>${bundle.output.find(item => item.type === 'chunk')!.code}</script></body></html>` })
  })
  await page.goto('http://mew-pages.test/')
  await page.waitForTimeout(200)
  assert.deepEqual(errors, [], 'fixture mounts without browser errors')
  assert.equal(await page.locator('[data-document-page="notes.md"] [data-document-leaf]').getAttribute('aria-hidden'), 'true', 'leaf pages mark the disclosure slot with a decorative bullet')
  assert.equal(await page.locator('[data-document-page="notes.md"] button[aria-expanded]').count(), 0)
  const active = () => page.locator('[data-active]').getAttribute('data-active')
  const count = () => page.locator('[data-test-tab]').count()
  await page.locator('[data-path="notes.md"]').click()
  await page.getByRole('textbox', { name: '문서 본문' }).filter({ hasText: 'Notes body' }).waitFor()
  await page.getByRole('textbox', { name: '문서 본문' }).fill('Notes edited before leaving')
  await page.locator('[data-path="dev"]').click()
  await page.getByRole('textbox', { name: '문서 본문' }).filter({ hasText: 'Development body' }).waitFor()
  assert.equal(await active(), 'mew:file:docs/dev/MOC.md')
  assert.equal(await count(), 1, 'ordinary parent click replaces the current tab')
  assert.equal(fs.readFileSync(path.join(root, 'notes.md'), 'utf8'), 'Notes edited before leaving', 'navigation saves the draft before replacing its tab')
  const disclosure = page.getByRole('button', { name: 'Dev 하위 문서', exact: true })
  await disclosure.click()
  assert.equal(await active(), 'mew:file:docs/dev/MOC.md', 'disclosure only changes the child list')
  assert.equal(await page.locator('[data-path="dev/MOC.md"]').count(), 0, 'representative is hidden')
  await page.locator('[data-path="dev/access-control.md"]').click()
  await page.getByRole('textbox', { name: '문서 본문' }).filter({ hasText: 'Access body' }).waitFor()
  assert.equal(await page.locator('[data-document-page="dev/access-control.md"] [data-document-leaf]').count(), 1, 'nested leaves have a bullet too')
  assert.equal(await count(), 1, 'ordinary child click also replaces in place')
  await page.locator('[data-path="dev"]').click({ modifiers: ['Control'] })
  assert.equal(await count(), 2, 'Ctrl click retains a separate tab')
  await page.locator('[data-path="notes.md"]').click({ modifiers: ['Meta'] })
  await page.getByRole('textbox', { name: '문서 본문' }).filter({ hasText: 'Notes edited before leaving' }).waitFor()
  assert.equal(await count(), 3, 'Cmd click retains a separate tab')
  await page.getByRole('textbox', { name: '문서 본문' }).fill('Edited notes [dev](dev/MOC.md)')
  await page.getByRole('button', { name: 'Notes에 하위 문서 추가', exact: true }).click()
  const input = page.getByPlaceholder('새 문서 이름')
  await input.fill('child'); await input.press('Enter')
  await promotionStarted
  await page.getByRole('textbox', { name: '문서 본문' }).fill('Typed during promotion [dev](dev/MOC.md)')
  await page.waitForTimeout(650)
  assert.equal(fs.existsSync(path.join(root, 'notes.md')), false, 'autosave is held while the old path is being moved')
  assert.equal(fs.readFileSync(path.join(root, 'notes/_notes.md'), 'utf8'), 'Edited notes [dev](../dev/MOC.md)')
  releasePromotion!()
  await page.locator('[data-test-tab="mew:file:docs/notes/_notes.md"]').waitFor()
  await page.locator('[data-test-tab="mew:file:docs/notes/child.md"]').waitFor()
  assert.equal(fs.existsSync(path.join(root, 'notes.md')), false)
  await page.locator('[data-test-tab="mew:file:docs/notes/_notes.md"]').click()
  await page.getByRole('textbox', { name: '문서 본문' }).filter({ hasText: 'Typed during promotion [dev](../dev/MOC.md)' }).waitFor()
  await page.getByRole('textbox', { name: '문서 본문' }).fill('Edited after promotion')
  await page.waitForTimeout(650)
  assert.equal(fs.readFileSync(path.join(root, 'notes/_notes.md'), 'utf8'), 'Edited after promotion')
  assert.equal(saves.at(-1), 'notes/_notes.md', 'autosave follows the representative path')
  assert.equal(fs.existsSync(path.join(root, 'notes.md')), false, 'autosave never recreates the old leaf')
  assert.equal(await page.locator('[data-document-page="notes"] > [data-tree-sticky-depth] button[aria-expanded]').count(), 1, 'promotion replaces the bullet with a disclosure')
  await page.locator('[data-path="empty"]').click()
  await page.locator('[data-document-page="empty"] [data-document-leaf]').waitFor()
  assert.equal(await page.locator('[data-document-page="empty"] button[aria-expanded]').count(), 0, 'a loaded directory with only its representative also has a bullet')
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 700 })
    await page.locator('#root').evaluate((el, dark) => el.ownerDocument.documentElement.classList.toggle('dark', dark), width === 1100)
    await page.screenshot({ path: `/tmp/mew-document-pages-${width}.png` })
    const overflow = await page.locator('aside').evaluate(el => el.scrollWidth > el.clientWidth)
    assert.equal(overflow, false)
  }
  assert.deepEqual(errors, [])
})
