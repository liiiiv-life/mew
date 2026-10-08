import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('Markdown links render external files and follow links from external Markdown', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {Editor} from ${JSON.stringify(new URL('../packages/editor/src/Editor.tsx', import.meta.url).pathname)};
import {useTabs} from ${JSON.stringify(new URL('../src/hooks/useTabs.ts', import.meta.url).pathname)};
import {editorLinkTabPath} from ${JSON.stringify(new URL('../src/utils/editor-files.ts', import.meta.url).pathname)};
import {externalAbsolutePath} from ${JSON.stringify(new URL('../src/utils/externalFiles.ts', import.meta.url).pathname)};
const noop=()=>{}, workspace={path:'/projects/mew',docsPath:'/projects/mew/docs'};
const initial='[Other](../../other/read%20me.md)\\n\\n[System](/etc/hosts)\\n\\n[File URL](file:///etc/hosts)';
function Fixture(){const tabs=useTabs('.workspace',noop,noop,'/projects/mew');window.tabs=tabs;
const tab=tabs.activeTab;
return <div style={{height:600}}>{tab && !tab.loading ? tab.viewMode==='hotview' ? <Editor key={tab.path} value={tab.content} onChange={noop} api={{db:{},fetchFile:async()=>({content:''})}} path={externalAbsolutePath(tab.path)} onOpenLink={p=>tabs.openFile(editorLinkTabPath('.workspace',p,workspace),{preview:false})}/> : <pre>{tab.content}</pre> : <Editor value={initial} onChange={noop} api={{db:{},fetchFile:async()=>({content:''})}} path="docs/guide.md" onOpenLink={p=>tabs.openFile(editorLinkTabPath('.workspace',p,workspace),{preview:false})}/>}</div>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:links.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:links.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:links.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(4000)
    const requested: string[] = []
    await page.route('http://mew-external-links.test/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/fs/file') {
        const path = url.searchParams.get('path')!
        requested.push(path)
        const content = path === '/projects/other/read me.md' ? '# Outside document\n\n[Next](./next.md)' : path === '/projects/other/next.md' ? '# Next outside document' : '127.0.0.1 localhost'
        return route.fulfill({ json: { path, content } })
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] })
      return route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript; charset=utf-8', body: chunk.code } : { contentType: 'text/html; charset=utf-8', body: '<html><div id="root"></div><script src="/app.js"></script></html>' })
    })
    for (const viewport of [{ width: 1200, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)
      await page.goto('http://mew-external-links.test/')
      await page.getByRole('link', { name: 'Other', exact: true }).click()
      await page.getByRole('heading', { name: 'Outside document', exact: true }).waitFor()
      await page.getByRole('link', { name: 'Next', exact: true }).click()
      await page.getByRole('heading', { name: 'Next outside document', exact: true }).waitFor()
      for (const label of ['System', 'File URL']) {
        await page.evaluate('localStorage.clear()')
        await page.reload()
        await page.getByRole('link', { name: label, exact: true }).click()
        await page.getByText('127.0.0.1 localhost', { exact: true }).waitFor()
      }
      await page.evaluate('localStorage.clear()')
    }
    assert.ok(requested.includes('/projects/other/read me.md'))
    assert.ok(requested.includes('/projects/other/next.md'))
    assert.ok(requested.includes('/etc/hosts'))
  } finally { await browser.close() }
})
