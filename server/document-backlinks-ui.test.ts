import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('title backlinks popup supports desktop/touch, themes, failures, cancellation and external document opening', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const source = `
import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {FrontmatterPanel} from ${JSON.stringify(path.join(root, 'packages/editor/src/editor/FrontmatterPanel.tsx'))};
import {useTabs} from ${JSON.stringify(path.join(root, 'src/hooks/useTabs.ts'))};
import {createEditorApi} from ${JSON.stringify(path.join(root, 'src/api/client.ts'))};
import {editorLinkTabPath} from ${JSON.stringify(path.join(root, 'src/utils/editor-files.ts'))};
const noop=()=>{}, api=createEditorApi('docs'), workspace={path:'/projects/current',docsPath:'/projects/current/docs'};
function Fixture(){const [docPath,setDocPath]=React.useState('target.md');window.changePath=setDocPath;
const tabs=useTabs('.workspace',noop,noop,'/projects/current');window.tabs=tabs;
return <div style={{height:650}}>{tabs.activeTab&&!tabs.activeTab.loading&&<pre>{tabs.activeTab.content}</pre>}<div className="editor-root"><FrontmatterPanel data={{title:'Current document',fields:[{key:'상위파일',value:'parent.md'}]}} docPath={docPath} readOnly onChange={noop} fetchBacklinks={api.fetchBacklinks} onOpenLink={p=>tabs.openFile(editorLinkTabPath('docs',p,workspace),{preview:false})}/></div></div>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:backlinks.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:backlinks.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:backlinks.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const candidates = await Promise.all(['packages/editor/src/editor/FrontmatterPanel.tsx', 'packages/editor/src/editor/FrontmatterPopover.tsx', 'packages/editor/src/editor/DocumentBacklinks.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))
  const css = compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + await fs.readFile(path.join(root, 'packages/editor/src/editor/editor.css'), 'utf8')
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width < 500, isMobile: width < 500 })
      page.setDefaultTimeout(4000)
      const errors: string[] = [], requested: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      let parentCount = 1
      let mode: 'normal' | 'empty' | 'error' | 'slow' = 'normal'
      await page.route('http://mew-backlinks.test/**', async route => {
        const url = new URL(route.request().url())
        if (url.pathname === '/api/docs/backlinks') {
          requested.push(url.searchParams.get('path')!)
          if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 250))
          if (mode === 'error') return route.fulfill({ status: 500, json: { error: 'Lookup failed' } })
          return route.fulfill({ json: { documents: mode === 'empty' ? [] : [
            { title: 'External source', path: '/projects/other/read me.md' },
            { title: 'Local source', path: '/projects/current/docs/source.md' },
          ], parents: Array.from({length:parentCount},(_,i)=>({title:'Parent '+(i+1),path:'/projects/other/parent'+(i+1)+'.md'})), skipped: 0 } })
        }
        if (url.pathname === '/api/fs/file') return route.fulfill({ json: { path: url.searchParams.get('path'), content: 'Opened external document' } })
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] })
        return route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript; charset=utf-8', body: chunk.code }
          : { contentType: 'text/html; charset=utf-8', body: `<html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-backlinks.test/')
      const arrow = page.getByRole('button', { name: '백링크', exact: true }), popup = page.getByRole('dialog', { name: '백링크', exact: true })
      assert.equal(await page.getByRole('textbox', { name: '제목' }).getAttribute('readonly'), '')
      assert.equal(await page.locator('input[value="상위파일"]').count(), 0, 'parent metadata is hidden from property rows')
      const titleBox = (await page.getByRole('textbox', { name: '제목' }).boundingBox())!, arrowBox = (await arrow.boundingBox())!
      assert.ok(arrowBox.x >= titleBox.x + titleBox.width && arrowBox.y < titleBox.y + titleBox.height)
      for (const theme of ['dark', 'light']) {
        await page.locator('html').evaluate((el, theme) => { el.className = theme }, theme)
        await arrow.click()
        await popup.getByRole('button', { name: /External source/ }).waitFor()
        const box = (await popup.boundingBox())!
        assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 844)
        assert.equal(await page.locator('html').evaluate(el => el.scrollWidth > el.clientWidth), false)
        await page.keyboard.press('ArrowDown')
        assert.equal(await popup.getByRole('button', { name: /Local source/ }).evaluate(el => el === el.ownerDocument.activeElement), true)
        if (process.env.MEW_EDITOR_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MEW_EDITOR_SCREENSHOT_DIR}/backlinks-${width}-${theme}.png` })
        await page.keyboard.press('Escape')
        assert.equal(await popup.count(), 0)
        assert.equal(await arrow.evaluate(el => el === el.ownerDocument.activeElement), true)
      }
      await arrow.click(); await popup.getByRole('button', { name: /External source/ }).waitFor()
      await arrow.click(); await popup.waitFor({ state: 'detached' })
      await arrow.click(); await popup.getByRole('button', { name: /External source/ }).waitFor()
      await page.goBack(); await popup.waitFor({ state: 'detached' })
      mode = 'empty'; await arrow.click()
      await popup.getByText('이 문서를 참조하는 문서가 없습니다').waitFor()
      await page.locator('html').click({ position: { x: width - 2, y: 2 } }); await popup.waitFor({ state: 'detached' })
      mode = 'error'; await arrow.click(); await popup.getByRole('alert').waitFor()
      mode = 'normal'; await popup.getByRole('button', { name: '다시 시도', exact: true }).click()
      await popup.getByRole('button', { name: /External source/ }).waitFor()
      await page.keyboard.press('Escape')
      mode = 'slow'; await arrow.click(); await popup.getByRole('status').waitFor()
      await page.evaluate('window.changePath("other.md")')
      await popup.waitFor({ state: 'detached' })
      mode = 'normal'; await arrow.click(); await popup.getByRole('button', { name: /External source/ }).waitFor()
      assert.equal(requested.at(-1), 'other.md', 'document switch cannot reuse stale lookup data')
      await popup.getByRole('button', { name: /External source/ }).click()
      await page.getByText('Opened external document', { exact: true }).waitFor()
      assert.equal(await page.evaluate('window.tabs.activeTab.path'), '@fs:/projects/other/read me.md')
      const parentArrow = page.getByRole('button', { name: '상위파일', exact: true })
      const parentPopup = page.getByRole('dialog', { name: '상위파일', exact: true })
      await parentArrow.click()
      await page.waitForFunction('window.tabs.activeTab.path === "@fs:/projects/other/parent1.md"')
      assert.equal(await parentPopup.count(), 0, 'a single parent opens directly')
      parentCount = 2
      await parentArrow.click()
      await parentPopup.getByRole('button', { name: /Parent 2/ }).waitFor()
      const parentBox = (await parentPopup.boundingBox())!
      assert.ok(parentBox.x >= 0 && parentBox.x + parentBox.width <= width + 1)
      await parentPopup.getByRole('button', { name: /Parent 2/ }).click()
      await page.waitForFunction('window.tabs.activeTab.path === "@fs:/projects/other/parent2.md"')
      parentCount = 0
      await parentArrow.click()
      await parentPopup.getByText('열 수 있는 상위파일이 없습니다').waitFor()
      await page.keyboard.press('Escape')
      mode = 'error'
      await parentArrow.click()
      await parentPopup.getByRole('alert').getByText('상위파일을 불러오지 못했습니다').waitFor()
      await page.keyboard.press('Escape')
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
