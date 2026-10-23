import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Page } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import type { MewlinkAccessOverview, MewlinkAccessStatus, MewlinkIdentity } from '../shared/mewlink-identity.ts'

const root = path.resolve(import.meta.dirname, '..')
const chrome = domBrowserExecutable()
const identity: MewlinkIdentity = { issuer: 'https://mewlink.test', subject: 'central-person-1', provider: 'github', displayName: '뮤링크 사용자', username: 'mewlink-person' }

async function fixture() {
  const source = `import React,{useState}from '${root}/node_modules/react/index.js';import{createRoot}from '${root}/node_modules/react-dom/client.js';import{LoginPage}from '${root}/src/components/LoginPage.tsx';import{MewlinkAccessSettings}from '${root}/src/components/mewlink-access-settings.tsx';import{MewlinkAccountConnection}from '${root}/src/components/mewlink-account-connection.tsx';import{I18nProvider}from '${root}/src/i18n.tsx';localStorage.setItem('mew:locale','ko');window.fixtureRemote=!location.pathname.startsWith('/local');function Fixture(){const[users,setUsers]=useState([{email:'member@example.test',displayName:'기존 사용자',role:'member',mustChangePassword:false,createdAt:0}]);return location.pathname==='/owner'?<div role='dialog' aria-label='계정 관리' className='mx-auto max-w-3xl p-3'><MewlinkAccessSettings users={users} onUsersChanged={async()=>{setUsers(await(await fetch('/api/admin/users')).json())}}/></div>:location.pathname.endsWith('/account')?<div role='dialog' aria-label='계정 설정' className='mx-auto max-w-sm p-3'><MewlinkAccountConnection email={location.search?'remote-user':'member@example.test'} authenticationMethod={location.search?'mewlink':'password'}/></div>:<LoginPage dismissible={false} onClose={()=>{window.fixtureClosed=true}} onSuccess={status=>{window.fixtureStatus=status}}/>}createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:mewlink-identity.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'mewlink-identity-fixture',
    resolveId(id) {
      if (id === 'virtual:mewlink-identity.tsx') return id
      if (id.endsWith('/remote-app.ts')) return 'virtual:remote-app'
      if (id.endsWith('/remote-transport.ts')) return 'virtual:remote-transport'
      if (id.endsWith('.css')) return 'virtual:style'
    },
    load(id) {
      if (id === 'virtual:mewlink-identity.tsx') return source
      if (id === 'virtual:remote-app') return 'export function requestMewlinkLogin(){window.fixtureCentralLogin=(window.fixtureCentralLogin||0)+1;return true}export function reloadRemoteAppForIdentity(email){window.fixtureReloaded=email;return true}'
      if (id === 'virtual:remote-transport') return 'export const mewFetch=(...args)=>fetch(...args);export const isRemoteMode=()=>window.fixtureRemote!==false;export const openMewSocket=()=>{throw new Error("No sockets in login fixture")}'
      if (id === 'virtual:style') return ''
    },
  }] })
  const content = source + '\n' + (await Promise.all(['src/components/LoginPage.tsx', 'src/components/mewlink-access-settings.tsx', 'src/components/mewlink-account-connection.tsx', 'packages/ui/src/select-field.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set(content.match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  return { js: bundle.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n'), css }
}

async function noHorizontalOverflow(page: Page) {
  assert.equal(await page.locator('#root').evaluate(el => el.ownerDocument.documentElement.scrollWidth <= el.ownerDocument.documentElement.clientWidth), true)
  assert.equal(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true)
}

test('Mewlink login requests approval without credentials and enters after approval on desktop/mobile', { skip: !chrome, timeout: 30_000 }, async t => {
  const { js, css } = await fixture()
  const browser = await chromium.launch({ executablePath: chrome, chromiumSandbox: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  page.setDefaultTimeout(5000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let status: MewlinkAccessStatus = { identity: null, state: 'unavailable' }
  let requests = 0, logins = 0, localLogins = 0
  await page.route('http://mewlink-ui.test/**', route => {
    const url = new URL(route.request().url())
    const json = (value: unknown, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(value) })
    if (url.pathname === '/api/auth/mewlink') return json(status)
    if (url.pathname === '/api/auth/mewlink/request') { requests++; status = { identity, state: 'pending' }; return json(status) }
    if (url.pathname === '/api/auth/mewlink/login') { logins++; return json({ ok: true }) }
    if (url.pathname === '/api/auth/me') return json({ authenticated: true, email: 'mew:remote-1', displayName: identity.displayName, role: 'member', mustChangePassword: false, hasPassword: false })
    if (url.pathname === '/api/auth/login') { localLogins++; return json({ error: '이메일 또는 비밀번호를 확인해 주세요.' }, 401) }
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: js })
    return route.fulfill({ contentType: 'text/html', body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}body{margin:0}</style><div id="root"></div><script src="/app.js"></script>` })
  })
  await page.goto('http://mewlink-ui.test/')
  await page.getByRole('button', { name: 'Mewlink로 로그인', exact: true }).click()
  assert.equal(await page.locator('#root').evaluate(el => (el.ownerDocument.defaultView as unknown as { fixtureCentralLogin: number }).fixtureCentralLogin), 1)
  assert.equal(requests, 0)
  await page.getByPlaceholder('이메일', { exact: true }).fill('local@example.test')
  await page.getByPlaceholder('비밀번호', { exact: true }).fill('local-password')
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await page.getByRole('alert').getByText('이메일 또는 비밀번호를 확인해 주세요.').waitFor()
  assert.equal(localLogins, 1)

  status = { identity, state: 'unlinked' }
  await page.reload()
  await page.getByRole('button', { name: '접근 요청', exact: true }).click()
  await page.getByRole('status').getByText('관리자 승인 대기 중').waitFor()
  assert.equal(requests, 1)
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((el, dark) => el.classList.toggle('dark', dark), theme === 'dark')
    for (const width of [1000, 390]) {
      await page.setViewportSize({ width, height: 800 })
      await noHorizontalOverflow(page)
      await page.screenshot({ path: `/tmp/mew-mewlink-login-${theme}-${width}.png` })
    }
  }
  status = { identity, state: 'approved', accountId: 'mew:remote-1' }
  await page.waitForFunction('window.fixtureStatus?.authenticated === true')
  assert.equal(logins, 1)
  assert.equal(await page.getByPlaceholder('새 비밀번호', { exact: true }).count(), 0)
  assert.equal(requests, 1)

  status = { identity, state: 'denied' }
  await page.reload()
  await page.getByText('접근 요청이 거절됐습니다.', { exact: true }).waitFor()
  await page.getByRole('button', { name: '다시 접근 요청', exact: true }).click()
  await page.getByText('관리자 승인 대기 중', { exact: true }).waitFor()
  assert.equal(requests, 2)
  await page.goto('http://mewlink-ui.test/local')
  await page.getByPlaceholder('이메일', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Mewlink로 로그인', exact: true }).count(), 0)
  assert.deepEqual(errors, [])
})

