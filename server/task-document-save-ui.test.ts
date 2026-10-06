import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { parse } from 'yaml'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { mergeTaskFrontmatter } from '../packages/editor/src/utils/task-frontmatter-merge.ts'

test('open tabs rebase server-preserved tags while retaining typing during autosave', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const source = `
import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {useTabs} from ${JSON.stringify(path.join(root, 'src/hooks/useTabs.ts'))};
function Fixture(){const tabs=useTabs('docs',()=>{},()=>{},'/fixture');window.tabs=tabs;return <button onClick={()=>tabs.openFile('tasks/Task.md')}>Open task</button>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:task-save.tsx', write: false, platform: 'browser', output: { format: 'esm' },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'task-save-fixture', resolveId: id => id === 'virtual:task-save.tsx' ? id : id.endsWith('.css') ? 'virtual:style' : undefined, load: id => id === 'virtual:task-save.tsx' ? source : id === 'virtual:style' ? '' : undefined }],
  })
  const script = bundle.output.find(item => item.type === 'chunk')!.code
  const browser = await chromium.launch({ executablePath: domBrowserExecutable()!, args: ['--no-sandbox'], headless: true })
  const original = '---\ntitle: Task\ndone: false\n---\nBody'
  let disk = original, release!: () => void, markReceived!: () => void
  const delayed = new Promise<void>(resolve => { release = resolve })
  const received = new Promise<void>(resolve => { markReceived = resolve })
  const writes: { content: string; expectedContent: string }[] = []
  try {
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://mew-task-save.test/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/file') {
        if (route.request().method() === 'GET') return route.fulfill({ json: { content: disk, editable: true } })
        const request = route.request().postDataJSON() as { content: string; expectedContent: string }
        writes.push(request)
        const saved = mergeTaskFrontmatter(request.expectedContent, request.content, disk)
        disk = saved
        if (writes.length === 1) { markReceived(); await delayed }
        return route.fulfill({ json: { ok: true, commit: null, ...(saved !== request.content ? { content: saved } : {}) } })
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] })
      return route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: script } : { contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/app.js"></script>' })
    })
    await page.goto('http://mew-task-save.test/')
    await page.getByRole('button', { name: 'Open task' }).click()
    await page.waitForFunction('window.tabs.activeTab?.content.includes("Body")')
    disk = original.replace('done: false', 'done: false\ntags: [기능]\nassignees: [alice@example.test]')
    await page.evaluate('window.tabs.updateTabContent("tasks/Task.md",window.tabs.activeTab.content+" first")')
    await received
    await page.evaluate('window.tabs.updateTabContent("tasks/Task.md",window.tabs.activeTab.content+" pending")')
    release()
    await page.waitForFunction('window.tabs.activeTab.content.includes("기능") && window.tabs.activeTab.content.endsWith("first pending")')
    await page.waitForFunction('window.tabs.activeTab.status === "saved"')
    assert.ok(writes.length >= 2)
    assert.equal(writes[0].expectedContent, original)
    assert.deepEqual(parse(disk.split('---')[1]).tags, ['기능'])
    assert.deepEqual(parse(disk.split('---')[1]).assignees, ['alice@example.test'])
    assert.ok(disk.endsWith('first pending'))
    assert.deepEqual(errors, [])
  } finally { release(); await browser.close() }
})
