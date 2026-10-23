import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('Documents settings preview and apply work on desktop and mobile with keyboard dismissal', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {DocsSettingsModal} from '${root}/src/components/DocsSettingsModal.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
createRoot(document.getElementById('root')).render(<I18nProvider><DocsSettingsModal onClose={()=>{}} onDone={()=>{}}/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:setup.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'fixture', resolveId(id) { if (id === 'virtual:setup.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) { if (id === 'virtual:setup.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/docs-agent-context.tsx', 'src/components/DocsSettingsModal.tsx', 'packages/ui/src/dialog-frame.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, locale: 'ko-KR' })
      page.setDefaultTimeout(4000)
      const requests: Record<string, any>[] = [], errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-setup.test/**', async route => {
        const url = new URL(route.request().url())
        if (url.pathname === '/api/workspace') { await route.fulfill({ json: { path: '/projects/demo', docs: 'docs', docsPath: '/projects/demo/docs', projects: [] } }); return }
        if (url.pathname === '/api/docs/agent-context') {
          if (route.request().method() === 'GET') { await route.fulfill({ json: { projectRoot: '/projects/demo', settings: { version: 1, enabled: true, docsDir: 'docs', entrypoints: [], instructions: '' } } }); return }
          const body = route.request().postDataJSON()
          requests.push(body)
          await route.fulfill({ json: { ...body, revision: 'preview-revision', files: [{ path: '.mew/agent-context.json', action: 'update' }, { path: 'docs/MOC.md', action: 'preserve' }, { path: 'docs/AGENT.md', action: 'create' }], context: 'Project root: /projects/demo\nDocuments folder: /projects/demo/docs\nRead relevant documents and update their canonical source.' } }); return
        }
        await route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-setup.test/')
      await page.getByRole('button', { name: '에이전트 안내와 문서 설정' }).click()
      const dialog = page.getByRole('dialog')
      const apply = page.getByRole('button', { name: '적용', exact: true })
      await page.getByLabel('Documents 폴더 (프로젝트 기준 상대 경로)').waitFor()
      assert.equal(await apply.isEnabled(), false)
      await page.getByLabel('없는 문서 기본 구조 만들기').check()
      await page.getByRole('button', { name: '미리보기', exact: true }).click()
      await page.getByText('변경 예정 파일', { exact: true }).waitFor()
      assert.equal(await apply.isEnabled(), true)
      await page.getByLabel('추가 프로젝트 지침 (선택)').fill('Use the existing decisions.')
      assert.equal(await apply.isEnabled(), false, 'editing invalidates the reviewed plan')
      await page.getByRole('button', { name: '미리보기', exact: true }).click()
      await page.getByText('전달할 안내 보기', { exact: true }).click()
      await page.screenshot({ path: `/tmp/mew-project-setup-${width}.png` })
      assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
      assert.ok(await dialog.evaluate(element => element.getBoundingClientRect().height <= 844))
      await apply.click()
      await page.getByRole('button', { name: '에이전트 안내와 문서 설정' }).waitFor()
      assert.equal(requests.filter(r => r.action === 'apply').length, 1)
      assert.equal(requests.at(-1)?.settings.instructions, 'Use the existing decisions.')
      assert.equal(requests.at(-1)?.revision, 'preview-revision')
      await page.getByRole('button', { name: '에이전트 안내와 문서 설정' }).click()
      await dialog.waitFor()
      await page.keyboard.press('Escape')
      assert.equal(await dialog.count(), 0)
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
