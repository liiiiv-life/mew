import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..'), require = createRequire(`${root}/package.json`)

test('Git repository tabs dock, preserve drafts, restore and share mobile dismissal', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const files = ['src/components/git-panel.tsx', 'src/components/GitWorkbench.tsx', 'src/components/DockWorkspace.tsx']
  const content = (await Promise.all(files.map((file) => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const source = `
import React,{useCallback,useEffect,useRef,useState} from '${require.resolve('react')}';
import {createRoot} from '${require.resolve('react-dom/client')}';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {DockWorkspace,DockPanel} from '${root}/src/components/DockWorkspace.tsx';
import {GitPanel} from '${root}/src/components/git-panel.tsx';
import {useWorkspacePanelDismissals} from '${root}/src/hooks/use-panel-dismissals.ts';
import {WORKSPACE_PANEL_IDS} from '${root}/src/utils/mobile-panel-stack.ts';
import {dispatchFocusedShortcut} from '${root}/packages/shortcuts/src/focusedShortcutScope.ts';
function Fixture(){
  const [dock,setDock]=useState(JSON.parse(localStorage.getItem('fixture:dock')||'null'));
  const [git,setGit]=useState(JSON.parse(localStorage.getItem('fixture:git')||'null'));
  const [open,setOpen]=useState(true),[foreground,setForeground]=useState('git');
  const [next,setNext]=useState(0),[previous,setPrevious]=useState(0),[close,setClose]=useState(0);
  const ref=useRef(null);
  const saveDock=useCallback(value=>{setDock(value);localStorage.setItem('fixture:dock',JSON.stringify(value))},[]);
  const saveGit=useCallback(value=>{setGit(value);localStorage.setItem('fixture:git',JSON.stringify(value))},[]);
  const dismiss=()=>{setOpen(false);setForeground(null)};
  useWorkspacePanelDismissals(Object.fromEntries(WORKSPACE_PANEL_IDS.map(id=>[id,{open:id==='git'&&open,close:dismiss}])),foreground);
  useEffect(()=>{const key=event=>{if(event.ctrlKey&&event.key==='w'&&dispatchFocusedShortcut('closeTab',event)==='handled')event.preventDefault()};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[]);
  window.fixture={dock,git,setOpen,setForeground,setNext,setPrevious,setClose};
  return <div className="flex h-dvh flex-col bg-surface-deep text-ink">
    <header className="flex h-10 shrink-0 items-center gap-4 px-3"><button onClick={()=>{setOpen(true);setForeground('git')}}>Git 열기</button><button onClick={()=>setForeground(null)}>편집기 보기</button></header>
    <DockWorkspace apiRef={ref} value={dock} onChange={saveDock} onEditorDrop={()=>''} foreground={foreground}>
      <DockPanel id="editor:main" kind="editor"><div className="h-9 shrink-0 border-b border-edge px-3 text-xs">README.md</div><textarea aria-label="편집기" className="h-full w-full bg-surface-deep p-3" defaultValue="문서 편집 중"/></DockPanel>
      <GitPanel visible={open} initialState={git} onChange={saveGit} onNotice={()=>{}} onClose={dismiss} onPanelFocus={()=>setForeground('git')} nextTabSignal={next} previousTabSignal={previous} closeTabSignal={close}/>
    </DockWorkspace>
  </div>
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:git.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:git.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) { if (id === 'virtual:git.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) } }] })
  const chunk = bundle.output.find((item) => item.type === 'chunk')
  assert.ok(chunk && chunk.type === 'chunk')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.setDefaultTimeout(6000)
    const errors: string[] = [], writes: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('http://localhost:48974/**', async (route) => {
      const url = new URL(route.request().url()), p = url.pathname
      if (route.request().method() !== 'GET') writes.push(p)
      if (p.startsWith('/api/')) {
        const payload = p === '/api/git/repositories' ? { repositories: url.searchParams.get('project') === 'docs' ? [{ path: '' }] : [{ path: '' }, { path: 'tools/a-very-long-repository-name-for-layout-checking' }] }
          : p === '/api/git/repository' ? { branch: 'main', ahead: 0, behind: 0 }
            : p === '/api/git/log' ? { commits: [{ hash: 'abc12345', parents: [], subject: '패널 작업', author: 'Tester', date: '2026-09-12T00:00:00Z', refs: ['main'] }] }
              : p.endsWith('/diff') ? { diff: 'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n' }
                : { files: [{ path: 'file.ts', status: 'M' }] }
        return route.fulfill({ json: payload })
      }
      return route.fulfill(p === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html class="dark" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    await page.addInitScript("localStorage.setItem('mew:locale','ko')")
    await page.goto('http://localhost:48974/')
    const panel = (id = 'git') => page.locator(`[data-dock-panel="${id}"]`)
    const bounds = async (locator: Locator) => { await locator.waitFor(); const box = await locator.boundingBox(); assert.ok(box); return box }
    const pick = async (name: string) => page.getByRole('button', { name, exact: true }).click()
    const screenshot = async (name: string) => {
      const dir = process.env.MEW_GIT_PANEL_SCREENSHOTS
      if (dir) { await fs.mkdir(dir, { recursive: true }); await page.screenshot({ path: path.join(dir, `${name}.png`) }) }
    }
    await page.getByRole('heading', { name: '저장소 선택' }).waitFor()
    assert.equal(await page.getByRole('dialog').count(), 0)
    await pick('루트 프로젝트 현재 프로젝트 루트')
    await page.getByRole('button', { name: /커밋되지 않은 변경사항/ }).click()
    await page.getByLabel('커밋 제목', { exact: true }).fill('KEEP DRAFT')
    await page.getByLabel('커밋 설명').fill('KEEP DESCRIPTION')
    await page.getByLabel('편집기', { exact: true }).fill('EDITOR STILL USABLE')
    assert.equal(await panel().isVisible(), true, 'outside clicks do not dismiss Git')
    await pick('새 Git 탭')
    await pick('Documents Documents 저장소')
    await pick('새 Git 탭')
    await pick('루트 프로젝트 현재 프로젝트 루트')
    assert.equal(await panel().getByRole('tab').count(), 2, 'same repository selects its existing tab')
    assert.equal(await page.getByLabel('커밋 제목', { exact: true }).inputValue(), 'KEEP DRAFT')
    await screenshot('desktop')

    const dragTo = async (tab: Locator, target: Locator, xpart: number, ypart: number) => {
      const from = await bounds(tab), to = await bounds(target)
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      await page.mouse.down()
      await page.mouse.move(from.x + from.width / 2 + 9, from.y + from.height / 2 + 9)
      await page.mouse.move(to.x + to.width * xpart, to.y + to.height * ypart, { steps: 12 })
      await page.locator('[data-dock-preview]').waitFor()
      await page.mouse.up()
    }
    await dragTo(panel().getByRole('tab', { name: /^Documents/ }), panel(), .5, .95)
    const detached = await page.evaluate<string>(`window.fixture.dock.tabs['git:'+JSON.stringify(['docs',''])]`)
    assert.ok(detached.startsWith('git:'))
    await panel(detached).waitFor()
    assert.equal(await page.getByLabel('커밋 제목', { exact: true }).inputValue(), 'KEEP DRAFT', 'split preserves draft')
    await dragTo(panel(detached).getByRole('tab', { name: /^Documents/ }), panel().locator('[data-dock-tab-bar]'), .9, .5)
    await panel(detached).waitFor({ state: 'hidden' })
    await panel().getByRole('tab', { name: /^루트 프로젝트/ }).focus()
    await page.keyboard.press('Enter')
    await page.getByLabel('커밋 설명').waitFor()
    assert.equal(await page.getByLabel('커밋 설명').inputValue(), 'KEEP DESCRIPTION', 'merge preserves draft')
    await pick('Git 닫기')
    await panel().waitFor({ state: 'hidden' })
    await pick('Git 열기')
    assert.equal(await page.getByLabel('커밋 제목', { exact: true }).inputValue(), 'KEEP DRAFT', 'panel hide/reopen preserves draft')
    await page.evaluate('window.fixture.setNext(v=>v+1)')
    await page.waitForFunction(`document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('Documents')`)
    await page.evaluate('window.fixture.setPrevious(v=>v+1)')
    await page.waitForFunction(`document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('루트 프로젝트')`)
    assert.equal(await page.evaluate(`JSON.parse(localStorage.getItem('fixture:dock')).active.git`), JSON.stringify(['.workspace', '']), 'selected tab is persisted before reload')
    await page.reload()
    await panel().getByRole('tab', { name: /^Documents/ }).waitFor()
    assert.equal(await panel().getByRole('tab').count(), 2)
    assert.equal(await panel().getByRole('tab', { name: /^루트 프로젝트/ }).getAttribute('aria-selected'), 'true', await page.evaluate(`JSON.stringify({dock:window.fixture.dock,git:window.fixture.git})`))
    await page.getByRole('button', { name: /커밋되지 않은 변경사항/ }).click()
    assert.equal(await page.getByLabel('커밋 제목', { exact: true }).inputValue(), '', 'reload restores repository identity, not draft content')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByLabel('커밋 제목', { exact: true }).fill('MOBILE DRAFT')
    await screenshot('mobile')
    assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth'), false)
    await pick('편집기 보기')
    await page.getByLabel('편집기', { exact: true }).waitFor()
    await pick('Git 열기')
    assert.equal(await page.getByLabel('커밋 제목', { exact: true }).inputValue(), 'MOBILE DRAFT')
    await page.keyboard.press('Escape')
    await panel().waitFor({ state: 'hidden' })
    await pick('Git 열기')
    await page.getByLabel('커밋 제목', { exact: true }).focus()
    await page.keyboard.press('Control+w')
    await page.waitForFunction(`document.querySelectorAll('[role="tab"]').length === 1`)
    await panel().getByRole('button', { name: 'Documents 탭 닫기' }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: '저장소 선택' }).waitFor()
    assert.deepEqual(writes, [], 'UI verification never mutates a repository')
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
