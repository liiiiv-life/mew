import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import type { MewcatAction } from '../shared/mewcat-assistant.ts'

const root = path.resolve(import.meta.dirname, '..')
type Fixture = { assistant: { projectRoot: string | null; onAction: (action: MewcatAction) => Promise<void> }; workTab: { id: string; runtime: string; cwd: string } }

test('Mewcat tools use real App project switching, Documents tabs and reviewed work-session drafts', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const app = await fs.readFile(`${root}/src/App.tsx`, 'utf8')
  const keep = new Set(['RootProjectTabs', 'ProjectLoadingOverlay', 'FileTree', 'DockWorkspace', 'ProjectIcon', 'SubprojectLink', 'SidebarCreateButtons', 'MobileDock', 'HeaderMenu'])
  const stubs = new Map<string, string>()
  for (const match of app.matchAll(/import \{ ([^\n]+) \} from '(\.\/components\/[^']+)'/g)) {
    const names = match[1].split(',').map(name => name.trim()).filter(name => !name.startsWith('type '))
    if (names.some(name => keep.has(name))) continue
    stubs.set(match[2], names.map(name => name === 'Mewcat'
      ? 'export function Mewcat({assistant}) { window.assistant=assistant;return null }'
      : name === 'AgentPanel'
        ? 'export function AgentPanel({requestedTab,onRequestedTabHandled}) { React.useEffect(()=>{if(requestedTab){window.workTab=requestedTab;onRequestedTabHandled()}},[requestedTab]);return null }'
        : name === 'EditorPane'
          ? 'export function EditorPane({pane}) { const active=pane.tabs.find(t=>t.path===pane.activePath);return React.createElement("div",{"data-editor-active":pane.activePath},active?.content||"") }'
          : `export function ${name}(){return null}`).join('\n'))
  }
  const source = `import React from '${root}/node_modules/react/index.js';import {createRoot} from '${root}/node_modules/react-dom/client.js';import App from '${root}/src/App.tsx';import {I18nProvider} from '${root}/src/i18n.tsx';createRoot(document.getElementById('root')).render(<I18nProvider><App/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:helper-app.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id, importer) {
    if (id === 'virtual:helper-app.tsx') return id
    if (importer === `${root}/src/App.tsx` && stubs.has(id)) return `virtual:stub:${id}`
    if (id.endsWith('.css')) return 'virtual:style'
  }, async load(id) {
    if (id === 'virtual:helper-app.tsx') return source
    if (id === 'virtual:style') return ''
    if (id.startsWith('virtual:stub:')) return `import React from '${root}/node_modules/react/index.js';\n${stubs.get(id.slice('virtual:stub:'.length))}`
    if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))
  } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set(app.match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), headless: true, args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      localStorage.setItem('mew:locale', 'ko')
      class Socket { static OPEN = 1; readyState = 1; onopen: (() => void) | null = null; constructor() { setTimeout(() => this.onopen?.(), 0) } send() {} close() { this.readyState = 3 } }
      Object.defineProperty(globalThis, 'WebSocket', { value: Socket })
    })
    let active = '/alpha'
    const reads: { path: string | null; project: string | null }[] = []
    await page.route('http://helper-app.test/**', async route => {
      const url = new URL(route.request().url()), method = route.request().method()
      const json = (value: unknown) => route.fulfill({ json: value })
      if (url.pathname === '/api/auth/me') return json({ authenticated: true, email: 'helper@test', role: 'owner', mustChangePassword: false, capabilities: { filesRead: true, filesWrite: true, agent: true, terminal: true, git: true, browser: true } })
      if (url.pathname === '/api/file-access') return json({ view: true, edit: true })
      if (url.pathname === '/api/workspace') {
        if (method === 'POST') {
          const path = route.request().postDataJSON().path
          if (path === '/missing') return route.fulfill({ status: 400, json: { error: 'Missing folder' } })
          active = path
        }
        return json({ path: active, docs: 'docs', docsPath: `${active}/docs`, projects: [] })
      }
      if (url.pathname === '/api/project-icons/read') return json({ icons: {} })
      if (url.pathname === '/api/user-ui/root-projects') return json({ state: { paths: ['/alpha'], icons: {}, groups: [] } })
      if (url.pathname === '/api/user-ui/agent-tabs') return json({ state: null, claims: [] })
      if (url.pathname === '/api/user-ui/workspace') return json({ state: null })
      if (url.pathname === '/api/tree') return json({ version: 1, state: 'ready', entries: [{ name: 'MOC.md', path: 'MOC.md', type: 'file' }] })
      if (url.pathname === '/api/file') { reads.push({ path: url.searchParams.get('path'), project: url.searchParams.get('project') }); return json({ path: url.searchParams.get('path'), content: 'Project document', editable: true }) }
      if (url.pathname === '/api/features') return json({ features: [], runs: [], canEdit: true })
      if (url.pathname === '/api/agent-sets') return json({ sets: [] })
      if (url.pathname === '/api/projects') return json([])
      if (url.pathname.startsWith('/api/')) return json({})
      return route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    await page.goto('http://helper-app.test/')
    await page.waitForFunction(() => (globalThis as unknown as Fixture).assistant?.projectRoot === '/alpha')
    const run = (action: MewcatAction) => page.evaluate(action => (globalThis as unknown as Fixture).assistant.onAction(action), action)
    await run({ kind: 'open_project', path: '/beta' })
    assert.equal(active, '/beta')
    await run({ kind: 'open_file', projectRoot: '/beta', path: 'docs/MOC.md' })
    assert.equal(await page.locator('[data-editor-active="mew:file:docs/MOC.md"]').count(), 1)
    assert.ok(reads.some(read => read.path === 'MOC.md' && read.project === 'docs'), 'Documents files retain their existing API and tab scope')
    await run({ kind: 'open_panel', panel: 'documents' })
    assert.equal(await page.locator('[data-explorer-toggle]').getByRole('button', { name: '문서', exact: true }).getAttribute('aria-pressed'), 'true')
    await run({ kind: 'start_project_session', projectRoot: '/beta', runtime: 'codex', request: '메모 작성과 검색 기능을 만들어요.' })
    const draft = await page.evaluate(() => { const fixture = globalThis as unknown as Fixture; return { tab: fixture.workTab, draft: JSON.parse(localStorage.getItem('mew:agent-input-drafts') ?? '{}')[fixture.workTab.id] } })
    assert.equal(draft.tab.cwd, '/beta')
    assert.equal(draft.tab.runtime, 'codex')
    assert.equal(draft.draft, '메모 작성과 검색 기능을 만들어요.')
    await assert.rejects(run({ kind: 'open_project', path: '/missing' }), /MEWCAT_ACTION_FAILED/)
    assert.equal(active, '/beta')
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
