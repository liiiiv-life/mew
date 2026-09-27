import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('terminal extra keys fill one row above the composer and send keys without losing its draft or focus', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {TmuxTerminal} from '${root}/packages/tmux-term/src/TmuxTerminal.tsx';
window.inputs=[];
class Socket {static OPEN=1;readyState=1;constructor(){setTimeout(()=>{this.onopen?.();this.onmessage?.({data:'$ terminal ready\\r\\n'})},10)}send(data){const value=JSON.parse(data);if(value.type==='input')window.inputs.push(value.data)}close(){this.readyState=3}}
window.WebSocket=Socket;
createRoot(document.getElementById('root')).render(<TmuxTerminal sessionName="keybar-fixture" inputPlaceholder="Message"/>);`
  const bundle = await build({ input: 'virtual:keys.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:keys.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:keys.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const content = (await Promise.all(['packages/tmux-term/src/TmuxTerminal.tsx', 'packages/mobile-keys/src/MobileKeyBar.tsx', 'packages/ui/src/HoverTipLayer.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const xterm = await fs.readFile(`${root}/node_modules/@xterm/xterm/css/xterm.css`, 'utf8')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 700 }, hasTouch: true })
    page.setDefaultTimeout(3000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://mew-keys.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n${xterm}\nhtml,body,#root{height:100%;margin:0}</style><div id="root"></div><script>${chunk.code}</script></html>` }))
    await page.goto('http://mew-keys.test/')
    const bar = page.locator('[data-mobile-key-bar]')
    await bar.waitFor()
    const draft = page.getByPlaceholder('Message')
    await draft.fill('keep this draft')
    for (const [label, sequence] of [['Home', '\x1b[H'], ['End', '\x1b[F'], ['Ctrl+C', '\x03'], ['Esc', '\x1b'], ['Tab', '\t'], ['←', '\x1b[D']]) {
      await bar.getByRole('button', { name: label, exact: true }).tap()
      assert.equal(await page.evaluate('window.inputs.at(-1)'), sequence)
      assert.equal(await draft.inputValue(), 'keep this draft')
      assert.equal(await draft.evaluate(el => el === el.ownerDocument.activeElement), true, 'key press keeps the composer focused')
    }
    await bar.getByRole('button', { name: 'Ctrl', exact: true }).tap()
    await bar.getByRole('button', { name: 'Shift', exact: true }).tap()
    await bar.getByRole('button', { name: 'Home', exact: true }).tap()
    assert.equal(await page.evaluate('window.inputs.at(-1)'), '\x1b[1;6H')
    assert.equal(await bar.getByRole('button', { name: 'Ctrl', exact: true }).getAttribute('aria-pressed'), 'false')
    assert.equal(await bar.getByRole('button', { name: 'Shift', exact: true }).getAttribute('aria-pressed'), 'false')
    for (const width of [320, 390, 767]) for (const dark of [false, true]) {
      await page.setViewportSize({ width, height: 700 })
      await page.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`)
      const box = (await bar.boundingBox())!, composer = (await draft.boundingBox())!
      assert.ok(box.y + box.height <= composer.y, 'bar is above the text input')
      assert.equal(await bar.getByRole('button').count(), 11)
      const buttons = await bar.getByRole('button').all()
      const positions = await Promise.all(buttons.map(button => button.boundingBox()))
      assert.ok(positions.every(position => position && position.y === positions[0]!.y))
      assert.ok(positions.at(-1)!.x + positions.at(-1)!.width <= box.x + box.width)
      assert.ok(positions.at(-1)!.x + positions.at(-1)!.width >= box.x + box.width - 8, 'keys fill the available row')
      assert.equal(await bar.evaluate(el => el.scrollWidth <= el.clientWidth), true)
      assert.equal(await bar.evaluate(el => el.scrollHeight <= el.clientHeight), true, 'key bar has no vertical overflow')
      assert.equal(await bar.evaluate(el => {
        const style = el.ownerDocument.defaultView!.getComputedStyle(el)
        const box = el.getBoundingClientRect()
        const top = box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)
        const bottom = box.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom)
        return [...el.querySelectorAll('button')].every(button => {
          const key = button.getBoundingClientRect()
          return key.top >= top && key.bottom <= bottom
        })
      }), true, 'bar fits the buttons and vertical padding without clipping')
      await page.screenshot({ path: `/tmp/mew-terminal-keys-${width}-${dark ? 'dark' : 'light'}.png` })
    }
    await page.setViewportSize({ width: 390, height: 400 })
    assert.ok((await bar.boundingBox())!.y + (await bar.boundingBox())!.height <= (await draft.boundingBox())!.y)
    await page.setViewportSize({ width: 1024, height: 700 })
    await bar.waitFor({ state: 'detached' })
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
