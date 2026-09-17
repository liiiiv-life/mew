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
  const keep = new Set(['RootProjectTabs', 'FileTree', 'DockWorkspace', 'ProjectIcon', 'SubprojectLink', 'SidebarCreateButtons', 'featureCopy'])
  const stubs = new Map<string, string>()
  for (const match of appSource.matchAll(/import \{ ([^\n]+) \} from '(\.\/components\/[^']+)'/g)) {
    const names = match[1].split(',').map(n => n.trim()).filter(n => !n.startsWith('type '))
    if (names.some(n => keep.has(n))) continue
    stubs.set(match[2], names.map(name => name === 'EditorPane'
      ? `export function EditorPane({pane,onCloseTab}) { const active=pane.tabs.find(t=>t.path===pane.activePath);return React.createElement('div',{'data-test-editor':true},React.createElement('span',{'data-test-content':true},active?.content||''),...pane.tabs.map(t=>React.createElement('button',{key:t.path,onClick:()=>onCloseTab(t.path)},'Close '+t.path))); }`
      : name === 'AgentPanel' ? `export function AgentPanel({preparedTabs}) { React.useEffect(()=>{preparedTabs?.then(value=>{window.preparedAgentRoot=value.workspace})},[preparedTabs]);return null }`
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
  const content = (await Promise.all(['src/components/RootProjectTabs.tsx', 'src/components/FileTree.tsx', 'src/components/DockWorkspace.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content + appSource).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
    page.setDefaultTimeout(3000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    let active = '/alpha'
    let failSwitch = false
    const requests: { path: string; method: string; root: string; time: number }[] = []
    const persisted = new Map<string, unknown>()
    let releaseSwitch: (() => void) | undefined
    let releaseUi: (() => void) | undefined
    let blockSwitch = false, blockUi = false, blockTree = false
    const treeWaiters: (() => void)[] = []
    const fileWaiters: (() => void)[] = []
    let blockFileRoot: string | null = null
    const stateFor = (name: string) => ({ sidebar: { docsExpanded: false, expandedSubprojects: [] }, chrome: { sidebarOpen: true, sidebarView: 'tree' }, tabs: { '.workspace': { panes: [{ id: 'main', tabs: [{ path: 'README.md', preview: false, viewMode: 'plain' }, { path: 'extra.md', preview: false, viewMode: 'plain' }], activePath: 'README.md' }], layout: { kind: 'leaf', pane: 'main' }, focusedPaneId: 'main' } }, label: name })
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
      if (url.pathname === '/api/auth/me') return json({ authenticated: true, email: 'switch@example.test', role: 'owner', mustChangePassword: false, capabilities: { filesRead: true, filesWrite: true, agent: true } })
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
        return json({ version: 1, state: 'ready', entries: [{ name: captured.slice(1) + '.md', path: captured.slice(1) + '.md', type: 'file' }] })
      }
      if (url.pathname === '/api/file') {
        const delayed = captured === blockFileRoot
        if (delayed) await new Promise<void>(resolve => fileWaiters.push(resolve))
        return json({ path: url.searchParams.get('path'), content: delayed ? 'Late response from ' + captured : 'Content of ' + captured, editable: true })
      }
      if (url.pathname === '/api/projects') return json([])
      if (url.pathname.startsWith('/api/')) return json({})
      return route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    await page.goto('http://mew-switch.test/')
    await page.locator('[data-test-content]').getByText('Content of /alpha', { exact: true }).waitFor()
    const tab = (root: string) => page.locator(`[data-project-drag="${root}"]`)
    const countUi = (root: string) => requests.filter(r => r.path === '/api/user-ui/workspace' && r.method === 'GET' && r.root === root).length
    await page.locator('[data-path="@docs"]').click()
    await page.locator('[data-tree-key="sidebar-tree:docs:/alpha"] [data-path="alpha.md"]').click()
    await page.getByRole('button', { name: 'Close alpha.md' }).waitFor()
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
    await page.locator('[data-test-content]').getByText('Content of /alpha', { exact: true }).waitFor()
    releaseUi!(); blockUi = false
    await page.waitForTimeout(40)
    releaseSwitch!(); blockSwitch = false
    await page.locator('[data-test-content]').getByText('Content of /beta', { exact: true }).waitFor()
    assert.equal(countUi('/beta'), 1, 'prefetch is reused by hydration')
    assert.equal(await page.evaluate(() => (globalThis as unknown as { preparedAgentRoot: string }).preparedAgentRoot), '/beta')
    const treeCount = requests.filter(r => r.path === '/api/tree').length
    await signal(); await page.waitForTimeout(100)
    assert.equal(requests.filter(r => r.path === '/api/tree').length, treeCount, 'duplicate broadcast does not empty or reload trees')
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
    await tab('/beta').click()
    await page.locator('[data-test-content]').getByText('Content of /beta', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Close extra.md' }).count(), 0, 'recent close survives quick round trip')
    blockFileRoot = null
    for (const release of fileWaiters.splice(0)) release()
    await page.waitForTimeout(100)
    await page.locator('[data-test-content]').getByText('Content of /beta', { exact: true }).waitFor()
    const betaCache = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.includes('mew:content:') && key.includes('/beta:')).map(([, value]) => value).join(''))
    assert.doesNotMatch(betaCache, /Late response/, 'late old-root response cannot pollute the current content cache')
    failSwitch = true
    await tab('/alpha').click(); await page.waitForTimeout(100)
    await page.locator('[data-test-content]').getByText('Content of /beta', { exact: true }).waitFor()
    assert.equal(active, '/beta', 'failed switch retains current project')
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
