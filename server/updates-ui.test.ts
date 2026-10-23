import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import type { UpdatesStatus } from '../shared/updates.ts'
const root = path.resolve(import.meta.dirname, '..')
test('updates dialog displays versions, individual/batch progress, persistent terminals, failure recovery and mobile layout', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {UpdatesModal} from '${root}/src/components/updates-modal.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {setUiLocale} from '@mew/ui/i18n-core';
setUiLocale('ko'); window.mewUpdates=0;
function Fixture(){const [open,setOpen]=React.useState(true);const [mew,setMew]=React.useState(window.initialMew);const [canViewSessions,setCanViewSessions]=React.useState(true);window.setMew=setMew;window.setCanViewSessions=setCanViewSessions;return <><button onClick={()=>setOpen(true)}>다시 열기</button><UpdatesModal open={open} mew={mew} mewUpdating={false} canViewSessions={canViewSessions} onMewUpdate={async()=>{window.mewUpdates++}} onRefreshMew={async()=>{}} onClose={()=>setOpen(false)} /></>};createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:updates.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:updates.tsx') return id; if (id === '@mew/tmux-term') return 'virtual:terminal.tsx'; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:updates.tsx') return source; if (id === 'virtual:terminal.tsx') return 'export const isHiddenTmuxSession=()=>false;export function TmuxTerminal({sessionName}){return <textarea aria-label="업데이트 터미널" data-session={sessionName} defaultValue="fixture update output"/>}'; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/updates-modal.tsx', 'src/components/SessionTerminalPopup.tsx', 'packages/ui/src/HoverTipLayer.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((content + 'fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-3 sm:p-6 w-full overflow-hidden rounded-xl bg-surface shadow-2xl outline-none').match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, locale: 'ko-KR' })
      const mew = { localHash: 'abc123', remoteHash: 'def456', available: true, canUpdate: true, running: false, session: null, job: null }
      let initialMew: Record<string, unknown> = mew
      let status: UpdatesStatus = { checkedAt: Date.now(), job: { running: false, items: [] }, items: [
        { id: 'agent:a', label: 'Codex CLI', category: 'agent', current: '1.0.0', latest: '1.1.0', available: true, canUpdate: true, error: null, session: null },
        { id: 'npm:root:react', label: 'react', category: 'dependency', current: '19.0.0', latest: '19.2.0', available: true, canUpdate: false, error: 'Mew 업데이트로 적용합니다', session: null },
        { id: 'system:uv', label: 'uv', category: 'system', current: '0.8.0', latest: '0.9.0', available: true, canUpdate: true, error: null, session: null },
        { id: 'system:node', label: 'Node.js', category: 'system', current: '22.0.0', latest: '24.0.0', available: true, canUpdate: false, error: '수동 업데이트 필요', session: null },
      ] }
      const requests: string[][] = []
      const errors: string[] = []
      let documentLoads = 0
      let sessionDeletes = 0
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew.test/**', async route => {
        if (route.request().url().includes('/api/updates/run')) {
          const ids = route.request().postDataJSON().ids; requests.push(ids)
          const session = ids[0] === 'agent:a' ? 'mewcmd-update-agent-a' : 'mewcmd-updates-system'
          status = { ...status, items: status.items.map(item => ids.includes(item.id) ? { ...item, session } : item), job: { running: true, items: ids.map((id: string) => ({ id, state: 'running', error: null, session })) } }
          return route.fulfill({ json: status })
        }
        if (route.request().url().includes('/api/updates/status')) return route.fulfill({ json: status })
        if (route.request().method() === 'DELETE') { sessionDeletes++; return route.fulfill({ json: { ok: true } }) }
        documentLoads++
        return route.fulfill({ contentType: 'text/html', body: `<html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"></div><script>window.initialMew=${JSON.stringify(initialMew)};${chunk.code}</script></body></html>` })
      })
      await page.goto('http://mew.test/')
      await page.getByText('Codex CLI', { exact: true }).waitFor()
      assert.equal(await page.getByRole('columnheader', { name: '현재 버전' }).count(), 1)
      assert.equal(await page.getByRole('columnheader', { name: '최신 버전' }).count(), 1)
      assert.equal(await page.getByRole('row').filter({ hasText: 'Node.js' }).getByRole('button', { name: '업데이트', exact: true }).isDisabled(), true)
      assert.equal(await page.getByRole('row').filter({ hasText: 'react' }).getByRole('button', { name: '업데이트', exact: true }).isDisabled(), true)
      assert.equal(await page.getByRole('button', { name: 'Codex CLI 터미널 세션', exact: true }).isDisabled(), true)
      assert.equal(await page.getByRole('button', { name: 'Mew 터미널 세션', exact: true }).isDisabled(), true)
      await page.evaluate(() => (globalThis as any).setCanViewSessions(false))
      await page.getByRole('button', { name: 'Mew 터미널 세션', exact: true }).waitFor({ state: 'hidden' })
      assert.equal(await page.getByRole('button', { name: /터미널 세션/ }).count(), 0)
      assert.equal(await page.getByRole('row').filter({ hasText: 'Codex CLI' }).getByRole('button', { name: '업데이트', exact: true }).isEnabled(), true)
      assert.equal(await page.getByRole('row').filter({ hasText: /^Mew/ }).getByRole('button', { name: '업데이트', exact: true }).isEnabled(), true)
      await page.evaluate(() => (globalThis as any).setCanViewSessions(true))
      await page.getByRole('button', { name: 'Mew 터미널 세션', exact: true }).waitFor()
      const bounds = await page.getByRole('dialog').boundingBox(); assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width)
      assert.equal(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true)
      await page.screenshot({ path: `/tmp/mew-updates-${width}.png` })
      await page.getByRole('row').filter({ hasText: 'Codex CLI' }).getByRole('button', { name: '업데이트', exact: true }).click()
      assert.deepEqual(requests[0], ['agent:a'])
      assert.equal(await page.getByRole('row').filter({ hasText: 'Codex CLI' }).getByRole('button', { name: '업데이트', exact: true }).isDisabled(), true)
      await page.getByRole('button', { name: 'Codex CLI 터미널 세션', exact: true }).click()
      assert.equal(await page.getByRole('dialog').count(), 1)
      assert.equal(await page.getByRole('textbox', { name: '업데이트 터미널' }).getAttribute('data-session'), 'mewcmd-update-agent-a')
      assert.equal(await page.getByRole('textbox', { name: '업데이트 터미널' }).inputValue(), 'fixture update output')
      assert.equal(await page.getByRole('button', { name: '종료', exact: true }).count(), 0)
      const terminalBounds = await page.getByRole('dialog').boundingBox()
      assert(terminalBounds && terminalBounds.x >= 0 && terminalBounds.x + terminalBounds.width <= width)
      await page.getByRole('button', { name: '닫기', exact: true }).press('Shift+Tab')
      assert.equal(await page.getByRole('textbox', { name: '업데이트 터미널' }).evaluate(el => el.ownerDocument.activeElement === el), true)
      await page.screenshot({ path: `/tmp/mew-update-terminal-${width}.png` })
      await page.getByRole('button', { name: '닫기', exact: true }).click()
      await page.getByRole('button', { name: 'Codex CLI 터미널 세션', exact: true }).waitFor()
      await page.getByRole('button', { name: '닫기', exact: true }).click()
      assert.equal(await page.getByRole('dialog').count(), 0)
      status.job = { running: false, items: [{ id: 'agent:a', state: 'failed', error: '설치 권한 없음', session: 'mewcmd-update-agent-a' }] }
      await page.getByRole('button', { name: '다시 열기', exact: true }).click()
      await page.getByText('설치 권한 없음', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Codex CLI 터미널 세션', exact: true }).click()
      assert.equal(await page.getByRole('textbox', { name: '업데이트 터미널' }).getAttribute('data-session'), 'mewcmd-update-agent-a')
      await page.getByRole('button', { name: '닫기', exact: true }).click()
      await page.getByRole('button', { name: '일괄 업데이트', exact: true }).click()
      assert.deepEqual(requests[1], ['system:uv'])
      status.job = { running: false, items: requests[1].map(id => ({ id, state: 'failed', error: '재시도 필요', session: 'mewcmd-updates-system' })) }
      await page.getByText('일부 업데이트가 실패해 Mew 업데이트를 보류했습니다. 실패 항목을 다시 시도하세요.', { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => (globalThis as any).mewUpdates), 0)
      await page.getByRole('button', { name: '일괄 업데이트', exact: true }).click()
      status.job = { running: false, items: requests[2].map(id => ({ id, state: 'succeeded', error: null, session: 'mewcmd-updates-system' })) }
      await page.waitForFunction(() => (globalThis as any).mewUpdates === 1)
      await page.getByRole('button', { name: 'uv 터미널 세션', exact: true }).click()
      assert.equal(await page.getByRole('textbox', { name: '업데이트 터미널' }).getAttribute('data-session'), 'mewcmd-updates-system')
      await page.getByRole('button', { name: '닫기', exact: true }).click()
      await page.evaluate(() => (globalThis as any).setMew({ localHash: 'def456', remoteHash: 'def456', available: false, canUpdate: true, session: 'mewcmd-mew-update', job: { state: 'failed', startedAt: 1, finishedAt: 2, message: 'build failed: ' + 'long-error/'.repeat(100) } }))
      await page.getByRole('alert').filter({ hasText: '업데이트에 실패했습니다.' }).waitFor()
      await page.getByText('실행 로그', { exact: true }).click()
      assert.equal(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true)
      await page.screenshot({ path: `/tmp/mew-update-failure-${width}.png` })
      const retry = page.getByRole('button', { name: '다시 시도', exact: true })
      assert.equal(await retry.isEnabled(), true)
      await retry.click()
      await page.waitForFunction(() => (globalThis as any).mewUpdates === 2)
      await page.evaluate(() => (globalThis as any).setMew({ localHash: 'def456', remoteHash: 'def456', available: false, canUpdate: true, running: true, session: 'mewcmd-mew-update', job: { state: 'running', startedAt: 3, finishedAt: null, message: null } }))
      await page.getByRole('button', { name: 'Mew 터미널 세션', exact: true }).click()
      assert.equal(await page.getByRole('textbox', { name: '업데이트 터미널' }).getAttribute('data-session'), 'mewcmd-mew-update')
      assert.equal(await page.getByRole('dialog').count(), 1)
      assert.equal(await page.getByRole('button', { name: '종료', exact: true }).count(), 0)
      initialMew = { ...mew, localHash: 'def456', available: false, session: 'mewcmd-mew-update', job: { state: 'succeeded', startedAt: 3, finishedAt: 4, message: null } }
      await page.evaluate(value => (globalThis as any).setMew(value), initialMew)
      await page.getByRole('button', { name: '새로고침', exact: true }).waitFor()
      await page.getByRole('button', { name: '닫기', exact: true }).click()
      assert.equal(await page.getByRole('button', { name: '새로고침', exact: true }).count(), 1)
      await page.getByRole('button', { name: 'Mew 터미널 세션', exact: true }).click()
      const beforeReload = documentLoads
      await page.getByRole('button', { name: '새로고침', exact: true }).click()
      await page.waitForLoadState('load')
      await page.getByRole('button', { name: 'Mew 터미널 세션', exact: true }).waitFor()
      assert.equal(documentLoads, beforeReload + 1)
      await page.getByRole('button', { name: 'Mew 터미널 세션', exact: true }).click()
      assert.equal(await page.getByRole('textbox', { name: '업데이트 터미널' }).getAttribute('data-session'), 'mewcmd-mew-update')
      assert.equal(sessionDeletes, 0, 'closing or refreshing never kills the update session')
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
