import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import type { GitAiCommitJob } from '../shared/git-ai-commit.ts'

const root = path.resolve(import.meta.dirname, '..')
test('AI Commit chooses/creates presets, restores jobs, creates multiple commits and preserves the manual composer on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const source = `
import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {GitWorkbench} from '${root}/src/components/GitWorkbench.tsx';
localStorage.setItem('mew:locale','ko');
Object.defineProperty(crypto,'randomUUID',{value:undefined});
createRoot(document.getElementById('root')).render(<I18nProvider><div style={{height:'100dvh'}}><GitWorkbench project='.workspace' repositoryPath='' onNotice={()=>{}}/></div></I18nProvider>);`
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
      const page = await browser.newPage({ viewport: { width, height: 844 }, locale: 'ko-KR' })
      page.setDefaultTimeout(6500)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      let job: GitAiCommitJob | null = null
      let starts = 0, commits = 0
      let modelRequests = 0
      let sets = [{ id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', name: '기존 커밋 에이전트', runtime: 'codex', modelId: 'test-model', role: 'Write commits' }]
      await page.route('http://localhost:48976/**', async route => {
        const request = route.request(), url = new URL(request.url()), p = url.pathname
        if (p === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (!p.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="${width === 390 ? '' : 'dark'}" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
        if (p === '/api/workspace') return route.fulfill({ json: { path: '/workspace', docs: 'docs', docsPath: '/workspace/docs', projects: [] } })
        if (p.endsWith('/models')) {
          if (p.includes('/codex/') && ++modelRequests === 1) return route.fulfill({ status: 502, json: { error: 'Model lookup failed' } })
          return route.fulfill({ json: { models: p.includes('/codex/') ? [
            { modelId: 'alpha[high]', name: 'Alpha Reasoning' },
            { modelId: 'beta[medium]', name: 'Beta General' },
          ] : [{ modelId: 'claude-test', name: 'Claude Test' }] } })
        }
        if (p === '/api/agent-sets') {
          if (request.method() === 'PUT') {
            const next = request.postDataJSON().sets as typeof sets
            if (new Set(next.map(set => set.name)).size !== next.length) return route.fulfill({ status: 400, json: { error: '에이전트셋 이름이 중복됩니다' } })
            sets = next
          }
          return route.fulfill({ json: { sets } })
        }
        if (p.startsWith('/api/git/ai-commit')) {
          assert.equal(url.searchParams.get('project'), '.workspace'); assert.equal(url.searchParams.get('workspace'), '/workspace')
          if (p.endsWith('/stop')) { job = { ...job!, state: 'cancelled', error: '생성을 취소했습니다' }; return route.fulfill({ json: { ok: true } }) }
          if (request.method() === 'POST') {
            starts++
            const body = request.postDataJSON(); assert.deepEqual(body.files, ['file.ts', 'new.ts']); const set = sets.find(set => set.id === body.agentSetId)!
            assert.match(body.id, /^[a-f0-9-]{36}$/)
            job = { mode: 'commit', id: body.id, agentSetName: set.name, state: 'running', output: '변경사항 분석 중…', startedAt: Date.now(), truncated: false }
          }
          return route.fulfill({ json: { job } })
        }
        if (p === '/api/git/commit' && request.method() === 'POST') { assert.deepEqual(request.postDataJSON().files, ['file.ts', 'new.ts']); commits++; return route.fulfill({ json: { hash: 'abc12345' } }) }
        return route.fulfill({ json: p.endsWith('/repository') ? { repository: true, branch: 'main' } : p.endsWith('/log') ? { commits: [] } : { files: [{ path: 'file.ts', status: 'M' }, { path: 'new.ts', status: 'A' }, { path: 'excluded.ts', status: 'M' }] } })
      })
      const click = (name: string) => page.getByRole('button', { name, exact: true }).click()
      await page.goto('http://localhost:48976/')
      await page.getByRole('checkbox', { name: 'file.ts 커밋에 포함' }).check()
      await page.getByRole('checkbox', { name: 'new.ts 커밋에 포함' }).check()
      await page.getByLabel('커밋 제목', { exact: true }).fill('기존 초안')
      await click('AI 자동 커밋')
      await page.getByRole('button', { name: '기존 커밋 에이전트', exact: false }).click()
      await click('자동 커밋 실행')
      await page.getByText('기존 커밋 에이전트 · 변경사항 분석 중…', { exact: true }).waitFor()
      await click('닫기')
      assert.equal(await page.getByLabel('커밋 제목', { exact: true }).inputValue(), '기존 초안')
      assert.equal(starts, 1); assert.equal(commits, 0)
      await click('AI 자동 커밋')
      await page.getByText('기존 커밋 에이전트 · 변경사항 분석 중…', { exact: true }).waitFor()
      job = { ...job!, state: 'completed', result: { commits: [
        { hash: 'abc123456789', title: 'fix: 첫 작업', description: '첫 변경', files: ['file.ts'] },
        { hash: 'def123456789', title: 'feat: 두 번째 작업', description: '', files: ['new.ts'] },
      ], skipped: [] } }
      await page.getByText('기존 커밋 에이전트 · 자동 커밋 완료', { exact: true }).waitFor()
      await page.getByText('fix: 첫 작업', { exact: true }).waitFor()
      await page.getByText('feat: 두 번째 작업', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: '초안 적용' }).count(), 0)
      assert.equal(await page.getByLabel('커밋 제목', { exact: true }).inputValue(), '기존 초안')
      if (process.env.MEW_GIT_AI_SCREENSHOTS) { await fs.mkdir(process.env.MEW_GIT_AI_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.MEW_GIT_AI_SCREENSHOTS, `commits-${width}.png`) }) }
      await click('닫기')
      assert.equal(commits, 0, 'the AI job owns commit execution, not the manual commit endpoint')
      await page.getByRole('checkbox', { name: '변경 파일 전체 선택' }).uncheck()
      await click('AI 자동 커밋')
      await page.getByText('fix: 첫 작업', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: '자동 커밋 실행', exact: true }).isDisabled(), true, 'completed results remain accessible without selecting files')
      await click('닫기')
      await page.getByRole('checkbox', { name: 'file.ts 커밋에 포함' }).check()
      await page.getByRole('checkbox', { name: 'new.ts 커밋에 포함' }).check()
      await click('AI 자동 커밋'); await click('에이전트셋 선택'); await click('+ 새 에이전트셋 추가')
      const editor = page.getByRole('dialog', { name: '새 에이전트셋', exact: true })
      assert.equal(await editor.locator('select, datalist').count(), 0)
      const runtime = editor.getByRole('combobox', { name: '에이전트', exact: true })
      await runtime.click()
      await page.getByRole('option', { name: 'Codex', exact: true }).click()
      await runtime.click(); await runtime.press('Escape')
      assert.equal(await editor.isVisible(), true, 'Escape keeps the preset editor open')
      await editor.getByRole('alert').filter({ hasText: '모델 목록을 불러오지 못했습니다' }).waitFor()
      const model = editor.getByRole('combobox', { name: '모델 (선택)', exact: true })
      await model.fill('custom-model')
      await model.press('Escape')
      await editor.getByRole('button', { name: '다시 시도', exact: true }).click()
      await editor.getByText('모델 목록을 불러오지 못했습니다', { exact: true }).waitFor({ state: 'hidden' })
      assert.equal(await model.inputValue(), 'custom-model', 'retry preserves a custom ID')
      await model.fill('REASONING')
      await page.getByRole('option', { name: 'Alpha Reasoning · alpha', exact: true }).waitFor()
      assert.equal(await page.getByRole('option', { name: 'Beta General · beta', exact: true }).count(), 0)
      if (process.env.MEW_GIT_AI_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.MEW_GIT_AI_SCREENSHOTS, `model-search-${width}.png`) })
      await model.press('ArrowDown'); await model.press('ArrowDown'); await model.press('Enter')
      assert.equal(await model.inputValue(), 'alpha', 'search by display name saves the exact ACP ID')
      await model.fill('beta')
      await page.getByRole('option', { name: 'Beta General · beta', exact: true }).click()
      assert.equal(await model.inputValue(), 'beta')
      await model.click(); await model.press('Escape')
      assert.equal(await editor.isVisible(), true)
      await runtime.click(); await page.getByRole('option', { name: 'Claude Agent', exact: true }).click()
      assert.equal(await model.inputValue(), '', 'switching runtimes clears the previous model')
      await runtime.click(); await page.getByRole('option', { name: 'Codex', exact: true }).click()
      await model.fill('unknown-model')
      await page.getByRole('option', { name: '일치하는 모델 없음 — 직접 입력 가능', exact: true }).waitFor()
      await model.fill('')
      await page.getByRole('option', { name: '런타임 기본 모델', exact: true }).click()
      assert.equal(await model.inputValue(), '')
      await model.fill('alpha')
      await page.getByRole('option', { name: 'Alpha Reasoning · alpha', exact: true }).click()
      await editor.getByLabel('이름', { exact: true }).fill('기존 커밋 에이전트')
      await editor.getByLabel('역할 지침').fill('짧은 커밋 제목을 작성하세요')
      await editor.getByRole('button', { name: '저장', exact: true }).click()
      await editor.getByRole('alert').filter({ hasText: '이름이 중복됩니다' }).waitFor()
      await editor.getByLabel('이름', { exact: true }).fill('새 커밋 에이전트')
      await editor.getByRole('button', { name: '저장', exact: true }).click()
      await editor.waitFor({ state: 'hidden' })
      await click('자동 커밋 실행')
      await page.getByText('새 커밋 에이전트 · 변경사항 분석 중…', { exact: true }).waitFor()
      assert.equal(sets.length, 2)
      assert.equal(sets[1].runtime, 'codex')
      assert.equal(sets[1].modelId, 'alpha[high]')
      await click('작업 중단')
      await page.getByText('새 커밋 에이전트 · 작업 중단됨', { exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      assert.equal(await page.getByLabel('커밋 제목', { exact: true }).inputValue(), '기존 초안')
      await page.reload()
      await page.getByRole('checkbox', { name: 'file.ts 커밋에 포함' }).check()
      await page.getByRole('checkbox', { name: 'new.ts 커밋에 포함' }).check()
      await click('AI 자동 커밋')
      await page.getByText('새 커밋 에이전트 · 작업 중단됨', { exact: true }).waitFor()
      assert.equal(starts, 2)
      const overflow = await page.evaluate(() => {
        const root = globalThis as unknown as { document: { documentElement: { scrollWidth: number; clientWidth: number } } }
        return root.document.documentElement.scrollWidth > root.document.documentElement.clientWidth
      })
      assert.equal(overflow, false)
      assert.deepEqual(errors, [])
      await click('닫기')
      await page.getByLabel('커밋 제목', { exact: true }).fill('사용자가 확정한 제목')
      await click('커밋')
      await page.getByText('커밋되지 않은 변경사항', { exact: true }).waitFor()
      assert.equal(commits, 1)
      await page.close()
    }
  } finally { await browser.close() }
})
