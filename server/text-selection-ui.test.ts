import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('UI chrome is not selectable while content, diagnostics and inputs remain copyable', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const source = `import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {createPortal} from '${root}/node_modules/react-dom/index.js';
import {ConfirmDialog} from '${root}/packages/ui/src/ConfirmDialog.tsx';
import {AgentErrorButton} from '${root}/src/components/AgentPanel.tsx';
import {renderMarkdown} from '${root}/src/utils/agentMarkdown.ts';
function Fixture(){const [confirm,setConfirm]=useState(false);window.openConfirm=()=>setConfirm(true);const [error,setError]=useState(false);window.openError=()=>setError(true);return <main className="h-full overflow-auto p-4 text-sm">
<h1 id="title">Workspace settings</h1><p id="hint">Choose your preferences here</p><button id="action">Save settings</button>
<div id="answer" className="select-text mew-agent-markdown" dangerouslySetInnerHTML={{__html:renderMarkdown('# Answer heading\\n\\nCopy this answer\\n\\n**Nested bold answer**\\n\\n[Content link](https://example.com)\\n\\n~~~js\\nconst answer = 42\\n~~~')}}/>
<div className="select-text"><button id="copy">Copy answer</button><span id="explicit-none" className="select-none">Hidden from selection</span></div>
<button id="bubble"><span id="prompt" className="select-text">Original user prompt</span></button>
<AgentErrorButton text="Connection failed: diagnostic details" onOpen={()=>setError(true)} />
<div id="alert" role="alert">Server failed with diagnostic code</div>
<div className="tiptap" contentEditable={false}><h2 id="document">Readonly document heading</h2><p>Document body</p></div>
<div className="cm-content" contentEditable={false}><div id="code-line">Readonly code body</div></div>
<div className="pdf-text-layer"><span id="pdf-text">PDF document text</span></div>
<pre id="log">Terminal diagnostic output</pre><code id="command">npm run example</code>
<table className="select-text"><tbody><tr><td id="cell">Spreadsheet cell content</td></tr></tbody></table>
<input id="input" defaultValue="Editable input"/><textarea id="textarea" defaultValue="Editable draft"/>
<div id="editable" contentEditable suppressContentEditableWarning>Editable document</div>
{createPortal(<div id="portal-hint" style={{position:'fixed',bottom:0,right:0}}>Portal hint</div>,document.body)}
{confirm&&<ConfirmDialog message="Confirm action" detail="This action cannot be undone" onConfirm={()=>setConfirm(false)} onCancel={()=>setConfirm(false)}/>}
{error&&<ConfirmDialog message="Diagnostic error message" detail="Copyable error details" onConfirm={()=>setError(false)}/>}
</main>};createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:selection.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:selection.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) {
    if (id === 'virtual:selection.tsx') return source
    if (id === 'virtual:style') return ''
    if (id.endsWith('/src/components/AgentPanel.tsx')) return (await fs.readFile(id, 'utf8')) + '\nexport { AgentErrorButton };'
    if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))
  } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/AgentPanel.tsx', 'packages/ui/src/ConfirmDialog.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, hasTouch: true })
    await context.route('http://mew-selection.test/**', route => route.fulfill(route.request().url().endsWith('/app.js') ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` }))
    const page = await context.newPage()
    page.setDefaultTimeout(3000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://mew-selection.test/')
    const clear = () => page.evaluate('window.getSelection()?.removeAllRanges()')
    const selection = () => page.evaluate<string>("window.getSelection()?.toString() ?? ''")
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 900 })
      for (const selector of ['#title', '#hint', '#action', '#copy', '#explicit-none', '#portal-hint']) {
        const target = page.locator(selector)
        assert.equal(await target.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).userSelect), 'none', selector)
        await clear()
        await target.dblclick()
        assert.equal(await selection(), '', selector)
      }
      for (const selector of ['#answer h1', '#answer strong', '#answer a', '#prompt', '#alert', '#document', '#code-line', '#pdf-text', '#log', '#command', '#cell']) {
        const target = page.locator(selector)
        assert.equal(await target.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).userSelect), 'text', selector)
        if (selector === '#answer a') continue
        await clear()
        await target.dblclick({ position: { x: 20, y: 8 } })
        assert.ok((await selection()).trim(), selector)
      }
      for (const selector of ['#input', '#textarea']) {
        const target = page.locator(selector)
        await target.fill('Copy and edit this')
        await target.press('ControlOrMeta+a')
        assert.equal(await target.evaluate(el => { const input = el as { value: string; selectionStart: number | null; selectionEnd: number | null }; return input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0) }), 'Copy and edit this')
      }
      await page.locator('#editable').fill('Edited content')
      assert.equal(await page.locator('#editable').innerText(), 'Edited content')
      await clear()
      await page.locator('main').evaluate(el => { el.scrollTop = 0 })
      await page.screenshot({ path: `/tmp/mew-selection-${width}.png` })
    }
    // Selecting an error inside a disclosure button must not open its dialog.
    await clear()
    const errorText = page.locator('button[title="오류 상세 보기"] .select-text')
    await errorText.evaluate(el => { const range = el.ownerDocument.createRange(); range.selectNodeContents(el); el.ownerDocument.defaultView!.getSelection()?.addRange(range) })
    await errorText.dispatchEvent('click')
    assert.equal(await page.getByText('Diagnostic error message', { exact: true }).count(), 0)
    await clear()
    await errorText.click()
    const message = page.getByText('Diagnostic error message', { exact: true })
    await message.waitFor()
    assert.equal(await message.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).userSelect), 'text')
    await message.dblclick({ position: { x: 20, y: 8 } })
    assert.ok(await selection())
    assert.equal(await page.getByRole('button', { name: '확인', exact: true }).evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).userSelect), 'none')
    await page.getByRole('button', { name: '확인', exact: true }).click()
    await page.evaluate('window.openConfirm()')
    for (const text of ['Confirm action', 'This action cannot be undone']) {
      const notice = page.getByText(text, { exact: true })
      await notice.waitFor()
      assert.equal(await notice.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).userSelect), 'none')
    }
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
