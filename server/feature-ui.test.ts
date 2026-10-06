import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import express from 'express'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { FeatureStore } from './features.ts'
import { FeatureService } from './feature-service.ts'
import { createFeatureRouter } from './feature-routes.ts'
import { WORKSPACE_ROOT, setWorkspaceRoot } from './paths.ts'
import { writeSets } from './agentSets.ts'
import type { AgentHostCallbacks } from './agentHost.ts'

const root = path.resolve(import.meta.dirname, '..')
test('feature GUI displays a file-backed tree, restores state and recovers from errors on desktop and mobile', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-feature-ui-'))), workspace = path.join(temporary, 'project'), original = WORKSPACE_ROOT
  fs.mkdirSync(workspace); fs.writeFileSync(path.join(workspace, 'login.ts'), 'export const login = true')
  const git = (...args: string[]) => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-q'); git('add', 'login.ts'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'Add login')
  const hash = git('rev-parse', 'HEAD')
  setWorkspaceRoot(workspace)
  const store = new FeatureStore(path.join(temporary, 'state'))
  const set = { id: crypto.randomUUID(), name: '기본 구현팀', role: 'Build', runtime: 'codex', modelId: '' }
  const secondSet = { ...set, id: crypto.randomUUID(), name: '두 번째 팀' }; writeSets([set, secondSet])
  const report = { summary: '로그인을 구현했습니다.', validation: '기능 검증 통과', files: ['login.ts'], commits: [{ repository: '', hash }] }
  const make = async (title: string, status: 'verified' | 'needs-fix' | null = null, parentId?: string) => {
    const run = await store.request(workspace, 'owner@example.com', { id: crypto.randomUUID(), title, content: `${title} 요구사항`, agentSetId: set.id, parentId }, set)
    await store.claim(workspace)
    const feature = await store.assign(workspace, run.id, { action: parentId ? 'child' : 'new', parentId, title, content: run.content, reason: '새 기능' })
    await store.report(workspace, run.id, report); await store.finish(workspace, run.id, 'completed')
    if (status) await store.judge(workspace, feature.id, store.read(workspace).features.find(item => item.id === feature.id)!.version, status)
    return feature.id
  }
  const loginId = await make('로그인'), searchId = await make('검색', 'verified'); await make('설정', 'needs-fix')
  const childId = await make('로그인 제한', null, loginId)
  const grandchildId = await make('추가 제한', null, childId)
  fs.writeFileSync(path.join(workspace, 'docs/features/일반 문서.md'), '# 제목\n\n<!-- mew:validation:start -->\n불완전한 구분자도 일반 본문이다.')
  for (let index = 0; index < 30; index++) fs.writeFileSync(path.join(workspace, `docs/features/항목 ${index}.md`), '본문')
  const callbacks = new Map<string, AgentHostCallbacks>()
  const executor = new FeatureService(store, async (_runtime, tab, _cwd, cb) => {
    callbacks.set(tab, cb)
    cb.onEvent?.({ type: 'meta', meta: { sessionId: 'fixture-session', startedAt: '', turns: 0, busy: false, queued: [], usage: null, canLoad: true, canList: false } })
    return { close() {}, send(command) {
      if (command.type !== 'prompt') return
      const run = store.read(workspace).runs.find(item => item.tabId === tab)!
      void store.assign(workspace, run.id, {
        action: run.targetId ? 'update' : run.parentId ? 'child' : 'new', title: run.title, content: run.content, reason: '요청에 맞는 기능에 연결',
        featureId: run.targetId, version: run.targetVersion, parentId: run.parentId,
      }).then(() => cb.onEvent?.({ type: 'turn_start', startedAt: Date.now() }))
    } }
  }, async () => { throw new Error('no recovery expected') }, () => true)
  const source = `import React from '${root}/node_modules/react/index.js';import {createRoot} from '${root}/node_modules/react-dom/client.js';import {FeatureDevelopment} from '${root}/src/components/feature-development.tsx';import {I18nProvider} from '${root}/src/i18n.tsx';window.files=[];window.agents=[];createRoot(document.getElementById('root')).render(<I18nProvider><FeatureDevelopment workspace={${JSON.stringify(workspace)}} canUseGit initialState={JSON.parse(localStorage.getItem('fixture:feature-state') || 'null')} onChange={state=>{window.featureState=state;localStorage.setItem('fixture:feature-state',JSON.stringify(state))}} onClose={()=>window.featureClosed=true} onOpenFile={path=>window.files.push(path)} onOpenAgent={run=>window.agents.push(run.tabId)}/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:features.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:features.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:features.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = ['src/components/feature-development.tsx', 'packages/ui/src/select-field.tsx', 'packages/ui/src/dialog-frame.tsx', 'packages/ui/src/ConfirmDialog.tsx'].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
  const compiler = await compile(fs.readFileSync(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const app = express(); app.use(express.json())
  app.use((req, _res, next) => { req.auth = { role: 'owner', email: 'owner@example.com', mustChangePassword: false }; next() })
  const mutations: string[] = [], agentSetReads: string[] = []
  app.use((req, _res, next) => { if (req.path.startsWith('/api/features') && req.method !== 'GET') mutations.push(req.path); if (req.path === '/api/agent-sets') agentSetReads.push(req.path); next() })
  let failFeatures = false
  app.use('/api/features', (_req, res, next) => { if (failFeatures) { res.status(409).json({ error: '일시적 목록 오류' }); return }; next() }, createFeatureRouter(executor))
  app.get('/api/agent-sets', (_req, res) => res.json({ sets: [set, secondSet] }))
  app.get('/api/git/commit', (_req, res) => res.json({ hash, subject: 'Add login', body: '실제 로그인 커밋', files: [{ status: 'A', path: 'login.ts' }] }))
  app.get('/app.js', (_req, res) => res.type('js').send(chunk.code))
  app.get('/', (_req, res) => res.type('html').send(`<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root" style="height:100dvh"></div><script src="/app.js"></script></html>`))
  const server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, hasTouch: true }); page.setDefaultTimeout(6000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript("localStorage.setItem('mew:locale','ko')")
    await page.goto(origin)
    const row = (id: string) => page.locator(`[data-feature-id="${id}"]`)
    await row(loginId).waitFor()
    await page.getByText('읽기 전용', { exact: true }).waitFor()
    const assertReadonly = async () => {
      assert.equal(await page.getByRole('textbox').count(), 0)
      assert.equal(await page.getByRole('combobox', { name: '에이전트셋', exact: true }).count(), 0)
      for (const name of ['기능 요청', '확인 완료', '수정 필요', '에이전트에게 맡기기', '하위 기능 추가', '다시 요청', '중단']) {
        assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0)
      }
      assert.equal(await page.locator('[data-feature-editor], [data-spec-item], form').count(), 0)
    }
    await assertReadonly()
    assert.ok((await row(loginId).boundingBox())!.height <= 32)
    assert.equal(await row(loginId).locator('[data-feature-status="implemented"]').count(), 1)
    assert.equal(await row(searchId).locator('[data-feature-status="verified"]').count(), 1)
    const login = page.locator(`[data-feature-node="${loginId}"]`)
    const documentPath = store.read(workspace).features.find(feature => feature.id === loginId)!.documentPath!
    assert.equal(documentPath, 'docs/features/로그인/_로그인.md')
    assert.equal(await row(childId).count(), 0)
    await login.getByRole('button', { name: '로그인', exact: true }).press('Enter')
    assert.deepEqual(await page.evaluate('window.files'), [documentPath])
    assert.equal(await row(childId).count(), 0, 'opening a document keeps the branch collapsed')
    await login.getByRole('button', { name: `문서 열기: ${documentPath}`, exact: true }).click()
    assert.deepEqual(await page.evaluate('window.files'), [documentPath, documentPath])
    await page.getByRole('button', { name: '모두 펼치기', exact: true }).click()
    await row(grandchildId).waitFor()
    assert.equal(await page.locator('[data-feature-specification], [data-spec-section], details').count(), 0)
    for (const text of ['요구사항', '구현 내용', '검증', '관련 파일', '관련 커밋', '작업 이력', '로그인 요구사항']) {
      assert.equal(await page.getByText(text, { exact: true }).count(), 0)
    }
    assert.equal(await row(searchId).locator('button').count(), 1, 'leaf title opens its document')
    assert.equal(await page.getByRole('button', { name: '검색 접기', exact: true }).count(), 0)
    const child = page.locator(`[data-feature-node="${childId}"]`)
    await child.getByRole('button', { name: '로그인 제한 접기', exact: true }).click()
    assert.equal(await row(grandchildId).count(), 0)
    await page.reload()
    await row(childId).waitFor()
    assert.equal(await row(grandchildId).count(), 0)
    await child.getByRole('button', { name: '로그인 제한 펼치기', exact: true }).press('Enter')
    await row(grandchildId).waitFor()
    await page.getByRole('combobox', { name: '정렬', exact: true }).click()
    await page.getByRole('option', { name: '이름순', exact: true }).click()
    const scroll = page.locator('[data-feature-list]')
    await scroll.evaluate(el => { el.scrollTop = 120 })
    await page.waitForFunction('window.featureState.scrollTop === 120')
    await page.reload()
    await row(childId).waitFor()
    assert.equal(await scroll.evaluate(el => el.scrollTop), 120)
    await page.getByRole('combobox', { name: '정렬', exact: true }).getByText('이름순').waitFor()
    await scroll.evaluate(el => { el.scrollTop = 0 })
    await page.screenshot({ path: '/tmp/mew-features-file-tree-desktop.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('html').evaluate(el => el.classList.remove('dark'))
    await assertReadonly()
    assert.equal(await page.locator('[data-feature-panel]').evaluate(el => el.scrollWidth <= el.clientWidth), true)
    await page.screenshot({ path: '/tmp/mew-features-file-tree-mobile.png' })
    await login.getByRole('button', { name: '로그인 접기', exact: true }).tap()
    assert.equal(await row(childId).count(), 0)
    await login.getByRole('button', { name: '로그인 펼치기', exact: true }).tap()
    await row(childId).waitFor()
    failFeatures = true
    await page.getByRole('button', { name: '새로고침', exact: true }).click()
    await page.getByRole('alert').getByText('일시적 목록 오류').waitFor()
    failFeatures = false
    await page.getByRole('button', { name: '새로고침', exact: true }).click()
    await page.getByRole('alert').waitFor({ state: 'detached' })
    await page.getByRole('button', { name: '닫기', exact: true }).click()
    assert.equal(await page.evaluate('window.featureClosed'), true)
    assert.deepEqual(mutations, [])
    assert.deepEqual(agentSetReads, [])
    assert.deepEqual(errors, [])
  } finally {
    executor.stop(); await browser.close(); await new Promise<void>(resolve => server.close(() => resolve()))
    setWorkspaceRoot(original); fs.rmSync(temporary, { recursive: true, force: true })
  }
})
