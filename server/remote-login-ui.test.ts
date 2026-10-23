import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import path from 'node:path'
import fs from 'node:fs/promises'
import { compile } from '@tailwindcss/node'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..'), chrome = domBrowserExecutable()
test('remote login cannot be dismissed and handles incorrect and temporary local passwords on desktop/mobile', { skip: !chrome, timeout: 30_000 }, async t => {
  const source = `import React from '${root}/node_modules/react/index.js';import{createRoot}from '${root}/node_modules/react-dom/client.js';import{LoginPage}from '${root}/src/components/LoginPage.tsx';import{I18nProvider}from '${root}/src/i18n.tsx';localStorage.setItem('mew:locale','ko');createRoot(document.getElementById('root')).render(<I18nProvider><LoginPage dismissible={false} initialMustChangePassword={location.pathname==='/resume'} onClose={()=>{window.fixtureClosed=true}} onSuccess={status=>{window.fixtureStatus=status}}/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:login.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:login.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:login.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const code = bundle.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n')
  const content = await fs.readFile(`${root}/src/components/LoginPage.tsx`, 'utf8')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set(content.match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  let logins = 0, changed = false, submittedPassword = ''
  const server = http.createServer((req, res) => {
    const json = (body: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)) }
    if (req.url === '/api/auth/login') { logins++; json(logins === 1 ? { error: '이메일 또는 비밀번호를 확인해 주세요.' } : { ok: true, email: 'local@example.test', role: 'member', mustChangePassword: true }, logins === 1 ? 401 : 200); return }
    if (req.url === '/api/auth/change-password') { let body = ''; req.on('data', chunk => { body += chunk }); req.on('end', () => { submittedPassword = JSON.parse(body).currentPassword; changed = true; json({ ok: true }) }); return }
    if (req.url === '/api/auth/me') { json({ authenticated: true, email: 'local@example.test', role: 'member', mustChangePassword: false }); return }
    res.setHeader('Content-Type', 'text/html'); res.end(`<meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}body{margin:0}</style><div id="root"></div><script>${code}</script>`)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))
  const browser = await chromium.launch({ executablePath: chrome, chromiumSandbox: true }); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } }); page.setDefaultTimeout(5000)
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`)
  await page.getByPlaceholder('이메일', { exact: true }).waitFor()
  await page.keyboard.press('Escape'); await page.mouse.click(1, 1)
  assert.equal(await page.getByRole('button', { name: '닫기', exact: true }).count(), 0)
  assert.equal(await page.locator('#root').evaluate(el => (el.ownerDocument.defaultView as unknown as { fixtureClosed?: boolean }).fixtureClosed), undefined)
  await page.getByPlaceholder('이메일', { exact: true }).fill('local@example.test')
  await page.getByPlaceholder('비밀번호', { exact: true }).fill('incorrect')
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await page.getByText('이메일 또는 비밀번호를 확인해 주세요.', { exact: true }).waitFor()
  assert.equal(await page.getByPlaceholder('이메일', { exact: true }).inputValue(), 'local@example.test')
  await page.screenshot({ path: '/tmp/mew-remote-login-desktop.png' })
  await page.getByPlaceholder('비밀번호', { exact: true }).fill('temporary-password')
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await page.getByPlaceholder('새 비밀번호', { exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 780 })
  await page.getByPlaceholder('새 비밀번호', { exact: true }).fill('new-safe-password')
  await page.getByPlaceholder('새 비밀번호 확인', { exact: true }).fill('new-safe-password')
  await page.screenshot({ path: '/tmp/mew-remote-login-mobile.png' })
  await page.getByRole('button', { name: '비밀번호 변경하고 시작하기', exact: true }).click()
  await page.waitForFunction('window.fixtureStatus?.authenticated === true')
  assert.equal(changed, true)
  assert.equal(submittedPassword, 'temporary-password')
  assert.equal(await page.locator('#root').evaluate(el => el.ownerDocument.documentElement.scrollWidth <= el.ownerDocument.documentElement.clientWidth), true)
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/resume`)
  await page.getByPlaceholder('현재 비밀번호', { exact: true }).waitFor()
  assert.equal(await page.getByPlaceholder('이메일', { exact: true }).count(), 0)
  await page.getByPlaceholder('현재 비밀번호', { exact: true }).fill('resumed-temporary-password')
  await page.getByPlaceholder('새 비밀번호', { exact: true }).fill('new-safe-password')
  await page.getByPlaceholder('새 비밀번호 확인', { exact: true }).fill('new-safe-password')
  await page.getByRole('button', { name: '비밀번호 변경하고 시작하기', exact: true }).click()
  await page.waitForFunction('window.fixtureStatus?.authenticated === true')
  assert.equal(submittedPassword, 'resumed-temporary-password')
  assert.equal(logins, 2)
})
