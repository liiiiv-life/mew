import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from '../../server/browser-dom-executable.ts'

test('command popup paints its controls before downloading the terminal renderer', { skip: !domBrowserExecutable(), timeout: 15_000 }, async t => {
  const popup = new URL('./SessionTerminalPopup.tsx', import.meta.url).pathname
  const i18n = new URL('../i18n.tsx', import.meta.url).pathname
  const react = import.meta.resolve('react')
  const reactDom = import.meta.resolve('react-dom/client')
  const result = await build({
    input: 'virtual:popup.tsx', write: false, platform: 'browser', output: { format: 'esm' },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('production') } },
    plugins: [{
      name: 'isolated-popup',
      resolveId(id) {
        if (id.startsWith('virtual:')) return id
        if (id === '@mew/tmux-term') return 'virtual:terminal.tsx'
        if (id.endsWith('.css')) return 'virtual:style'
      },
      load(id) {
        if (id === 'virtual:style') return ''
        if (id === 'virtual:terminal.tsx') return `import React from ${JSON.stringify(react)}; export function TmuxTerminal(){return <div data-terminal>Ready</div>}`
        if (id === 'virtual:popup.tsx') return `
          import React from ${JSON.stringify(react)};
          import {createRoot} from ${JSON.stringify(reactDom)};
          import {SessionTerminalPopup} from ${JSON.stringify(popup)};
          import {I18nProvider} from ${JSON.stringify(i18n)};
          localStorage.setItem('mew:locale','ko');
          function Fixture(){
            const [open,setOpen]=React.useState(true);
            return <I18nProvider>{open && <SessionTerminalPopup title="Fixture command" session="fixture" running={false} onRun={async()=>{}} onClose={()=>setOpen(false)} onChanged={()=>{}}/>}</I18nProvider>;
          }
          createRoot(document.getElementById('root')).render(<Fixture/>);`
      },
    }],
  })
  const chunks = result.output.filter(chunk => chunk.type === 'chunk')
  const entry = chunks.find(chunk => chunk.isEntry)!
  const terminal = chunks.find(chunk => 'virtual:terminal.tsx' in chunk.modules)!
  const scripts = new Map(chunks.map(chunk => [`/${chunk.fileName}`, chunk.code]))
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ locale: 'ko-KR' })
  page.setDefaultTimeout(3000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let terminalReads = 0, releaseTerminal: (() => void) | undefined
  let onTerminalRequest: (() => void) | undefined
  const terminalRequested = new Promise<void>(resolve => { onTerminalRequest = resolve })
  await page.route('http://popup.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === `/${terminal.fileName}`) {
      terminalReads++
      await new Promise<void>(resolve => { releaseTerminal = resolve; onTerminalRequest!() })
    }
    const script = scripts.get(path)
    await route.fulfill(script !== undefined ? { contentType: 'text/javascript', body: script }
      : { contentType: 'text/html', body: `<html><body><div id="root"></div><script type="module" src="/${entry.fileName}"></script></body></html>` })
  })
  await page.goto('http://popup.test/')
  const dialog = page.getByRole('dialog', { name: 'Fixture command' })
  await dialog.waitFor()
  assert.equal(terminalReads, 0, 'an idle popup does not fetch terminal UI')
  await dialog.getByRole('button', { name: '실행', exact: true }).click()
  await terminalRequested
  await dialog.getByRole('status').waitFor()
  assert.equal(terminalReads, 1)
  assert.ok(await dialog.getByRole('button', { name: '닫기', exact: true }).isVisible(), 'popup controls remain available during chunk download')
  assert.ok(releaseTerminal)
  releaseTerminal()
  await dialog.locator('[data-terminal]').waitFor()
  await dialog.getByRole('button', { name: '닫기', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
})
