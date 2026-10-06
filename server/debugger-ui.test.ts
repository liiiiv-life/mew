import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import { compile } from '@tailwindcss/node'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom.ts'
import { defaultDebugConfig, type DebugSnapshot } from '../shared/debugger.ts'

test('debugger settings and panel work on desktop and narrow mobile with changed variables and pins', { skip: !domBrowserExecutable(), timeout: 60000 }, async t => {
  const bundle = await build({ input: 'virtual:debugger.tsx', output: { format: 'esm', codeSplitting: false }, platform: 'browser', write: false, transform: { define: { 'process.env.NODE_ENV': JSON.stringify('test') }, jsx: 'react-jsx' }, plugins: [{ name: 'debugger-fixture', resolveId(id) { if (id === 'virtual:debugger.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) {
    if (id === 'virtual:style') return ''
    if (id !== 'virtual:debugger.tsx') return
    return `import React, {useState} from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {I18nProvider} from ${JSON.stringify(new URL('../src/i18n.tsx', import.meta.url).pathname)};
import {SettingsModal} from ${JSON.stringify(new URL('../src/components/SettingsModal.tsx', import.meta.url).pathname)};
import DebuggerPanel from ${JSON.stringify(new URL('../src/components/debugger-panel.tsx', import.meta.url).pathname)};
function Fixture(){const [settings, setSettings] = useState(true); return <div className="h-dvh bg-surface text-ink"><DebuggerPanel root="/fixture" onClose={()=>{}} onSettings={()=>setSettings(true)} onOpenFile={(file,line)=>{window.openedFile=[file,line]}}/>{settings && <SettingsModal initialDebugger debuggerRoot="/fixture" onOpenDebugger={()=>setSettings(false)} email="one@example.test" displayName="One" avatarDataUrl={null} canEditIgnore={false} theme="dark" fontPreferences={{sans:'',mono:''}} themeColor="#808080" mewcatSkin={null} mewcatHideDesktop={false} onMewcatHideDesktopChange={()=>{}} onToggleTheme={()=>{}} onFontPreferencesChange={()=>{}} onThemeColorChange={()=>{}} onMewcatSkinChange={()=>{}} onClose={()=>setSettings(false)} onLoggedOut={()=>{}} onProfileChanged={()=>{}}/>}</div>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const sources = ['../src/components/debugger-panel.tsx', '../src/components/debugger-settings.tsx', '../src/components/SettingsModal.tsx', '../packages/ui/src/select-field.tsx']
  const cssSource = (await Promise.all(sources.map(file => fs.readFile(new URL(file, import.meta.url), 'utf8')))).join('\n') + ' h-dvh bg-surface text-ink'
  const compiler = await compile(await fs.readFile(new URL('../src/index.css', import.meta.url), 'utf8'), { base: new URL('../src', import.meta.url).pathname, onDependency() {} })
  const css = compiler.build([...new Set(cssSource.match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  let config = defaultDebugConfig('js-debug', '/fixture'), counter = 1
  let snapshot: DebugSnapshot = { id: 'fixture', state: 'idle', reason: '', frames: [], output: '', breakpoints: [], capabilities: {} }
  const server = http.createServer(async (req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(chunk.type === 'chunk' ? chunk.code : ''); return }
    if (req.url?.startsWith('/api/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const raw = Buffer.concat(chunks).toString(), body = raw ? JSON.parse(raw) : {}
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/api/debugger/config') { config = body; res.end(JSON.stringify(config)); return }
      if (req.url === '/api/debugger/test') { res.end('{"ok":true}'); return }
      if (req.url === '/api/debugger/start') snapshot = { ...snapshot, state: 'stopped', stopRevision: 1, frames: [{ id: 1, name: 'main', line: 3, source: { path: '/fixture/main.js' } }], breakpoints: config.breakpoints.map(bp => ({ ...bp, file: '/fixture/' + bp.file, verified: true })) }
      if (req.url === '/api/debugger/command') {
        const command = body.command
        if (command === 'next') { counter++; snapshot = { ...snapshot, stopRevision: (snapshot.stopRevision ?? 0) + 1 } }
        if (command === 'scopes') { res.end('{"scopes":[{"name":"Locals","variablesReference":10}]}'); return }
        if (command === 'variables') { res.end(JSON.stringify({ variables: [{ name: 'fixed', value: 'unchanged', variablesReference: 0 }, { name: 'counter', value: String(counter), variablesReference: 0, evaluateName: 'counter' }] })); return }
        if (command === 'evaluate') { res.end(JSON.stringify({ result: String(counter) })); return }
        res.end('{}'); return
      }
      if (req.url === '/api/debugger/stop') snapshot = { ...snapshot, state: 'terminated', frames: [] }
      res.end(JSON.stringify({ config, session: snapshot, adapter: { installed: false, version: '1.140.0' } })); return
    }
    res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><html class="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  for (const viewport of [{ width: 1366, height: 768 }, { width: 320, height: 640 }]) {
    config = defaultDebugConfig('js-debug', '/fixture'); counter = 1; snapshot = { ...snapshot, state: 'idle', frames: [], stopRevision: 0 }
    const context = await browser.newContext({ viewport, locale: 'en-US' })
    const page = await context.newPage(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(7000)
    await page.goto(`http://127.0.0.1:${address.port}`)
    if (viewport.width === 320) await page.locator('html').evaluate(el => el.classList.remove('dark'))
    const modal = page.getByRole('dialog', { name: 'Settings', exact: true })
    await modal.getByRole('textbox', { name: 'Adapter arguments (JSON)' }).fill('[broken')
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await modal.getByRole('alert').waitFor()
    await modal.getByRole('textbox', { name: 'Adapter arguments (JSON)' }).fill('[]')
    await modal.getByRole('textbox', { name: 'Launch configuration (JSON)' }).fill('{"program":"main.js"}')
    await modal.getByRole('button', { name: 'Test connection', exact: true }).click()
    await modal.getByRole('status').filter({ hasText: 'Connection succeeded' }).waitFor()
    const overflow = await modal.evaluate(el => el.scrollWidth > el.clientWidth)
    assert.equal(overflow, false, `settings must fit ${viewport.width}px`)
    await page.screenshot({ path: `/tmp/mew-debugger-settings-${viewport.width}.png` })
    await modal.getByRole('button', { name: 'Open debugger', exact: true }).click()
    const panel = page.getByRole('region', { name: 'Debugger', exact: true })
    await panel.getByRole('textbox', { name: 'Source file', exact: true }).fill('main.js')
    await panel.getByRole('spinbutton', { name: 'Line', exact: true }).fill('3')
    await panel.getByRole('button', { name: 'Add', exact: true }).first().click()
    await panel.getByRole('button', { name: 'Start debugging', exact: true }).click()
    await panel.getByRole('button', { name: 'Pin variable: counter', exact: true }).waitFor()
    await panel.getByRole('button', { name: 'Pin variable: counter', exact: true }).click()
    await panel.getByRole('button', { name: 'Step over', exact: true }).click()
    await panel.getByText('Changed', { exact: true }).first().waitFor()
    const rows = panel.locator('details').filter({ has: page.locator('summary', { hasText: /^Variables$/ }) })
    assert.ok((await rows.innerText()).indexOf('counter') < (await rows.innerText()).indexOf('fixed'), 'changed variables are first')
    assert.equal(await panel.evaluate(el => el.scrollWidth > el.clientWidth), false)
    await page.screenshot({ path: `/tmp/mew-debugger-panel-${viewport.width}.png` })
    await panel.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await panel.getByRole('status').filter({ hasText: 'Ended' }).waitFor()
    assert.deepEqual(errors, [])
    await context.close()
  }
})
