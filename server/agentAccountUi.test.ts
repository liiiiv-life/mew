import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import http from 'node:http'
import express from 'express'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { createDomBrowserRoutes, attachDomBrowserWebSocket, closeDomBrowsers, domBrowserExecutable } from './browser-dom.ts'
import { DATA_DIR } from './dataDir.ts'

test('account UI shows quota/account, opens and closes a real internal DOM page, and refreshes without sending a prompt', { skip: !domBrowserExecutable(), timeout: 45_000 }, async (t) => {
  const account = `account-ui-${crypto.randomUUID()}@example.test`
  const auth = { role: 'owner' as const, email: account, mustChangePassword: false }
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.auth = auth; next() })
  app.use('/api/browser-dom', createDomBrowserRoutes())
  const requests: string[] = []
  let origin = '', reads = 0
  app.get('/api/agent-runtimes/kimi/account', (_req, res) => {
    reads++
    res.json({ account: { runtime: 'kimi', account: 'long-account-name-for-mobile-layout@example.test', plan: reads > 1 ? 'pro' : 'free', authentication: 'connected', subscription: reads > 1 ? 'paid' : 'free', issue: reads > 1 ? null : 'quota_exhausted', subscriptionUrl: `${origin}/billing`, checkedAt: new Date().toISOString(), note: null } })
  })
  app.get('/billing', (_req, res) => res.type('html').send('<html><body><h1>Subscription fixture</h1><button onclick="document.querySelector(\'h1\').textContent=\'Plan selected\'">Choose plan</button></body></html>'))
  const bundle = await build({
    input: 'virtual:account', output: { format: 'esm' }, platform: 'browser', write: false,
    transform: { define: { 'process.env.NODE_ENV': JSON.stringify('test') }, jsx: 'react-jsx' },
    plugins: [{ name: 'account-fixture', resolveId(id) { if (id === 'virtual:account') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) {
      if (id === 'virtual:style') return ''
      if (id === 'virtual:account') return `import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {I18nProvider} from ${JSON.stringify(new URL('../src/i18n.tsx', import.meta.url).pathname)};
import {AgentAccountCard} from ${JSON.stringify(new URL('../src/components/AgentAccountCard.tsx', import.meta.url).pathname)};
createRoot(document.getElementById('root')).render(React.createElement(I18nProvider,null,React.createElement(AgentAccountCard,{runtime:'kimi'})));`
    } }],
  })
  const code = bundle.output.find((item) => item.type === 'chunk')!
  app.get('/app.js', (_req, res) => res.type('js').send(code.type === 'chunk' ? code.code : ''))
  // Use the existing app stylesheet for the optional local visual inspection.
  let css = ''
  const assets = new URL('../dist/assets/', import.meta.url)
  try { const file = (await fs.readdir(assets)).find((name) => name.endsWith('.css')); if (file) css = await fs.readFile(new URL(file, assets), 'utf8') } catch { /* behavioral test needs no production build */ }
  app.get('/style.css', (_req, res) => res.type('css').send(css))
  app.get('/', (_req, res) => res.type('html').send('<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'))
  const server = http.createServer(app)
  attachDomBrowserWebSocket(server, () => auth)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(async () => {
    await browser.close(); await closeDomBrowsers()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await fs.rm(path.join(DATA_DIR, 'browser/profiles', crypto.createHash('sha256').update(account).digest('hex')), { recursive: true, force: true })
  })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (req) => { if (req.method() === 'POST') requests.push(req.url()) })
  await page.addInitScript(() => localStorage.setItem('mew:locale', 'ko'))
  await page.goto(origin)
  await page.getByText('long-account-name-for-mobile-layout@example.test', { exact: true }).waitFor()
  assert.equal(await page.getByText('사용량 한도를 모두 사용했습니다', { exact: true }).isVisible(), true)
  assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
  if (process.env.MEW_ACCOUNT_UI_SCREENSHOTS === '1') {
    await page.screenshot({ path: path.join(os.tmpdir(), 'mew-account-mobile.png') })
    await page.setViewportSize({ width: 1100, height: 800 })
    await page.screenshot({ path: path.join(os.tmpdir(), 'mew-account-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
  }
  await page.getByRole('button', { name: '구독하기', exact: true }).click()
  const dom = page.frameLocator('.mew-dom-browser > .replayer-wrapper > iframe')
  await dom.getByRole('heading', { name: 'Subscription fixture' }).waitFor()
  await dom.getByRole('button', { name: 'Choose plan' }).click()
  await dom.getByRole('heading', { name: 'Plan selected' }).waitFor()
  assert.equal(page.context().pages().length, 1, 'no external browser tab')
  await page.getByRole('button', { name: '채팅으로 돌아가기' }).click()
  await page.getByText('플랜: pro · 구독 중', { exact: true }).waitFor({ state: 'attached' })
  assert.equal(reads, 2)
  assert.equal(requests.every((url) => url === `${origin}/api/browser-dom/tabs`), true, 'only the internal browser was opened; no payment/prompt request')
  assert.deepEqual(errors, [])
})
