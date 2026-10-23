import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import express from 'express'
import { WebSocketServer } from 'ws'
import type { RemoteFrame } from '../shared/remote-access.ts'

test('anonymous P2P uses local password sessions and preserves the authentication boundary', { timeout: 30_000 }, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-remote-local-auth-'))
  process.env.MEW_DATA_DIR = path.join(temporary, 'data')
  const { remoteDispatcher } = await import('./remote-access-dispatch.ts')
  const { createRemoteUiRouter } = await import('./remote-ui.ts')
  const { createAuthRouter, checkOrigin } = await import('./authRoutes.ts')
  const { attachAuthContext, resolveAuth } = await import('./reqAuth.ts')
  const { getSession, getUser, upsertUser, removeUser, hashPassword, createSession, destroySession, isLoginBlocked, SESSION_TTL_MS } = await import('./auth.ts')
  const { setFileRule, accessRevision } = await import('./access-policy.ts')
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const password = 'local-secure-password-2026', otherPassword = 'different-secure-password-2026'
  for (const [email, role, mustChangePassword] of [['owner@example.test', 'owner', false], ['member@example.test', 'member', false], ['temporary@example.test', 'member', true]] as const) {
    upsertUser(email, { hash: hashPassword(password), role, mustChangePassword, createdAt: 1, passwordChangedAt: 0 })
  }
  const dist = path.join(temporary, 'dist')
  fs.mkdirSync(dist)
  fs.writeFileSync(path.join(dist, 'index.html'), '<head><meta name="mew-p2p-bootstrap" content="1"></head><body>login</body>')

  function harness(initial: string | null = null, clientIp = '198.51.100.25') {
    let token = initial, closed = false, requests = 0, upgrades = 0, sequence = 0
    const app = express(), server = http.createServer(app), frames: RemoteFrame[] = []
    app.use(checkOrigin)
    app.use('/api/auth', createAuthRouter())
    app.use('/api', attachAuthContext)
    app.use('/api/remote-ui', createRemoteUiRouter(dist))
    app.get('/api/file', (req, res) => { requests++; res.json({ account: resolveAuth(req).email, role: resolveAuth(req).role }) })
    app.get('/api/pending', (_req, res) => { requests++; res.write('private') })
    app.use((error: Error & { type?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => { if (error.type === 'request.aborted') { res.end(); return }; next(error) })
    const wss = new WebSocketServer({ noServer: true })
    server.on('upgrade', (req, socket, head) => { upgrades++; wss.handleUpgrade(req, socket, head, ws => ws.send(resolveAuth(req).email ?? 'guest')) })
    let dispatcher: ReturnType<typeof remoteDispatcher>
    dispatcher = remoteDispatcher(server, {
      send: async raw => {
        const frame = JSON.parse(raw) as RemoteFrame
        frames.push(frame)
        if (frame.type === 'response' || frame.type === 'chunk') setImmediate(() => { void dispatcher.receive(JSON.stringify({ type: 'credit', id: frame.id })) })
      },
      close: () => { closed = true },
    }, () => getSession(token), 'https://mew.saens.kr', { alive: () => !closed, sessionToken: () => token, setSessionToken: next => { token = next }, clientIp, accessRevision })
    const until = async (predicate: () => boolean) => {
      const deadline = performance.now() + 4000
      while (!predicate()) { if (performance.now() > deadline) throw new Error('P2P auth request timed out'); await new Promise(resolve => setTimeout(resolve, 5)) }
    }
    const request = async (url: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
      const id = String(++sequence)
      await dispatcher.receive(JSON.stringify({ type: 'request', id, method, path: url, headers: { 'content-type': 'application/json', ...headers } }))
      if (body !== undefined) await dispatcher.receive(JSON.stringify({ type: 'chunk', id, data: Buffer.from(JSON.stringify(body)).toString('base64') }))
      if (method !== 'GET' && method !== 'HEAD') await dispatcher.receive(JSON.stringify({ type: 'end', id }))
      await until(() => frames.some(frame => frame.id === id && frame.type === 'end'))
      const response = frames.find((frame): frame is Extract<RemoteFrame, { type: 'response' }> => frame.id === id && frame.type === 'response')!
      const text = Buffer.concat(frames.filter((frame): frame is Extract<RemoteFrame, { type: 'chunk' }> => frame.id === id && frame.type === 'chunk').map(frame => Buffer.from(frame.data, 'base64'))).toString()
      return { ...response, text, json: () => JSON.parse(text) }
    }
    t.after(() => { dispatcher.close(); wss.close(); server.closeAllConnections() })
    return { request, dispatcher, server, frames, until, token: () => token, closed: () => closed, requests: () => requests, upgrades: () => upgrades }
  }

  await t.test('only exact login bootstrap routes are reachable before local login, even with a valid forged cookie', async () => {
    const h = harness(), localToken = createSession('owner@example.test')
    const me = await h.request('/api/auth/me', 'GET', undefined, { cookie: `mew_session=${localToken}`, 'x-mew-session': localToken, 'x-role': 'owner' })
    assert.equal(me.json().authenticated, false)
    assert.equal(me.headers['x-mew-session'], '')
    assert.ok(Object.values(me.json().capabilities).every(value => value === false))
    assert.equal((await h.request('/api/remote-ui/file?path=/index.html')).status, 200)
    for (const url of ['/api/file', '/api/auth/profile', '/api/remote-ui/anything', '/api/remote-ui/file/']) assert.equal((await h.request(url)).status, 401, url)
    assert.equal((await h.request('/api/remote-ui/file?path=/index.html', 'POST')).status, 401)
    await h.dispatcher.receive(JSON.stringify({ type: 'socket', id: 'anonymous-socket', path: '/api/presence' }))
    assert.equal(h.upgrades(), 0)
    assert.equal(h.requests(), 0, 'the guest file route was never called')
    assert.ok(h.frames.some(frame => frame.type === 'error' && frame.code === 'login-required'))
    assert.equal(h.closed(), false)
    destroySession(localToken)
  })

  await t.test('local login issues the existing hashed session, resumes on a new connection, and logout immediately closes old work', async () => {
    const h = harness()
    assert.equal((await h.request('/api/auth/login', 'POST', { email: 'owner@example.test', password: 'incorrect' })).status, 401)
    const login = await h.request('/api/auth/login', 'POST', { email: 'owner@example.test', password })
    assert.equal(login.status, 200)
    const token = login.headers['x-mew-session']
    assert.match(token, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(h.token(), token)
    assert.equal(login.headers['set-cookie'], undefined)
    assert.equal(getSession(token)?.email, 'owner@example.test')
    assert.equal(fs.readFileSync(path.join(process.env.MEW_DATA_DIR!, 'sessions.json'), 'utf8').includes(token), false)
    const resumed = harness(token)
    assert.equal((await resumed.request('/api/auth/me')).json().email, 'owner@example.test')
    assert.equal((await h.request('/api/file')).json().account, 'owner@example.test')
    await h.dispatcher.receive(JSON.stringify({ type: 'socket', id: 'owned-socket', path: '/api/presence' }))
    await h.until(() => h.frames.some(frame => frame.type === 'open' && frame.id === 'owned-socket'))
    await h.dispatcher.receive(JSON.stringify({ type: 'request', id: 'owned-pending', method: 'GET', path: '/api/pending', headers: {} }))
    await h.until(() => h.frames.some(frame => frame.type === 'chunk' && frame.id === 'owned-pending'))
    const logout = await h.request('/api/auth/logout', 'POST')
    assert.equal(logout.status, 200)
    assert.equal(logout.headers['x-mew-session'], '')
    assert.equal(getSession(token), null)
    for (const id of ['owned-socket', 'owned-pending']) assert.ok(h.frames.some(frame => frame.type === 'error' && frame.id === id && frame.code === 'permission-revoked'), id)
    assert.equal((await h.request('/api/file')).status, 401)
    assert.equal((await h.request('/api/auth/me')).json().authenticated, false)
    assert.equal((await resumed.request('/api/auth/me')).json().authenticated, false)
    assert.equal(h.closed(), false, 'logout preserves the login transport')
  })

  await t.test('temporary passwords can fetch the login UI and change password but cannot use work routes or sockets', async () => {
    const h = harness()
    const login = await h.request('/api/auth/login', 'POST', { email: 'temporary@example.test', password })
    assert.equal(login.status, 200)
    const previous = h.token()!
    assert.equal((await h.request('/api/auth/me')).json().mustChangePassword, true)
    assert.equal((await h.request('/api/remote-ui/file?path=/index.html')).status, 200)
    assert.equal((await h.request('/api/file')).status, 403)
    await h.dispatcher.receive(JSON.stringify({ type: 'socket', id: 'temporary-socket', path: '/api/presence' }))
    assert.equal(h.upgrades(), 0)
    const changed = await h.request('/api/auth/change-password', 'POST', { currentPassword: password, newPassword: otherPassword })
    assert.equal(changed.status, 200)
    assert.notEqual(changed.headers['x-mew-session'], previous)
    assert.equal(getSession(previous), null)
    assert.equal((await h.request('/api/auth/me')).json().mustChangePassword, false)
    assert.equal((await h.request('/api/file')).status, 200)
  })

  await t.test('logging in as another local account closes the previous account work before changing authority', async () => {
    const h = harness(createSession('owner@example.test'))
    await h.dispatcher.receive(JSON.stringify({ type: 'socket', id: 'previous-account', path: '/api/presence' }))
    await h.until(() => h.frames.some(frame => frame.type === 'open' && frame.id === 'previous-account'))
    const login = await h.request('/api/auth/login', 'POST', { email: 'member@example.test', password })
    assert.equal(login.status, 200)
    assert.ok(h.frames.some(frame => frame.type === 'error' && frame.id === 'previous-account' && frame.code === 'permission-revoked'))
    assert.equal((await h.request('/api/file')).json().account, 'member@example.test')
    assert.equal(h.closed(), false)
  })

  await t.test('delayed logout and password-change bodies cannot act on a newly logged-in account', async () => {
    const h = harness(createSession('owner@example.test'))
    const memberHash = getUser('member@example.test')!.hash
    for (const [id, url, body] of [
      ['delayed-logout', '/api/auth/logout', {}],
      ['delayed-password', '/api/auth/change-password', { currentPassword: password, newPassword: otherPassword }],
    ] as const) {
      await h.dispatcher.receive(JSON.stringify({ type: 'request', id, method: 'POST', path: url, headers: { 'content-type': 'application/json' } }))
      await h.dispatcher.receive(JSON.stringify({ type: 'chunk', id, data: Buffer.from(JSON.stringify(body)).toString('base64') }))
    }
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.frames.some(frame => frame.type === 'response' && frame.id.startsWith('delayed-')), false)
    const login = await h.request('/api/auth/login', 'POST', { email: 'member@example.test', password })
    assert.equal(login.status, 200, 'the login operation keeps its own response across its token transition')
    for (const id of ['delayed-logout', 'delayed-password']) {
      assert.ok(h.frames.some(frame => frame.type === 'error' && frame.id === id && frame.code === 'permission-revoked'))
      await h.dispatcher.receive(JSON.stringify({ type: 'end', id }))
    }
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(getSession(login.headers['x-mew-session'])?.email, 'member@example.test')
    assert.equal(getUser('member@example.test')!.hash, memberHash)
    assert.equal((await h.request('/api/auth/me')).json().email, 'member@example.test')
    assert.equal(h.closed(), false)
  })

  await t.test('an expired persisted local session closes work and returns to the anonymous login boundary', async subt => {
    const now = Date.now(), h = harness(createSession('member@example.test'))
    await h.dispatcher.receive(JSON.stringify({ type: 'socket', id: 'expired-session', path: '/api/presence' }))
    await h.until(() => h.frames.some(frame => frame.type === 'open' && frame.id === 'expired-session'))
    subt.mock.timers.enable({ apis: ['Date'], now: now + SESSION_TTL_MS + 1000 })
    h.dispatcher.revalidate()
    assert.ok(h.frames.some(frame => frame.type === 'error' && frame.id === 'expired-session' && frame.code === 'permission-revoked'))
    assert.equal((await h.request('/api/file')).status, 401)
    const me = await h.request('/api/auth/me')
    assert.equal(me.json().authenticated, false)
    assert.equal(me.headers['x-mew-session'], '')
    assert.equal(h.closed(), false)
  })

  await t.test('ordinary HTTP keeps HttpOnly cookies, origin validation, password rotation and logout without exposing P2P bearer headers', async () => {
    const h = harness()
    await new Promise<void>(resolve => h.server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise<void>(resolve => { h.server.closeAllConnections(); h.server.close(() => resolve()) }))
    const origin = `http://127.0.0.1:${(h.server.address() as { port: number }).port}`
    const post = (url: string, body: unknown, cookie?: string, requestOrigin = origin) => fetch(origin + url, { method: 'POST', headers: { 'content-type': 'application/json', origin: requestOrigin, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
    const credentials = { email: 'member@example.test', password }
    assert.equal((await post('/api/auth/login', credentials, undefined, 'https://evil.example')).status, 403)
    const login = await post('/api/auth/login', credentials)
    assert.equal(login.status, 200)
    assert.equal(login.headers.get('x-mew-session'), null)
    const setCookie = login.headers.get('set-cookie')!
    assert.match(setCookie, /HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000/)
    assert.equal(setCookie.includes('Secure'), false)
    const cookie = setCookie.split(';')[0], initialToken = cookie.split('=')[1]
    const initialStatus = await (await fetch(origin + '/api/auth/me', { headers: { cookie } })).json() as { email: string }
    assert.equal(initialStatus.email, 'member@example.test')
    const changed = await post('/api/auth/change-password', { currentPassword: password, newPassword: otherPassword }, cookie)
    assert.equal(changed.status, 200)
    assert.equal(changed.headers.get('x-mew-session'), null)
    assert.equal(getSession(initialToken), null)
    const changedCookie = changed.headers.get('set-cookie')!.split(';')[0], changedToken = changedCookie.split('=')[1]
    assert.equal(getSession(changedToken)?.email, 'member@example.test')
    const logout = await post('/api/auth/logout', {}, changedCookie)
    assert.equal(logout.status, 200)
    assert.match(logout.headers.get('set-cookie')!, /mew_session=; HttpOnly; SameSite=Lax; Path=\/; Max-Age=0/)
    assert.equal(logout.headers.get('x-mew-session'), null)
    assert.equal(getSession(changedToken), null)
    const finalStatus = await (await fetch(origin + '/api/auth/me', { headers: { cookie: changedCookie } })).json() as { authenticated: boolean }
    assert.equal(finalStatus.authenticated, false)
    const secureLogin = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-forwarded-proto': 'https' }, body: JSON.stringify({ email: 'member@example.test', password: otherPassword }) })
    assert.match(secureLogin.headers.get('set-cookie')!, /; Secure$/)
    assert.equal(secureLogin.headers.get('x-mew-session'), null)
    destroySession(secureLogin.headers.get('set-cookie')!.split(';')[0].split('=')[1])
  })

  await t.test('role and permission changes close old work, and password reset or deletion remove all local authority', async () => {
    const h = harness(createSession('owner@example.test'))
    const open = async (id: string) => { await h.dispatcher.receive(JSON.stringify({ type: 'socket', id, path: '/api/presence' })); await h.until(() => h.frames.some(frame => frame.type === 'open' && frame.id === id)) }
    await open('role-socket')
    upsertUser('owner@example.test', { ...getUser('owner@example.test')!, role: 'member' })
    h.dispatcher.revalidate()
    assert.ok(h.frames.some(frame => frame.type === 'error' && frame.id === 'role-socket' && frame.code === 'permission-revoked'))
    assert.equal((await h.request('/api/file')).json().role, 'member')
    await open('permission-socket')
    setFileRule('owner@example.test', 'docs', 'private.md', 'deny')
    h.dispatcher.revalidate()
    assert.ok(h.frames.some(frame => frame.type === 'error' && frame.id === 'permission-socket' && frame.code === 'permission-revoked'))
    await open('reset-socket')
    upsertUser('owner@example.test', { ...getUser('owner@example.test')!, passwordChangedAt: Date.now() + 1 })
    h.dispatcher.revalidate()
    assert.ok(h.frames.some(frame => frame.type === 'error' && frame.id === 'reset-socket' && frame.code === 'permission-revoked'))
    assert.equal((await h.request('/api/file')).status, 401)
    const deleted = harness(createSession('member@example.test'))
    await deleted.dispatcher.receive(JSON.stringify({ type: 'socket', id: 'deleted-socket', path: '/api/presence' }))
    await deleted.until(() => deleted.frames.some(frame => frame.type === 'open' && frame.id === 'deleted-socket'))
    removeUser('member@example.test')
    deleted.dispatcher.revalidate()
    assert.ok(deleted.frames.some(frame => frame.type === 'error' && frame.id === 'deleted-socket' && frame.code === 'permission-revoked'))
    assert.equal((await deleted.request('/api/auth/me')).json().authenticated, false)
    assert.equal((await deleted.request('/api/file')).status, 401)
  })

  await t.test('password attempt throttling uses the signed peer IP and cannot be bypassed by app headers or reconnecting', async () => {
    const h = harness(null, '203.0.113.80')
    for (let i = 0; i < 10; i++) {
      assert.equal((await h.request('/api/auth/login', 'POST', { email: 'temporary@example.test', password: 'incorrect' }, { 'cf-connecting-ip': `203.0.113.${i}`, 'x-forwarded-for': `203.0.113.${i}` })).status, 401)
    }
    assert.equal(isLoginBlocked('203.0.113.80', 'new@example.test'), true)
    assert.equal((await harness(null, '203.0.113.80').request('/api/auth/login', 'POST', { email: 'new@example.test', password: 'incorrect' })).status, 429)
    assert.equal((await harness(null, '203.0.113.81').request('/api/auth/login', 'POST', { email: 'temporary@example.test', password: 'incorrect' })).status, 429, 'email throttle also survives a changed peer IP')
  })
})
