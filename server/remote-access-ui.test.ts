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
import type { RemoteNetworkStatus } from '../shared/remote-access.ts'
const root = path.resolve(import.meta.dirname, '..'), chrome = domBrowserExecutable()
test('remote registration settings support desktop/mobile and local account access without central member mapping', { skip: !chrome, timeout: 30_000 }, async t => {
  const source = `import React from '${root}/node_modules/react/index.js';import{createRoot}from '${root}/node_modules/react-dom/client.js';import{setUiLocale}from '${root}/packages/ui/src/i18n-core.ts';setUiLocale('ko');import{RemoteAccessSettings}from '${root}/src/components/remote-access-settings.tsx';import{DialogFrame}from '${root}/packages/ui/src/dialog-frame.tsx';const app=createRoot(document.getElementById('root'));app.render(<DialogFrame labelledBy="fixture-title" onClose={()=>app.unmount()}><header className="border-b border-edge px-3 py-2"><h2 id="fixture-title" className="text-sm font-semibold">Mewlink</h2></header><div className="p-3"><RemoteAccessSettings/></div></DialogFrame>);`
  const bundle = await build({ input: 'virtual:remote-ui.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:remote-ui.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:remote-ui.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const code = bundle.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n')
  const content = (await Promise.all(['src/components/remote-access-settings.tsx', 'packages/ui/src/dialog-frame.tsx', 'packages/ui/src/select-field.tsx'].map(file => fs.readFile(path.join(root,file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set(content.match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  let enabled = false, registered = false, removed = false, memberRequests = 0, preparations = 0, addressError = false, fail = false
  let network: RemoteNetworkStatus = { state: 'ready', reason: 'wsl-udp-rule' }
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/remote-access')) {
      res.setHeader('Content-Type', 'application/json')
      if (fail) { res.statusCode = 503; res.end(JSON.stringify({ error: '일시적인 조회 실패' })); return }
      if (req.url.endsWith('/prepare-network')) { preparations++; network = { state: 'preparing' }; res.statusCode = 202; res.end(JSON.stringify({ enabled, state: 'online', network })); return }
      if (req.url.endsWith('/register')) { registered = true; res.end(JSON.stringify({ enabled: false, state: 'registering', registrationUrl: 'https://mew.saens.kr/register/test' })); return }
      if (req.url.endsWith('/members')) { memberRequests++; res.end('{}'); return }
      if (req.method === 'DELETE') { removed = true; enabled = false; res.end(JSON.stringify({ enabled: false, state: 'disabled' })); return }
      res.end(JSON.stringify(enabled ? { enabled: true, state: 'online', url: addressError ? undefined : 'https://mew.run/alice/home', username: addressError ? undefined : 'alice', deviceName: 'home', dashboardUrl: 'https://mew.run/alice', addressError: addressError ? 'unavailable' : undefined, network } : { enabled: false, state: 'disabled' })); return
    }
    res.setHeader('Content-Type', 'text/html'); res.end(`<meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}body{margin:0}#root{padding:12px;max-width:650px}</style><div id="root"></div><script>localStorage.setItem("mew:locale","ko")</script><script>${code}</script>`)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const browser = await chromium.launch({ executablePath: chrome, chromiumSandbox: true }); t.after(async () => { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const page = await browser.newPage({ viewport: { width: 900, height: 700 }, permissions: ['clipboard-read', 'clipboard-write'] }); page.setDefaultTimeout(5000); await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`)
  await page.getByRole('dialog', { name: 'Mewlink', exact: true }).waitFor()
  await page.getByRole('button', { name: '기기 등록', exact: true }).click(); await page.getByRole('link', { name: '로그인하고 등록 완료' }).waitFor(); assert.equal(registered, true)
  await page.screenshot({ path: '/tmp/mew-remote-access-desktop.png' })
  enabled = true; await page.getByRole('button', { name: '새로고침', exact: true }).click(); await page.getByText('온라인', { exact: true }).waitFor()
  await page.getByText('@alice', { exact: true }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'mew.run/alice/home', exact: true }).getAttribute('href'), 'https://mew.run/alice/home')
  assert.equal(await page.getByRole('link', { name: '계정·기기 관리', exact: true }).getAttribute('href'), 'https://mew.run/alice')
  await page.getByRole('button', { name: '주소 복사', exact: true }).click()
  assert.equal(await page.locator('#root').evaluate(el => (el.ownerDocument.defaultView!.navigator as unknown as { clipboard: { readText(): Promise<string> } }).clipboard.readText()), 'https://mew.run/alice/home')
  await page.getByRole('status').filter({ hasText: '주소를 복사했습니다.' }).waitFor()
  await page.screenshot({ path: '/tmp/mew-remote-access-desktop.png' })
  fail = true; await page.getByRole('button', { name: '새로고침', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '일시적인 조회 실패' }).waitFor()
  fail = false; await page.getByRole('button', { name: '새로고침', exact: true }).click()
  await page.getByRole('alert').waitFor({ state: 'detached' })
  await page.setViewportSize({ width: 390, height: 780 })
  assert.equal(await page.getByText('멤버 접근', { exact: true }).count(), 0)
  assert.equal(memberRequests, 0)
  network = { state: 'blocked', reason: 'approval-required', error: 'Windows 승인창을 확인해 주세요.' }
  await page.getByRole('button', { name: '새로고침', exact: true }).click()
  await page.getByText('연결 준비 필요', { exact: true }).waitFor()
  await page.getByRole('alert').filter({ hasText: 'Windows 승인창' }).waitFor()
  await page.screenshot({ path: '/tmp/mew-remote-access-network-mobile.png' })
  await page.getByRole('button', { name: '연결 준비', exact: true }).click()
  await page.getByText('연결 준비 중', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '연결 준비', exact: true }).isDisabled(), true)
  assert.equal(preparations, 1)
  network = { state: 'ready', reason: 'wsl-udp-rule' }
  await page.getByRole('button', { name: '새로고침', exact: true }).click()
  await page.getByText('준비됨', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '연결 준비', exact: true }).count(), 0)
  await page.screenshot({ path: '/tmp/mew-remote-access-mobile.png' })
  addressError = true; await page.getByRole('button', { name: '새로고침', exact: true }).click()
  await page.getByText('접속 주소 확인 필요', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '주소 복사', exact: true }).count(), 0)
  await page.getByText('온라인', { exact: true }).waitFor()
  addressError = false; await page.getByRole('button', { name: '새로고침', exact: true }).click()
  await page.getByRole('link', { name: 'mew.run/alice/home', exact: true }).waitFor()
  for (const dark of [true, false]) {
    await page.locator('html').evaluate((el, dark) => el.classList.toggle('dark', dark), dark)
    for (const viewport of [900, 390]) {
      await page.setViewportSize({ width: viewport, height: 780 })
      const box = await page.getByRole('dialog').boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= viewport)
      await page.screenshot({ path: `/tmp/mewlink-polish-${dark ? 'dark' : 'light'}-${viewport}.png` })
    }
  }
  const width = await page.locator('#root').evaluate(el => ({ available: el.ownerDocument.documentElement.clientWidth, content: el.ownerDocument.documentElement.scrollWidth }))
  assert.ok(width.content <= width.available + 1)
  await page.getByRole('button', { name: '등록 해제', exact: true }).click()
  await page.getByRole('button', { name: '등록 해제', exact: true }).last().click()
  await page.getByText('등록 안 됨', { exact: true }).waitFor()
  assert.equal(removed, true)
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Mewlink', exact: true }).waitFor({ state: 'detached' })
})
