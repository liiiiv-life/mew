import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { defaultBranchGuidance, type BranchGuidanceSettings } from '../shared/branch-guidance.ts'

const root = path.resolve(import.meta.dirname, '..')

test('compact guidance settings match the shared settings dialog, autosave, preserve branch drafts and trap focus on desktop and mobile', { skip: !domBrowserExecutable(), timeout: 120_000 }, async () => {
  const source = `import React, {useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {AgentGuidanceButton} from '${root}/src/components/agent-guidance-settings.tsx';
import {DialogFrame} from '${root}/packages/ui/src/dialog-frame.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {applyThemePalette,THEME_PRESETS} from '${root}/src/utils/theme-color.ts';
window.fixtureTheme=dark=>applyThemePalette(THEME_PRESETS.find(theme=>theme.id===(dark?'dark':'light')).palette);
window.fixtureTheme(false);
function Fixture(){const [reference,setReference]=useState(false);return <I18nProvider><button onClick={()=>setReference(true)}>전체 설정 크기 기준</button>{reference&&<DialogFrame size="settings" labelledBy="reference-title" onClose={()=>setReference(false)} className="flex flex-col"><h2 id="reference-title">전체 설정 크기 기준</h2><button onClick={()=>setReference(false)}>기준 닫기</button></DialogFrame>}<AgentGuidanceButton onOpenFile={p=>{window.opened=p}}/></I18nProvider>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:guidance.tsx', write: false, platform: 'browser', onwarn(warning, warn) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning) }, output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'fixture', resolveId(id) { if (id === 'virtual:guidance.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:guidance.tsx') return source; if (id === 'virtual:style') return '' },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/agent-guidance-settings.tsx', 'src/components/agent-branch-guidance.tsx', 'src/components/agent-guidance-row.tsx', 'packages/ui/src/dialog-frame.tsx', 'packages/ui/src/select-field.tsx', 'packages/ui/src/HoverTipLayer.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce', hasTouch: width < 768, isMobile: width < 768 })
      page.setDefaultTimeout(4000)
      let fail = true, conflict = false, updates = 0
      let releaseSave: (() => void) | undefined, releaseLoad: (() => void) | undefined
      let heldLoad = false
      let state = { path: '/data/agent-guidance.md', content: '# Guidance', revision: 'first', settings: { commit: 'inherit', language: 'inherit', detail: 'custom', subagents: 'inherit', debugger: 'enabled' }, branch: { value: { ...defaultBranchGuidance }, custom: false } }
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-guidance.test/**', async route => {
        const url = new URL(route.request().url())
        if (url.pathname === '/api/fs/agent-guidance') {
          if (fail) return route.fulfill({ status: 403, json: { error: '다시 시도하세요.' } })
          if (route.request().method() === 'GET' && !heldLoad) {
            heldLoad = true
            await new Promise<void>(resolve => { releaseLoad = resolve })
          }
          if (route.request().method() === 'PUT') {
            if (updates === 0) await new Promise<void>(resolve => { releaseSave = resolve })
            if (conflict) return route.fulfill({ status: 409, json: { error: '지침 파일이 변경되었습니다. 다시 불러오세요.' } })
            const input = route.request().postDataJSON()
            assert.equal(input.revision, state.revision)
            updates++
            if (input.key === 'branch') {
              assert.deepEqual(Object.keys(input.value).sort(), Object.keys(defaultBranchGuidance).sort(), 'branch writes include the entire preference object')
              state = { ...state, revision: `updated-${updates}`, branch: { value: input.value, custom: false } }
            } else state = { ...state, revision: `updated-${updates}`, settings: { ...state.settings, [input.key]: input.value } }
          }
          await route.fulfill({ json: state })
          return
        }
        await route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-guidance.test/')
      await page.getByRole('button', { name: '전체 설정 크기 기준', exact: true }).click()
      const referenceBounds = (await page.getByRole('dialog', { name: '전체 설정 크기 기준', exact: true }).boundingBox())!
      assert.equal(referenceBounds.width, width >= 768 ? 740 : width)
      assert.ok(Math.abs(referenceBounds.height - (width >= 768 ? 844 * 0.7 : 844)) < 1)
      await page.getByRole('button', { name: '기준 닫기', exact: true }).click()
      const button = page.getByRole('button', { name: '에이전트 기본 지침', exact: true })
      await button.focus()
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog', { name: '에이전트 기본 지침' })
      await page.getByRole('alert').filter({ hasText: '다시 시도' }).waitFor()
      fail = false
      await page.getByRole('button', { name: '다시 불러오기' }).click()
      await page.getByRole('status').filter({ hasText: '불러오는 중' }).waitFor()
      await page.keyboard.press('Tab')
      assert.equal(await page.getByRole('button', { name: '닫기', exact: true }).evaluate(el => el === el.ownerDocument.activeElement), true)
      releaseLoad!()
      assert.equal(await page.locator('select').count(), 0, 'settings never open an OS select menu')
      const field = (name: string) => page.getByRole('combobox', { name, exact: true })
      await field('응답 언어').waitFor()
      const guidanceBounds = (await dialog.boundingBox())!
      for (const dimension of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(guidanceBounds[dimension] - referenceBounds[dimension]) < 1, `guidance ${dimension} matches the shared full-settings frame at ${width}px`)
      const assertInlineFields = async (names: string[], role: 'combobox' | 'textbox' = 'combobox') => {
        for (const name of names) {
          const label = (await dialog.locator('[data-guidance-label]').filter({ hasText: name }).boundingBox())!
          const control = (await page.getByRole(role, { name, exact: true }).boundingBox())!
          assert.ok(label.x + label.width <= control.x + 1, `${name} keeps its label beside the control at ${width}px`)
          assert.ok(Math.abs(label.y + label.height / 2 - control.y - control.height / 2) < 2, `${name} vertically aligns its label and control at ${width}px`)
          assert.ok(Math.abs(control.height - (width >= 768 ? 32 : 44)) < 1, `${name} uses a compact desktop or usable touch target`)
          assert.ok(control.x >= 0 && control.x + control.width <= width, `${name} stays inside a ${width}px viewport`)
        }
      }
      await assertInlineFields(['응답 언어', '답변 길이', '서브에이전트 위임', '디버거 활용', '브랜치 전략', 'Git 자동 처리', '커밋 방식'])
      const languageBounds = (await field('응답 언어').boundingBox())!, debuggerBounds = (await field('디버거 활용').boundingBox())!
      assert.ok(debuggerBounds.y - languageBounds.y <= (width >= 768 ? 120 : 168), 'ordinary settings use a compact, consistently spaced list')
      if (width >= 768) {
        const saveBounds = (await page.getByRole('button', { name: 'Git 설정 저장', exact: true }).boundingBox())!
        const footerBounds = (await dialog.locator('footer').boundingBox())!
        assert.ok(saveBounds.y + saveBounds.height <= footerBounds.y, 'the initial desktop view includes the Git save action above its fixed footer')
      }
      for (const dark of [false, true]) {
        await page.evaluate(`window.fixtureTheme(${dark})`)
        await page.screenshot({ path: `/tmp/mew-guidance-polish-${width}-${dark ? 'dark' : 'light'}.png` })
      }
      await page.evaluate('window.fixtureTheme(false)')
      const choose = async (name: string, option: string) => {
        if (width < 768) {
          await field(name).tap()
          await page.getByRole('option', { name: option, exact: true }).tap()
        } else {
          await field(name).click()
          await page.getByRole('option', { name: option, exact: true }).click()
        }
      }
      if (width === 320) {
        await field('서브에이전트 위임').tap()
        const bounds = (await page.getByRole('listbox', { name: '서브에이전트 위임' }).boundingBox())!
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 844)
        await page.keyboard.press('Escape')
        assert.equal(await dialog.count(), 1, 'a narrow-screen dropdown closes before the settings dialog')
        await page.locator('summary', { hasText: '브랜치 세부 설정' }).click()
        await assertInlineFields(['작업 폴더', '병합 방식'])
        await assertInlineFields(['기본 브랜치', '작업 브랜치 접두사'], 'textbox')
        await page.getByRole('checkbox', { name: '통합 후 로컬 브랜치 정리', exact: true }).scrollIntoViewIfNeeded()
        for (const dark of [false, true]) {
          await page.evaluate(`window.fixtureTheme(${dark})`)
          await page.screenshot({ path: `/tmp/mew-guidance-polish-${width}-details-${dark ? 'dark' : 'light'}.png` })
        }
        assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        await page.keyboard.press('Escape')
        assert.equal(await dialog.count(), 0)
        assert.equal(await button.evaluate(el => el === el.ownerDocument.activeElement), true)
        assert.deepEqual(errors, [])
        await page.close()
        continue
      }
      await field('응답 언어').focus()
      await page.keyboard.press('Enter')
      await page.getByRole('listbox', { name: '응답 언어' }).waitFor()
      assert.equal(await page.getByRole('listbox', { name: '응답 언어' }).evaluate(el => !!el.closest('[role="dialog"]')), true, 'selection menus stay within the shared dialog focus boundary')
      assert.equal(await page.getByRole('option').first().textContent(), 'mew 언어 설정에 따름')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await page.getByRole('status').filter({ hasText: '저장 중' }).waitFor()
      await page.keyboard.press('Tab')
      assert.equal(await page.getByRole('button', { name: '닫기', exact: true }).evaluate(el => el === el.ownerDocument.activeElement), true)
      releaseSave!()
      await page.getByRole('status').filter({ hasText: '저장했습니다.' }).waitFor()
      assert.equal(state.settings.language, 'ko')
      assert.equal(await page.getByLabel('응답 언어', { exact: true }).evaluate(el => el === el.ownerDocument.activeElement), true)
      assert.equal(await field('답변 길이').textContent(), '직접 편집한 지침')
      await choose('응답 언어', 'mew 언어 설정에 따름')
      await page.getByRole('status').filter({ hasText: '저장했습니다.' }).waitFor()
      assert.equal(state.settings.language, 'mew')
      await field('응답 언어').click()
      for (const dark of [false, true]) {
        await page.evaluate(`window.fixtureTheme(${dark})`)
        await page.screenshot({ path: `/tmp/mew-language-guidance-${width}-${dark ? 'dark' : 'light'}.png` })
      }
      await page.keyboard.press('Escape')
      await choose('응답 언어', '한국어')
      await page.getByRole('status').filter({ hasText: '저장했습니다.' }).waitFor()
      const gitGroup = page.getByRole('group', { name: 'Git', exact: true })
      for (const name of ['브랜치 전략', 'Git 자동 처리', '커밋 방식']) assert.equal(await gitGroup.getByRole('combobox', { name, exact: true }).count(), 1)
      assert.equal(await gitGroup.getByRole('combobox', { name: '응답 언어', exact: true }).count(), 0)
      assert.equal(await field('Git 자동 처리').textContent(), '로컬 병합까지 자동 (권장)')
      assert.equal(await field('커밋 방식').isDisabled(), true)
      await gitGroup.scrollIntoViewIfNeeded()
      for (const dark of [false, true]) {
        await page.evaluate(`window.fixtureTheme(${dark})`)
        await page.screenshot({ path: `/tmp/mew-git-group-${width}-${dark ? 'dark' : 'light'}.png` })
      }
      await choose('Git 자동 처리', '기존 커밋 설정 사용')
      await page.getByRole('button', { name: 'Git 설정 저장', exact: true }).click()
      await page.getByRole('status').filter({ hasText: '저장했습니다.' }).waitFor()
      await choose('커밋 방식', '매 변경 완료 후 커밋')
      await page.getByRole('status').filter({ hasText: '저장했습니다.' }).waitFor()
      assert.equal(await field('서브에이전트 위임').textContent(), '별도 지정 안 함')
      for (const [option, value] of [['필요할 때 자동 위임', 'automatic'], ['요청할 때만 위임', 'explicit'], ['사용 안 함', 'never'], ['별도 지정 안 함', 'inherit'], ['필요할 때 자동 위임', 'automatic']]) {
        await choose('서브에이전트 위임', option)
        await page.getByRole('status').filter({ hasText: '저장했습니다.' }).waitFor()
        assert.equal(state.settings.subagents, value)
        assert.equal(await field('서브에이전트 위임').textContent(), option)
        assert.equal(state.settings.language, 'ko')
        assert.equal(state.settings.detail, 'custom')
      }
      assert.equal(await field('디버거 활용').textContent(), '활성화')
      for (const [option, value] of [['비활성화', 'disabled'], ['활성화', 'enabled']]) {
        await choose('디버거 활용', option)
        await page.getByRole('status').filter({ hasText: '저장했습니다.' }).waitFor()
        assert.equal(state.settings.debugger, value)
        assert.equal(state.settings.language, 'ko')
        assert.equal(state.settings.detail, 'custom')
      }
      await field('디버거 활용').click()
      for (const dark of [false, true]) {
        await page.evaluate(`window.fixtureTheme(${dark})`)
        const bounds = (await page.getByRole('listbox', { name: '디버거 활용' }).boundingBox())!
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 844)
        await page.screenshot({ path: `/tmp/mew-debugger-guidance-${width}-${dark ? 'dark' : 'light'}.png` })
      }
      await page.keyboard.press('Escape')
      await field('서브에이전트 위임').click()
      for (const dark of [false, true]) {
        await page.evaluate(`window.fixtureTheme(${dark})`)
        const bounds = (await page.getByRole('listbox', { name: '서브에이전트 위임' }).boundingBox())!
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 844)
        await page.screenshot({ path: `/tmp/mew-subagent-guidance-${width}-${dark ? 'dark' : 'light'}.png` })
      }
      await page.keyboard.press('Escape')
      await page.evaluate('window.fixtureTheme(false)')
      const branchSave = page.getByRole('button', { name: 'Git 설정 저장', exact: true })
      const details = page.locator('details').filter({ has: page.locator('summary', { hasText: '브랜치 세부 설정' }) })
      const base = page.getByRole('textbox', { name: '기본 브랜치', exact: true })
      const development = page.getByRole('textbox', { name: '개발 브랜치', exact: true })
      const prefix = page.getByRole('textbox', { name: '작업 브랜치 접두사', exact: true })
      const cleanup = page.getByRole('checkbox', { name: '통합 후 로컬 브랜치 정리', exact: true })
      const saveBranch = async () => {
        const previous = updates
        await branchSave.click()
        await page.getByRole('status').filter({ hasText: '저장했습니다.' }).waitFor()
        assert.equal(updates, previous + 1)
        assert.equal(await branchSave.isDisabled(), true)
      }
      assert.equal(await field('브랜치 전략').textContent(), 'GitHub Flow (권장)')
      assert.equal(await details.evaluate(el => el.hasAttribute('open')), false, 'advanced branch fields start collapsed')
      assert.equal(await branchSave.isDisabled(), true)
      const beforeBranchEdits = updates
      await choose('브랜치 전략', 'Git Flow')
      await details.locator('summary').click()
      assert.equal(await base.getAttribute('placeholder'), '자동 감지')
      assert.equal(await development.inputValue(), 'develop')
      await assertInlineFields(['작업 폴더', '병합 방식'])
      await assertInlineFields(['기본 브랜치', '개발 브랜치', '작업 브랜치 접두사'], 'textbox')
      await cleanup.scrollIntoViewIfNeeded()
      for (const dark of [false, true]) {
        await page.evaluate(`window.fixtureTheme(${dark})`)
        await page.screenshot({ path: `/tmp/mew-guidance-polish-${width}-details-${dark ? 'dark' : 'light'}.png` })
      }
      await page.evaluate('window.fixtureTheme(false)')
      await base.fill('release/2026.10')
      await development.fill('integration/next')
      await prefix.fill('task/')
      await choose('작업 폴더', '항상 worktree')
      await choose('병합 방식', 'Merge commit')
      await cleanup.check()
      assert.equal(updates, beforeBranchEdits, 'branch fields keep a draft until explicit save')
      const gitFlow: BranchGuidanceSettings = { strategy: 'git-flow', baseBranch: 'release/2026.10', developmentBranch: 'integration/next', branchPrefix: 'task/', worktree: 'always', mergeMethod: 'merge', cleanup: true, workflow: 'manual' }
      await saveBranch()
      assert.deepEqual(state.branch.value, gitFlow)
      assert.equal(state.settings.language, 'ko')
      assert.equal(state.settings.detail, 'custom')
      await base.fill('release/2026.11')
      await choose('응답 언어', 'English')
      await page.getByRole('status').filter({ hasText: '저장했습니다.' }).waitFor()
      assert.equal(await base.inputValue(), 'release/2026.11', 'saving an unrelated setting preserves the branch draft')
      assert.equal(state.branch.value.baseBranch, 'release/2026.10')
      await choose('응답 언어', '한국어')
      await page.getByRole('status').filter({ hasText: '저장했습니다.' }).waitFor()
      await saveBranch()
      assert.equal(state.branch.value.baseBranch, 'release/2026.11')
      await base.fill('bad..branch')
      const beforeInvalid = updates
      await branchSave.click()
      await page.getByRole('alert').filter({ hasText: '브랜치 이름이나 접두사를 확인' }).waitFor()
      assert.equal(updates, beforeInvalid, 'invalid Git refs never reach the API')
      await base.fill('main')
      await choose('작업 폴더', '현재 폴더')
      await choose('병합 방식', 'Rebase')
      await cleanup.uncheck()
      await saveBranch()
      assert.equal(state.branch.value.worktree, 'never')
      assert.equal(state.branch.value.mergeMethod, 'rebase')
      assert.equal(state.branch.value.cleanup, false)
      await choose('브랜치 전략', 'Trunk 기반')
      assert.equal(await development.count(), 0, 'only Git Flow exposes its development branch')
      await choose('작업 폴더', '필요할 때 worktree')
      await choose('병합 방식', 'Squash')
      await saveBranch()
      assert.equal(state.branch.value.strategy, 'trunk')
      assert.equal(state.branch.value.worktree, 'auto')
      assert.equal(state.branch.value.mergeMethod, 'squash')
      const lastValidBranch = { ...state.branch.value }
      await base.fill('invalid..hidden-ref')
      await choose('브랜치 전략', '프로젝트 지침에 따름')
      assert.equal(await details.count(), 0)
      await saveBranch()
      assert.deepEqual(state.branch.value, { ...lastValidBranch, strategy: 'inherit' }, 'switching to project instructions restores valid saved fields before hiding them')
      await choose('브랜치 전략', 'GitHub Flow (권장)')
      await saveBranch()
      assert.equal(state.branch.value.strategy, 'github-flow')
      await details.locator('summary').click()
      await field('작업 폴더').click()
      for (const dark of [false, true]) {
        await page.evaluate(`window.fixtureTheme(${dark})`)
        const bounds = (await page.getByRole('listbox', { name: '작업 폴더' }).boundingBox())!
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 844)
        await page.screenshot({ path: `/tmp/mew-branch-guidance-${width}-${dark ? 'dark' : 'light'}.png` })
      }
      await page.keyboard.press('Escape')
      await page.evaluate('window.fixtureTheme(false)')
      conflict = true
      await base.fill('release/conflict')
      await branchSave.click()
      await page.getByRole('alert').filter({ hasText: '파일이 변경' }).waitFor()
      assert.equal(state.branch.value.baseBranch, 'main')
      assert.equal(await base.inputValue(), 'release/conflict', 'a conflicting write preserves its unsaved branch draft')
      assert.equal(await branchSave.isDisabled(), true)
      conflict = false
      await page.getByRole('button', { name: '다시 불러오기' }).click()
      await page.waitForFunction("!document.querySelector('[role=combobox]')?.disabled")
      await details.locator('summary').click()
      assert.equal(await base.inputValue(), 'main', 'reload replaces the conflicting draft with the server state')
      state = { ...state, revision: 'custom-branch', branch: { ...state.branch, custom: true } }
      await page.getByRole('button', { name: '다시 불러오기' }).click()
      await field('브랜치 전략').filter({ hasText: '직접 편집한 지침' }).waitFor()
      assert.equal(await details.count(), 0)
      assert.equal(await branchSave.isDisabled(), true)
      await field('브랜치 전략').click()
      assert.equal(await page.getByRole('option', { name: '직접 편집한 지침', exact: true }).getAttribute('aria-disabled'), 'true')
      await page.getByRole('option', { name: 'Git Flow', exact: true }).click()
      assert.equal(state.branch.custom, true, 'choosing a replacement does not overwrite custom text before save')
      await details.locator('summary').click()
      assert.equal(await development.inputValue(), 'develop', 'replacing custom instructions starts from safe defaults')
      await saveBranch()
      assert.deepEqual(state.branch, { value: { ...defaultBranchGuidance, strategy: 'git-flow' }, custom: false })
      assert.equal(await field('Git 자동 처리').textContent(), '로컬 병합까지 자동 (권장)')
      await choose('Git 자동 처리', '기존 커밋 설정 사용')
      await saveBranch()
      await choose('Git 자동 처리', '로컬 병합까지 자동 (권장)')
      assert.equal(state.branch.value.workflow, 'manual', 'choosing automation keeps a draft until Save')
      await cleanup.check()
      await saveBranch()
      assert.equal(state.branch.value.workflow, 'local')
      assert.equal(state.branch.value.cleanup, true)
      assert.equal(await field('커밋 방식').isDisabled(), true, 'automation owns task commits while preserving the stored setting')
      await field('Git 자동 처리').click()
      for (const dark of [false, true]) {
        await page.evaluate(`window.fixtureTheme(${dark})`)
        await page.screenshot({ path: `/tmp/mew-git-automation-${width}-${dark ? 'dark' : 'light'}.png` })
      }
      await page.keyboard.press('Escape')
      await choose('Git 자동 처리', '원격 반영까지 자동')
      await saveBranch()
      assert.equal(state.branch.value.workflow, 'remote')
      assert.equal(state.branch.value.cleanup, true)
      assert.equal(await field('커밋 방식').isDisabled(), true)
      await page.getByRole('button', { name: '다시 불러오기' }).click()
      await field('Git 자동 처리').filter({ hasText: '원격 반영까지 자동' }).waitFor()
      await choose('Git 자동 처리', '기존 커밋 설정 사용')
      await saveBranch()
      assert.equal(state.branch.value.workflow, 'manual')
      assert.equal(await field('커밋 방식').isDisabled(), false)
      await details.locator('summary').click()
      await cleanup.uncheck()
      await saveBranch()
      await details.locator('summary').click()
      conflict = true
      await choose('응답 언어', 'English')
      await page.getByRole('alert').filter({ hasText: '파일이 변경' }).waitFor()
      assert.equal(await field('응답 언어').textContent(), '한국어')
      assert.equal(await page.getByLabel('응답 언어', { exact: true }).isDisabled(), true)
      conflict = false
      await page.getByRole('button', { name: '다시 불러오기' }).click()
      await page.waitForFunction("!document.querySelector('[role=combobox]')?.disabled")
      const close = page.getByRole('button', { name: '닫기', exact: true })
      await close.focus()
      await page.keyboard.press('Shift+Tab')
      assert.equal(await page.getByRole('button', { name: '다시 불러오기' }).evaluate(el => el === el.ownerDocument.activeElement), true)
      await page.keyboard.press('Tab')
      assert.equal(await close.evaluate(el => el === el.ownerDocument.activeElement), true)
      await field('답변 길이').click()
      assert.equal(await page.getByRole('option', { name: '직접 편집한 지침' }).getAttribute('aria-disabled'), 'true')
      const menu = page.getByRole('listbox')
      const box = (await menu.boundingBox())!
      assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 844)
      await page.screenshot({ path: `/tmp/mew-agent-guidance-${width}.png` })
      await page.keyboard.press('Escape')
      assert.equal(await menu.count(), 0)
      assert.equal(await dialog.count(), 1, 'Esc closes the list before its settings dialog')
      assert.equal(await field('답변 길이').evaluate(el => el === el.ownerDocument.activeElement), true)
      await field('응답 언어').click()
      await page.getByText('모든 프로젝트에 공통으로 적용됩니다.', { exact: false }).click()
      assert.equal(await menu.count(), 0, 'outside click dismisses the list')
      await page.getByRole('button', { name: '파일 보기' }).click()
      await page.waitForFunction('window.opened === "/data/agent-guidance.md"')
      assert.equal(await dialog.count(), 0)
      await button.click()
      await page.getByLabel('응답 언어', { exact: true }).waitFor()
      assert.equal(await field('응답 언어').textContent(), '한국어')
      assert.equal(await field('서브에이전트 위임').textContent(), '필요할 때 자동 위임')
      assert.equal(await field('디버거 활용').textContent(), '활성화')
      await page.keyboard.press('Escape')
      assert.equal(await dialog.count(), 0)
      assert.equal(await button.evaluate(el => el === el.ownerDocument.activeElement), true)
      assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
