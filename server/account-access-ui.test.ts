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
test('account controls save roles, features and file rules and confirm deletion on desktop and mobile', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';import{createRoot}from '${root}/node_modules/react-dom/client.js';import{AdminSettingsModal}from '${root}/src/components/AdminSettingsModal.tsx';import{I18nProvider}from '${root}/src/i18n.tsx';import{applyThemePalette,THEME_PRESETS}from '${root}/src/utils/theme-color.ts';window.fixtureTheme=id=>applyThemePalette(THEME_PRESETS.find(theme=>theme.id===id).palette);window.fixtureTheme('light');localStorage.setItem('mew:locale','ko');createRoot(document.getElementById('root')).render(<I18nProvider><AdminSettingsModal onClose={()=>{window.fixtureClosed=true}}/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:access.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:access.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) { if (id === 'virtual:access.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) } }] })
  const content = (await Promise.all(['src/components/AdminSettingsModal.tsx', 'src/components/account-access-matrix.tsx', 'src/components/account-column-headers.tsx', 'src/components/account-role-select.tsx', 'src/components/mewlink-access-settings.tsx', 'packages/ui/src/dialog-frame.tsx', 'packages/ui/src/select-field.tsx', 'packages/ui/src/HoverTipLayer.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set(content.match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
  const rows: AccessRow[] = (['owner', 'manager', 'member', 'guest'] as const).map(role => ({ subject: role === 'guest' ? 'guest' : `${role}@example.test`, displayName: role === 'member' ? 'Member with a long name' : role, role, avatarDataUrl: role === 'member' ? avatar : role === 'manager' ? 'data:image/png;base64,broken' : null, capabilities: defaultCapabilities(role), overrides: {} }))
  const rules = new Map<string, string>()
  let failNext = false
  let failNextDelete = false
  const deleteRequests: string[] = []
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, hasTouch: true })
    await context.route('http://mew-access.test/**', async route => {
      const url = new URL(route.request().url()), method = route.request().method()
      const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
      if (url.pathname === '/api/admin/users') return json(rows.filter(row => row.role !== 'guest').map(row => ({ email: row.subject, role: row.role, mustChangePassword: false, createdAt: 0 })))
      if (url.pathname.startsWith('/api/admin/users/') && url.pathname.endsWith('/role')) {
        const subject = decodeURIComponent(url.pathname.split('/')[4])
        const row = rows.find(row => row.subject === subject)!
        row.role = route.request().postDataJSON().role
        row.capabilities = { ...defaultCapabilities(row.role), ...row.overrides }
        return json({ ok: true })
      }
      if (method === 'DELETE' && url.pathname.startsWith('/api/admin/users/')) {
        const subject = decodeURIComponent(url.pathname.split('/')[4])
        deleteRequests.push(subject)
        if (failNextDelete) { failNextDelete = false; return json({ error: '계정 삭제 테스트 실패' }, 500) }
        const index = rows.findIndex(row => row.subject === subject)
        assert.ok(index >= 0)
        rows.splice(index, 1)
        return json({ ok: true })
      }
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
    const addAccount = page.getByRole('button', { name: '허용 이메일 추가', exact: true })
    await addAccount.click()
    await page.getByRole('textbox', { name: '이메일', exact: true }).waitFor()
    await addAccount.click()
    await page.getByRole('textbox', { name: '이메일', exact: true }).waitFor({ state: 'hidden' })
    const agent = page.getByRole('checkbox', { name: 'member@example.test 에이전트 창', exact: true })
    await agent.waitFor()
    assert.equal(await page.getByRole('columnheader').count(), rows.length + 1)
    assert.equal(await page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: '에이전트 창', exact: true }) }).getByRole('checkbox').count(), rows.length)
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
    const memberRole = page.getByRole('combobox', { name: /^member@example\.test 역할:/ })
    assert.equal(await memberRole.innerText(), '')
    assert.equal(await memberRole.locator('svg').count(), 1)
    assert.equal(await page.getByRole('combobox', { name: 'owner@example.test 역할: owner', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('combobox', { name: /^guest 역할/ }).count(), 0)
    await memberRole.focus()
    await memberRole.press('ArrowDown')
    await page.waitForFunction("document.querySelector('input[aria-label=\"member@example.test 에이전트 창\"]').checked")
    assert.equal(rows[2].role, 'manager')
    await memberRole.press('ArrowUp')
    await page.waitForFunction("!document.querySelector('input[aria-label=\"member@example.test 에이전트 창\"]').checked")
    assert.equal(rows[2].role, 'member')
    for (const theme of ['light', 'dark']) for (const width of [1366, 390, 320]) {
      await page.locator('html').evaluate((el, theme) => (el.ownerDocument.defaultView as unknown as { fixtureTheme: (theme: string) => void }).fixtureTheme(theme), theme)
      await page.setViewportSize({ width, height: 900 })
      await page.getByRole('tab', { name: '기능 권한', exact: true }).click()
      const dialog = page.getByRole('dialog')
      const dialogBox = await dialog.boundingBox()
      assert.ok(dialogBox)
      assert.equal(Math.round(dialogBox.width), width >= 768 ? 740 : width)
      assert.equal(Math.round(dialogBox.height), width >= 768 ? 630 : 900)
      const accountWidths = await page.getByRole('columnheader').evaluateAll(headers => headers.slice(1).map(el => el.getBoundingClientRect().width))
      assert.ok(accountWidths.every(width => width <= 65), JSON.stringify(accountWidths))
      await memberRole.click()
      const roleMenu = page.getByRole('listbox', { name: 'member@example.test 역할: member', exact: true })
      for (const role of ['member', 'manager', 'owner']) {
        const option = roleMenu.getByRole('option', { name: role, exact: true })
        assert.equal(await option.locator('svg[width="18"]').count(), 1)
      }
      const menuBox = await roleMenu.boundingBox()
      assert.ok(menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= width)
      await page.screenshot({ path: `/tmp/mew-account-roles-${theme}-${width}.png` })
      await page.keyboard.press('Escape')
      await roleMenu.waitFor({ state: 'hidden' })
      assert.equal(await page.evaluate('window.fixtureClosed'), undefined)
      const memberIcon = page.getByRole('columnheader').getByRole('button', { name: 'Member with a long name (member@example.test)', exact: true })
      assert.equal(await memberIcon.locator('img').getAttribute('src'), avatar)
      assert.equal(await memberIcon.locator('img').evaluate(el => el.complete && el.naturalWidth > 0), true)
      assert.equal(await page.getByRole('columnheader').locator('img').count(), 1)
      assert.equal(await memberIcon.innerText(), '')
      assert.equal(await page.getByText('Member with a long name', { exact: true }).isVisible(), false)
      if (width === 390) await memberIcon.tap(); else { await memberIcon.focus(); await memberIcon.press('Enter') }
      const identity = page.getByRole('region', { name: '계정: Member with a long name', exact: true })
      await identity.waitFor()
      assert.equal(await identity.getByText('member@example.test', { exact: true }).isVisible(), true)
      const identityBox = await identity.boundingBox()
      assert.ok(identityBox && identityBox.x >= 0 && identityBox.x + identityBox.width <= width, JSON.stringify({ theme, width, identityBox }))
      await page.screenshot({ path: `/tmp/mew-account-identity-${theme}-${width}.png` })
      await page.keyboard.press('Escape')
      await identity.waitFor({ state: 'hidden' })
      assert.equal(await page.evaluate('window.fixtureClosed'), undefined)
      assert.equal(await memberIcon.evaluate(el => el.ownerDocument.activeElement === el), true)
      await memberIcon.click()
      await identity.waitFor()
      await page.getByRole('tab', { name: '기능 권한', exact: true }).click()
      await identity.waitFor({ state: 'hidden' })
      await memberIcon.click()
      await identity.waitFor()
      await page.evaluate('history.back()')
      await identity.waitFor({ state: 'hidden' })
      assert.equal(await page.evaluate('window.fixtureClosed'), undefined)
      const box = await dialog.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= width)
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true, JSON.stringify(await dialog.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, children: [...el.querySelectorAll('*')].filter(child => child.scrollWidth > child.clientWidth + 1).map(child => ({ tag: child.tagName, className: child.className, width: child.clientWidth, scroll: child.scrollWidth })) }))))
      await page.getByRole('tabpanel').evaluate(el => { el.scrollLeft = 0 })
      await page.screenshot({ path: `/tmp/mew-account-matrix-${theme}-${width}.png` })
      await page.getByRole('tab', { name: '파일·폴더 권한', exact: true }).click()
      await Promise.all([
        page.waitForResponse(response => new URL(response.url()).searchParams.get('path') === 'readme.md'),
        page.getByRole('button', { name: 'readme.md', exact: true }).click(),
      ])
      await page.getByRole('rowheader', { name: '설정', exact: true }).waitFor()
      const fileAvatar = page.getByRole('columnheader').getByRole('button', { name: 'Member with a long name (member@example.test)', exact: true }).locator('img')
      assert.equal(await fileAvatar.getAttribute('src'), avatar)
      assert.equal(await fileAvatar.evaluate(el => el.complete && el.naturalWidth > 0), true)
      assert.equal(await page.getByRole('columnheader').count(), rows.length + 1)
      assert.equal(await page.getByRole('rowheader', { name: '설정', exact: true }).count(), 1)
      assert.equal(await page.getByRole('rowheader', { name: '현재 적용', exact: true }).count(), 1)
      const guest = page.getByRole('combobox', { name: 'guest 파일·폴더 권한', exact: true })
      await guest.click()
      await page.getByRole('option', { name: '열람만', exact: true }).click()
      await page.getByRole('status').getByText('저장됨').waitFor()
      assert.equal(rules.get('guest:readme.md'), 'view')
      await page.getByRole('combobox', { name: 'member@example.test 파일·폴더 권한', exact: true }).click()
      await page.getByRole('option', { name: '차단', exact: true }).click()
      await page.getByRole('status').getByText('저장됨').waitFor()
      assert.equal(rules.get('member@example.test:readme.md'), 'deny')
      await page.screenshot({ path: `/tmp/mew-account-files-${theme}-${width}.png` })
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true, JSON.stringify(await dialog.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, children: [...el.querySelectorAll('*')].filter(child => child.scrollWidth > child.clientWidth + 1).map(child => ({ tag: child.tagName, className: child.className, width: child.clientWidth, scroll: child.scrollWidth })) }))))
      await page.getByRole('button', { name: '상위 폴더', exact: false }).click()
      await page.getByRole('button', { name: 'readme.md', exact: true }).waitFor()
    }
    await page.getByRole('tab', { name: '기능 권한', exact: true }).click()
    const memberIcon = page.getByRole('columnheader').getByRole('button', { name: 'Member with a long name (member@example.test)', exact: true })
    await memberIcon.click()
    const memberAccount = page.getByRole('region', { name: '계정: Member with a long name', exact: true })
    const accountRole = memberAccount.getByRole('combobox', { name: 'member@example.test 역할 변경', exact: true })
    await accountRole.click()
    await page.getByRole('listbox', { name: 'member@example.test 역할 변경', exact: true }).getByRole('option', { name: 'manager', exact: true }).click()
    await page.waitForFunction("document.querySelector('input[aria-label=\"member@example.test 에이전트 창\"]').checked")
    assert.equal(rows[2].role, 'manager')
    await accountRole.press('ArrowUp')
    await page.waitForFunction("!document.querySelector('input[aria-label=\"member@example.test 에이전트 창\"]').checked")
    assert.equal(rows[2].role, 'member')
    const deleteAccount = memberAccount.getByRole('button', { name: '계정 삭제', exact: true })
    const confirmDelete = memberAccount.getByRole('button', { name: '삭제 확인', exact: true })
    await deleteAccount.click()
    await memberAccount.getByText('계정과 로그인 권한을 삭제합니다. 프로젝트 파일과 작업 기록은 유지됩니다.', { exact: true }).waitFor()
    await memberAccount.getByRole('button', { name: '삭제 취소', exact: true }).click()
    await confirmDelete.waitFor({ state: 'hidden' })
    assert.deepEqual(deleteRequests, [])
    failNextDelete = true
    await deleteAccount.click()
    await confirmDelete.click()
    await page.getByRole('alert').getByText('계정 삭제 테스트 실패', { exact: true }).waitFor()
    assert.equal(await memberAccount.isVisible(), true)
    assert.equal(await memberIcon.count(), 1)
    assert.deepEqual(deleteRequests, ['member@example.test'])
    await confirmDelete.click()
    await memberIcon.waitFor({ state: 'hidden' })
    await memberAccount.waitFor({ state: 'hidden' })
    assert.deepEqual(deleteRequests, ['member@example.test', 'member@example.test'])
    assert.equal(await page.getByRole('columnheader').count(), rows.length + 1)
    assert.equal(await page.getByRole('checkbox', { name: 'member@example.test 에이전트 창', exact: true }).count(), 0)
    await page.getByRole('tab', { name: '파일·폴더 권한', exact: true }).click()
    await page.getByRole('rowheader', { name: '설정', exact: true }).waitFor()
    assert.equal(await page.getByRole('columnheader').count(), rows.length + 1)
    assert.equal(await page.getByRole('combobox', { name: 'member@example.test 파일·폴더 권한', exact: true }).count(), 0)
    await page.keyboard.press('Escape')
    assert.equal(await page.evaluate('window.fixtureClosed'), true)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
