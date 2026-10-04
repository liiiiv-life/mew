import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('App overlaps workspace metadata, restores warm roots and ignores duplicate handoffs', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const appSource = await fs.readFile(`${root}/src/App.tsx`, 'utf8')
  // Keep App, useTabs, FileTree, root tabs and docking real. Unrelated panels and the
  // editor renderer are inert so this measures handoff work rather than editor startup.
  const keep = new Set(['RootProjectTabs', 'ProjectLoadingOverlay', 'FileTree', 'DockWorkspace', 'ProjectIcon', 'SubprojectLink', 'SidebarCreateButtons', 'featureCopy', 'FeatureDevelopment', 'MobileDock', 'HeaderMenu'])
  const stubs = new Map<string, string>()
  for (const match of appSource.matchAll(/import \{ ([^\n]+) \} from '(\.\/components\/[^']+)'/g)) {
    const names = match[1].split(',').map(n => n.trim()).filter(n => !n.startsWith('type '))
    if (names.some(n => keep.has(n))) continue
    stubs.set(match[2], names.map(name => name === 'EditorPane'
      ? `export function EditorPane({pane,onCloseTab,onActivate}) { const active=pane.tabs.find(t=>t.path===pane.activePath);return React.createElement('div',{'data-test-editor':true,'data-test-active':pane.activePath},React.createElement('span',{'data-test-content':true},active?.content||''),...pane.tabs.flatMap(t=>[React.createElement('button',{key:'select:'+t.path,onClick:()=>onActivate(t.path)},'Select '+t.path),React.createElement('button',{key:t.path,onClick:()=>onCloseTab(t.path)},'Close '+t.path)])); }`
      : name === 'AgentPanel' ? `export function AgentPanel({preparedTabs}) { React.useEffect(()=>{preparedTabs?.then(value=>{window.preparedAgentRoot=value.workspace})},[preparedTabs]);return null }`
      : name === 'RemoteDesktop' ? `export function RemoteDesktop({onClose,dockHostRef}) { return React.createElement('div',{'role':'dialog','aria-label':'Remote desktop fixture',style:{position:'fixed',inset:0,zIndex:100,background:'var(--color-surface)'}},React.createElement('button',{onClick:onClose},'Close remote desktop'),React.createElement('div',{ref:dockHostRef})); }`
      : `export function ${name}(){return null}`).join('\n'))
  }
  const source = `import React from '${root}/node_modules/react/index.js';import {createRoot} from '${root}/node_modules/react-dom/client.js';import App from '${root}/src/App.tsx';import {I18nProvider} from '${root}/src/i18n.tsx';createRoot(document.getElementById('root')).render(<I18nProvider><App/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:switch.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id, importer) {
    if (id === 'virtual:switch.tsx') return id
    if (importer === `${root}/src/App.tsx` && stubs.has(id)) return `virtual:stub:${id}`
    if (id.endsWith('.css')) return 'virtual:style'
  }, async load(id) {
    if (id === 'virtual:switch.tsx') return source
    if (id === 'virtual:style') return ''
    if (id.startsWith('virtual:stub:')) return `import React from '${root}/node_modules/react/index.js';\n${stubs.get(id.slice('virtual:stub:'.length))}`
    if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))
  } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/RootProjectTabs.tsx', 'src/components/project-loading-overlay.tsx', 'src/components/FileTree.tsx', 'src/components/DockWorkspace.tsx', 'src/components/mobile-dock.tsx', 'src/components/HeaderMenu.tsx', 'src/components/feature-development.tsx', 'packages/ui/src/HoverTipLayer.tsx', 'packages/ui/src/dialog-frame.tsx', 'packages/ui/src/ConfirmDialog.tsx', 'packages/ui/src/select-field.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content + appSource).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, hasTouch: true })
    page.setDefaultTimeout(3000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    let active = '/alpha'
    let failSwitch = false
    const requests: { path: string; method: string; root: string; time: number }[] = []
    const persisted = new Map<string, unknown>()
    let releaseSwitch: (() => void) | undefined
    let releaseUi: (() => void) | undefined
    let blockSwitch = false, blockUi = true, blockTree = false
    let blockAuth = false, blockAccess = false, failTree = false
    const authWaiters: (() => void)[] = [], accessWaiters: (() => void)[] = []
    const treeWaiters: (() => void)[] = []
    const fileWaiters: (() => void)[] = []
    let blockFileRoot: string | null = null
    const stateFor = (name: string) => ({ sidebar: { docsExpanded: false, expandedSubprojects: [] }, chrome: { sidebarOpen: true, sidebarView: 'tree', ragOpen: true }, tabs: { '.workspace': { panes: [{ id: 'main', tabs: [{ path: 'README.md', preview: false, viewMode: 'plain' }, { path: 'extra.md', preview: false, viewMode: 'plain' }], activePath: 'README.md' }], layout: { kind: 'leaf', pane: 'main' }, focusedPaneId: 'main' } }, label: name })
    await page.addInitScript(() => {
      localStorage.setItem('mew:locale', 'ko')
      class Socket extends EventTarget {
        static OPEN = 1
        readyState = 1
        onopen: (() => void) | null = null
        onmessage: ((event: { data: string }) => void) | null = null
        onclose: (() => void) | null = null
        constructor(url: string) { super(); if (url.includes('presence')) (globalThis as unknown as { presence: Socket }).presence = this; setTimeout(() => this.onopen?.(), 0) }
        send() {}
        close() { this.readyState = 3 }
      }
      Object.defineProperty(globalThis, 'WebSocket', { value: Socket })
    })
    await page.route('http://mew-switch.test/**', async route => {
      const url = new URL(route.request().url()), method = route.request().method(), captured = active
      requests.push({ path: url.pathname, method, root: url.searchParams.get('workspace') ?? captured, time: Date.now() })
      const json = (value: unknown) => route.fulfill({ json: value })
      if (url.pathname === '/api/auth/me') {
        if (blockAuth) await new Promise<void>(resolve => authWaiters.push(resolve))
        return json({ authenticated: true, email: 'switch@example.test', role: 'owner', mustChangePassword: false, capabilities: { filesRead: true, filesWrite: true, agent: true, terminal: true, git: true, browser: true, desktop: true } })
      }
      if (url.pathname === '/api/file-access') {
        if (blockAccess) await new Promise<void>(resolve => accessWaiters.push(resolve))
        return json({ view: true, edit: true })
      }
      if (url.pathname === '/api/workspace') {
        if (method === 'POST') {
          if (blockSwitch) await new Promise<void>(resolve => { releaseSwitch = resolve })
          if (failSwitch) return route.fulfill({ status: 400, json: { error: 'missing folder' } })
          active = route.request().postDataJSON().path
          // Real presence can arrive before the POST response. Both must share one hydration.
          await page.evaluate(() => (globalThis as unknown as { presence: { onmessage: (e: { data: string }) => void } }).presence.onmessage({ data: JSON.stringify({ type: 'workspace' }) }))
          await new Promise(resolve => setTimeout(resolve, 40))
        }
        return json({ path: active, docs: 'docs', docsPath: active + '/docs', projects: [] })
      }
      if (url.pathname === '/api/project-icons/read') return json({ icons: {} })
      if (url.pathname === '/api/user-ui/root-projects') return json({ state: { paths: ['/alpha', '/beta'], icons: {}, groups: [] } })
      if (url.pathname === '/api/user-ui/agent-tabs') return json({ state: null, claims: [], workspace: url.searchParams.get('workspace') })
      if (url.pathname === '/api/user-ui/workspace') {
        if (method === 'PUT') { const body = route.request().postDataJSON(); persisted.set(body.workspacePath, body.state); return json({ state: body.state }) }
        if (blockUi) await new Promise<void>(resolve => { releaseUi = resolve })
        const name = url.searchParams.get('workspace')!
        return json({ state: persisted.get(name) ?? stateFor(name) })
      }
      if (url.pathname === '/api/tree') {
        if (blockTree) await new Promise<void>(resolve => treeWaiters.push(resolve))
        if (failTree) return route.fulfill({ status: 500, json: { error: 'refresh failed' } })
        return json({ version: 1, state: 'ready', entries: [...(url.searchParams.get('project') === 'docs' ? [{ name: 'MOC.md', path: 'MOC.md', type: 'file' }] : []), { name: captured.slice(1) + '.md', path: captured.slice(1) + '.md', type: 'file' }] })
      }
      if (url.pathname === '/api/file') {
        const delayed = captured === blockFileRoot
        if (delayed) await new Promise<void>(resolve => fileWaiters.push(resolve))
        return json({ path: url.searchParams.get('path'), content: delayed ? 'Late response from ' + captured : 'Content of ' + captured, editable: true })
      }
      if (url.pathname === '/api/features') return json({ features: [], runs: [], canEdit: true })
      if (url.pathname === '/api/agent-sets') return json({ sets: [] })
      if (url.pathname === '/api/projects') return json([])
      if (url.pathname.startsWith('/api/')) return json({})
      return route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    await page.goto('http://mew-switch.test/')
    const loading = page.getByRole('status', { name: '불러오는 중…' })
    await loading.waitFor()
    while (!releaseUi) await page.waitForTimeout(10)
    releaseUi(); blockUi = false
    await page.locator('[data-test-content]').getByText('Content of /alpha', { exact: true }).waitFor()
    const tab = (root: string) => page.locator(`[data-project-drag="${root}"]`)
    const countUi = (root: string) => requests.filter(r => r.path === '/api/user-ui/workspace' && r.method === 'GET' && r.root === root).length
    const explorerToggle = page.locator('[data-explorer-toggle]')
    const docsToggle = explorerToggle.getByRole('button', { name: '문서', exact: true })
    const filesToggle = explorerToggle.getByRole('button', { name: '파일', exact: true })
    assert.equal(await filesToggle.getAttribute('aria-pressed'), 'true')
    await page.locator('[data-path="@docs"]').click()
    assert.equal(await docsToggle.getAttribute('aria-pressed'), 'true')
    const graphEntry = page.locator('[data-docs-graph-entry]')
    assert.equal(await graphEntry.count(), 1)
    assert.ok((await graphEntry.boundingBox())!.y < (await page.locator('[data-tree-key="sidebar-tree:docs:/alpha"] [data-path="MOC.md"]').boundingBox())!.y)
    await page.locator('[data-sidebar]').getByRole('button', { name: '새 문서', exact: true }).click()
    await page.locator('[data-tree-key="sidebar-tree:docs:/alpha"]').getByPlaceholder('새 문서 이름').waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('[data-tree-key="sidebar-tree:root:/alpha"]').count(), 0)
    assert.equal(await page.locator('[data-path="@docs"]').count(), 0)
    await docsToggle.focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await filesToggle.getAttribute('aria-pressed'), 'true')
    await page.locator('[data-sidebar]').getByRole('button', { name: '새 파일', exact: true }).click()
    await page.locator('[data-tree-key="sidebar-tree:root:/alpha"]').getByPlaceholder('새 파일 이름').waitFor()
    await page.keyboard.press('Escape')
    await filesToggle.focus()
    assert.equal(await page.locator('[data-tree-key="sidebar-tree:docs:/alpha"]').count(), 0)
    await page.keyboard.press('Home')
    assert.equal(await docsToggle.getAttribute('aria-pressed'), 'true')
    if (process.env.MEW_EXPLORER_SCREENSHOTS) {
      await fs.mkdir(process.env.MEW_EXPLORER_SCREENSHOTS, { recursive: true })
      await page.locator('[data-sidebar]').screenshot({ path: path.join(process.env.MEW_EXPLORER_SCREENSHOTS, 'desktop-documents.png') })
      await filesToggle.click()
      await page.locator('[data-sidebar]').screenshot({ path: path.join(process.env.MEW_EXPLORER_SCREENSHOTS, 'desktop-files.png') })
      await docsToggle.click()
    }
    await page.locator('[data-tree-key="sidebar-tree:docs:/alpha"] [data-path="alpha.md"]').click({ modifiers: ['Control'] })
    await page.getByRole('button', { name: 'Close mew:file:docs/alpha.md' }).waitFor()
    await page.getByRole('button', { name: 'Close README.md' }).waitFor()
    await page.getByRole('button', { name: 'Select extra.md', exact: true }).click()
    assert.equal(await filesToggle.getAttribute('aria-pressed'), 'true', 'file-tab reveal selects its explorer scope')
    assert.equal(await page.locator('[data-docs-graph-entry]').count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Close mew:file:docs/alpha.md' }).isVisible(), true, 'Documents remains in the same pane when a root file is selected')
    await tab('/alpha').click()
    await page.getByRole('button', { name: 'Close README.md' }).waitFor()
    const signal = () => page.evaluate(() => (globalThis as unknown as { presence: { onmessage: (e: { data: string }) => void } }).presence.onmessage({ data: JSON.stringify({ type: 'workspace' }) }))
    blockSwitch = true; blockUi = true
    await tab('/beta').click()
    await page.waitForTimeout(80)
    assert.ok(releaseSwitch, 'switch request starts')
    assert.ok(releaseUi, 'metadata request starts before switch response')
    assert.equal(countUi('/beta'), 1)
    assert.equal(requests.filter(r => r.path === '/api/user-ui/agent-tabs' && r.root === '/beta').length, 1, 'agent metadata also starts before the switch completes')
    assert.equal(active, '/alpha')
    await loading.waitFor()
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 700 })
      assert.deepEqual(await loading.boundingBox(), { x: 0, y: 0, width, height: 700 })
      await page.screenshot({ path: `/tmp/mew-project-loading-${width}.png` })
    }
    await page.setViewportSize({ width: 1100, height: 700 })
    await page.keyboard.press('Tab')
    assert.equal(await loading.evaluate(el => el.contains(el.ownerDocument.activeElement)), false, 'loading does not capture keyboard focus')
    assert.equal(await page.locator('header').getByText('프로젝트 여는 중…').count(), 0)
    await page.locator('[data-test-content]').getByText('Content of /alpha', { exact: true }).waitFor()
    releaseUi!(); blockUi = false
    await page.waitForTimeout(40)
    releaseSwitch!(); blockSwitch = false
    await page.locator('[data-test-content]').getByText('Content of /beta', { exact: true }).waitFor()
    await loading.waitFor({ state: 'detached' })
    assert.equal(countUi('/beta'), 1, 'prefetch is reused by hydration')
    assert.equal(await page.evaluate(() => (globalThis as unknown as { preparedAgentRoot: string }).preparedAgentRoot), '/beta')
    const treeCount = requests.filter(r => r.path === '/api/tree').length
    await signal(); await page.waitForTimeout(100)
    assert.equal(requests.filter(r => r.path === '/api/tree').length, treeCount, 'duplicate broadcast does not empty or reload trees')
    // Mobile tab changes retain the editor; only reselecting the active tab reveals the sidebar.
    await page.setViewportSize({ width: 390, height: 700 })
    const mobileEditor = page.getByRole('navigation', { name: '작업 독' }).getByRole('button', { name: '에디터 화면', exact: true })
    await mobileEditor.tap()
    await page.getByRole('button', { name: 'Select extra.md', exact: true }).tap()
    assert.equal(await page.locator('[data-test-editor]').getAttribute('data-test-active'), 'extra.md')
    assert.equal(await page.locator('[data-sidebar]').isVisible(), false, 'switching files keeps the mobile editor in front')
    await page.getByRole('button', { name: 'Select extra.md', exact: true }).tap()
    await page.locator('[data-sidebar]').waitFor({ state: 'visible' })
    await mobileEditor.tap()
    await page.getByRole('button', { name: 'Select README.md', exact: true }).tap()
    assert.equal(await page.locator('[data-sidebar]').isVisible(), false)
    await page.setViewportSize({ width: 1100, height: 700 })
    await page.getByRole('button', { name: 'Close extra.md' }).click()
    await page.waitForTimeout(30)
    blockTree = true
    blockFileRoot = '/alpha'
    const warmStarted = Date.now()
    await tab('/alpha').click()
    await page.locator('[data-test-content]').getByText('Content of /alpha', { exact: true }).waitFor()
    assert.equal(countUi('/alpha'), 1, 'warm root does not wait for another UI GET')
    await page.locator('[data-path="alpha.md"]').first().waitFor()
    assert.ok(treeWaiters.length > 0, 'cached tree is visible while its refresh is still blocked')
    assert.ok(fileWaiters.length > 0, 'cached file is visible while refresh is blocked')
    console.log(`warm workspace restore: ${Date.now() - warmStarted}ms; UI metadata GETs on return: 0`)
    for (const release of treeWaiters.splice(0)) release()
    blockTree = false
    await page.waitForTimeout(100)
    assert.ok(persisted.has('/beta'), 'leaving before 500ms flushes the last outgoing layout')
    assert.equal((persisted.get('/beta') as { tabs: Record<string, unknown> }).tabs.docs, undefined, 'old-root Documents tabs must not be saved into the new root')
    await loading.waitFor()
    assert.equal(await loading.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).pointerEvents), 'none', 'warm body refresh leaves the workspace interactive')
    // Another client may change the server workspace during the pending refresh.
    active = '/beta'
    await signal()
    await page.locator('[data-test-content]').getByText('Content of /beta', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Close extra.md' }).count(), 0, 'recent close survives quick round trip')
    blockFileRoot = null
    for (const release of fileWaiters.splice(0)) release()
    await page.waitForTimeout(100)
    await page.locator('[data-test-content]').getByText('Content of /beta', { exact: true }).waitFor()
    const betaCache = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.includes('mew:content:') && key.includes('/beta:')).map(([, value]) => value).join(''))
    assert.doesNotMatch(betaCache, /Late response/, 'late old-root response cannot pollute the current content cache')
    failSwitch = true
    blockSwitch = true
    await tab('/alpha').click()
    await loading.waitFor()
    await page.waitForTimeout(100)
    releaseSwitch!(); blockSwitch = false
    await loading.waitFor({ state: 'detached' })
    await page.locator('[data-test-content]').getByText('Content of /beta', { exact: true }).waitFor()
    assert.equal(active, '/beta', 'failed switch retains current project')
    // Re-entry and reconnect refresh several independent reads; none may hide the
    // overlay before the last one settles. Keep the existing workspace underneath.
    for (const [width, trigger] of [[1100, 'visibility'], [390, 'pageshow'], [1100, 'reconnect']] as const) {
      await page.setViewportSize({ width, height: 700 })
      await page.evaluate(`document.documentElement.classList.toggle('dark', ${width === 1100})`)
      blockAuth = true; blockAccess = true; blockTree = true
      if (trigger === 'visibility') await page.evaluate(`(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
      })()`)
      else if (trigger === 'pageshow') await page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))")
      else await page.evaluate('window.presence.onopen()')
      await loading.waitFor()
      await page.waitForTimeout(100)
      assert.ok(authWaiters.length && accessWaiters.length && treeWaiters.length, 'resume starts auth, access and tree revalidation')
      assert.deepEqual(await loading.boundingBox(), { x: 0, y: 0, width, height: 700 })
      assert.equal(await loading.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)')
      assert.equal(await page.locator('[data-test-content]').textContent(), 'Content of /beta')
      if (trigger !== 'reconnect') await page.screenshot({ path: `/tmp/mew-session-refresh-${width}.png` })
      await page.keyboard.press('Escape')
      await page.keyboard.press('Tab')
      assert.equal(await loading.evaluate(el => el.contains(el.ownerDocument.activeElement)), false)
      const sidebarButton = page.getByRole('navigation', { name: '작업 독' }).getByRole('button', { name: '사이드바', exact: true })
      if (width === 390) await sidebarButton.tap()
      else await sidebarButton.click()
      await page.locator('[data-sidebar]').waitFor({ state: 'visible' })
      await sidebarButton.focus()
      await page.keyboard.press('Tab')
      assert.equal(await sidebarButton.evaluate(el => el === el.ownerDocument.activeElement), false, 'Tab moves focus while loading')
      assert.equal(await loading.count(), 1, 'interaction keeps the pending indicator visible')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      assert.equal(await loading.locator('[aria-hidden=true]').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).animationName), 'none')
      for (const release of authWaiters.splice(0)) release()
      blockAuth = false
      failTree = trigger === 'reconnect'
      for (const release of treeWaiters.splice(0)) release()
      blockTree = false
      await page.waitForTimeout(80)
      assert.equal(await loading.count(), 1, 'access checks still pending after other requests finish or fail')
      for (const release of accessWaiters.splice(0)) release()
      blockAccess = false
      await loading.waitFor({ state: 'detached' })
      failTree = false
      await page.emulateMedia({ reducedMotion: 'no-preference' })
    }
    blockTree = true
    await page.evaluate("window.presence.onmessage({data: JSON.stringify({type: 'tree'})})")
    await page.waitForTimeout(80)
    assert.ok(treeWaiters.length, 'ordinary file-watcher refresh is pending')
    assert.equal(await loading.count(), 0, 'routine background updates do not block the session')
    blockTree = false
    for (const release of treeWaiters.splice(0)) release()
    const dock = page.getByRole('navigation', { name: '작업 독' })
    assert.equal(await dock.isVisible(), true, 'desktop shows the header dock')
    assert.equal(await page.locator('[data-header-dock] .mobile-dock').count(), 1)
    const dockBounds = (await dock.boundingBox())!
    const menuBounds = (await page.getByRole('button', { name: '메뉴', exact: true }).boundingBox())!
    assert.ok(dockBounds.y >= 0 && dockBounds.y + dockBounds.height <= 48)
    assert.ok(menuBounds.x > dockBounds.x + dockBounds.width && menuBounds.x - dockBounds.x - dockBounds.width <= 12)
    assert.equal(await dock.locator('.dock-move-handle').count(), 0)
    const sidebarToggle = dock.locator('[data-dock-item=sidebar]')
    const editorToggle = dock.locator('[data-dock-item=editor]')
    const editorPanel = page.locator('[data-dock-panel^="editor:"]').first()
    await page.locator('[data-sidebar]').waitFor({ state: 'visible' })
    assert.equal(await sidebarToggle.getAttribute('aria-pressed'), 'true')
    assert.equal(await editorToggle.getAttribute('aria-pressed'), 'true', 'desktop marks every open panel')
    const highlighted = () => dock.locator('[aria-current]').getAttribute('data-dock-item')
    await page.locator('[data-test-content]').click()
    assert.equal(await highlighted(), 'editor', 'clicking an already open body updates the dock')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const dark of [true, false]) {
      await page.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`)
      const colors = await dock.evaluate(element => {
        const color = (selector: string) => element.ownerDocument.defaultView!.getComputedStyle(element.querySelector(selector)!).backgroundColor
        return { focused: color('[data-dock-item=editor]'), open: color('[data-dock-item=sidebar]'), closed: color('[data-dock-item=features]'), dock: element.ownerDocument.defaultView!.getComputedStyle(element.closest('.mew-workspace')!).backgroundColor }
      })
      assert.notEqual(colors.open, 'rgba(0, 0, 0, 0)', 'an open, unfocused panel keeps a background')
      assert.equal(colors.closed, 'rgba(0, 0, 0, 0)', 'closed panels have no highlight')
      const brightness = (color: string) => Number(color.match(/[\d.]+/g)![0]) * (color.startsWith('color(srgb ') ? 255 : 1)
      assert.ok(Math.abs(brightness(colors.focused) - brightness(colors.dock)) > Math.abs(brightness(colors.open) - brightness(colors.dock)), 'focused background is stronger than the open background in either theme')
      await page.screenshot({ path: `/tmp/mew-header-dock-app-${dark ? 'dark' : 'light'}.png` })
    }
    await page.evaluate("document.documentElement.classList.add('dark')")
    await page.locator('[data-sidebar]').click({ position: { x: 30, y: 200 } })
    assert.equal(await highlighted(), 'sidebar', 'pointer focus follows the sidebar, not the last opened panel')
    await page.getByRole('button', { name: 'Close README.md' }).focus()
    assert.equal(await highlighted(), 'editor', 'keyboard focus updates the dock')
    await page.locator('[data-sidebar] button').first().focus()
    assert.equal(await highlighted(), 'sidebar')
    await editorPanel.evaluate(el => {
      const frame = el.ownerDocument.createElement('iframe')
      frame.setAttribute('data-test-focus-frame', '')
      frame.srcdoc = '<button>Frame focus</button>'
      el.appendChild(frame)
    })
    await page.frameLocator('[data-test-focus-frame]').getByRole('button', { name: 'Frame focus' }).click()
    await page.waitForFunction(`document.querySelector('[data-dock-item=editor]').getAttribute('aria-current') === 'true'`)
    assert.equal(await highlighted(), 'editor', 'iframe focus reaches its owning panel')
    await page.locator('[data-test-focus-frame]').evaluate(el => el.remove())
    await sidebarToggle.click()
    await page.locator('[data-sidebar]').waitFor({ state: 'visible' })
    assert.equal(await sidebarToggle.getAttribute('aria-pressed'), 'true', 'selecting an open background panel keeps it open')
    assert.equal(await highlighted(), 'sidebar')
    await page.waitForFunction("document.activeElement?.closest('[data-workspace-panel]')?.getAttribute('data-workspace-panel') === 'sidebar'")
    assert.equal(await page.evaluate("document.activeElement?.closest('[data-workspace-panel]')?.getAttribute('data-workspace-panel')"), 'sidebar', 'dock selection moves keyboard focus into the panel')
    await sidebarToggle.click()
    await page.locator('[data-sidebar]').waitFor({ state: 'hidden' })
    assert.equal(await sidebarToggle.getAttribute('aria-pressed'), 'false')
    assert.equal(await sidebarToggle.getAttribute('aria-current'), null, 'closed panels cannot stay highlighted')
    assert.equal(await sidebarToggle.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'closing the refocused panel clears its background even while hovered')
    await editorPanel.waitFor({ state: 'visible' })
    await sidebarToggle.click()
    await page.locator('[data-sidebar]').waitFor({ state: 'visible' })
    const editorContent = await page.locator('[data-test-content]').textContent()
    await editorToggle.click()
    await editorPanel.waitFor({ state: 'visible' })
    assert.equal(await editorToggle.getAttribute('aria-pressed'), 'true', 'selecting the unfocused editor keeps its panes open')
    await page.locator('[data-test-content]').click()
    assert.equal(await highlighted(), 'editor')
    await editorToggle.click()
    await editorPanel.waitFor({ state: 'hidden' })
    assert.equal(await editorToggle.getAttribute('aria-pressed'), 'false')
    assert.equal(await editorToggle.getAttribute('aria-current'), null)
    assert.equal(await editorToggle.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'closing the focused panel clears its stronger highlight')
    await page.locator('[data-sidebar]').waitFor({ state: 'visible' })
    await page.setViewportSize({ width: 390, height: 700 })
    await editorToggle.tap()
    await editorPanel.waitFor({ state: 'visible' })
    await editorToggle.tap()
    await editorPanel.waitFor({ state: 'visible' })
    assert.equal(await editorToggle.getAttribute('aria-pressed'), null, 'mobile uses navigation, not toggle state')
    await page.waitForFunction(el => el!.ownerDocument.defaultView!.getComputedStyle(el!).backgroundColor === 'rgba(0, 0, 0, 0)', await editorToggle.elementHandle())
    await page.setViewportSize({ width: 1100, height: 700 })
    await page.locator('[data-test-content]').click()
    await editorToggle.click()
    await editorPanel.waitFor({ state: 'hidden' })
    await editorToggle.focus()
    await page.keyboard.press('Enter')
    await editorPanel.waitFor({ state: 'visible' })
    assert.equal(await page.locator('[data-test-content]').textContent(), editorContent, 'hiding the editor preserves its tabs and content')
    for (const panel of ['agent', 'terminal', 'git']) {
      const button = dock.locator(`[data-dock-item=${panel}]`)
      const before = await button.getAttribute('aria-pressed')
      await button.click()
      assert.equal(await button.getAttribute('aria-pressed'), 'true')
      await page.locator('[data-test-content]').click()
      await button.focus()
      await page.keyboard.press('Enter')
      assert.equal(await button.getAttribute('aria-pressed'), 'true', 'keyboard selection keeps an open background panel open')
      assert.equal(await highlighted(), panel)
      await button.click()
      assert.equal(await button.getAttribute('aria-pressed'), 'false', 'only selecting the focused panel closes it')
      if (before === 'true') await button.click()
    }
    const openMenuPanel = async (label: string) => {
      await page.getByRole('button', { name: '메뉴', exact: true }).click()
      await page.getByRole('menuitem', { name: label, exact: true }).click()
    }
    await openMenuPanel('원격 데스크톱')
    await page.getByRole('dialog', { name: 'Remote desktop fixture' }).waitFor()
    await page.getByRole('button', { name: 'Close remote desktop', exact: true }).click()
    await page.getByRole('dialog', { name: 'Remote desktop fixture' }).waitFor({ state: 'detached' })
    const featureToggle = dock.locator('[data-dock-item=features]')
    await featureToggle.click()
    const desktopFeatures = page.getByRole('region', { name: '기능', exact: true })
    await desktopFeatures.waitFor()
    await desktopFeatures.getByText('읽기 전용', { exact: true }).waitFor()
    assert.equal((await desktopFeatures.locator('header').boundingBox())!.height, 36)
    const featureGrip = desktopFeatures.locator('[draggable=true]')
    assert.equal(await featureGrip.count(), 1, 'desktop uses the shared panel grip')
    const widthBeforeResize = (await desktopFeatures.boundingBox())!.width
    const featureSeparator = page.locator('[data-dock-workspace] > [role=separator]').last()
    const resizeBounds = (await featureSeparator.boundingBox())!
    await page.mouse.move(resizeBounds.x + resizeBounds.width / 2, resizeBounds.y + 80)
    await page.mouse.down()
    await page.mouse.move(resizeBounds.x - 70, resizeBounds.y + 80, { steps: 5 })
    await page.mouse.up()
    assert.ok((await desktopFeatures.boundingBox())!.width > widthBeforeResize + 50, 'shared divider resizes the feature panel')
    const dockedEditor = page.locator('[data-dock-panel]').filter({ has: page.locator('[data-test-editor]') })
    const editorBounds = (await dockedEditor.boundingBox())!
    await featureGrip.dragTo(dockedEditor, { targetPosition: { x: editorBounds.width / 2, y: editorBounds.height - 10 } })
    const movedFeatures = (await desktopFeatures.boundingBox())!
    const movedEditor = (await dockedEditor.boundingBox())!
    assert.ok(movedFeatures.y >= movedEditor.y + movedEditor.height, 'grip docks features below the editor')
    const heightSeparator = page.locator('[data-dock-workspace] > [role=separator][aria-orientation=horizontal]').last()
    await heightSeparator.focus()
    await page.keyboard.press('ArrowUp')
    assert.ok((await desktopFeatures.boundingBox())!.height > movedFeatures.height, 'stacked feature panel supports keyboard height adjustment')
    assert.equal(await desktopFeatures.getByRole('textbox').count(), 0, 'docking preserves the read-only panel')
    assert.equal(await highlighted(), 'features')
    await page.locator('[data-test-content]').click()
    assert.equal(await highlighted(), 'editor', 'opening features does not pin its highlight')
    await featureToggle.click()
    assert.equal(await highlighted(), 'features')
    assert.equal(await featureToggle.getAttribute('aria-pressed'), 'true')
    assert.equal(await desktopFeatures.getByRole('textbox').count(), 0)
    await featureToggle.click()
    await desktopFeatures.waitFor({ state: 'detached' })
    assert.equal(await featureToggle.getAttribute('aria-pressed'), 'false')
    await page.setViewportSize({ width: 390, height: 700 })
    await dock.waitFor()
    const sidebar = page.locator('[data-sidebar]')
    await dock.getByRole('button', { name: '에디터 화면', exact: true }).tap()
    assert.equal(await sidebar.isVisible(), false)
    await dock.getByRole('button', { name: '사이드바', exact: true }).tap()
    await sidebar.waitFor({ state: 'visible' })
    await dock.getByRole('button', { name: '사이드바', exact: true }).tap()
    assert.equal(await sidebar.isVisible(), true, 'selecting current dock panel does not close it')
    await dock.getByRole('button', { name: '에디터 화면', exact: true }).tap()
    await dock.getByRole('button', { name: '사이드바', exact: true }).tap()
    await docsToggle.tap()
    const toggleBounds = (await explorerToggle.boundingBox())!, sidebarBounds = (await sidebar.boundingBox())!
    assert.ok(toggleBounds.y < sidebarBounds.y + sidebarBounds.height / 2)
    assert.ok(toggleBounds.width >= sidebarBounds.width - 20)
    assert.ok(toggleBounds.y + toggleBounds.height <= sidebarBounds.y + sidebarBounds.height)
    if (process.env.MEW_EXPLORER_SCREENSHOTS) {
      await sidebar.evaluate(el => el.ownerDocument.documentElement.classList.remove('dark'))
      await page.mouse.move(0, 0)
      await sidebar.screenshot({ path: path.join(process.env.MEW_EXPLORER_SCREENSHOTS, 'mobile-documents.png') })
    }
    await filesToggle.tap()
    if (process.env.MEW_EXPLORER_SCREENSHOTS) await sidebar.screenshot({ path: path.join(process.env.MEW_EXPLORER_SCREENSHOTS, 'mobile-files.png') })
    await sidebar.locator('[data-path="beta.md"]').first().tap()
    await dock.getByRole('button', { name: '에디터 화면', exact: true }).tap()
    const cdp = await page.context().newCDPSession(page)
    const swipe = async (dx: number) => {
      const box = (await dock.boundingBox())!
      const x = box.x + box.width / 2, y = box.y + box.height / 2
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    const selectedDocument = await page.locator('[data-test-editor]').getAttribute('data-test-active')
    await swipe(65)
    await sidebar.waitFor({ state: 'visible' })
    assert.equal(await dock.locator('[data-dock-item=sidebar]').getAttribute('aria-current'), 'page', 'swipe goes directly to sidebar despite an available previous editor tab')
    await swipe(-65)
    assert.equal(await dock.locator('[data-dock-item=editor]').getAttribute('aria-current'), 'page')
    assert.equal(await page.locator('[data-test-editor]').getAttribute('data-test-active'), selectedDocument, 'panel switching preserves the selected document')
    await swipe(-65)
    assert.equal(await dock.locator('[data-dock-item=agent]').getAttribute('aria-current'), 'page', 'right swipe skips document tabs and selects the next panel')
    await swipe(65)
    assert.equal(await dock.locator('[data-dock-item=editor]').getAttribute('aria-current'), 'page')
    await openMenuPanel('원격 데스크톱')
    await page.getByRole('dialog', { name: 'Remote desktop fixture' }).waitFor()
    await page.getByRole('button', { name: 'Close remote desktop', exact: true }).click()
    await openMenuPanel('브라우저')
    await page.getByRole('dialog', { name: 'Remote desktop fixture' }).waitFor({ state: 'detached' })
    assert.equal(await dock.locator('[data-dock-item=browser]').count(), 0)
    await dock.getByRole('button', { name: '기능', exact: true }).tap()
    const features = page.getByRole('region', { name: '기능', exact: true })
    await features.waitFor()
    assert.equal(await page.getByRole('dialog').count(), 0, 'features occupies a workspace panel without a modal overlay')
    assert.equal((await features.locator('header').boundingBox())!.height, 36)
    assert.equal(await features.locator('[draggable=true]').count(), 0, 'mobile omits the panel grip')
    assert.ok((await features.boundingBox())!.y + (await features.boundingBox())!.height <= (await dock.boundingBox())!.y, 'panel leaves the dock accessible')
    await features.getByText('읽기 전용', { exact: true }).waitFor()
    await dock.getByRole('button', { name: '에디터 화면', exact: true }).tap()
    await features.waitFor({ state: 'hidden' })
    assert.equal(await dock.locator('[data-dock-item=editor]').getAttribute('aria-current'), 'page')
    await dock.getByRole('button', { name: '기능', exact: true }).tap()
    assert.equal(await features.getByRole('textbox').count(), 0)
    await swipe(65)
    await features.waitFor({ state: 'hidden' })
    assert.equal(await dock.locator('[data-dock-item=git]').getAttribute('aria-current'), 'page')
    await swipe(-65)
    await features.waitFor()
    assert.equal(await features.getByRole('textbox').count(), 0)
    assert.equal(await dock.locator('[data-dock-item=features]').getAttribute('aria-current'), 'page')
    await page.screenshot({ path: '/tmp/mew-feature-panel-mobile.png' })
    await page.keyboard.press('Escape')
    await features.waitFor({ state: 'detached' })
    assert.equal(await dock.locator('[data-dock-item=git]').getAttribute('aria-current'), 'page')
    await dock.getByRole('button', { name: '기능', exact: true }).tap()
    await features.waitFor()
    await page.waitForResponse(response => {
      if (!response.url().includes('/api/user-ui/workspace') || response.request().method() !== 'PUT') return false
      const state = response.request().postDataJSON().state
      return state.chrome?.featuresOpen === true && state.dock?.groups.some((group: { kind: string }) => group.kind === 'features')
    })
    await page.reload()
    await page.locator('[data-test-editor]').waitFor({ state: 'attached' })
    await features.waitFor()
    assert.equal(await dock.locator('[data-dock-item=features]').getAttribute('aria-current'), 'page', 'reload restores the foreground feature panel')
    await page.setViewportSize({ width: 1100, height: 700 })
    await features.waitFor()
    await features.locator('[draggable=true]').waitFor()
    const restoredEditor = (await dockedEditor.boundingBox())!
    const restoredFeatures = (await features.boundingBox())!
    assert.ok(restoredFeatures.y >= restoredEditor.y + restoredEditor.height - 1, `docking survives closing, reopening, mobile navigation and reload: ${JSON.stringify({ restoredEditor, restoredFeatures })}`)
    await page.screenshot({ path: '/tmp/mew-feature-panel-desktop.png' })
    await features.getByRole('button', { name: '닫기', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 700 })
    await dock.getByRole('button', { name: '사이드바', exact: true }).tap()
    for (const dark of [false, true]) {
      await page.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`)
      await page.screenshot({ path: `/tmp/mew-mobile-dock-app-${dark ? 'dark' : 'light'}.png` })
    }
    assert.equal(await page.locator('[data-mobile-sidebar-opener]').count(), 0)
    // Restore two real editor panes and switch them through the mobile picker.
    persisted.set(active, { ...stateFor(active), tabs: { '.workspace': {
      panes: [
        { id: 'main', tabs: [{ path: 'README.md', preview: false, viewMode: 'plain' }], activePath: 'README.md' },
        { id: 'second', tabs: [{ path: 'extra.md', preview: false, viewMode: 'plain' }], activePath: 'extra.md' },
      ],
      layout: { kind: 'split', dir: 'row', kids: [{ kind: 'leaf', pane: 'main' }, { kind: 'leaf', pane: 'second' }] },
      focusedPaneId: 'main',
    } } })
    await page.reload()
    await dock.locator('[data-dock-item=editor]').tap()
    const panePicker = page.getByRole('combobox')
    await panePicker.waitFor()
    assert.equal(await page.locator('select, datalist').count(), 0)
    await panePicker.tap()
    const list = page.getByRole('listbox')
    const listBounds = await list.boundingBox()
    assert.ok(listBounds && listBounds.x >= 0 && listBounds.x + listBounds.width <= 390)
    await page.getByRole('option', { name: '2 · extra.md', exact: true }).tap()
    assert.equal(await page.locator('[data-test-editor]:visible').getAttribute('data-test-active'), 'extra.md')
    await panePicker.click(); await panePicker.press('Escape')
    assert.equal(await list.count(), 0)
    assert.equal(await page.locator('[data-test-editor]:visible').getAttribute('data-test-active'), 'extra.md')
    await page.screenshot({ path: '/tmp/mew-mobile-pane-dropdown.png' })
    // The real App menu keeps secondary actions; workspace panels stay in the dock.
    for (const width of [390, 1100]) for (const dark of [false, true]) {
      await page.setViewportSize({ width, height: 700 })
      await page.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`)
      await page.getByRole('button', { name: '메뉴', exact: true }).click()
      const menu = page.getByRole('menu', { name: '메뉴', exact: true })
      await menu.waitFor()
      for (const label of ['기능', 'Git', '에이전트', '터미널']) {
        assert.equal(await menu.getByRole('menuitem', { name: new RegExp(`^${label}(?:\\s|$)`) }).count(), 0, `${label} is only in the dock`)
      }
      for (const id of ['agent', 'terminal', 'git', 'features']) {
        assert.equal(await dock.locator(`[data-dock-item=${id}]`).isVisible(), true, `${id} remains accessible`)
      }
      for (const [id, label] of [['browser', '브라우저'], ['desktop', '원격 데스크톱']]) {
        assert.equal(await dock.locator(`[data-dock-item=${id}]`).count(), 0)
        assert.equal(await menu.getByRole('menuitem', { name: label, exact: true }).isVisible(), true)
      }
      assert.equal(await dock.locator('[data-dock-item=rag]').count(), 0)
      assert.equal(await menu.getByRole('menuitem', { name: 'RAG', exact: true }).count(), 0)
      assert.equal(await menu.getByRole('menuitem', { name: '설정', exact: true }).isVisible(), true)
      assert.equal(await menu.getByRole('menuitem', { name: '전체화면', exact: false }).isVisible(), true)
      await page.screenshot({ path: `/tmp/mew-header-menu-${width}-${dark ? 'dark' : 'light'}.png` })
      await page.keyboard.press('Escape')
      await menu.waitFor({ state: 'detached' })
    }
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
