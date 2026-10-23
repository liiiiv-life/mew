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

test('/page names child pages before creation and keeps the parent open on desktop and mobile', { skip: !domBrowserExecutable(), timeout: 60_000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-page-command-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {EditorPane} from '${repo}/src/components/EditorPane.tsx';
    import {useTabs} from '${repo}/src/hooks/useTabs.ts';
    import {I18nProvider} from '${repo}/src/i18n.tsx';
    import {editorTabPath} from '${repo}/src/utils/editor-files.ts';
    const noop=()=>{};
    function Fixture(){
      const [notice,setNotice]=React.useState(''),[guest,setGuest]=React.useState(false);
      const tabs=useTabs('.workspace',noop,setNotice,'fixture');
      const callbacks=Object.fromEntries(['registerHandle','registerElement','registerTabBar','onPin','onCloseTab','onReorder','onOpenHistory','onSetTocOpen','onOpenSidebar','onTabDragMove','onTabDrop'].map(key=>[key,noop]));
      return <div className="flex h-dvh flex-col">
        <nav><button onClick={()=>tabs.openFile(editorTabPath('docs','abc.md'),{preview:false})}>Docs</button>
          <button onClick={()=>tabs.openFile('notes.md',{preview:false})}>Workspace</button>
          <button onClick={()=>tabs.openFile(editorTabPath('docs','readonly.md'),{preview:false})}>Readonly</button>
          <button onClick={()=>setGuest(value=>!value)}>Guest</button></nav>
        <div data-active={tabs.activePath||''} data-tabs={JSON.stringify(tabs.tabs.map(tab=>tab.path))}/>
        {tabs.panes.map(pane=><EditorPane key={pane.id} {...callbacks} pane={pane} role={guest?'guest':'owner'} authEmail={null} project=".workspace"
          tree={[]} presence={{}} focused isGuest={guest} canCollaborate={false} showSidebarButton={false} tocOpen={false} dropZone={null}
          onFocus={()=>tabs.focusPane(pane.id)} onActivate={path=>tabs.setActivePath(path,pane.id)} onSetViewMode={tabs.setTabViewMode}
          onChangeContent={tabs.updateTabContent} onOpenLink={path=>tabs.openFile(path,{preview:false,paneId:pane.id})}
          onCreateChildPage={async (path,name)=>{await tabs.createChildPage(path,name)}}/>)}
        <span role="status">{notice}</span>
      </div>
    }
    createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);
  `
  const candidates = [source], styles: string[] = []
  const bundle = await build({ input: 'virtual:page-command.tsx', write: false, platform: 'browser',
    output: { format: 'esm' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'page-command-fixture', resolveId(id) { if (id === 'virtual:page-command.tsx') return id },
      load(id) {
        if (id === 'virtual:page-command.tsx') return source
        if (id.endsWith('.tsx')) candidates.push(fs.readFileSync(id, 'utf8'))
        if (id.endsWith('.css')) { styles.push(fs.readFileSync(id, 'utf8')); return { code: '', moduleType: 'js' } }
      },
    }],
  })
  const chunks = bundle.output.filter(item => item.type === 'chunk')
  const entry = chunks.find(item => item.isEntry)!
  const scripts = new Map(chunks.map(item => [`/${item.fileName}`, item.code]))
  const compiler = await compile(fs.readFileSync(`${repo}/src/index.css`, 'utf8'), { base: `${repo}/src`, onDependency() {} })
  const css = compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + styles.join('\n')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  for (const width of [1100, 390]) {
    const workspace = path.join(root, String(width)), docs = path.join(workspace, 'docs')
    fs.mkdirSync(docs, { recursive: true })
    fs.writeFileSync(path.join(docs, 'abc.md'), '# ABC\n\nOriginal body\n\n[회의 기록](abc/회의%20기록.md)\n')
    fs.writeFileSync(path.join(docs, 'readonly.md'), 'Readonly body')
    fs.writeFileSync(path.join(workspace, 'notes.md'), 'Workspace body')
    const pages = { docs: new DocumentPages(docs), '.workspace': new DocumentPages(workspace) }
    const page = await browser.newPage({ viewport: { width, height: 800 }, hasTouch: width < 768 })
    page.setDefaultTimeout(5000)
    const errors: string[] = [], requests: { path: string; project: string }[] = []
    let deny = false, releaseCreation: (() => void) | undefined
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => { localStorage.setItem('mew:locale', 'ko'); localStorage.setItem('mew:ui-locale', 'ko') })
    await page.route('http://mew-page-command.test/**', async route => {
      const url = new URL(route.request().url()), method = route.request().method()
      const json = (value: unknown) => route.fulfill({ json: value })
      if (url.pathname === '/api/docs/pages/create') {
        const body = route.request().postDataJSON() as { path: string; project: keyof typeof pages; name: string; unique: boolean }
        requests.push(body)
        if (deny) return route.fulfill({ status: 403, json: { error: '하위 페이지를 만들 권한이 없습니다' } })
        const result = pages[body.project].create(body.path, body.name, body.unique)
        if (requests.length === 1) await new Promise<void>(resolve => { releaseCreation = resolve })
        return json(result)
      }
      if (url.pathname === '/api/file') {
        const body = method === 'PUT' ? route.request().postDataJSON() : null
        const rel = body?.path ?? url.searchParams.get('path')!
        const project = body?.project ?? url.searchParams.get('project') ?? 'docs'
        const file = path.join(project === 'docs' ? docs : workspace, rel)
        if (body) { fs.writeFileSync(file, body.content); return json({ ok: true, commit: null }) }
        if (!fs.existsSync(file)) return route.fulfill({ status: 404, json: { error: 'Missing file' } })
        return json({ path: rel, content: fs.readFileSync(file, 'utf8'), editable: rel !== 'readonly.md' })
      }
      if (url.pathname === '/api/rules') return json({ violations: [], archived: false })
      if (url.pathname === '/api/file-access') return json({ view: true, edit: true })
      if (url.pathname.startsWith('/api/')) return json([])
      if (url.pathname === '/app.js' || scripts.has(url.pathname)) return route.fulfill({ contentType: 'text/javascript', body: url.pathname === '/app.js' ? entry.code : scripts.get(url.pathname)! })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="${width > 768 ? 'dark' : ''}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` })
    })
    await page.goto('http://mew-page-command.test/')
    await page.getByRole('button', { name: 'Docs', exact: true }).click()
    const editor = page.locator('.tiptap')
    await editor.getByText('Original body', { exact: true }).waitFor()
    await editor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.press('Enter')
    await page.keyboard.type('Draft before command'); await page.keyboard.press('Enter'); await page.keyboard.type('/page')
    const command = page.getByRole('button', { name: '하위 페이지 새 하위 페이지 만들기', exact: true })
    await command.waitFor()
    await page.screenshot({ path: `/tmp/mew-page-command-${width}.png` })
    if (width > 768) await page.keyboard.press('Enter')
    else await command.tap()
    const nameInput = page.getByRole('textbox', { name: '새 문서 이름', exact: true })
    await nameInput.waitFor()
    await page.screenshot({ path: `/tmp/mew-page-name-${width}.png` })
    assert.equal(requests.length, 0, 'opening the name dialog does not create a page')
    assert.equal(await page.getByRole('button', { name: '만들기', exact: true }).isDisabled(), true)
    await nameInput.fill('회의 기록')
    await nameInput.press('Enter')
    await page.locator('[data-active$="abc.md"]').waitFor({ state: 'attached' })
    while (!releaseCreation) await page.waitForTimeout(20)
    await nameInput.waitFor({ state: 'hidden' })
    await page.waitForTimeout(100)
    assert.match(fs.readFileSync(path.join(docs, 'abc/_abc.md'), 'utf8'), /Draft before command/)
    assert.match(fs.readFileSync(path.join(docs, 'abc/_abc.md'), 'utf8'), /Original body/)
    assert.doesNotMatch(fs.readFileSync(path.join(docs, 'abc/_abc.md'), 'utf8'), /\/page/)
    await editor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('During creation')
    await page.waitForTimeout(600)
    assert.equal(fs.existsSync(path.join(docs, 'abc.md')), false, 'pending autosave does not recreate the old path')
    releaseCreation!()
    await page.locator('[data-active$="abc/_abc.md"]').waitFor({ state: 'attached' })
    await page.waitForTimeout(650)
    assert.match(fs.readFileSync(path.join(docs, 'abc/_abc.md'), 'utf8'), /During creation/)
    assert.equal(fs.existsSync(path.join(docs, 'abc.md')), false)
    assert.equal(fs.existsSync(path.join(docs, 'abc/회의 기록.md')), true)
    assert.equal(await page.getByRole('tab').count(), 1, 'creation does not open a child tab')
    async function createNamed(name: string) {
      await editor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.press('Enter')
      await page.keyboard.type('/page'); await command.click()
      await nameInput.fill(name); await nameInput.press('Enter')
    }
    await createNamed('회의 기록')
    await page.waitForTimeout(650)
    assert.equal(fs.existsSync(path.join(docs, 'abc/회의 기록 2.md')), true)
    assert.equal(requests.length, 2)
    assert.match((await page.locator('[data-active]').getAttribute('data-active'))!, /abc\/_abc.md$/)
    // A document opens only after an explicit link click.
    await editor.locator('a').filter({ hasText: '회의 기록' }).click({ modifiers: ['ControlOrMeta'] })
    await page.waitForTimeout(300)
    assert.match((await page.locator('[data-active]').getAttribute('data-active'))!, /abc\/회의 기록.md$/, JSON.stringify({errors}))
    await page.locator('[data-editor-loading]').waitFor({ state: 'hidden' })
    await createNamed('중첩 페이지')
    await page.waitForTimeout(650)
    assert.equal(fs.existsSync(path.join(docs, 'abc/회의 기록/중첩 페이지.md')), true)
    assert.match((await page.locator('[data-active]').getAttribute('data-active'))!, /회의 기록\/_회의 기록.md$/)
    await page.getByRole('button', { name: 'Workspace', exact: true }).click()
    await editor.getByText('Workspace body', { exact: true }).waitFor()
    await createNamed('작업 메모')
    await page.locator('[data-active="notes/_notes.md"]').waitFor({ state: 'attached' })
    assert.equal(fs.existsSync(path.join(workspace, 'notes/작업 메모.md')), true)
    const beforeCancel = requests.length
    await editor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.press('Enter')
    await page.keyboard.type('/page'); await command.click()
    await nameInput.fill('취소할 페이지'); await page.keyboard.press('Escape')
    assert.equal(requests.length, beforeCancel)
    deny = true
    await createNamed('거부할 페이지')
    await page.getByText('하위 페이지를 만들 권한이 없습니다', { exact: true }).waitFor()
    assert.equal(await page.locator('[data-active]').getAttribute('data-active'), 'notes/_notes.md')
    assert.equal(fs.existsSync(path.join(workspace, 'notes/거부할 페이지.md')), false)
    await page.getByRole('button', { name: 'Readonly', exact: true }).click()
    await editor.getByText('Readonly body', { exact: true }).waitFor()
    assert.equal(await editor.getAttribute('contenteditable'), 'false')
    await page.getByRole('tab').filter({ has: page.locator('[title="_notes.md"]') }).click()
    await page.getByRole('button', { name: 'Guest', exact: true }).click()
    await editor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.press('Enter'); await page.keyboard.type('/page')
    await page.getByText('일치하는 명령 없음', { exact: true }).waitFor()
    assert.equal(await command.count(), 0)
    assert.deepEqual(errors, [])
    await page.close()
  }
})
