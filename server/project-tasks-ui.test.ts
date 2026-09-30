import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('task panel desktop and mobile hierarchy, optional metadata, inline editing, completion and failed save', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-task-ui-'))
  const source = `import React from 'react';import {createRoot} from 'react-dom/client';import {I18nProvider} from '${root}/src/i18n.tsx';import {ProjectTasks} from '${root}/src/components/project-tasks.tsx';localStorage.setItem('mew:locale','ko');createRoot(document.getElementById('root')).render(<I18nProvider><div style={{height:'100dvh'}}><ProjectTasks workspace="/project" onClose={()=>{}}/></div></I18nProvider>);`
  const bundle = await build({ input: 'virtual:task.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'task-fixture', resolveId(id) { if (id === 'virtual:task.tsx') return id; if (id.endsWith('.css')) return 'virtual:css' }, load(id) { if (id === 'virtual:task.tsx') return source; if (id === 'virtual:css') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const ui = (await Promise.all(['src/components/project-tasks.tsx', 'packages/ui/src/select-field.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set((source + ui).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + await fs.readFile(path.join(root, 'src/components/project-tasks.css'), 'utf8')
  const server = http.createServer((req, res) => { if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(chunk.code); return }; res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } }); page.setDefaultTimeout(5000)
      const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
      let board = { revision: 0, tasks: [] as unknown[], milestones: [] as unknown[], canEdit: true }, fail = false
      await page.route('**/api/project-tasks**', async route => {
        if (route.request().method() === 'PUT') {
          if (fail) { await route.fulfill({ status: 409, json: { error: '다른 창에서 변경했습니다.' } }); return }
          board = { ...route.request().postDataJSON().board, revision: board.revision + 1, canEdit: true }
        }
        await route.fulfill({ json: board })
      })
      await page.goto(`http://127.0.0.1:${address.port}`)
      await page.getByRole('button', { name: '태스크 추가', exact: true }).click()
      await page.getByLabel('제목', { exact: true }).fill('할일1')
      await page.getByRole('button', { name: '추가', exact: true }).click()
      await page.getByRole('button', { name: '하위 태스크 추가: 할일1', exact: true }).click()
      await page.getByLabel('제목', { exact: true }).fill('할일1.a')
      await page.getByRole('button', { name: '추가', exact: true }).click()
      await page.getByRole('button', { name: '하위 태스크 추가: 할일1.a', exact: true }).click()
      await page.getByLabel('제목', { exact: true }).fill('할일1.a.i')
      await page.getByRole('button', { name: '추가', exact: true }).click()
      await page.getByLabel('제목: 할일1.a.i', { exact: true }).waitFor()
      await page.getByRole('button', { name: '접기: 할일1', exact: true }).click()
      assert.equal(await page.getByLabel('제목: 할일1.a', { exact: true }).count(), 0)
      await page.getByRole('button', { name: '펼치기: 할일1', exact: true }).click()
      await page.getByRole('checkbox', { name: '완료: 할일1.a', exact: true }).check()
      await page.getByLabel('기한: 할일1.a', { exact: true }).waitFor()
      assert.equal(await page.getByRole('checkbox', { name: '완료: 할일1', exact: true }).isChecked(), false)
      await page.getByLabel('기한: 할일1.a', { exact: true }).fill('2026-10-02')
      await page.getByLabel('기한: 할일1.a', { exact: true }).press('Tab')
      await page.getByLabel('시간: 할일1.a', { exact: true }).fill('14:30')
      await page.getByRole('heading', { name: '태스크', exact: true }).click()
      await page.getByRole('combobox', { name: '우선순위: 할일1.a', exact: true }).click()
      await page.getByRole('option', { name: '높음', exact: true }).click()
      await page.getByRole('combobox', { name: '우선순위: 할일1.a', exact: true }).filter({ hasText: '높음' }).waitFor()
      const saved = board.tasks.find((t: any) => t.title === '할일1.a') as any
      assert.equal(saved.status, 'done')
      assert.equal(saved.due, '2026-10-02')
      assert.equal(saved.time, '14:30')
      assert.equal(saved.priority, 'high')
      fail = true
      await page.getByLabel('제목: 할일1.a', { exact: true }).fill('수정한 태스크')
      await page.getByLabel('제목: 할일1.a', { exact: true }).press('Enter')
      await page.getByRole('alert').filter({ hasText: '다른 창' }).waitFor()
      assert.equal(await page.getByLabel('제목: 할일1.a', { exact: true }).inputValue(), '수정한 태스크')
      fail = false
      await page.getByRole('button', { name: '저장', exact: true }).click()
      await page.getByRole('checkbox', { name: '완료: 수정한 태스크', exact: true }).waitFor()
      assert.equal(await page.locator('select,datalist').count(), 0)
      assert.ok(await page.locator('body').evaluate(el => el.scrollWidth <= el.ownerDocument.defaultView!.innerWidth), 'no horizontal overflow')
      await page.screenshot({ path: path.join(directory, `tasks-${width}.png`) })
      await page.getByRole('button', { name: '삭제: 할일1', exact: true }).click()
      await page.getByRole('button', { name: '삭제 확인: 할일1', exact: true }).click()
      await page.getByLabel('제목: 할일1', { exact: true }).waitFor({ state: 'detached' })
      assert.equal(board.tasks.length, 2, 'deleting a parent keeps descendants')
      assert.deepEqual(errors, [])
      await page.close()
    }
    console.log(`Task panel screenshots: ${directory}`)
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
