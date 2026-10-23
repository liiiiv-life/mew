import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import express from 'express'
import { WebSocket } from 'ws'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { createApiApp } from './api.ts'
import { attachAuthContext, resolveAuth } from './reqAuth.ts'
import { createSession, destroySession, upsertUser } from './auth.ts'
import { attachPresenceWebSocket, broadcast } from './presence.ts'
import { readAccountTheme, writeAccountTheme } from './userUiState.ts'
import { DATA_DIR, readJsonRecord } from './dataDir.ts'
import { THEME_PRESETS, type ThemeSettings } from '../shared/theme.ts'

const theme = (index: number): ThemeSettings => ({ palette: THEME_PRESETS[index].palette, custom: [] })

test('account themes persist and synchronize across authenticated devices', { timeout: 90_000 }, async t => {
  const app = express(), server = http.createServer(app), sockets: WebSocket[] = []
  const email = 'themes@example.invalid', otherEmail = 'other-themes@example.invalid'
  const token = (account: string, role: 'owner' | 'member' = 'member') => {
    upsertUser(account, { hash: '', role, mustChangePassword: false, createdAt: Date.now(), passwordChangedAt: 0 })
    return createSession(account)
  }
  const tokens = [token(email), token(email), token(otherEmail, 'owner')]
  let fixture = ''
  app.get('/fixture.js', (_req, res) => res.type('js').send(fixture))
  app.get('/fixture', (_req, res) => res.type('html').send('<!doctype html><html><meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script></html>'))
  app.use('/api', attachAuthContext, createApiApp())
  attachPresenceWebSocket(server, { getAuth: resolveAuth })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const request = (session: string | undefined, body?: unknown) => fetch(`${origin}/api/user-ui/theme`, {
    method: body === undefined ? 'GET' : 'PUT',
    headers: { ...(session ? { Cookie: `mew_session=${session}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  async function connect(session?: string) {
    const ws = new WebSocket(`${origin.replace('http', 'ws')}/api/presence`, { headers: session ? { Cookie: `mew_session=${session}` } : {} })
    const messages: { type: string }[] = []
    ws.on('message', data => messages.push(JSON.parse(data.toString())))
    sockets.push(ws); await once(ws, 'open')
    return { ws, messages }
  }
  try {
    await t.test('authenticated account identity owns persistence, migration and notifications', async () => {
      assert.equal((await request(undefined)).status, 403)
      assert.equal((await request(undefined, { state: theme(1) })).status, 403)
      assert.deepEqual(await (await request(tokens[0])).json(), { state: null })
      const clients = await Promise.all([connect(tokens[0]), connect(tokens[1]), connect(tokens[2]), connect()])
      clients.forEach(client => { client.messages.length = 0 })
      const saved = { palette: { background: '#ABCDEF', text: '#123456', primary: '#654321', gradient: { colors: ['#ABCDEF', '#FEDCBA'], angle: 450, animated: true } }, custom: [] }
      const result = await request(tokens[1], { state: saved, email: otherEmail })
      assert.equal(result.status, 200)
      const expected = { palette: { ...saved.palette, background: '#abcdef', gradient: { colors: ['#abcdef', '#fedcba'], angle: 90, animated: true } }, custom: [] as unknown[] }
      expected.custom = [expected.palette]
      assert.deepEqual(await result.json(), { state: expected })
      assert.deepEqual(await (await request(tokens[0])).json(), { state: expected })
      assert.deepEqual(await (await request(tokens[2])).json(), { state: null })
      broadcast({ type: 'theme-test-marker' })
      for (let attempt = 0; attempt < 100 && !clients.every(client => client.messages.some(message => message.type === 'theme-test-marker')); attempt++) await new Promise(resolve => setTimeout(resolve, 10))
      assert.deepEqual(clients.map(client => client.messages.filter(message => message.type === 'theme').length), [1, 1, 0, 0])
      assert.deepEqual(await (await request(tokens[0], { state: theme(0), initialize: true })).json(), { state: expected }, 'stale first-load migration cannot overwrite another device')
      assert.equal((await request(tokens[0], { state: { palette: { background: 'bad' }, custom: [] } })).status, 400)
      assert.equal((await request(tokens[0], { state: { ...theme(0), custom: ['x'.repeat(70_000)] } })).status, 400)
      assert.deepEqual(readAccountTheme(email), expected, 'invalid requests preserve the saved theme')
      const persisted = readJsonRecord<{ theme: ThemeSettings }>(`${DATA_DIR}/user-ui-state.json`)
      assert.deepEqual(persisted?.[email].theme, expected)
      destroySession(tokens[1])
      assert.equal((await request(tokens[1])).status, 403)
      clients.forEach(client => client.ws.terminate())
    })

    await t.test('two independent browsers share choices and custom themes, recover missed signals and isolate accounts', { skip: !domBrowserExecutable() }, async () => {
      writeAccountTheme(email, theme(0))
      writeAccountTheme(otherEmail, theme(4))
      const root = new URL('../', import.meta.url).pathname
      const source = `import React from '${root}node_modules/react/index.js';
import {createRoot} from '${root}node_modules/react-dom/client.js';
import {useAccountTheme} from '${root}src/hooks/use-account-theme.ts';
import {usePresence} from '${root}src/hooks/usePresence.ts';
import {THEME_PRESETS} from '${root}shared/theme.ts';
const account=new URL(location.href).searchParams.get('account');
if(new URL(location.href).searchParams.has('blocked'))Object.defineProperty(window,'localStorage',{get(){throw new Error('storage disabled')}});
function Fixture(){const [settings,change]=useAccountTheme(account,error=>{window.fixtureError=String(error)});
const presence=usePresence('.workspace',null,account,()=>{});
return <><output id="settings" data-background={settings.palette.background}>{JSON.stringify(settings)}</output><output id="connected">{String(!!presence.activeSessions)}</output>
{THEME_PRESETS.map(p=><button key={p.id} onClick={()=>change({...settings,palette:p.palette})}>{p.id}</button>)}
<button onClick={()=>change({palette:{background:'#182532',text:'#f1f2f3',primary:'#cc7744',gradient:{colors:['#234567','#432156'],angle:45,animated:false}},custom:[]})}>custom</button></>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
      const bundle = await build({ input: 'virtual:account-theme.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:account-theme.tsx') return id }, load(id) { if (id === 'virtual:account-theme.tsx') return source } }] })
      const chunk = bundle.output.find(item => item.type === 'chunk'); assert.ok(chunk); fixture = chunk.code
      const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
      const errors: string[] = []
      try {
        const contexts = await Promise.all([browser.newContext(), browser.newContext({ viewport: { width: 390, height: 844 } }), browser.newContext()])
        const browserTokens = [tokens[0], createSession(email), tokens[2]]
        for (const [index, context] of contexts.entries()) {
          await context.addCookies([{ name: 'mew_session', value: browserTokens[index], url: origin }])
          await context.addInitScript(() => { localStorage.setItem('mew:themes', JSON.stringify({ palette: { background: '#ffffff', text: '#262626', primary: '#5642c7' }, custom: [] })) })
        }
        const pages = await Promise.all(contexts.map(context => context.newPage()))
        pages.forEach(page => { page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message)) })
        const [a, b, other] = pages
        await Promise.all(pages.map((page, index) => page.goto(`${origin}/fixture?account=${encodeURIComponent(index === 2 ? otherEmail : email)}${index === 2 ? '&blocked=1' : ''}`)))
        const waitPalette = (page: typeof a, color: string) => page.locator(`#settings[data-background="${color}"]`).waitFor()
        await Promise.all([waitPalette(a, theme(0).palette.background), waitPalette(b, theme(0).palette.background), waitPalette(other, theme(4).palette.background)])
        await a.getByText('true', { exact: true }).waitFor()
        await b.getByRole('button', { name: 'ocean', exact: true }).click()
        await Promise.all([waitPalette(a, theme(6).palette.background), waitPalette(b, theme(6).palette.background)])
        assert.equal(readAccountTheme(email)?.palette.background, theme(6).palette.background)
        await b.getByRole('button', { name: 'custom', exact: true }).click()
        await waitPalette(a, '#182532')
        const custom = JSON.parse((await a.locator('#settings').textContent())!) as ThemeSettings
        assert.equal(custom.custom.length, 1)
        assert.equal(custom.palette.gradient?.animated, false)
        assert.deepEqual(custom, readAccountTheme(email))
        await a.reload(); await waitPalette(a, '#182532')
        assert.equal(readAccountTheme(otherEmail)?.palette.background, theme(4).palette.background)
        await contexts[0].setOffline(true)
        await b.getByRole('button', { name: 'forest', exact: true }).click()
        await waitPalette(b, theme(3).palette.background)
        await contexts[0].setOffline(false)
        await waitPalette(a, theme(3).palette.background)
        // A background/bfcache return also reconciles a persisted change with no broadcast.
        writeAccountTheme(email, theme(5))
        await a.locator('#settings').evaluate(el => el.ownerDocument.dispatchEvent(new Event('visibilitychange')))
        await waitPalette(a, theme(5).palette.background)
        writeAccountTheme(email, theme(1))
        await a.locator('#settings').evaluate(el => { const view = el.ownerDocument.defaultView!; view.dispatchEvent(new view.PageTransitionEvent('pageshow', { persisted: true })) })
        await waitPalette(a, theme(1).palette.background)
        await contexts[0].addCookies([{ name: 'mew_session', value: tokens[2], url: origin }])
        await a.goto(`${origin}/fixture?account=${encodeURIComponent(otherEmail)}`)
        await waitPalette(a, theme(4).palette.background)
        assert.deepEqual(errors, [])
        assert.equal(await a.evaluate('window.fixtureError'), undefined)
        assert.equal(await b.evaluate('window.fixtureError'), undefined)
      } finally { await browser.close() }
    })
  } finally {
    sockets.forEach(ws => ws.terminate())
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
