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

test('Git opens only the current project, migrates saved tabs, docks and preserves drafts', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const files = ['src/components/git-panel.tsx', 'src/components/GitWorkbench.tsx', 'src/components/github-account.tsx', 'src/components/DockWorkspace.tsx']
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
    const errors: string[] = [], writes: string[] = [], reads: string[] = []
    let repositoryExists = true
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('http://localhost:48974/**', async (route) => {
      const url = new URL(route.request().url()), p = url.pathname
      if (route.request().method() !== 'GET') writes.push(p)
      if (p.startsWith('/api/')) {
        reads.push(url.pathname + url.search)
        const payload = p === '/api/git/github-auth' ? { available: true, login: null, environmentToken: false, busy: false, job: null }
          : p === '/api/git/repositories' ? { repositories: url.searchParams.get('project') === 'docs' ? [{ path: '' }] : [{ path: '' }, { path: 'tools/a-very-long-repository-name-for-layout-checking' }] }
          : p === '/api/git/repository' ? { repository: repositoryExists, branch: 'main', ahead: 0, behind: 0 }
            : p === '/api/git/log' ? { commits: Array.from({ length: 80 }, (_, index) => ({ hash: `abc12345${index}`, parents: index < 79 ? [`abc12345${index + 1}`] : [], subject: index === 0 ? '패널 작업: 긴 커밋 제목도 메타데이터를 밀어내지 않고 한 줄로 표시합니다' : `패널 작업 ${index}`, author: 'Tester with a long name', date: new Date(Date.now() - index * 3_600_000 - 1000).toISOString(), refs: index === 0 ? ['main', 'tag: v1'] : [] })) }
              : p.endsWith('/diff') ? { diff: 'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n' }
                : { files: Array.from({ length: 60 }, (_, index) => ({ path: index === 0 ? 'file.ts' : `src/components/long-directory-name/changed-file-${index}.tsx`, status: index % 2 ? '??' : 'M' })) }
        return route.fulfill({ json: payload })
      }
      return route.fulfill(p === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html class="dark" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    await page.addInitScript(() => {
      localStorage.setItem('mew:locale', 'ko')
      if (!localStorage.getItem('fixture:git')) localStorage.setItem('fixture:git', JSON.stringify({ tabs: [
        { project: 'docs', path: '' }, { project: '.workspace', path: 'tools/child' },
      ], activeId: 'stale-child' }))
    })
    await page.goto('http://localhost:48974/')
    let activePanelId = 'git'
    const panel = (id = activePanelId) => page.locator(`[data-dock-panel="${id}"]`)
    const bounds = async (locator: Locator) => { await locator.waitFor(); const box = await locator.boundingBox(); assert.ok(box); return box }
    const pick = async (name: string) => page.getByRole('button', { name, exact: true }).click()
    const screenshot = async (name: string) => {
      const dir = process.env.MEW_GIT_PANEL_SCREENSHOTS
      if (dir) { await fs.mkdir(dir, { recursive: true }); await page.screenshot({ path: path.join(dir, `${name}.png`) }) }
    }
    await page.getByText('커밋되지 않은 변경사항', { exact: true }).waitFor()
    assert.equal(await page.getByRole('heading', { name: '저장소 선택' }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '새 Git 탭' }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '저장소 목록' }).count(), 0)
    assert.equal(await panel().getByRole('tab').count(), 0)
    await page.getByRole('button', { name: 'GitHub 로그인', exact: true }).waitFor()
    const header = () => panel().locator('[data-dock-tab-bar]')
    assert.equal(await header().count(), 1)
    assert.equal((await bounds(header())).height, 36)
    await header().getByText('Git', { exact: true }).waitFor()
    await header().getByRole('button', { name: 'Git 닫기', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Git 닫기', exact: true }).count(), 1)
    assert.equal(await header().locator('[draggable="true"]').count(), 1)
    assert.equal(await page.getByRole('dialog').count(), 0)
    const changes = page.locator('[data-git-scroll="changes"]')
    const history = page.locator('[data-git-scroll="history"]')
    const separator = page.getByRole('separator', { name: '커밋 기록과 변경사항 높이 조절' })
    assert.equal(await page.getByText('프로젝트 루트', { exact: true }).count(), 0)
    const panelBox = await bounds(panel())
    const changesBox = await bounds(page.getByRole('region', { name: '현재 변경사항' }))
    assert.equal(await separator.getAttribute('aria-valuenow'), '20')
    const composer = page.getByRole('form', { name: '커밋 작성' })
    const composerBox = await bounds(composer)
    const historyBox = await bounds(page.getByRole('region', { name: '커밋 기록' }))
    assert.ok(Math.abs(historyBox.y - panelBox.y - 36) < 2, 'history starts below the shared-height panel header')
    assert.ok(historyBox.y + historyBox.height <= changesBox.y, 'history precedes the changes')
    assert.ok((await bounds(changes)).y + (await bounds(changes)).height <= composerBox.y, 'composer follows the changes')
    assert.ok(Math.abs(composerBox.y + composerBox.height - panelBox.y - panelBox.height) < 2, 'composer stays at the panel bottom')
    assert.ok(Math.abs(composerBox.height / (changesBox.height + historyBox.height) - .3) < .02)
    await screenshot('desktop-default')
    await page.evaluate("document.documentElement.classList.remove('dark')")
    await screenshot('desktop-light')
    await page.evaluate("document.documentElement.classList.add('dark')")
    const descriptionBefore = await bounds(page.getByLabel('커밋 설명'))
    await page.mouse.move(composerBox.x + composerBox.width - 3, composerBox.y + composerBox.height - 3)
    await page.mouse.down()
    await page.mouse.move(composerBox.x + composerBox.width - 3, composerBox.y + composerBox.height + 37, { steps: 4 })
    await page.mouse.up()
    assert.ok((await bounds(page.getByLabel('커밋 설명'))).height > descriptionBefore.height + 30, 'resizing the composer grows the description')
    const resizedComposer = await bounds(composer)
    await page.mouse.move(resizedComposer.x + resizedComposer.width - 3, resizedComposer.y + resizedComposer.height - 3)
    await page.mouse.down()
    await page.mouse.move(resizedComposer.x + resizedComposer.width - 3, resizedComposer.y + resizedComposer.height - 43, { steps: 4 })
    await page.mouse.up()
    const firstCheck = page.getByRole('checkbox', { name: 'file.ts 커밋에 포함', exact: true })
    assert.equal(await firstCheck.isChecked(), false)
    await firstCheck.check()
    assert.equal(await page.getByRole('checkbox', { name: '변경 파일 전체 선택' }).evaluate(el => (el as unknown as { indeterminate: boolean }).indeterminate), true)
    await page.getByLabel('커밋 제목', { exact: true }).fill('selected draft')
    assert.equal(await page.getByRole('button', { name: '커밋', exact: true }).isEnabled(), true)
    await firstCheck.uncheck()
    assert.equal(await page.getByRole('button', { name: '커밋', exact: true }).isEnabled(), false)
    await page.getByRole('checkbox', { name: '변경 파일 전체 선택' }).check()
    assert.equal(await changes.getByRole('checkbox', { checked: true }).count(), 60)
    await page.getByRole('checkbox', { name: '변경 파일 전체 선택' }).uncheck()
    await firstCheck.check()
    const rowBox = await bounds(history.getByRole('button').first())
    assert.equal(rowBox.height, 28)
    assert.equal(await history.locator('time').first().textContent(), '0분 전')
    assert.equal(await history.locator('time').nth(1).textContent(), '1시간 전')
    assert.equal(await history.locator('time').nth(24).textContent(), '1일 전')
    assert.equal(await history.evaluate(el => el.scrollWidth > el.clientWidth), false, 'long titles do not force horizontal scrolling')
    await changes.hover()
    await page.mouse.wheel(0, 250)
    await page.waitForFunction(`document.querySelector('[data-git-scroll="changes"]').scrollTop > 0`)
    assert.equal(await history.evaluate(el => el.scrollTop), 0)
    const changeScroll = await changes.evaluate(el => el.scrollTop)
    await history.hover()
    await page.mouse.wheel(0, 250)
    await page.waitForFunction(`document.querySelector('[data-git-scroll="history"]').scrollTop > 0`)
    assert.equal(await changes.evaluate(el => el.scrollTop), changeScroll, 'lists scroll independently')
    const handleBox = await bounds(separator)
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 100, { steps: 5 })
    await page.mouse.up()
    const draggedRatio = Number(await separator.getAttribute('aria-valuenow'))
    assert.ok(draggedRatio > 20)
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 160)
    assert.equal(Number(await separator.getAttribute('aria-valuenow')), draggedRatio, 'release stops resizing')
    await separator.focus()
    await page.keyboard.press('ArrowUp')
    assert.equal(Number(await separator.getAttribute('aria-valuenow')), draggedRatio - 5)
    await page.keyboard.press('Home')
    assert.equal(await separator.getAttribute('aria-valuenow'), '15')
    await page.keyboard.press('End')
    assert.equal(await separator.getAttribute('aria-valuenow'), '85')
    await page.keyboard.press('Home')
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown')
    await changes.evaluate(el => { el.scrollTop = 0 })
    await history.evaluate(el => { el.scrollTop = 0 })
    await screenshot('desktop-split')
    await changes.evaluate(el => { el.scrollTop = 120 })
    await history.evaluate(el => { el.scrollTop = 160 })
    await changes.getByRole('button').nth(6).click()
    await page.getByText('+new', { exact: true }).waitFor()
    await header().getByRole('button', { name: 'Git 닫기', exact: true }).waitFor()
    await pick('Git 닫기')
    await panel().waitFor({ state: 'hidden' })
    await pick('Git 열기')
    await page.getByText('+new', { exact: true }).waitFor()
    await pick('뒤로 가기')
    await separator.waitFor()
    assert.equal(await changes.evaluate(el => el.scrollTop), 120, 'returning from diff preserves changes scroll')
    assert.equal(await history.evaluate(el => el.scrollTop), 160, 'returning from diff preserves history scroll')
    assert.equal(await page.getByLabel('커밋 제목', { exact: true }).inputValue(), 'selected draft', 'direct diff returns to composer with draft intact')
    assert.equal(await firstCheck.isChecked(), true)
    await changes.evaluate(el => { el.scrollTop = 0 })
    await history.evaluate(el => { el.scrollTop = 0 })
    await page.setViewportSize({ width: 320, height: 720 })
    await page.getByRole('region', { name: '현재 변경사항' }).waitFor()
    assert.equal(await history.evaluate(el => el.scrollWidth > el.clientWidth), false)
    assert.equal((await bounds(history.getByRole('button').first())).height, 28)
    await screenshot('mobile-split')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByLabel('커밋 제목', { exact: true }).fill('KEEP DRAFT')
    await page.getByLabel('커밋 설명').fill('KEEP DESCRIPTION')
    await page.getByLabel('편집기', { exact: true }).fill('EDITOR STILL USABLE')
    assert.equal(await panel().isVisible(), true, 'outside clicks do not dismiss Git')
    await screenshot('desktop')

    const from = await bounds(header().locator('[draggable="true"]')), to = await bounds(panel('editor:main'))
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2 + 9, from.y + from.height / 2 + 9)
    await page.mouse.move(to.x + to.width / 2, to.y + to.height * .95, { steps: 12 })
    await page.locator('[data-dock-preview]').waitFor()
    await page.mouse.up()
    activePanelId = await page.evaluate<string>(`window.fixture.dock.tabs['git:'+JSON.stringify(['.workspace',''])] || 'git'`)
    await panel().waitFor()
    assert.equal(await page.getByLabel('커밋 제목', { exact: true }).inputValue(), 'KEEP DRAFT', 'dock move preserves draft')
    await pick('Git 닫기')
    await panel().waitFor({ state: 'hidden' })
    await pick('Git 열기')
    assert.equal(await page.getByLabel('커밋 제목', { exact: true }).inputValue(), 'KEEP DRAFT', 'panel reopen preserves draft')
    await page.evaluate('window.fixture.setNext(v=>v+1); window.fixture.setPrevious(v=>v+1)')
    assert.equal(await panel().getByRole('tab').count(), 0, 'next/previous cannot reopen an old child repository')
    await page.reload()
    await page.getByLabel('커밋 제목', { exact: true }).waitFor()
    assert.equal(await panel().getByRole('tab').count(), 0)
    assert.equal(await page.getByLabel('커밋 제목', { exact: true }).inputValue(), '', 'reload does not restore drafts')

    await page.setViewportSize({ width: 390, height: 844 })
    activePanelId = 'git'
    await page.getByLabel('커밋 제목', { exact: true }).fill('MOBILE DRAFT')
    assert.equal((await bounds(header())).height, 36)
    assert.equal(await header().locator('[draggable="true"]').count(), 0, 'mobile follows the shared panel grip visibility')
    const mobileHeader = await bounds(header())
    const mobileBody = await bounds(page.locator('[data-dock-body="git"]'))
    assert.equal(mobileBody.y, mobileHeader.y + mobileHeader.height, 'mobile body does not cover the header')
    await screenshot('mobile')
    await page.evaluate("document.documentElement.classList.remove('dark')")
    await screenshot('mobile-light')
    await page.evaluate("document.documentElement.classList.add('dark')")
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
    await panel().waitFor({ state: 'hidden' })
    await pick('Git 열기')
    assert.equal(await page.getByLabel('커밋 제목', { exact: true }).inputValue(), 'MOBILE DRAFT')
    await pick('Git 닫기')
    await panel().waitFor({ state: 'hidden' })
    await pick('Git 열기')
    assert.equal(await page.getByLabel('커밋 제목', { exact: true }).inputValue(), 'MOBILE DRAFT')
    assert.ok(reads.length > 0)
    assert.ok(reads.every(raw => { const url = new URL(raw, 'http://fixture'); return url.pathname !== '/api/git/repositories' && url.searchParams.get('project') === '.workspace' && (url.pathname === '/api/git/github-auth' || url.searchParams.get('path') === '') }), JSON.stringify(reads))
    repositoryExists = false; reads.length = 0
    await page.reload()
    await page.getByText('현재 프로젝트에 Git 저장소가 없습니다.', { exact: true }).waitFor()
    await header().getByRole('button', { name: 'Git 닫기', exact: true }).waitFor()
    await pick('Git 닫기')
    await panel().waitFor({ state: 'hidden' })
    await pick('Git 열기')
    assert.equal(await page.getByText('커밋되지 않은 변경사항', { exact: true }).count(), 0)
    assert.ok(reads.every(raw => ['/api/git/repository', '/api/git/github-auth'].includes(new URL(raw, 'http://fixture').pathname)), 'non-Git project never falls back to child or parent repositories')
    repositoryExists = true
    await pick('새로고침')
    await page.getByText('커밋되지 않은 변경사항', { exact: true }).waitFor()
    assert.deepEqual(writes, [], 'UI verification never mutates a repository')
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
