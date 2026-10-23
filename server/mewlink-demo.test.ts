import test from 'node:test'
import assert from 'node:assert/strict'
import { assertDemoUsernameAvailable, handleMewlinkDemo } from '../shared/mewlink-demo.ts'

const central = 'https://mew.run', app = 'https://app.mew.run'
function fixture(missing = false) {
  const requested: string[] = []
  return {
    requested,
    env: {
      CENTRAL_ORIGIN: central, APP_ORIGIN: app,
      ASSETS: {
        async fetch(request: Request) {
          requested.push(new URL(request.url).pathname)
          if (missing) return new Response(null, { status: 404 })
          return new Response(request.method === 'HEAD' ? null : new URL(request.url).pathname === '/demo/' ? '<html>demo</html>' : 'fixture asset', { headers: { 'Content-Type': new URL(request.url).pathname.endsWith('.js') ? 'text/javascript' : 'text/html' } })
        },
      },
    },
  }
}

test('public demo shell opens the application origin without reading a central account or cookies', async () => {
  const { env, requested } = fixture()
  for (const method of ['GET', 'HEAD']) {
    const response = await handleMewlinkDemo(new Request(`${central}/demo`, { method }), env)
    assert.equal(response?.status, 200)
    assert.equal(response.headers.get('Set-Cookie'), null)
    assert.match(response.headers.get('Content-Type')!, /text\/html/)
    assert.match(response.headers.get('Content-Security-Policy')!, /frame-src https:\/\/app\.mew\.run;/)
    assert.match(response.headers.get('Content-Security-Policy')!, /frame-ancestors 'none'/)
    const body = await response.text()
    if (method === 'HEAD') assert.equal(body, '')
    else assert.match(body, /<iframe src="https:\/\/app\.mew\.run\/demo\/"/)
  }
  assert.deepEqual(requested, [])
})

test('demo entry and static fetches remain under the application origin demo directory', async () => {
  const { env, requested } = fixture()
  const routes = ['/demo/', '/demo/assets/main.js', '/demo/fonts/inter.woff2', '/demo/mewcat/capybara/skin.json', ...['json', 'bin', 'svg', 'pdf', 'mp3', 'ogg', 'wav', 'bmp'].map(extension => `/demo/repository/${'a'.repeat(64)}.${extension}`)]
  for (const route of routes) {
    const response = await handleMewlinkDemo(new Request(app + route), env)
    assert.equal(response?.status, 200)
    assert.equal(response.headers.get('Cache-Control'), 'no-store, no-transform')
    assert.match(response.headers.get('Content-Security-Policy')!, /connect-src https:\/\/app\.mew\.run\/demo\/;/)
    assert.doesNotMatch(response.headers.get('Content-Security-Policy')!, /connect-src 'self'/)
    assert.match(response.headers.get('Content-Security-Policy')!, /frame-ancestors https:\/\/mew\.run/)
    assert.match(response.headers.get('Content-Security-Policy')!, /frame-src blob:;/)
  }
  assert.deepEqual(requested, routes)
  const head = await handleMewlinkDemo(new Request(app + '/demo/', { method: 'HEAD' }), env)
  assert.equal(await head!.text(), '')
})

test('demo routing neither exposes APIs or arbitrary HTML nor intercepts live app paths', async () => {
  const { env, requested } = fixture()
  for (const pathname of ['/demo/assets/main.js', '/demo/home']) assert.equal((await handleMewlinkDemo(new Request(central + pathname), env))?.status, 404)
  for (const pathname of ['/demo/api', '/demo/other.html', '/demo/.secret.json', '/demo/assets/%2Fhidden.js', '/demo/assets/x%5Csecret.js', '/demo/assets/x%252ejs']) {
    assert.equal((await handleMewlinkDemo(new Request(app + pathname), env))?.status, 404, pathname)
  }
  for (const pathname of ['/launch/token', '/__mew_ui/token/index.html', '/api/auth/me', '/central/account', '/demo-user']) {
    assert.equal(await handleMewlinkDemo(new Request(app + pathname), env), null)
  }
  assert.equal(await handleMewlinkDemo(new Request('https://other.example/demo'), env), null)
  assert.equal((await handleMewlinkDemo(new Request(app + '/demo/', { method: 'POST' }), env))?.status, 405)
  assert.deepEqual(requested, [])
})

test('canonical demo URLs avoid asset HTML normalization loops and missing builds fail closed', async () => {
  const { env } = fixture()
  const centralRedirect = await handleMewlinkDemo(new Request(central + '/demo/?test=1'), env)
  assert.equal(centralRedirect?.status, 308)
  assert.equal(centralRedirect.headers.get('Location'), central + '/demo?test=1')
  const appRedirect = await handleMewlinkDemo(new Request(app + '/demo?test=1'), env)
  assert.equal(appRedirect?.status, 308)
  assert.equal(appRedirect.headers.get('Location'), app + '/demo/?test=1')
  const missing = fixture(true)
  assert.equal((await handleMewlinkDemo(new Request(app + '/demo/'), missing.env))?.status, 503)
  assert.equal((await handleMewlinkDemo(new Request(app + '/demo/assets/missing.js'), missing.env))?.status, 404)
})

test('deployment refuses existing demo usernames and aliases without changing the account', () => {
  assert.doesNotThrow(() => assertDemoUsernameAvailable([{ results: [], success: true }]))
  assert.throws(() => assertDemoUsernameAvailable([{ results: [{ account: 'existing-owner' }], success: true }]), /기존 계정을 변경하지 않고/)
  for (const value of [null, [], [{}], [{ results: [], success: false }]]) assert.throws(() => assertDemoUsernameAvailable(value), /조회 결과/)
})