test('users link Mewlink to their own email account after a password login', { skip: !chrome, timeout: 30_000 }, async t => {
  const { js, css } = await fixture()
  const browser = await chromium.launch({ executablePath: chrome, chromiumSandbox: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  page.setDefaultTimeout(5000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let status: MewlinkAccessStatus = { identity, state: 'approved', accountId: 'remote-user' }
  let failLoad = true, failLink = true, failLogin = true, localLoads = 0
  const bodies: unknown[] = []
  await page.route('http://mewlink-account-ui.test/**', route => {
    const url = new URL(route.request().url())
    const json = (value: unknown, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(value) })
    if (url.pathname === '/api/auth/mewlink') {
      localLoads++
      if (failLoad) { failLoad = false; return json({ error: '상태 조회 실패' }, 500) }
      return json(status)
    }
    if (url.pathname === '/api/auth/mewlink/link') {
      bodies.push(route.request().postDataJSON())
      if (failLink) { failLink = false; return json({ error: '연결 저장 실패' }, 500) }
      status = { identity, state: 'approved', accountId: 'member@example.test' }
      return json({ ok: true })
    }
    if (url.pathname === '/api/auth/login') {
      if (failLogin) { failLogin = false; return json({ error: '이메일 또는 비밀번호를 확인해 주세요.' }, 401) }
      return json({ ok: true, mustChangePassword: false })
    }
    if (url.pathname === '/api/auth/me') return json({ authenticated: true, email: 'member@example.test', role: 'member', mustChangePassword: false, hasPassword: true, authenticationMethod: 'password' })
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: js })
    return route.fulfill({ contentType: 'text/html', body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}body{margin:0;background:var(--color-surface-deep)}</style><div id="root"></div><script src="/app.js"></script>` })
  })
  await page.goto('http://mewlink-account-ui.test/account?method=mewlink')
  await page.getByRole('alert').getByText('상태 조회 실패').waitFor()
  await page.getByRole('button', { name: 'Mewlink 계정 새로고침', exact: true }).click()
  await page.getByRole('button', { name: '기존 이메일 계정으로 로그인', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Mewlink로 로그인', exact: true }).count(), 0)
  await page.getByPlaceholder('이메일', { exact: true }).fill('member@example.test')
  await page.getByPlaceholder('비밀번호', { exact: true }).fill('existing-password')
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await page.getByRole('alert').getByText('이메일 또는 비밀번호를 확인해 주세요.').waitFor()
  assert.equal(bodies.length, 0)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await page.waitForFunction('window.fixtureReloaded === "member@example.test"')
  await page.goto('http://mewlink-account-ui.test/account')
  await page.getByText('병합 후 로그인 수단이 남지 않는 이전 계정은 삭제됩니다. 작업 기록은 보존됩니다.', { exact: true }).waitFor()
  await page.getByRole('button', { name: '이 계정에 연결', exact: true }).click()
  await page.getByRole('alert').getByText('연결 저장 실패').waitFor()
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((el, dark) => el.classList.toggle('dark', dark), theme === 'dark')
    for (const width of [1000, 390]) {
      await page.setViewportSize({ width, height: 800 })
      await noHorizontalOverflow(page)
      await page.screenshot({ path: `/tmp/mew-mewlink-account-${theme}-${width}.png` })
    }
  }
  await page.getByRole('button', { name: '이 계정에 연결', exact: true }).click()
  await page.getByRole('status').getByText('member@example.test에 연결됨', { exact: true }).waitFor()
  assert.deepEqual(bodies, [{ previousAccountId: 'remote-user' }, { previousAccountId: 'remote-user' }])
  assert.equal(await page.getByRole('button', { name: '이 계정에 연결', exact: true }).count(), 0)
  await page.reload()
  await page.getByRole('status').getByText('member@example.test에 연결됨', { exact: true }).waitFor()
  status = { identity: null, state: 'unavailable' }
  await page.reload()
  await page.getByRole('button', { name: 'Mewlink로 로그인', exact: true }).click()
  assert.equal(await page.locator('#root').evaluate(el => (el.ownerDocument.defaultView as unknown as { fixtureCentralLogin: number }).fixtureCentralLogin), 1)
  const before = localLoads
  await page.goto('http://mewlink-account-ui.test/local/account')
  assert.equal(await page.getByRole('region', { name: 'Mewlink 계정 연결', exact: true }).count(), 0)
  assert.equal(localLoads, before)
  assert.deepEqual(errors, [])
})

test('owner approves Mewlink accounts directly, retries failures, denies and revokes access', { skip: !chrome, timeout: 30_000 }, async t => {
  const { js, css } = await fixture()
  const browser = await chromium.launch({ executablePath: chrome, chromiumSandbox: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, hasTouch: true })
  page.setDefaultTimeout(5000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const names = ['새 사용자', '두번째 사용자', '거절할 사용자']
  const overview: MewlinkAccessOverview = { requests: names.map((displayName, index) => ({ id: `request-${index}`, identity: { ...identity, subject: `central-${index}`, displayName }, requestedAt: Date.now(), status: 'pending' })), links: [] }
  const users = [{ email: 'member@example.test', displayName: '기존 사용자', role: 'member', mustChangePassword: false, createdAt: 0 }]
  const approvals: unknown[] = []
  let failApprove = true, failDeny = true, deleted = 0
  await page.route('http://mewlink-owner-ui.test/**', route => {
    const url = new URL(route.request().url()), method = route.request().method()
    const json = (value: unknown, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(value) })
    if (url.pathname === '/api/admin/users') return json(users)
    if (url.pathname === '/api/admin/mewlink') return json(overview)
    const requestRoute = /^\/api\/admin\/mewlink\/requests\/(request-\d)\/(approve|deny)$/.exec(url.pathname)
    if (requestRoute) {
      const request = overview.requests.find(item => item.id === requestRoute[1])!
      if (requestRoute[2] === 'deny') {
        if (failDeny) { failDeny = false; return json({ error: '거절 저장 실패' }, 500) }
        request.status = 'denied'
        return json({ ok: true })
      }
      if (failApprove) { failApprove = false; return json({ error: '승인 저장 실패' }, 500) }
      const body = route.request().postDataJSON() as { accountId?: string; displayName?: string; role?: string }
      approvals.push(body)
      const accountId = `mew:remote-${request.id}`
      users.push({ email: accountId, displayName: request.identity.displayName, role: 'member', mustChangePassword: false, createdAt: 0 })
      request.status = 'approved'; request.accountId = accountId
      const link = { id: `link-${request.id}`, identity: request.identity, accountId, linkedAt: Date.now() }
      overview.links.push(link)
      return json({ ok: true, link })
    }
    if (url.pathname.startsWith('/api/admin/mewlink/links/') && method === 'DELETE') { deleted++; overview.links = overview.links.filter(link => link.id !== url.pathname.split('/').at(-1)); return json({ ok: true }) }
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: js })
    return route.fulfill({ contentType: 'text/html', body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}body{margin:0;background:var(--color-surface-deep)}</style><div id="root"></div><script src="/app.js"></script>` })
  })
  await page.goto('http://mewlink-owner-ui.test/owner')
  await page.getByText('승인 대기 3건', { exact: true }).waitFor()
  await page.locator('details > summary').filter({ hasText: 'Mewlink 계정 접근' }).click()
  await page.getByRole('button', { name: '새 사용자 접근 승인', exact: true }).click()
  assert.equal(await page.getByRole('combobox', { name: '연결할 mew 계정', exact: true }).count(), 0)
  await page.getByRole('alert').getByText('승인 저장 실패').waitFor()
  assert.equal(approvals.length, 0)
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((el, dark) => el.classList.toggle('dark', dark), theme === 'dark')
    for (const width of [1000, 390]) {
      await page.setViewportSize({ width, height: 800 })
      await noHorizontalOverflow(page)
      await page.screenshot({ path: `/tmp/mew-mewlink-owner-${theme}-${width}.png` })
    }
  }
  await page.getByRole('button', { name: '새 사용자 접근 승인', exact: true }).click()
  await page.getByRole('list', { name: '승인된 Mewlink 계정', exact: true }).getByText('새 사용자', { exact: true }).waitFor()
  assert.deepEqual(approvals[0], {})
  assert.equal(users.find(user => user.email === 'mew:remote-request-0')?.role, 'member')
  await page.getByRole('button', { name: '두번째 사용자 접근 승인', exact: true }).click()
  await page.getByRole('list', { name: '승인된 Mewlink 계정', exact: true }).getByText('두번째 사용자', { exact: true }).waitFor()
  assert.deepEqual(approvals[1], {})
  await page.getByRole('button', { name: '거절할 사용자 접근 요청 거절', exact: true }).click()
  await page.getByRole('alert').getByText('거절 저장 실패').waitFor()
  await page.getByRole('button', { name: '거절할 사용자 접근 요청 거절', exact: true }).click()
  await page.getByText('거절됨', { exact: true }).waitFor()
  await page.getByRole('button', { name: '새 사용자 Mewlink 연결 해제', exact: true }).click()
  assert.equal(deleted, 0)
  await page.getByRole('button', { name: '연결 해제 취소', exact: true }).click()
  assert.equal(deleted, 0)
  await page.getByRole('button', { name: '새 사용자 Mewlink 연결 해제', exact: true }).click()
  await page.getByRole('button', { name: '연결 해제', exact: true }).click()
  await page.getByRole('button', { name: '새 사용자 Mewlink 연결 해제', exact: true }).waitFor({ state: 'detached' })
  assert.equal(deleted, 1)
  await noHorizontalOverflow(page)
  assert.deepEqual(errors, [])
})
