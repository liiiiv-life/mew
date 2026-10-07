import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('advanced debugger UI pages arrays, edits values/memory and shares editor breakpoints on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 60000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-debugger-advanced-ui-')); process.env.MEW_DATA_DIR = root; process.env.MEW_WORKSPACE = root
  const { createDebuggerRouter } = await import('./debugger-routes.ts'), { saveDebugConfig, debugConfig, debugSessions } = await import('./debugger.ts'), { defaultDebugConfig, breakpointKey } = await import('../shared/debugger.ts'), { upsertUser } = await import('./auth.ts')
  const account = 'one@example.test'; upsertUser(account, { hash: 'fixture', role: 'owner', mustChangePassword: false, createdAt: 0, passwordChangedAt: 0 })
  const bp = { file: 'main.js', line: 3, enabled: true }
  const config = { ...defaultDebugConfig('custom', root), command: process.execPath, args: [new URL('./fixtures/debug-adapter.cjs', import.meta.url).pathname, '--features'], configuration: { program: path.join(root, 'main.js') }, breakpoints: [bp, { file: 'main.js', line: 4, enabled: true, trigger: breakpointKey(bp) }] }
  const bundle = await build({ input: 'virtual:fixture.tsx', output: { format: 'esm', codeSplitting: false }, platform: 'browser', write: false, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('test') }, jsx: 'react-jsx' }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:fixture.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) {
    if (id === 'virtual:style') return ''
    if (id !== 'virtual:fixture.tsx') return
    return `import React from ${JSON.stringify(import.meta.resolve('react'))}; import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))}; import {EditorState} from ${JSON.stringify(import.meta.resolve('@codemirror/state'))}; import {EditorView,lineNumbers} from ${JSON.stringify(import.meta.resolve('@codemirror/view'))}; import {I18nProvider} from ${JSON.stringify(new URL('../src/i18n.tsx', import.meta.url).pathname)}; import DebuggerPanel from ${JSON.stringify(new URL('../src/components/debugger-panel.tsx', import.meta.url).pathname)}; import {debuggerEditorExtension} from ${JSON.stringify(new URL('../src/utils/debugger-editor.ts', import.meta.url).pathname)};
const debug = debuggerEditorExtension(${JSON.stringify(root)}, ${JSON.stringify(account)}, 'main.js', 0, true), parent=document.getElementById('editor'); const view = new EditorView({parent,state:EditorState.create({doc:${JSON.stringify('let counter = 1;\nfunction main() {\nreturn counter;\n}\n')},extensions:[lineNumbers(),debug.extension]})}); debug.attach(view); parent.fixtureEditor=view; createRoot(document.getElementById('root')).render(<I18nProvider><DebuggerPanel root=${JSON.stringify(root)} onClose={()=>{}} onSettings={()=>{}} onOpenFile={()=>{}}/></I18nProvider>);`
  } }] })
  const chunk = bundle.output.find(o => o.type === 'chunk')!
  const files = ['debugger-panel', 'debugger-variable', 'debugger-inspector', 'debugger-artifacts', 'debugger-browser', 'debugger-helpers', 'debugger-controls', 'panel-close-button', 'debugger-source-field'].map(name => `../src/components/${name}.${name === 'debugger-helpers' ? 'ts' : 'tsx'}`)
  const source = (await Promise.all(files.map(file => fs.readFile(new URL(file, import.meta.url), 'utf8')))).join('\n') + await fs.readFile(new URL('../packages/ui/src/select-field.tsx', import.meta.url), 'utf8')
  const compiler = await compile(await fs.readFile(new URL('../src/index.css', import.meta.url), 'utf8'), { base: new URL('../src', import.meta.url).pathname, onDependency() {} }), css = compiler.build([...new Set(source.match(/[A-Za-z0-9_@!&:/.[\]()%,-]+/g))])
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.auth = { email: account, role: 'owner', mustChangePassword: false }; next() }); app.use('/api/debugger', createDebuggerRouter())
  app.get('/app.js', (_req, res) => res.type('text/javascript').send(chunk.type === 'chunk' ? chunk.code : ''))
  app.get('/', (_req, res) => res.type('html').send(`<!doctype html><html class="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0}#editor{height:120px;overflow:auto}#root{height:calc(100dvh - 120px);width:min(100%,480px)}.cm-editor{height:100%}</style><body><div id="editor"></div><div id="root"></div><script type="module" src="/app.js"></script></body></html>`))
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(async () => { await Promise.allSettled(debugSessions(account, root).map(s => s.stop())); await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(root, { recursive: true, force: true }) })
  const wait = async (check: () => boolean) => { const deadline = Date.now() + 4000; while (!check()) { assert.ok(Date.now() < deadline, 'state did not settle'); await new Promise(r => setTimeout(r, 10)) } }
  for (const viewport of [{ width: 1366, height: 768 }, { width: 320, height: 640 }]) {
    await saveDebugConfig(account, root, config)
    const context = await browser.newContext({ viewport, isMobile: viewport.width === 320, hasTouch: viewport.width === 320 }), page = await context.newPage(), errors: string[] = []
    page.on('pageerror', e => errors.push(e.message)); await page.goto(`http://127.0.0.1:${address.port}`)
    const panel = page.getByRole('region', { name: 'Debugger', exact: true })
    await panel.getByRole('button', { name: 'Start debugging', exact: true }).waitFor()
    await page.locator('.cm-debugger-marker').last().waitFor()
    await page.locator('#editor').evaluate((el: any) => el.fixtureEditor.dispatch({ changes: { from: 0, insert: '\n' } }))
    await wait(() => debugConfig(account, root).breakpoints[0].line === 4)
    assert.equal(debugConfig(account, root).breakpoints[1].trigger, breakpointKey(debugConfig(account, root).breakpoints[0]))
    await page.locator('.cm-content').click(); await page.locator('.cm-content').press('Control+Home'); await page.locator('.cm-content').press('F9')
    await wait(() => debugConfig(account, root).breakpoints.some(b => b.line === 1))
    await panel.getByRole('button', { name: 'Start debugging', exact: true }).click()
    await page.locator('.cm-debugger-execution').waitFor()
    await panel.screenshot({ path: `/tmp/mew-debugger-polish-live-${viewport.width}.png` })
    await panel.getByRole('button', { name: '+ numbers', exact: true }).click()
    await panel.getByRole('button', { name: 'Load more', exact: true }).click(); await panel.getByRole('button', { name: 'Load more', exact: true }).click()
    await panel.locator('[data-debug-variable="239"]').waitFor()
    await panel.getByRole('combobox', { name: 'Value', exact: true }).click(); await page.getByRole('option', { name: 'Chart', exact: true }).click(); await panel.getByRole('img', { name: 'Chart: numbers' }).waitFor()
    const counter = panel.locator('[data-debug-variable="counter"]').first()
    await counter.getByRole('button', { name: 'Set variable: counter' }).click(); await counter.getByRole('textbox', { name: 'Value: counter' }).fill('17'); await counter.getByRole('button', { name: 'Save', exact: true }).click()
    await counter.getByText('17', { exact: true }).waitFor()
    await counter.getByRole('button', { name: 'Data breakpoints: counter' }).click(); await counter.getByRole('button', { name: 'Add', exact: true }).click(); await wait(() => debugSessions(account, root).at(-1)?.config.dataBreakpoints?.length === 1)
    await counter.getByRole('button', { name: 'Memory: counter' }).click()
    const memory = panel.locator('details').filter({ has: page.locator('summary', { hasText: /^Memory$/ }) })
    await memory.getByRole('button', { name: 'Read memory', exact: true }).click(); await memory.getByRole('textbox', { name: 'Hexadecimal', exact: true }).fill('09 0a'); await memory.getByRole('button', { name: 'Write memory', exact: true }).click(); await memory.getByRole('status').filter({ hasText: 'Bytes written: 2' }).waitFor()
    await memory.getByRole('button', { name: 'Disassembly', exact: true }).click(); await memory.getByText('0x1000', { exact: true }).waitFor()
    await panel.getByText('Debug console', { exact: true }).click(); await panel.getByRole('textbox', { name: 'Debug console', exact: true }).fill('counter'); await panel.getByRole('button', { name: 'Evaluate', exact: true }).click()
    await panel.getByText('Session & execution', { exact: true }).click()
    await panel.getByRole('button', { name: 'Step back', exact: true }).click(); await counter.getByText('16', { exact: true }).waitFor()
    await panel.getByRole('combobox', { name: 'Stop history', exact: true }).click(); await page.getByRole('option').filter({ hasText: /^#1/ }).click()
    assert.equal(await panel.getByRole('button', { name: 'Step over', exact: true }).isDisabled(), true)
    await panel.getByText('Analysis files', { exact: true }).click(); await panel.locator('input[type="file"]').setInputFiles({ name: 'fixture.cpuprofile', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ nodes: [{ id: 1, callFrame: { functionName: 'profiledFunction' } }], samples: [1], timeDeltas: [500] })) }); await panel.getByText('profiledFunction', { exact: true }).waitFor()
    assert.equal(await panel.evaluate(el => el.scrollWidth > el.clientWidth), false)
    await panel.locator('div.overflow-auto').first().evaluate(el => { el.scrollTop = 0 })
    await panel.screenshot({ path: `/tmp/mew-debugger-advanced-${viewport.width}.png` })
    await panel.getByRole('button', { name: 'Disconnect', exact: true }).click(); assert.deepEqual(errors, [])
    await context.close()
  }
})
