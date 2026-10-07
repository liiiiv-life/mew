import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('guidance settings autosave, recover from conflicts, open the editor and trap focus on desktop and mobile', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const source = `import React, {useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {AgentGuidanceButton} from '${root}/src/components/agent-guidance-settings.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
function Fixture(){return <I18nProvider><AgentGuidanceButton onOpenFile={p=>{window.opened=p}}/></I18nProvider>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:guidance.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'fixture', resolveId(id) { if (id === 'virtual:guidance.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:guidance.tsx') return source; if (id === 'virtual:style') return '' },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/agent-guidance-settings.tsx', 'packages/ui/src/select-field.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, locale: 'ko-KR', hasTouch: width < 768, isMobile: width < 768 })
      page.setDefaultTimeout(4000)
      let fail = true, conflict = false, updates = 0
      let releaseSave: (() => void) | undefined, releaseLoad: (() => void) | undefined
      let heldLoad = false
      let state = { path: '/data/agent-guidance.md', content: '# Guidance', revision: 'first', settings: { commit: 'inherit', language: 'inherit', detail: 'custom', subagents: 'inherit', debugger: 'enabled' } }
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
            state = { ...state, revision: `updated-${updates}`, settings: { ...state.settings, [input.key]: input.value } }
          }
          await route.fulfill({ json: state })
          return
        }
        await route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-guidance.test/')
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
      const choose = async (name: string, option: string) => {
        if (width < 768) {
          await field(name).tap()
          await page.getByRole('option', { name: option, exact: true }).tap()
        } else {
          await field(name).click()
          await page.getByRole('option', { name: option, exact: true }).click()
        }
      }
      await field('응답 언어').focus()
      await page.keyboard.press('ArrowDown')
      await page.getByRole('listbox', { name: '응답 언어' }).waitFor()
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
        await page.locator('html').evaluate((el, dark) => el.classList.toggle('dark', dark), dark)
        const bounds = (await page.getByRole('listbox', { name: '디버거 활용' }).boundingBox())!
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 844)
        await page.screenshot({ path: `/tmp/mew-debugger-guidance-${width}-${dark ? 'dark' : 'light'}.png` })
      }
      await page.keyboard.press('Escape')
      await field('서브에이전트 위임').click()
      for (const dark of [false, true]) {
        await page.locator('html').evaluate((el, dark) => el.classList.toggle('dark', dark), dark)
        const bounds = (await page.getByRole('listbox', { name: '서브에이전트 위임' }).boundingBox())!
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 844)
        await page.screenshot({ path: `/tmp/mew-subagent-guidance-${width}-${dark ? 'dark' : 'light'}.png` })
      }
      await page.keyboard.press('Escape')
      await page.locator('html').evaluate(el => el.classList.remove('dark'))
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
