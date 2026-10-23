import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import express from 'express'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { WebSocketServer } from 'ws'

test('account UI shows quota/account, opens and closes the isolated sign-in video viewer, and refreshes without sending a prompt', { skip: !domBrowserExecutable(), timeout: 45_000 }, async (t) => {
  const app = express()
  app.use(express.json())
  let closed = false
  app.post('/api/login-desktop', (req, res) => res.json({ id: 'fixture', job: 'fixture', url: req.body.url, streamUrl: '/api/login-desktop/ws?session=fixture' }))
  app.delete('/api/login-desktop/fixture', (_req, res) => { closed = true; res.json({ ok: true }) })
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
  const video = new WebSocketServer({ server, path: '/api/login-desktop/ws' })
  video.on('connection', socket => socket.once('message', () => { socket.send(JSON.stringify({ type: 'ready', width: 640, height: 480 })); socket.send(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'), { binary: true }) }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(async () => {
    await browser.close(); video.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
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
  await page.locator('[data-login-desktop] img').waitFor()
  await page.locator('[data-login-desktop] img').evaluate(async el => { for (let i = 0; i < 100 && !el.getAttribute('src')?.startsWith('blob:'); ++i) await new Promise(resolve => setTimeout(resolve, 20)); if (!el.getAttribute('src')?.startsWith('blob:')) throw new Error('No sign-in video frame') })
  assert.equal(page.context().pages().length, 1, 'no external browser tab')
  await page.getByRole('button', { name: '채팅으로 돌아가기' }).click()
  await page.getByText('플랜: pro · 구독 중', { exact: true }).waitFor({ state: 'attached' })
  assert.equal(reads, 2)
  await page.waitForTimeout(100)
  assert.equal(closed, true)
  assert.equal(requests.every((url) => url === `${origin}/api/login-desktop`), true, 'only the sign-in video session was opened; no payment/prompt request')
  assert.deepEqual(errors, [])
})
