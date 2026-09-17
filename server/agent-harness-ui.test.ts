import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import type { HarnessInventory, HarnessMutation } from '../shared/agent-harness.ts'

const root = path.resolve(import.meta.dirname, '..')
test('harness popup supports scope filtering, protected drafts, editing, moves and deletion on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 45000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {AgentHarnessButtons} from '${root}/src/components/agent-harness-modal.tsx';
createRoot(document.getElementById('root')).render(<div className="flex"><button aria-label="세션 정보">i</button><AgentHarnessButtons cwd="/project"/></div>);`
  const bundle = await build({ input: 'virtual:harness.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'harness-fixture', resolveId(id) { if (id === 'virtual:harness.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:harness.tsx') return source; if (id === 'virtual:style') return '' },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = await fs.readFile(path.join(root, 'src/components/agent-harness-modal.tsx'), 'utf8')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1200, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, locale: 'ko-KR' })
      page.setDefaultTimeout(5000)
      const errors: string[] = [], mutations: HarnessMutation[] = []
      page.on('pageerror', error => errors.push(error.message))
      const inventory: HarnessInventory = {
        scopes: [{ id: 'global', label: '전역', path: '/home/test', global: true }, { id: '/project', label: 'project', path: '/project', global: false }, { id: '/project/apps/web', label: 'apps/web', path: '/project/apps/web', global: false }],
        agents: [{ id: 'shared', label: '공통' }, { id: 'codex', label: 'Codex' }, { id: 'claude', label: 'Claude' }],
        locations: [
          { id: 'global', kind: 'skills', agent: 'shared', scope: 'global', label: '공통', path: '/home/test/.agents/skills', writable: true },
          { id: 'global-codex', kind: 'skills', agent: 'codex', scope: 'global', label: 'Codex', path: '/home/test/.codex/skills', writable: true },
          { id: 'local', kind: 'skills', agent: 'codex', scope: '/project', label: 'Codex', path: '/project/.codex/skills', writable: true },
          { id: 'child', kind: 'skills', agent: 'claude', scope: '/project/apps/web', label: 'Claude', path: '/project/apps/web/.claude/skills', writable: true },
        ],
        items: [
          { id: 'shared', location: 'global', name: 'writing', description: '공통 문서 작성 지침', path: '/home/test/.agents/skills/writing/SKILL.md', writable: true },
          { id: 'deploy', location: 'local', name: 'deploy', description: '프로젝트 배포 전 확인할 사항', path: '/project/.codex/skills/deploy/SKILL.md', writable: true },
          { id: 'child', location: 'child', name: 'frontend', description: '웹 프로젝트 UI 개발 지침', path: '/project/apps/web/.claude/skills/frontend/SKILL.md', writable: true },
          { id: 'system', location: 'global-codex', name: 'system-skill', description: '기본 제공 스킬', path: '/home/test/.codex/skills/.system/system-skill/SKILL.md', writable: false, reason: '시스템 스킬' },
        ], warnings: [],
      }
      let detailText = '---\nname: deploy\ndescription: 배포 지침\n---\n\n# 배포\n\n테스트를 통과한 변경사항을 반영합니다.\n'
      let failSave = false
      await page.route('http://mew-harness.test/**', async route => {
        const url = new URL(route.request().url())
        if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (url.pathname === '/api/agent/harness/detail') return route.fulfill({ json: { item: inventory.items.find(item => item.id === url.searchParams.get('id')), content: url.searchParams.get('kind') === 'mcp' ? '{"command":"node","args":["server.js"]}' : detailText, revision: 'revision', files: url.searchParams.get('kind') === 'mcp' ? [] : ['SKILL.md', 'scripts/check.sh'] } })
        if (url.pathname === '/api/agent/harness') {
          if (route.request().method() === 'POST') {
            const input = route.request().postDataJSON() as HarnessMutation
            mutations.push(input)
            if (failSave) return route.fulfill({ status: 409, json: { error: '다른 곳에서 변경되었습니다. 새로고침 후 다시 시도하세요' } })
            if (input.action === 'save') detailText = input.content!
            if (input.action === 'move') inventory.items = inventory.items.map(item => item.id === input.id ? { ...item, location: input.target! } : item)
            if (input.action === 'delete') inventory.items = inventory.items.filter(item => item.id !== input.id)
            return route.fulfill({ json: { ok: true } })
          }
          return route.fulfill({ json: inventory })
        }
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="${width === 390 ? '' : 'dark'}" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body{margin:0}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-harness.test/')
      const opener = page.getByRole('button', { name: 'Skills 관리', exact: true })
      await opener.click()
      await page.getByRole('button', { name: 'deploy Codex', exact: true }).waitFor()
      assert.ok(await page.evaluate('document.activeElement?.getAttribute("aria-label") === "확장 검색"'))
      const deployRow = page.getByRole('button', { name: 'deploy Codex', exact: true })
      assert.equal(await deployRow.innerText(), 'deploy\nCodex')
      assert.ok((await deployRow.boundingBox())!.height <= 32)
      assert.doesNotMatch(await page.getByLabel('확장 목록').innerText(), /프로젝트 배포 전 확인할 사항/)
      await page.getByRole('button', { name: '전역 접기', exact: true }).click()
      const expandGlobal = page.getByRole('button', { name: '전역 펼치기', exact: true })
      assert.equal(await expandGlobal.getAttribute('aria-expanded'), 'false')
      assert.equal(await page.getByRole('button', { name: 'writing Global', exact: true }).isVisible(), false)
      assert.equal(await deployRow.isVisible(), true)
      await expandGlobal.press('Enter')
      assert.equal(await page.getByRole('button', { name: 'writing Global', exact: true }).isVisible(), true)
      await page.getByLabel('스코프', { exact: true }).selectOption('/project/apps/web')
      assert.equal(await page.getByRole('button', { name: 'deploy Codex', exact: true }).count(), 0)
      await page.getByRole('button', { name: 'frontend Claude', exact: true }).waitFor()
      await page.getByLabel('스코프', { exact: true }).selectOption('all')
      await page.getByRole('button', { name: 'system-skill Codex', exact: true }).click()
      await page.getByLabel('확장 내용').waitFor()
      assert.ok(await page.evaluate('document.querySelector("[role=dialog]")?.contains(document.activeElement) && document.activeElement?.getClientRects().length > 0'))
      assert.equal(await page.getByRole('button', { name: '삭제', exact: true }).isEnabled(), false)
      if (width < 768) {
        await page.getByRole('button', { name: '목록으로' }).click()
        assert.ok(await page.evaluate('document.activeElement?.getAttribute("aria-label") === "확장 검색"'))
      }
      await page.getByRole('button', { name: 'deploy Codex', exact: true }).click()
      await page.getByLabel('확장 내용').waitFor()
      assert.equal(await page.getByLabel('확장 설명').innerText(), '프로젝트 배포 전 확인할 사항')
      await fs.mkdir('/tmp/mew-harness-review', { recursive: true })
      await page.screenshot({ path: `/tmp/mew-harness-review/harness-${width}.png` })
      await page.getByRole('button', { name: '수정', exact: true }).click()
      const editor = page.getByLabel('스킬 내용')
      await editor.fill(detailText + '\n추가 지침')
      if (width >= 768) {
        await page.getByRole('button', { name: '현재 프로젝트 · project 접기', exact: true }).click()
        assert.equal(await page.getByRole('alertdialog').count(), 0)
        assert.match(await editor.inputValue(), /추가 지침/)
        await page.getByRole('button', { name: '현재 프로젝트 · project 펼치기', exact: true }).click()
      }
      await page.keyboard.press('Escape')
      await page.getByRole('alertdialog').waitFor()
      await page.getByRole('alertdialog').getByRole('button', { name: '취소', exact: true }).click()
      assert.match(await editor.inputValue(), /추가 지침/)
      failSave = true
      await page.getByRole('button', { name: '저장', exact: true }).click()
      await page.getByRole('alert').waitFor()
      assert.match(await editor.inputValue(), /추가 지침/)
      failSave = false
      await page.getByRole('button', { name: '저장', exact: true }).click()
      await page.getByRole('status').filter({ hasText: '저장했습니다' }).waitFor()
      await page.getByRole('button', { name: 'deploy Codex', exact: true }).click()
      await page.getByLabel('확장 내용').waitFor()
      await page.getByRole('button', { name: '이동', exact: true }).click()
      await page.getByLabel('대상 위치').selectOption('global-codex')
      await page.getByRole('button', { name: '이동 확인', exact: true }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: '이동', exact: true }).click()
      await page.getByRole('status').filter({ hasText: '이동했습니다' }).waitFor()
      assert.equal(mutations.at(-1)?.target, 'global-codex')
      await page.getByRole('button', { name: 'deploy Codex', exact: true }).click()
      await page.getByLabel('확장 내용').waitFor()
      await page.getByRole('button', { name: '삭제', exact: true }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: '취소', exact: true }).click()
      assert.notEqual(mutations.at(-1)?.action, 'delete')
      await page.getByRole('button', { name: '삭제', exact: true }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: '삭제', exact: true }).click()
      await page.getByRole('status').filter({ hasText: '삭제했습니다' }).waitFor()
      await page.getByRole('button', { name: 'MCP', exact: true }).click()
      assert.equal(await page.getByRole('button', { name: 'MCP', exact: true }).getAttribute('aria-pressed'), 'true')
      await page.getByRole('button', { name: '전역 접기', exact: true }).click()
      assert.equal(await page.getByRole('button', { name: 'writing Global', exact: true }).isVisible(), false)
      await page.getByRole('button', { name: 'frontend Claude', exact: true }).click()
      await page.getByLabel('확장 내용').waitFor()
      await page.getByRole('button', { name: '수정', exact: true }).click()
      await page.getByLabel('MCP 설정 JSON').fill('{"command":"node","args":["updated.js"]}')
      await page.getByRole('button', { name: '저장', exact: true }).click()
      await page.getByRole('status').filter({ hasText: '저장했습니다' }).waitFor()
      assert.equal(mutations.at(-1)?.kind, 'mcp')
      assert.match(mutations.at(-1)!.content!, /updated.js/)
      await page.getByRole('button', { name: '추가', exact: true }).click()
      await page.getByLabel('이름', { exact: true }).fill('new-tool')
      await page.getByLabel('대상 위치').selectOption('global-codex')
      await page.getByLabel('MCP 설정 JSON').fill('{"command":"node","args":["new.js"]}')
      await page.getByRole('button', { name: '저장', exact: true }).click()
      await page.getByRole('status').filter({ hasText: '저장했습니다' }).waitFor()
      assert.equal(mutations.at(-1)?.action, 'create')
      assert.equal(mutations.at(-1)?.name, 'new-tool')
      await page.getByRole('button', { name: '닫기', exact: true }).focus()
      await page.keyboard.press('Shift+Tab')
      assert.ok(await page.evaluate("document.querySelector('[role=dialog]')?.contains(document.activeElement)"))
      assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
      await page.keyboard.press('Escape')
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.ok(await page.evaluate('document.activeElement?.getAttribute("aria-label") === "Skills 관리"'))
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
