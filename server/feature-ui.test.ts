import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import type { BranchFeature, BranchFeatureSnapshot } from '../shared/branch-features.ts'

const root = path.resolve(import.meta.dirname, '..'), chrome = domBrowserExecutable()

test('branch feature panel previews apps, preserves drafts and supports review on compact desktop/mobile layouts', { skip: !chrome, timeout: 45_000 }, async t => {
  const source = `import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {FeatureDevelopment} from '${root}/src/components/feature-development.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
localStorage.setItem('mew:locale','ko');window.closeCount=0;
function Fixture(){const[workspace,setWorkspace]=useState('/project');window.switchFixtureWorkspace=setWorkspace;return <FeatureDevelopment key={workspace} accountKey="owner@example.test" workspace={workspace} canUseGit={!location.search.includes('no-git')} onClose={()=>window.closeCount++} onOpenFile={()=>{}} onOpenAgent={()=>{}} />}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:branch-features.tsx', write: false, platform: 'browser', output: { format: 'iife' }, onLog(level, log, next) { if (log.code !== 'MODULE_LEVEL_DIRECTIVE') next(level, log) }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:branch-features.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:branch-features.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const code = bundle.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n')
  const content = (await Promise.all(['src/components/feature-development.tsx', 'packages/ui/src/select-field.tsx', 'packages/ui/src/ConfirmDialog.tsx', 'packages/ui/src/dialog-frame.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))]) + await fs.readFile(`${root}/src/components/feature-development.css`, 'utf8')
  const item = (branch: string, title: string, extras: Partial<BranchFeature> = {}): BranchFeature => ({ branch, title, notes: '', validation: '', review: 'pending', revision: 'a'.repeat(64), previewPort: null, previewPath: '/', previewStatus: 'unconfigured', current: false, isBase: false, worktreePath: null, worktreePaths: [], dirty: null, commit: { hash: 'abcdef1234567890', subject: '최근 작업 내용', committedAt: '2026-10-22T09:00:00Z' }, updatedAt: null, ...extras })
  const state: BranchFeatureSnapshot = { workspace: '/project', isGitRepository: true, baseBranch: 'main', currentBranch: 'main', canEdit: true, canPreview: true, branches: [
    item('main', '기준 버전', { current: true, isBase: true, worktreePath: '/project', worktreePaths: ['/project'], dirty: { staged: 0, unstaged: 0, untracked: 0 } }),
    item('feat/search', '검색 개선', { notes: '검색 결과를 빠르게 찾고 직접 확인합니다.', previewPort: 5101, previewPath: '/deep?tab=results', previewStatus: 'running', worktreePath: '/project-search', worktreePaths: ['/project-search'], dirty: { staged: 1, unstaged: 2, untracked: 1 } }),
    item('feat/theme', '테마 조정', { notes: '밝은 테마의 색상 조정', review: 'needs-fix' }),
  ] }
  const secondState = structuredClone(state); secondState.workspace = '/other'
  secondState.branches.find(branch => branch.branch === 'feat/search')!.notes = '다른 프로젝트의 작업'
  let failRead = false, failSave = false, reads = 0
  const mutations: Record<string, unknown>[] = []
  const browser = await chromium.launch({ executablePath: chrome, chromiumSandbox: true })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 } })
  await context.route('http://branch-features.test/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname === '/api/features/branches') {
      if (request.method() === 'GET') { reads++; return route.fulfill({ status: failRead ? 503 : 200, json: failRead ? { error: '목록을 불러오지 못했습니다.' } : url.searchParams.get('workspace') === '/other' ? secondState : state }) }
      const patch = request.postDataJSON() as Record<string, unknown>
      mutations.push(patch)
      if (failSave) return route.fulfill({ status: 403, json: { error: '변경 권한이 회수되었습니다.' } })
      const active = patch.workspace === '/other' ? secondState : state
      const branch = active.branches.find(item => item.branch === patch.branch)!
      if (patch.expectedRevision && patch.expectedRevision !== branch.revision) return route.fulfill({ status: 409, json: { error: '코드가 변경되었습니다. 최신 상태를 확인하세요.' } })
      for (const key of ['title', 'notes', 'validation', 'review', 'previewPort', 'previewPath'] as const) if (key in patch) Object.assign(branch, { [key]: patch[key] })
      branch.updatedAt = new Date().toISOString()
      return route.fulfill({ json: active })
    }
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: code })
    if (url.pathname.startsWith('/5101/')) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<p>작업 미리보기</p>' })
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0}#root{height:100dvh;max-width:600px}</style><div id="root"></div><script src="/app.js"></script></html>` })
  })
  const page = await context.newPage(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(5000)
  await page.goto('http://branch-features.test/')
  const row = (branch: string) => page.locator(`[data-branch-feature="${branch}"]`)
  const search = row('feat/search'), theme = row('feat/theme')
  await search.waitFor()
  assert.equal(await row('main').count(), 0)
  assert.equal(await page.locator('[data-branch-feature]').count(), 2)
  const preview = search.getByRole('link', { name: '검색 개선 미리보기 열기', exact: true })
  assert.equal(await preview.getAttribute('href'), '/5101/deep?tab=results')
  assert.equal(await preview.getAttribute('target'), '_blank')
  assert.equal(await preview.getAttribute('rel'), 'noopener noreferrer')
  const popupEvent = page.waitForEvent('popup'); await preview.click(); const popup = await popupEvent
  await popup.getByText('작업 미리보기', { exact: true }).waitFor({ timeout: 5000 })
  assert.equal(popup.url(), 'http://branch-features.test/5101/deep?tab=results'); await popup.close()
  await page.getByRole('button', { name: '전체', exact: true }).click(); await row('main').waitFor()
  await page.getByRole('button', { name: '작업 브랜치', exact: true }).click()
  await page.getByRole('textbox', { name: '브랜치 검색', exact: true }).fill('theme')
  assert.equal(await search.count(), 0); assert.equal(await theme.count(), 1)
  await page.getByRole('textbox', { name: '브랜치 검색', exact: true }).fill('')
  await search.getByRole('button', { name: '검색 개선 작업 설정', exact: true }).click()
  await search.getByRole('textbox', { name: '미리보기 포트', exact: true }).fill('0')
  await search.getByRole('button', { name: '저장', exact: true }).click()
  await search.getByRole('alert').getByText('포트는 1~65535 사이의 정수로 입력하세요.', { exact: true }).waitFor()
  assert.equal(mutations.length, 0)
  await search.getByRole('textbox', { name: '미리보기 포트', exact: true }).fill('5101')
  await search.getByRole('textbox', { name: '시작 경로', exact: true }).fill('//evil.test')
  await search.getByRole('button', { name: '저장', exact: true }).click()
  await search.getByRole('alert').getByText('시작 경로는 /로 시작하는 앱 내부 경로여야 합니다.', { exact: true }).waitFor()
  assert.equal(mutations.length, 0)
  await search.getByRole('textbox', { name: '시작 경로', exact: true }).fill('/deep?tab=results')
  await search.getByRole('textbox', { name: '작업 내용', exact: true }).fill('보존할 작업 초안')
  state.branches.find(branch => branch.branch === 'feat/search')!.validation = '다른 작업자가 추가한 검증'
  await page.getByRole('button', { name: '새로고침', exact: true }).click()
  await page.locator('[data-feature-panel][aria-busy="false"]').waitFor()
  assert.equal(await search.getByRole('textbox', { name: '작업 내용', exact: true }).inputValue(), '보존할 작업 초안')
  await theme.getByRole('button', { name: '테마 조정 작업 설정', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: '저장하지 않은 변경사항을 버릴까요?', exact: true })
  await confirm.waitFor(); await confirm.getByRole('button', { name: '취소', exact: true }).click()
  assert.equal(await search.getByRole('textbox', { name: '작업 내용', exact: true }).inputValue(), '보존할 작업 초안')
  await search.getByRole('combobox', { name: '사용자 확인', exact: true }).click()
  await page.getByRole('option', { name: '확인 완료', exact: true }).click()
  await search.getByRole('button', { name: '저장', exact: true }).click()
  await search.getByRole('status').getByText('저장됨', { exact: true }).waitFor()
  assert.equal(mutations.length, 1)
  assert.equal(mutations[0].notes, '보존할 작업 초안')
  assert.equal(mutations[0].review, 'verified')
  assert.equal(mutations[0].expectedRevision, 'a'.repeat(64))
  assert.equal('validation' in mutations[0], false)
  assert.equal(await search.getByRole('textbox', { name: '검증 기록', exact: true }).inputValue(), '다른 작업자가 추가한 검증')
  await search.getByRole('textbox', { name: '작업 내용', exact: true }).fill('충돌 중에도 유지할 초안')
  await search.getByRole('combobox', { name: '사용자 확인', exact: true }).click()
  await page.getByRole('option', { name: '수정 필요', exact: true }).click()
  const changedBranch = state.branches.find(branch => branch.branch === 'feat/search')!
  changedBranch.revision = 'b'.repeat(64); changedBranch.validation = '새 커밋의 검증 기록'
  await page.getByRole('button', { name: '새로고침', exact: true }).click()
  await page.locator('[data-feature-panel][aria-busy="false"]').waitFor()
  await search.getByRole('button', { name: '저장', exact: true }).click()
  await search.getByRole('alert').getByText('코드가 변경되었습니다. 최신 상태를 확인하세요.', { exact: true }).waitFor()
  assert.equal(mutations.at(-1)!.expectedRevision, 'a'.repeat(64))
  await search.getByRole('button', { name: '최신 상태로 다시 확인', exact: true }).click()
  await search.getByRole('alert').waitFor({ state: 'detached' })
  assert.equal(await search.getByRole('textbox', { name: '작업 내용', exact: true }).inputValue(), '충돌 중에도 유지할 초안')
  assert.equal(await search.getByRole('textbox', { name: '검증 기록', exact: true }).inputValue(), '새 커밋의 검증 기록')
  await search.getByRole('button', { name: '저장', exact: true }).click()
  await search.getByRole('status').getByText('저장됨', { exact: true }).waitFor()
  assert.equal(mutations.at(-1)!.expectedRevision, 'b'.repeat(64))
  failSave = true
  await search.getByRole('textbox', { name: '작업 내용', exact: true }).fill('거절되어도 유지할 초안')
  await search.getByRole('button', { name: '저장', exact: true }).click()
  await search.getByRole('alert').getByText('변경 권한이 회수되었습니다.', { exact: true }).waitFor()
  assert.equal(await search.getByRole('textbox', { name: '작업 내용', exact: true }).inputValue(), '거절되어도 유지할 초안')
  failSave = false
  await search.getByRole('button', { name: '취소', exact: true }).click()
  await confirm.getByRole('button', { name: '변경 버리기', exact: true }).click()
  await search.locator('form').waitFor({ state: 'detached' })
  await search.getByRole('button', { name: '검색 개선 작업 설정', exact: true }).click()
  await search.getByRole('textbox', { name: '작업 내용', exact: true }).fill('새로고침에도 유지할 초안')
  await page.reload()
  await search.getByRole('textbox', { name: '작업 내용', exact: true }).waitFor()
  assert.equal(await search.getByRole('textbox', { name: '작업 내용', exact: true }).inputValue(), '새로고침에도 유지할 초안')
  await page.evaluate(`window.switchFixtureWorkspace('/other')`)
  await search.waitFor(); assert.equal(await search.locator('form').count(), 0)
  await search.getByRole('button', { name: '검색 개선 작업 설정', exact: true }).click()
  assert.equal(await search.getByRole('textbox', { name: '작업 내용', exact: true }).inputValue(), '다른 프로젝트의 작업')
  await search.getByRole('textbox', { name: '작업 내용', exact: true }).fill('다른 프로젝트에 남긴 초안')
  await page.evaluate(`window.switchFixtureWorkspace('/project')`)
  await search.getByRole('textbox', { name: '작업 내용', exact: true }).waitFor()
  assert.equal(await search.getByRole('textbox', { name: '작업 내용', exact: true }).inputValue(), '새로고침에도 유지할 초안')
  await page.evaluate(`window.switchFixtureWorkspace('/other')`)
  await search.getByRole('textbox', { name: '작업 내용', exact: true }).waitFor()
  assert.equal(await search.getByRole('textbox', { name: '작업 내용', exact: true }).inputValue(), '다른 프로젝트에 남긴 초안')
  await page.evaluate(`window.switchFixtureWorkspace('/project')`)
  await search.getByRole('textbox', { name: '작업 내용', exact: true }).waitFor()
  const missing = state.branches.splice(state.branches.findIndex(branch => branch.branch === 'feat/search'), 1)[0]
  await page.reload()
  await page.getByRole('alert').getByText('브랜치가 없습니다. 저장 전 초안을 복사하거나 취소하세요.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '작업 내용', exact: true }).inputValue(), '새로고침에도 유지할 초안')
  assert.equal(await page.getByRole('button', { name: '저장', exact: true }).isDisabled(), true)
  state.branches.push(missing)
  await page.getByRole('button', { name: '새로고침', exact: true }).click()
  await search.getByRole('textbox', { name: '작업 내용', exact: true }).waitFor()
  assert.equal(await search.getByRole('textbox', { name: '작업 내용', exact: true }).inputValue(), '새로고침에도 유지할 초안')
  await search.getByRole('button', { name: '취소', exact: true }).click()
  await confirm.getByRole('button', { name: '변경 버리기', exact: true }).click()
  await page.reload(); await search.waitFor()
  assert.equal(await search.locator('form').count(), 0, 'explicit discard removes the persisted draft')
  for (const width of [1100, 390, 320]) {
    await page.setViewportSize({ width, height: 850 })
    for (const dark of [true, false]) {
      await page.locator('html').evaluate((el, dark) => el.classList.toggle('dark', dark), dark)
      assert.equal(await page.locator('[data-feature-panel]').evaluate(el => el.scrollWidth <= el.clientWidth), true)
      await page.screenshot({ path: `/tmp/mew-branch-features-${width}-${dark ? 'dark' : 'light'}.png` })
    }
  }
  await search.getByRole('button', { name: '검색 개선 작업 설정', exact: true }).click()
  await search.locator('form').waitFor()
  assert.equal(await page.locator('[data-feature-panel]').evaluate(el => el.scrollWidth <= el.clientWidth), true)
  await page.screenshot({ path: '/tmp/mew-branch-features-editor-mobile.png' })
  failRead = true
  await page.getByRole('button', { name: '새로고침', exact: true }).click()
  await page.getByRole('alert').getByText('목록을 불러오지 못했습니다.', { exact: true }).waitFor()
  failRead = false
  await page.getByRole('button', { name: '새로고침', exact: true }).click()
  await page.getByRole('alert').waitFor({ state: 'detached' })
  state.canEdit = false; state.canPreview = false
  changedBranch.previewStatus = 'unknown'
  await page.reload(); await page.getByText('읽기 전용', { exact: true }).waitFor()
  assert.equal(await search.getByRole('link').count(), 0)
  assert.equal(await search.getByRole('button', { name: '검색 개선 미리보기 설정', exact: true }).isDisabled(), true)
  await search.getByText('포트 상태 미확인 · 5101', { exact: true }).waitFor()
  await search.getByRole('button', { name: '검색 개선 작업 설정', exact: true }).click()
  assert.equal(await search.locator('form').count(), 0)
  await search.getByText('새 커밋의 검증 기록', { exact: true }).waitFor()
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  assert.equal(await page.evaluate('window.closeCount'), 1)
  const beforeDenied = reads
  await page.goto('http://branch-features.test/?no-git')
  await page.getByText('브랜치를 보려면 Git 권한이 필요합니다.', { exact: true }).waitFor()
  assert.equal(reads, beforeDenied)
  assert.deepEqual(errors, [])
})
