import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('external files become attachments without entering the composer document', { skip: !domBrowserExecutable() }, async () => {
  const bundle = await build({
    input: 'virtual:drop.tsx', write: false, platform: 'browser',
    output: { format: 'iife', codeSplitting: false },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{
      name: 'fixture',
      resolveId(id) {
        if (id === 'virtual:drop.tsx' || id === '@mew/editor') return id
        if (id.endsWith('.css')) return 'virtual:css'
      },
      load(id) {
        if (id === '@mew/editor') return 'export const prefixMatch=(query,text)=>text.startsWith(query)'
        if (id === 'virtual:css') return ''
        if (id === 'virtual:drop.tsx') return `
          import React from '${root}/node_modules/react/index.js';
          import {createRoot} from '${root}/node_modules/react-dom/client.js';
          import {MentionTextarea} from '${root}/src/components/MentionTextarea.tsx';
          window.dropped=[];
          function Fixture(){const [value,setValue]=React.useState('작성 중');return <MentionTextarea imageCapable value={value} onChange={setValue} options={[]} onFilesDropped={files=>window.dropped.push(...files.map(file=>file.name))}/>}
          createRoot(document.getElementById('root')).render(<Fixture/>);
        `
      },
    }],
  })
  const code = bundle.output.find(item => item.type === 'chunk')!.code
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage()
    await page.route('http://mew-drop.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://mew-drop.test/')
    await page.addScriptTag({ content: code })
    const input = page.locator('.cm-content')
    await input.waitFor()
    const prevented = await input.evaluate(element => {
      const browserWindow = element.ownerDocument.defaultView!
        const data = new browserWindow.DataTransfer()
      data.items.add(new File(['should not enter draft'], 'notes.txt', { type: 'text/plain' }))
      data.items.add(new File(['photo'], 'photo.png', { type: 'image/png' }))
      const over = new browserWindow.DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true })
      const drop = new browserWindow.DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })
      element.dispatchEvent(over)
      element.dispatchEvent(drop)
      return over.defaultPrevented && drop.defaultPrevented
    })
    assert.equal(prevented, true)
    assert.deepEqual(await page.evaluate('window.dropped'), ['notes.txt', 'photo.png'])
    // Wait for any FileReader work initiated by the editor's default drop handler.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)))
    assert.equal(await input.innerText(), '작성 중')
  } finally { await browser.close() }
})
