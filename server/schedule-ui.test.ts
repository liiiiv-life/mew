import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('schedule dropdowns edit drafts, preserve cron values and save on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {ScheduleModal} from '${root}/src/components/ScheduleModal.tsx';
createRoot(document.getElementById('root')).render(<ScheduleModal onClose={()=>{window.closedSettings=true}}/>);`
  const bundle = await build({ input: 'virtual:schedule.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'fixture', resolveId(id) { if (id === 'virtual:schedule.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' },
    async load(id) { if (id === 'virtual:schedule.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk'); assert.ok(chunk)
  const content = (await Promise.all(['src/components/ScheduleModal.tsx', 'packages/ui/src/select-field.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set(content.match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width < 640 })
      page.setDefaultTimeout(4000)
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
      let saved: { cron: string; project: string; agent: string; agentSetId: string; prompt: string }[] = []
      let releaseSave: (() => void) | undefined
      const job = { id: 'job-1', name: 'Nightly review', cron: '15 2 * * *', project: '', agent: 'claude', prompt: 'Review changes', enabled: true, command: '', lastRun: null, session: '', running: false }
      const agentSets = [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: '문서 검토', runtime: 'codex', modelId: 'test-model', role: 'Review carefully' }]
      const runtimes = [{ id: 'claude', label: 'Claude' }, { id: 'codex', label: 'Codex' }]
      await page.route('http://mew-schedule.test/**', async route => {
        const url = new URL(route.request().url())
        if (url.pathname === '/api/projects') return route.fulfill({ json: [{ name: 'project-with-a-long-name-for-overflow-checks' }] })
        if (url.pathname === '/api/schedules') {
          if (route.request().method() === 'PUT') {
            saved = route.request().postDataJSON().jobs
            await new Promise<void>(resolve => { releaseSave = resolve })
          }
          return route.fulfill({ json: { jobs: saved.length ? saved.map(value => ({ ...job, ...value, agentSet: agentSets.find(set => set.id === value.agentSetId) })) : [job], runtimes, agentSets, otherLines: ['# unmanaged cron remains unchanged'] } })
        }
        return route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html class="${width === 1100 ? 'dark' : ''}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-schedule.test/')
      await page.getByRole('button', { name: /Nightly review/ }).click()
      assert.equal(await page.locator('select, datalist').count(), 0)
      const kind = page.getByRole('combobox', { name: '실행 주기', exact: true })
      await kind.press('ArrowDown'); await kind.press('ArrowDown')
      assert.equal(await kind.innerText(), '매일', 'navigation leaves the draft unchanged')
      await kind.press('Enter')
      assert.equal(await kind.innerText(), '요일마다')
      assert.equal(await page.locator('input[type=time]').inputValue(), '02:15', 'changing frequency keeps the scheduled time')
      await kind.click(); await kind.press('Escape')
      assert.equal(await page.evaluate('window.closedSettings'), undefined)
      const agent = page.getByRole('combobox', { name: '에이전트셋', exact: true })
      await agent.click(); await page.getByRole('option', { name: '문서 검토', exact: true }).click()
      for (const control of [page.getByRole('textbox', { name: '작업 이름', exact: true }), agent, kind, page.locator('input[type=time]')]) {
        const box = await control.boundingBox(); assert.equal(box?.height, 44)
      }
      const project = page.getByRole('combobox', { name: '프로젝트', exact: true })
      await project.click()
      const bounds = await page.getByRole('listbox').boundingBox()
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 844)
      await page.screenshot({ path: `/tmp/mew-schedule-dropdown-${width}.png` })
      const option = page.getByRole('option', { name: 'project-with-a-long-name-for-overflow-checks', exact: true })
      if (width < 640) await option.tap(); else await option.click()
      assert.equal(saved.length, 0, 'choosing options does not submit the schedule')
      await project.click(); await page.evaluate('history.back()'); await page.getByRole('listbox').waitFor({ state: 'hidden' })
      assert.equal(await page.evaluate('window.closedSettings'), undefined)
      await page.getByRole('button', { name: '저장', exact: true }).click()
      await page.waitForFunction('document.querySelectorAll("[role=combobox]:disabled").length===3')
      assert.equal(saved[0].cron, '15 2 * * 1')
      assert.equal(saved[0].agent, 'codex')
      assert.equal(saved[0].agentSetId, agentSets[0].id)
      assert.ok(await page.locator('input[type=time]').isDisabled())
      assert.ok(await page.getByRole('textbox', { name: '작업 내용', exact: true }).isDisabled())
      assert.equal(saved[0].project, 'project-with-a-long-name-for-overflow-checks')
      assert.equal(saved[0].prompt, 'Review changes')
      assert.ok(releaseSave); releaseSave()
      await page.waitForFunction('!document.querySelector("[role=combobox]:disabled")')
      assert.equal(await kind.innerText(), '요일마다')
      await page.screenshot({ path: `/tmp/mew-schedule-form-${width}.png` })
      for (const [label, cron] of [['매시', '0 * * * *'], ['N분마다', '*/30 * * * *'], ['직접 입력', '*/30 * * * *']]) {
        await kind.click(); await page.getByRole('option', { name: label, exact: true }).click()
        if (label === '직접 입력') assert.equal(await page.getByRole('textbox', { name: '분 시 일 월 요일' }).inputValue(), cron)
        else assert.equal((await page.locator('input[type=number]').boundingBox())?.height, 44)
      }
      await page.getByRole('button', { name: '+ 예약 작업 추가', exact: true }).click()
      assert.equal(await page.getByRole('combobox', { name: '에이전트셋', exact: true }).innerText(), '에이전트셋 선택')
      assert.ok(await page.getByRole('button', { name: '저장', exact: true }).isDisabled())
      assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth'), false)
      await page.route('http://mew-schedule.test/api/schedules', route => route.fulfill({ json: {
        jobs: [{ ...job, agent: 'codex', agentSet: agentSets[0] }], agentSets: [], runtimes, otherLines: [],
      } }))
      await page.reload()
      await page.getByRole('button', { name: /Nightly review/ }).click()
      assert.equal(await page.getByRole('combobox', { name: '에이전트셋', exact: true }).innerText(), '문서 검토', 'deleted set keeps the saved snapshot visible')
      assert.ok(await page.getByRole('button', { name: '저장', exact: true }).isEnabled())
      await page.getByRole('button', { name: '+ 예약 작업 추가', exact: true }).click()
      assert.ok(await page.getByText('에이전트 패널에서 에이전트셋을 먼저 만들어 주세요.', { exact: true }).isVisible())
      assert.ok(await page.getByRole('button', { name: '저장', exact: true }).isDisabled())
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
