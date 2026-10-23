import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
test('Agent sets separate Codex model/effort and save ACP effort on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const source = `
import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {AgentSetPicker} from '${root}/src/components/AgentSetPicker.tsx';
localStorage.setItem('mew:locale','ko');
Object.defineProperty(crypto,'randomUUID',{value:undefined});
createRoot(document.getElementById('root')).render(<I18nProvider><div style={{height:'100dvh'}}><AgentSetPicker onSelect={()=>{}}/></div></I18nProvider>);`
  const bundle = await build({ input: 'virtual:git-ai.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'fixture', resolveId(id) { if (id === 'virtual:git-ai.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' },
    async load(id) { if (id === 'virtual:git-ai.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return `export default ${JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))}` },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const files = ['src/components/GitWorkbench.tsx', 'src/components/git-ai-commit-dialog.tsx', 'src/components/AgentSetPicker.tsx', 'packages/ui/src/dialog-frame.tsx', 'packages/ui/src/select-field.tsx']
  const content = (await Promise.all(files.map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } })
      page.setDefaultTimeout(6500)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      let saved: Record<string, unknown>[] = []
      await page.route('http://localhost:48977/**', route => {
        const p = new URL(route.request().url()).pathname
        if (p === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (p === '/api/agent-sets') {
          if (route.request().method() === 'PUT') saved = route.request().postDataJSON().sets
          return route.fulfill({ json: { sets: saved } })
        }
        if (p.endsWith('/models')) return route.fulfill({ json: p.includes('/codex/') ? { models: [
          { modelId: 'astra[low]', name: 'Astra (low)' }, { modelId: 'astra[high]', name: 'Astra (high)' },
          { modelId: 'other[medium]', name: 'Other (medium)' },
        ] } : { models: [{ modelId: 'claude', name: 'Claude' }], thinking: { configId: 'effort', options: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } } })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="${width === 390 ? '' : 'dark'}" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://localhost:48977/')
      assert.deepEqual(errors, [])
      await page.getByRole('button', { name: '+ 새 에이전트셋 추가' }).click()
      const editor = page.getByRole('dialog', { name: '새 에이전트셋', exact: true })
      const runtime = editor.getByRole('combobox', { name: '에이전트', exact: true })
      const model = editor.getByRole('combobox', { name: '모델 (선택)', exact: true })
      const effort = editor.getByRole('combobox', { name: '노력도 (선택)', exact: true })
      await runtime.click(); await page.getByRole('option', { name: 'Codex', exact: true }).click()
      await model.fill('astra')
      await page.getByRole('option', { name: 'Astra · astra', exact: true }).click()
      assert.equal(await model.inputValue(), 'astra')
      await effort.click()
      assert.deepEqual(await page.getByRole('option').allTextContents(), ['low', 'high'])
      await page.getByRole('option', { name: 'high', exact: true }).click()
      await model.fill('other'); await page.getByRole('option', { name: 'Other · other', exact: true }).click()
      assert.match(await effort.textContent() ?? '', /medium/)
      await model.fill('astra'); await page.getByRole('option', { name: 'Astra · astra', exact: true }).click()
      await effort.click(); await page.getByRole('option', { name: 'high', exact: true }).click()
      await editor.getByLabel('이름', { exact: true }).fill('Codex preset')
      await editor.getByLabel('역할 지침').fill('Review')
      await editor.getByRole('button', { name: '저장', exact: true }).click()
      await editor.waitFor({ state: 'hidden' })
      assert.equal(saved[0].modelId, 'astra[high]')
      assert.equal(saved[0].thinkingId, undefined)
      await page.getByRole('button', { name: '수정', exact: true }).click()
      const edit = page.getByRole('dialog', { name: '에이전트셋 수정', exact: true })
      await edit.getByRole('combobox', { name: '노력도 (선택)', exact: true }).filter({ hasText: 'high' }).waitFor()
      const editRuntime = edit.getByRole('combobox', { name: '에이전트', exact: true })
      await editRuntime.click(); await page.getByRole('option', { name: 'Claude Agent', exact: true }).click()
      assert.equal(await edit.getByRole('combobox', { name: '모델 (선택)', exact: true }).inputValue(), '')
      const editEffort = edit.getByRole('combobox', { name: '노력도 (선택)', exact: true })
      await editEffort.click(); await page.getByRole('option', { name: 'High', exact: true }).click()
      await edit.getByRole('button', { name: '저장', exact: true }).click()
      await edit.waitFor({ state: 'hidden' })
      assert.equal(saved[0].thinkingId, 'high')
      assert.equal(saved[0].thinkingConfigId, 'effort')
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
