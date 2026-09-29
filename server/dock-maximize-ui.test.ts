import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
test('desktop tab double-click expands the selected panel and its tab bar, hides siblings and restores mounted sessions', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const layout = { version: 1, groups: [{ id: 'editor:main', kind: 'editor' }, ...['agent', 'terminal', 'browser', 'git'].map(id => ({ id, kind: id }))], tabs: {}, active: {}, tree: {
    axis: 'row', ratio: .7,
    first: { axis: 'row', ratio: .5, first: { axis: 'col', ratio: .5, first: { id: 'editor:main' }, second: { id: 'git' } }, second: { axis: 'col', ratio: .5, first: { id: 'agent' }, second: { id: 'terminal' } } },
    second: { id: 'browser' },
  } }
  const source = `
import React,{useState,useRef,useEffect} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {DockWorkspace,DockPanel,DockInlineBody,DockGrip} from '${root}/src/components/DockWorkspace.tsx';
import {TabBar} from '${root}/src/components/TabBar.tsx';
import {AgentPanel} from '${root}/src/components/AgentPanel.tsx';
import {BrowserPanel} from '${root}/src/components/BrowserPanel.tsx';
import {GitPanel} from '${root}/src/components/git-panel.tsx';
import {MobileDock} from '${root}/src/components/mobile-dock.tsx';
import {DialogFrame,useOverlayDismiss} from '${root}/packages/ui/src/index.ts';
window.mounts={};window.unmounts={};window.pins=0;window.layoutWrites=0;
function Probe({id}){useEffect(()=>{window.mounts[id]=(window.mounts[id]||0)+1;return()=>{window.unmounts[id]=(window.unmounts[id]||0)+1}},[]);return <textarea data-session={id} defaultValue={'Draft '+id} className="min-h-0 flex-1 bg-surface p-4 text-ink"/>}
function Fixture(){
 const [state,setState]=useState(${JSON.stringify(layout)}),[foreground,setForeground]=useState('agent');
 const [modal,setModal]=useState(false);
 useOverlayDismiss(()=>{window.panelEsc=(window.panelEsc||0)+1},{escapePhase:'bubble'});
 const [agent,setAgent]=useState(true),[terminal,setTerminal]=useState(true),[browser,setBrowser]=useState(true),[git,setGit]=useState(true),[docs,setDocs]=useState([{path:'README.md',preview:true}]);
 const ref=useRef(null);window.fixture={state,setState,setAgent,setForeground,setModal,ref};
 return <div className="flex h-dvh flex-col bg-surface-deep text-ink">
 <header data-project-tabs className="flex h-10 shrink-0 items-center border-b border-edge"><button>Project</button><div className="ml-auto"> <MobileDock active={foreground} available={['editor','agent','terminal','git','browser']} hidden={false} onSelect={panel=>{ref.current.restore();setForeground(panel)}} onNavigate={()=>{}}/></div></header>
 <div className="mew-workspace-content relative flex min-h-0 flex-1 overflow-hidden">
 <aside className="hidden w-40 shrink-0 md:block" data-sidebar>Files</aside>
 <DockWorkspace apiRef={ref} value={state} onChange={value=>{window.layoutWrites++;setState(value)}} foreground={foreground} onEditorDrop={()=>'main'}>
 <DockPanel id="editor:main" kind="editor" tabs={docs.map(d=>d.path)}>
 <div className="relative flex min-h-0 flex-1 flex-col"><div data-dock-tab-bar className="flex h-9 shrink-0"><DockGrip group="editor:main"/><TabBar tabs={docs} activePath={docs[0]?.path??null} presence={{}} onActivate={()=>{}} onPin={()=>{window.pins++}} onClose={()=>setDocs([])} onReorder={()=>{}}/></div>
 <DockInlineBody group="editor:main" className="relative flex min-h-0 flex-1 bg-surface"><Probe id="editor"/></DockInlineBody></div>
 </DockPanel>
 <AgentPanel project=".workspace" workspacePath="/fixture" tree={[]} focusedFilePath={null} onOpenFile={()=>{}} onClose={()=>setAgent(false)} onCloseTerminal={()=>setTerminal(false)} agentOpen={agent} terminalOpen={terminal}/>
 <BrowserPanel visible={browser} onClose={()=>setBrowser(false)}/>
 <GitPanel visible={git} initialState={null} onChange={()=>{}} onNotice={()=>{}} onClose={()=>setGit(false)} onPanelFocus={()=>{}}/>
 </DockWorkspace></div>
 {modal&&<DialogFrame labelledBy="fixture-modal" onClose={()=>setModal(false)}><h2 id="fixture-modal">Modal</h2><button onClick={()=>setModal(false)}>Dismiss</button></DialogFrame>}
 </div>
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const targets = ['DockWorkspace', 'TabBar', 'AgentPanel', 'BrowserPanel', 'git-panel', 'GitWorkbench', 'mobile-dock', 'github-account'].map(name => `src/components/${name}.tsx`)
  const content = (await Promise.all(targets.map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const bundle = await build({ input: 'virtual:maximize.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'fixture',
    resolveId(id) { if (id === 'virtual:maximize.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' },
    async load(id) {
      if (id === 'virtual:maximize.tsx') return source
      if (id === 'virtual:style') return ''
      if (id.endsWith('?raw')) return `export default ${JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))}`
      if (id.endsWith('/server-dom-browser.tsx')) return `import React,{useEffect} from '${root}/node_modules/react/index.js';export function ServerDomBrowserTabs(){return null};export function ServerDomBrowser({streamUrl,onController}){useEffect(()=>{window.mounts.browser=(window.mounts.browser||0)+1;onController({command:()=>{}});return()=>{window.unmounts.browser=(window.unmounts.browser||0)+1}},[]);return <textarea data-session="browser" defaultValue="Browser state" className="h-full w-full bg-surface p-4 text-ink"/>}`
    },
    transform(code, id) {
      if (!id.endsWith('/AgentPanel.tsx')) return
      const start = code.indexOf('  const renderSession = (tab:'), end = code.indexOf('  if (dock) return', start)
      assert.ok(start >= 0 && end > start)
      return code.slice(0, start) + '  const renderSession = (tab) => <SessionProbe id={tab.id}/>;\n' + code.slice(end) + `\nfunction SessionProbe({id}){useEffect(()=>{window.mounts[id]=(window.mounts[id]||0)+1;return()=>{window.unmounts[id]=(window.unmounts[id]||0)+1}},[]);return <textarea data-session={id} defaultValue={'Draft '+id} className="h-full w-full bg-surface p-4 text-ink"/>}`
    },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set((content + source).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.setDefaultTimeout(7000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const tabs = [{ id: 'a1', label: 'Agent', runtime: 'codex', cwd: '/fixture' }, { id: 't1', label: 'Terminal', runtime: 'tmux', cwd: '/fixture' }]
    await page.route('http://localhost:48978/**', async route => {
      const p = new URL(route.request().url()).pathname
      if (p === '/api/user-ui/agent-tabs') return route.fulfill({ json: { state: { tabs, activeId: 'a1' }, claims: [] } })
      if (p === '/api/agent-cwd') return route.fulfill({ json: { cwd: '/fixture' } })
      if (p === '/api/agent-runtimes') return route.fulfill({ json: { runtimes: [] } })
      if (p === '/api/agent-sets') return route.fulfill({ json: { sets: [] } })
      if (p === '/api/browser-dom/tabs') return route.fulfill({ json: [{ id: 'b1', title: 'Browser', url: 'https://example.test/', streamUrl: '/stream/b1' }] })
      if (p === '/api/git-connections/github') return route.fulfill({ json: { available: true, login: 'octocat', job: null } })
      if (p === '/api/git/repository') return route.fulfill({ json: { repository: true, branch: 'main' } })
      if (p === '/api/git/log') return route.fulfill({ json: { commits: [] } })
      if (p === '/api/git/working-tree') return route.fulfill({ json: { files: [] } })
      if (p.startsWith('/api/')) return route.fulfill({ json: {} })
      return route.fulfill(p === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html class="dark" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    await page.addInitScript("localStorage.setItem('mew:locale','ko')")
    await page.goto('http://localhost:48978/')
    const host = page.locator('[data-dock-workspace]')
    const tab = (group: string) => page.locator(`[data-dock-panel="${group}"] [role="tab"]`).first()
    const box = async (locator: Locator) => { const result = await locator.boundingBox(); assert.ok(result); return result }
    await page.locator('[data-session="a1"]').waitFor()
    await page.locator('[data-session="t1"]').fill('KEEP TERMINAL')
    await page.locator('[data-session="editor"]').fill('KEEP EDITOR')
    await page.getByLabel('커밋 제목', { exact: true }).fill('KEEP COMMIT')
    const groups = ['editor:main', 'agent', 'terminal', 'browser']
    assert.equal(await tab('git').count(), 0, 'Git has no tab bar')
    const before = await Promise.all(groups.map(id => box(page.locator(`[data-dock-panel="${id}"]`))))
    const mounts = await page.evaluate('window.mounts')
    for (const dark of [true, false]) {
    await page.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`)
    for (const group of groups) {
      await tab(group).dblclick()
      assert.equal(await host.getAttribute('data-dock-maximized'), group)
      const body = page.locator(group === 'editor:main' ? '[data-dock-inline-body="editor:main"]' : `[data-dock-body="${group}"]`).filter({ visible: true })
      const expanded = await box(body), area = await box(page.locator('.mew-workspace-content'))
      assert.equal(Math.round(expanded.x), Math.round(area.x))
      assert.equal(Math.round(expanded.y), Math.round(area.y + 36))
      assert.equal(Math.round(expanded.width), Math.round(area.width))
      assert.equal(Math.round(expanded.height), Math.round(area.height - 36))
      const bar = page.locator(`[data-dock-panel="${group}"] [data-dock-tab-bar]`)
      const expandedBar = await box(bar)
      assert.equal(Math.round(expandedBar.x), Math.round(area.x))
      assert.equal(Math.round(expandedBar.y), Math.round(area.y))
      assert.equal(Math.round(expandedBar.width), Math.round(area.width))
      assert.equal(Math.round(expandedBar.height), 36)
      assert.equal(await tab(group).evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(el.ownerDocument.elementFromPoint(r.x + 5, r.y + 5)) }), true, 'expanded tab remains available for restoring the panel')
      for (const id of groups.filter(id => id !== group)) {
        assert.equal(await tab(id).isVisible(), false, `${id} tab is hidden, including vertically split panels`)
        assert.equal(await tab(id).evaluate(el => el.closest('[inert]') !== null), true, 'hidden tabs cannot receive keyboard focus')
      }
      for (const locator of [page.getByRole('button', { name: 'Project', exact: true }), page.locator('.mobile-dock [data-dock-item="git"]')]) {
        assert.equal(await locator.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(el.ownerDocument.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }), true, 'project tabs and dock remain clickable')
      }
      assert.equal(await page.getByRole('separator', { name: '패널 크기 조절' }).count(), 0)
      if (process.env.MEW_MAXIMIZE_SCREENSHOTS && group === 'editor:main') {
        await fs.mkdir(process.env.MEW_MAXIMIZE_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: path.join(process.env.MEW_MAXIMIZE_SCREENSHOTS, `desktop-${dark ? 'dark' : 'light'}.png`) })
      }
      await tab(group).dblclick()
      assert.equal(await host.getAttribute('data-dock-maximized'), null)
      assert.deepEqual(await Promise.all(groups.map(id => box(page.locator(`[data-dock-panel="${id}"]`)))), before)
    }
    }
    assert.deepEqual(await page.evaluate('window.fixture.state.tree'), layout.tree, 'maximization never changes the saved split tree')
    assert.deepEqual(await page.evaluate('window.fixture.state.tabs'), layout.tabs, 'tab assignments are preserved')
    assert.deepEqual(await page.evaluate('window.mounts'), mounts)
    assert.deepEqual(await page.evaluate('window.unmounts'), {})
    assert.equal(await page.locator('[data-session="editor"]').inputValue(), 'KEEP EDITOR')
    assert.equal(await page.locator('[data-session="t1"]').inputValue(), 'KEEP TERMINAL')
    assert.equal(await page.getByLabel('커밋 제목', { exact: true }).inputValue(), 'KEEP COMMIT')
    assert.equal(await page.evaluate('window.pins'), 4, 'editor preview pinning still runs')
    for (const group of groups) {
      await tab(group).dblclick()
      const body = page.locator(group === 'editor:main' ? '[data-dock-inline-body="editor:main"]' : `[data-dock-body="${group}"]`).filter({ visible: true })
      await body.locator('textarea,input').first().focus()
      await page.keyboard.press('Escape')
      await page.waitForFunction("!document.querySelector('[data-dock-maximized]')")
      assert.deepEqual(await Promise.all(groups.map(id => box(page.locator(`[data-dock-panel="${id}"]`)))), before)
      assert.equal(await page.evaluate('window.panelEsc||0'), 0, 'Esc restores expansion without closing an underlying panel')
    }
    await tab('agent').dblclick()
    await page.evaluate('window.fixture.setModal(true)')
    await page.getByRole('dialog').waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(await host.getAttribute('data-dock-maximized'), 'agent', 'a modal above the expanded panel dismisses first')
    await page.keyboard.press('Escape')
    await page.waitForFunction("!document.querySelector('[data-dock-maximized]')")
    await tab('agent').focus(); await page.keyboard.press('F2')
    await page.getByLabel('탭 이름', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await tab('agent').dblclick()
    assert.equal(await tab('terminal').isVisible(), false)
    await tab('agent').focus(); await page.keyboard.press('Shift+Enter')
    assert.equal(await host.getAttribute('data-dock-maximized'), null)
    await tab('terminal').focus(); await page.keyboard.press('Shift+Enter')
    assert.equal(await host.getAttribute('data-dock-maximized'), 'terminal')
    await page.locator('.mobile-dock [data-dock-item="editor"]').click()
    assert.equal(await host.getAttribute('data-dock-maximized'), null, 'dock navigation restores other destinations')
    await tab('agent').dblclick()
    await page.locator('[data-dock-panel="agent"]').getByRole('button', { name: '새 탭', exact: true }).click()
    const picker = page.locator('[data-dock-inline-body="agent"]')
    await picker.waitFor()
    assert.equal(Math.round((await box(picker)).width), 1440, 'new-agent picker uses the expanded area')
    const pickerButton = picker.getByRole('button').first()
    await pickerButton.click({ trial: true })
    await tab('agent').click()
    assert.equal(await tab('browser').isVisible(), false)
    await tab('agent').dblclick()
    await tab('browser').dblclick()
    assert.equal(await host.getAttribute('data-dock-maximized'), 'browser')
    await tab('browser').dblclick()
    await tab('terminal').dblclick()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForFunction("!document.querySelector('[data-dock-maximized]')")
    await page.evaluate("window.fixture.setForeground('editor')")
    await tab('editor:main').dblclick()
    assert.equal(await host.getAttribute('data-dock-maximized'), null, 'mobile double-click never enters desktop expansion')
    if (process.env.MEW_MAXIMIZE_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.MEW_MAXIMIZE_SCREENSHOTS, 'mobile.png') })
    await page.setViewportSize({ width: 1440, height: 900 })
    assert.equal(await host.getAttribute('data-dock-maximized'), null)
    await tab('agent').dblclick()
    await page.evaluate("window.fixture.ref.current.preview('agent','a1',900,200)")
    await page.waitForFunction("!document.querySelector('[data-dock-maximized]')")
    assert.equal(await host.getAttribute('data-dock-maximized'), null, 'dragging restores the normal layout')
    await page.keyboard.press('Escape')
    await tab('agent').dblclick()
    await page.getByRole('button', { name: '에이전트 닫기', exact: true }).click()
    await page.waitForFunction("!document.querySelector('[data-dock-maximized]')")
    await tab('editor:main').dblclick()
    await tab('editor:main').getByRole('button').click()
    await page.waitForFunction("!document.querySelector('[data-dock-maximized]')")
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
