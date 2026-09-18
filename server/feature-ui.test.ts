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
import { setFeature } from './access-policy.ts'
import type { AgentHostCallbacks } from './agentHost.ts'

const root = path.resolve(import.meta.dirname, '..')
test('feature GUI implements compact hierarchy, editing, assignment, review, evidence and mobile navigation', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
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
  const make = async (title: string, status: 'verified' | 'needs-fix' | null = null) => {
    const run = await store.request(workspace, 'owner@example.com', { id: crypto.randomUUID(), title, content: `${title} 요구사항`, agentSetId: set.id }, set)
    await store.claim(workspace)
    const feature = await store.assign(workspace, run.id, { action: 'new', title, content: run.content, reason: '새 기능' })
    await store.report(workspace, run.id, report); await store.finish(workspace, run.id, 'completed')
    if (status) await store.judge(workspace, feature.id, store.read(workspace).features.find(item => item.id === feature.id)!.version, status)
    return feature.id
  }
  const loginId = await make('로그인'), searchId = await make('검색', 'verified'); await make('설정', 'needs-fix')
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
  const source = `import React from '${root}/node_modules/react/index.js';import {createRoot} from '${root}/node_modules/react-dom/client.js';import {FeatureDevelopment} from '${root}/src/components/feature-development.tsx';import {I18nProvider} from '${root}/src/i18n.tsx';window.files=[];window.agents=[];createRoot(document.getElementById('root')).render(<I18nProvider><FeatureDevelopment workspace={${JSON.stringify(workspace)}} canUseGit onClose={()=>window.closed=true} onOpenFile={path=>window.files.push(path)} onOpenAgent={run=>window.agents.push(run.tabId)}/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:features.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:features.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:features.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = ['src/components/feature-development.tsx', 'packages/ui/src/dialog-frame.tsx', 'packages/ui/src/ConfirmDialog.tsx'].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
  const compiler = await compile(fs.readFileSync(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const app = express(); app.use(express.json())
  app.use((req, _res, next) => { req.auth = { role: 'owner', email: 'owner@example.com', mustChangePassword: false }; next() })
  app.use('/api/features', createFeatureRouter(executor))
  app.get('/api/agent-sets', (_req, res) => res.json({ sets: [set, secondSet] }))
  app.get('/api/git/commit', (_req, res) => res.json({ hash, subject: 'Add login', body: '실제 로그인 커밋', files: [{ status: 'A', path: 'login.ts' }] }))
  app.get('/app.js', (_req, res) => res.type('js').send(chunk.code))
  app.get('/', (_req, res) => res.type('html').send(`<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`))
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
    assert.equal(await page.locator('[data-feature-list] button').first().innerText(), '기능 요청')
    assert.ok((await row(loginId).boundingBox())!.height <= 32)
    assert.equal(await row(loginId).locator('[data-feature-status="implemented"]').count(), 1)
    assert.equal(await row(searchId).locator('[data-feature-status="verified"]').count(), 1)
    const dotColor = (id: string) => row(id).locator('[data-feature-status]').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor)
    assert.equal(await dotColor(loginId), 'rgb(66, 203, 179)')
    assert.equal(await dotColor(searchId), 'rgb(36, 147, 68)')
    await row(loginId).click()
    await page.getByRole('button', { name: 'login.ts', exact: true }).click()
    assert.deepEqual(await page.evaluate('window.files'), ['login.ts'])
    const documentPath = store.read(workspace).features.find(item => item.id === loginId)!.documentPath!
    await page.getByRole('button', { name: `문서 열기: ${documentPath}`, exact: true }).click()
    assert.deepEqual(await page.evaluate('window.files'), ['login.ts', documentPath])
    const documentFile = path.join(workspace, documentPath)
    fs.writeFileSync(documentFile, fs.readFileSync(documentFile, 'utf8').replace('로그인 요구사항', '파일에서 수정한 요구사항'))
    await page.getByRole('button', { name: '새로고침', exact: true }).click()
    await row(loginId).locator('[data-feature-status="changed"]').waitFor()
    assert.equal(await page.getByRole('textbox', { name: '요구사항', exact: true }).inputValue(), '파일에서 수정한 요구사항')
    await page.getByRole('textbox', { name: '요구사항', exact: true }).fill('보존할 GUI 초안')
    fs.writeFileSync(documentFile, fs.readFileSync(documentFile, 'utf8').replace('파일에서 수정한 요구사항', '두 번째 외부 수정'))
    await page.getByRole('button', { name: '새로고침', exact: true }).click()
    await page.getByRole('button', { name: '최신 내용 불러오기', exact: true }).waitFor()
    assert.equal(await page.getByRole('textbox', { name: '요구사항', exact: true }).inputValue(), '보존할 GUI 초안')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '다른 변경사항' }).waitFor()
    assert.ok(fs.readFileSync(documentFile, 'utf8').includes('두 번째 외부 수정'))
    await page.getByRole('button', { name: '최신 내용 불러오기', exact: true }).click()
    await page.getByRole('button', { name: '변경 버리기', exact: true }).click()
    assert.equal(await page.getByRole('textbox', { name: '요구사항', exact: true }).inputValue(), '두 번째 외부 수정')
    await page.getByRole('button', { name: /Add login/ }).click()
    await page.getByText('실제 로그인 커밋').waitFor()
    await page.getByRole('dialog').last().getByRole('button', { name: '닫기', exact: true }).click()
    await page.getByRole('textbox', { name: '제목', exact: true }).fill('로그인 변경')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await row(loginId).locator('[data-feature-status="changed"]').waitFor()
    assert.equal(await dotColor(loginId), 'rgb(225, 138, 38)')
    assert.equal(store.read(workspace).runs.length, 3, 'editing alone never dispatches an agent')
    await page.getByRole('button', { name: '확인 완료', exact: true }).click()
    await row(loginId).locator('[data-feature-status="verified"]').waitFor()
    await page.getByRole('button', { name: '에이전트에게 맡기기', exact: true }).click()
    const composer = page.getByRole('form', { name: '기능 요청', exact: true })
    assert.equal(await page.getByRole('dialog').count(), 1, 'request composer is inline')
    await composer.getByRole('button', { name: '맡기기', exact: true }).click()
    await row(loginId).locator('[data-feature-status="implementing"]').waitFor()
    assert.equal(await dotColor(loginId), 'rgb(54, 135, 238)')
    await page.getByRole('textbox', { name: '요구사항', exact: true }).fill('실행 중 새로 변경한 요구사항')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await row(loginId).locator('[data-feature-status="changed"]').waitFor()
    const run = store.read(workspace).runs.at(-1)!
    await store.report(workspace, run.id, report)
    callbacks.get(run.tabId)!.onEvent?.({ type: 'turn_end', stopReason: 'end_turn', durationMs: 10 })
    await page.getByRole('button', { name: '새로고침', exact: true }).click()
    assert.equal(store.read(workspace).features.find(item => item.id === loginId)!.status, 'changed')
    assert.equal(await page.getByRole('textbox', { name: '요구사항', exact: true }).inputValue(), '실행 중 새로 변경한 요구사항')
    await page.getByRole('button', { name: '수정 필요', exact: true }).click()
    await row(loginId).locator('[data-feature-status="needs-fix"]').waitFor()
    assert.equal(await dotColor(loginId), 'rgb(223, 73, 91)')
    await page.getByRole('button', { name: '하위 기능 추가', exact: true }).click()
    assert.equal(await composer.getByRole('textbox').count(), 1)
    await composer.getByRole('textbox', { name: '추가할 기능', exact: true }).fill('비밀번호 재설정\n복구 이메일을 보냅니다.')
    await composer.getByRole('button', { name: '맡기기', exact: true }).click()
    await page.getByTitle('비밀번호 재설정', { exact: true }).waitFor()
    const childRun = store.read(workspace).runs.at(-1)!, childId = childRun.featureId!
    assert.equal(store.read(workspace).features.find(item => item.id === childId)!.parentId, loginId)
    assert.ok((await row(childId).boundingBox())!.x > (await row(loginId).boundingBox())!.x)
    await store.report(workspace, childRun.id, report); callbacks.get(childRun.tabId)!.onEvent?.({ type: 'turn_end', stopReason: 'end_turn', durationMs: 20 })
    await page.getByRole('button', { name: '새로고침', exact: true }).click()
    await row(childId).locator('[data-feature-status="implemented"]').waitFor()
    await page.getByRole('combobox', { name: '정렬', exact: true }).selectOption('name')
    assert.equal(await page.locator('[data-feature-id]').first().getAttribute('data-feature-id'), searchId)
    await row(loginId).click()
    await page.screenshot({ path: '/tmp/mew-features-desktop.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '목록으로', exact: true }).click()
    await row(childId).tap()
    await page.getByRole('textbox', { name: '제목', exact: true }).waitFor()
    await page.screenshot({ path: '/tmp/mew-features-mobile.png' })
    await page.getByRole('textbox', { name: '제목', exact: true }).fill('저장하지 않은 수정')
    await page.getByRole('button', { name: '목록으로', exact: true }).click()
    await page.getByRole('button', { name: '취소', exact: true }).click()
    assert.equal(await page.getByRole('textbox', { name: '제목', exact: true }).inputValue(), '저장하지 않은 수정')
    await page.getByRole('button', { name: '목록으로', exact: true }).click()
    await page.getByRole('button', { name: '변경 버리기', exact: true }).click()
    await row(childId).tap()
    assert.equal(await page.getByRole('textbox', { name: '제목', exact: true }).inputValue(), '비밀번호 재설정')
    // Mobile new requests keep the selector at the top and the composer inside the list.
    await page.getByRole('button', { name: '목록으로', exact: true }).click()
    await page.getByRole('combobox', { name: '에이전트셋', exact: true }).selectOption(secondSet.id)
    await page.getByRole('button', { name: '기능 요청', exact: true }).click()
    const requestInput = composer.getByRole('textbox', { name: '추가할 기능', exact: true })
    assert.equal(await requestInput.getAttribute('rows'), '3')
    assert.equal(await requestInput.evaluate(el => el === el.ownerDocument.activeElement), true)
    assert.equal(await composer.getByRole('textbox', { name: '제목', exact: true }).count(), 0)
    assert.equal(await composer.getByRole('combobox').count(), 0)
    assert.equal(await composer.getByRole('button', { name: '맡기기', exact: true }).isDisabled(), true)
    const requestText = '알림 설정\n이메일과 앱 알림을 각각 선택하고 싶어요.'
    await requestInput.fill(requestText)
    const selectorBox = (await page.getByRole('combobox', { name: '에이전트셋', exact: true }).boundingBox())!
    assert.ok(selectorBox.y < (await requestInput.boundingBox())!.y)
    assert.ok((await requestInput.boundingBox())!.height < 90)
    assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
    await page.screenshot({ path: '/tmp/mew-features-inline-mobile.png' })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.screenshot({ path: '/tmp/mew-features-inline-desktop.png' })
    await composer.getByRole('button', { name: '취소', exact: true }).click()
    await page.getByRole('dialog').last().getByRole('button', { name: '취소', exact: true }).click()
    assert.equal(await requestInput.inputValue(), requestText, 'cancelling discard retains the draft')
    // A failed request retains both content and the chosen preset for retry.
    await page.route('**/api/features/requests', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '잠시 후 다시 시도하세요' }) }), { times: 1 })
    await composer.getByRole('button', { name: '맡기기', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '잠시 후 다시 시도하세요' }).waitFor()
    assert.equal(await requestInput.inputValue(), requestText)
    assert.equal(await page.getByRole('combobox', { name: '에이전트셋', exact: true }).inputValue(), secondSet.id)
    await composer.getByRole('button', { name: '맡기기', exact: true }).click()
    await page.getByTitle('알림 설정', { exact: true }).waitFor()
    const inlineRun = store.read(workspace).runs.at(-1)!
    assert.equal(inlineRun.content, requestText)
    assert.equal(inlineRun.title, '알림 설정')
    assert.equal(inlineRun.agentSet.id, secondSet.id)
    assert.equal(await composer.count(), 0)
    await store.report(workspace, inlineRun.id, report)
    callbacks.get(inlineRun.tabId)!.onEvent?.({ type: 'turn_end', stopReason: 'end_turn', durationMs: 10 })
    await page.getByRole('button', { name: '새로고침', exact: true }).click()
    await row(inlineRun.featureId!).locator('[data-feature-status="implemented"]').waitFor()
    await row(childId).click()
    await page.setViewportSize({ width: 390, height: 844 })
    setFeature('owner@example.com', 'filesWrite', false)
    await page.getByRole('button', { name: '새로고침', exact: true }).click()
    await page.getByText('읽기 전용', { exact: true }).waitFor()
    assert.equal(await page.getByRole('textbox', { name: '제목', exact: true }).isDisabled(), true)
    const denied = await fetch(`${origin}/api/features/${loginId}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace, version: 1, status: 'verified' }) })
    assert.equal(denied.status, 403)
    const stale = await fetch(`${origin}/api/features?workspace=${encodeURIComponent('/old-project')}`); assert.equal(stale.status, 409)
    fs.unlinkSync(path.join(workspace, store.read(workspace).features.find(item => item.id === childId)!.documentPath!))
    await page.getByRole('button', { name: '새로고침', exact: true }).click()
    await row(loginId).waitFor({ state: 'visible' })
    assert.equal(await page.getByRole('textbox', { name: '제목', exact: true }).count(), 0)
    assert.deepEqual(errors, [])
  } finally {
    executor.stop(); await browser.close(); await new Promise<void>(resolve => server.close(() => resolve()))
    setWorkspaceRoot(original); fs.rmSync(temporary, { recursive: true, force: true })
  }
})
