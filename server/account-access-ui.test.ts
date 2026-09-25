import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { defaultCapabilities, type AccessRow } from '../shared/access-policy.ts'

const root = path.resolve(import.meta.dirname, '..')
test('account matrix saves independent features and file rules on desktop and mobile', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';import{createRoot}from '${root}/node_modules/react-dom/client.js';import{AdminSettingsModal}from '${root}/src/components/AdminSettingsModal.tsx';import{I18nProvider}from '${root}/src/i18n.tsx';localStorage.setItem('mew:locale','ko');createRoot(document.getElementById('root')).render(<I18nProvider><AdminSettingsModal onClose={()=>{window.fixtureClosed=true}}/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:access.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:access.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) { if (id === 'virtual:access.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) } }] })
  const content = (await Promise.all(['src/components/AdminSettingsModal.tsx', 'src/components/account-access-matrix.tsx', 'packages/ui/src/select-field.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set(content.match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  const rows: AccessRow[] = (['owner', 'manager', 'member', 'guest'] as const).map(role => ({ subject: role === 'guest' ? 'guest' : `${role}@example.test`, displayName: role === 'member' ? 'Member with a long name' : role, role, capabilities: defaultCapabilities(role), overrides: {} }))
  const rules = new Map<string, string>()
  let failNext = false
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, hasTouch: true })
    await context.route('http://mew-access.test/**', async route => {
      const url = new URL(route.request().url()), method = route.request().method()
      const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
      if (url.pathname === '/api/admin/users') return json(rows.filter(row => row.role !== 'guest').map(row => ({ email: row.subject, role: row.role, mustChangePassword: false, createdAt: 0 })))
      if (url.pathname === '/api/admin/access') return json({ rows, workspace: '/projects/mew' })
      if (url.pathname === '/api/admin/access/feature') {
        if (failNext) { failNext = false; return json({ error: '권한 저장 테스트 실패' }, 500) }
        const { subject, feature, enabled } = route.request().postDataJSON() as { subject: string; feature: keyof AccessRow['capabilities']; enabled: boolean | null }
        const row = rows.find(row => row.subject === subject)!
        if (enabled === null) delete row.overrides[feature]; else row.overrides[feature] = enabled
        row.capabilities = { ...defaultCapabilities(row.role), ...row.overrides }
        return json({ rows, workspace: '/projects/mew' })
      }
      if (url.pathname === '/api/admin/access/path') {
        if (method === 'PUT') { const body = route.request().postDataJSON(); rules.set(`${body.subject}:${body.path}`, body.access); return json({ ok: true }) }
        const selected = url.searchParams.get('path') ?? ''
        return json({ workspace: '/projects/mew', project: '.workspace', path: selected, directory: !selected.endsWith('.md'), entries: selected ? [] : [{ path: 'readme.md', name: 'readme.md', type: 'file' }, { path: 'private', name: 'private', type: 'dir' }], permissions: rows.map(row => {
          const rule = rules.get(`${row.subject}:${selected}`)
          const view = rule ? ['view', 'edit'].includes(rule) : row.role !== 'guest'
          const edit = rule ? rule === 'edit' : row.role !== 'guest'
          return { subject: row.subject, explicit: rule && rule !== 'inherit' ? { path: selected, view, edit } : null, effective: { view, edit } }
        }) })
      }
      if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.output.find(item => item.type === 'chunk')!.code })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    const page = await context.newPage(); page.setDefaultTimeout(4000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://mew-access.test/')
    const agent = page.getByRole('checkbox', { name: 'member@example.test 에이전트 창', exact: true })
    await agent.waitFor()
    assert.equal(await agent.isChecked(), false)
    assert.equal(await page.getByRole('checkbox', { name: 'guest 터미널', exact: true }).isDisabled(), true)
    await agent.click()
    await page.getByRole('status').getByText('저장됨').waitFor()
    assert.equal(rows[2].capabilities.agent, true)
    assert.equal(await page.getByRole('checkbox', { name: 'member@example.test 터미널', exact: true }).isChecked(), false)
    failNext = true
    await agent.click()
    await page.getByRole('alert').getByText('권한 저장 테스트 실패').waitFor()
    assert.equal(await agent.isChecked(), true)
    await page.getByRole('button', { name: 'member@example.test 에이전트 창 역할 기본값으로 되돌리기' }).click()
    await page.waitForFunction("!document.querySelector('input[aria-label=\"member@example.test 에이전트 창\"]').checked")
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await page.getByRole('tab', { name: '기능 권한', exact: true }).click()
      const dialog = page.getByRole('dialog')
      const box = await dialog.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= width)
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true, JSON.stringify(await dialog.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, children: [...el.querySelectorAll('*')].filter(child => child.scrollWidth > child.clientWidth + 1).map(child => ({ tag: child.tagName, className: child.className, width: child.clientWidth, scroll: child.scrollWidth })) }))))
      await page.getByRole('tabpanel').evaluate(el => { el.scrollLeft = 0 })
      await page.screenshot({ path: `/tmp/mew-account-matrix-${width}.png` })
      await page.getByRole('tab', { name: '파일·폴더 권한', exact: true }).click()
      await page.getByRole('button', { name: 'readme.md', exact: true }).click()
      const guest = page.getByRole('combobox', { name: 'guest 파일·폴더 권한', exact: true })
      await guest.click()
      await page.getByRole('option', { name: '열람만', exact: true }).click()
      await page.getByRole('status').getByText('저장됨').waitFor()
      assert.equal(rules.get('guest:readme.md'), 'view')
      await page.getByRole('combobox', { name: 'member@example.test 파일·폴더 권한', exact: true }).click()
      await page.getByRole('option', { name: '차단', exact: true }).click()
      await page.getByRole('status').getByText('저장됨').waitFor()
      assert.equal(rules.get('member@example.test:readme.md'), 'deny')
      await page.screenshot({ path: `/tmp/mew-account-files-${width}.png` })
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true, JSON.stringify(await dialog.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, children: [...el.querySelectorAll('*')].filter(child => child.scrollWidth > child.clientWidth + 1).map(child => ({ tag: child.tagName, className: child.className, width: child.clientWidth, scroll: child.scrollWidth })) }))))
      await page.getByRole('button', { name: '상위 폴더', exact: false }).click()
      await page.getByRole('button', { name: 'readme.md', exact: true }).waitFor()
    }
    await page.keyboard.press('Escape')
    assert.equal(await page.evaluate('window.fixtureClosed'), true)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
