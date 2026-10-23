import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import { once } from 'node:events'
import { gzipSync } from 'node:zlib'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from '../server/browser-dom-executable.ts'
import type { AuthStatus } from './api/auth.ts'
import { startupCodeSplitting } from '../server/startup-chunks.ts'
import type { CodeSplittingOptions, OutputChunk } from 'rolldown'

const appPath = new URL('./App.tsx', import.meta.url).pathname
const react = import.meta.resolve('react')
const guest: AuthStatus = { authenticated: false, email: null, role: 'guest', mustChangePassword: false, displayName: null, avatarDataUrl: null }
const owner: AuthStatus = { ...guest, authenticated: true, email: 'owner@test', role: 'owner' }

function startupBundle(codeSplitting?: CodeSplittingOptions) {
  return build({
    input: new URL('./main.tsx', import.meta.url).pathname, write: false, platform: 'browser',
    onwarn(warning, report) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE' || !warning.id?.includes('/iconoir-react/')) report(warning) },
    output: { format: 'esm', codeSplitting }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'import.meta.hot': 'false' } },
    plugins: [{ name: 'startup-fixture', resolveId(id) { if (id.endsWith('.css')) return 'virtual:style' }, load(id) {
      if (id === 'virtual:style') return ''
      if (id === appPath) return `import React from ${JSON.stringify(react)};
        window.workspaceLoads = (window.workspaceLoads || 0) + 1;
        export default function Workspace({auth,onLoggedOut,onRequestLogin}) {
          return <section data-workspace-role={auth.role}><button onClick={onRequestLogin}>Login</button><button onClick={onLoggedOut}>Logout</button></section>
        }`
    } }],
  })
}

function staticChunks(chunks: OutputChunk[], entry: OutputChunk) {
  const files = new Set<string>()
  const visit = (chunk: OutputChunk) => {
    if (files.has(chunk.fileName)) return
    files.add(chunk.fileName)
    for (const name of chunk.imports) {
      const imported = chunks.find(item => item.fileName === name)
      assert.ok(imported, `missing static dependency ${name}`)
      visit(imported)
    }
  }
  visit(entry)
  return files
}

test('startup groups reduce requests while keeping workspace imports behind authentication', async () => {
  const bundles = [await startupBundle(), await startupBundle(startupCodeSplitting)]
  const counts = bundles.map(bundle => {
    const chunks = bundle.output.filter(item => item.type === 'chunk')
    const entry = chunks.find(item => item.isEntry)!
    const bootstrap = chunks.find(item => new URL('./AppBootstrap.tsx', import.meta.url).pathname in item.modules)!
    const initial = staticChunks(chunks, entry)
    const login = new Set([...initial, ...staticChunks(chunks, bootstrap)])
    const workspace = chunks.find(item => appPath in item.modules)!
    assert.equal(login.has(workspace.fileName), false, 'workspace code remains outside the login dependency graph')
    const gzip = (files: Set<string>) => [...files].reduce((bytes, name) => bytes + gzipSync(chunks.find(chunk => chunk.fileName === name)!.code).byteLength, 0)
    return { initial: initial.size, login: login.size, initialGzip: gzip(initial), loginGzip: gzip(login) }
  })
  assert.ok(counts[1].initial < counts[0].initial, `initial requests: ${JSON.stringify(counts)}`)
  assert.ok(counts[1].login < counts[0].login, `login requests: ${JSON.stringify(counts)}`)
  console.log('Startup fixture JS requests:', JSON.stringify({ before: counts[0], after: counts[1] }))
})

test('cold startup preserves deferred workspace loading, remote authentication and local guest entry', { skip: !domBrowserExecutable(), timeout: 25_000 }, async t => {
  const bundle = await startupBundle(startupCodeSplitting)
  const chunks = bundle.output.filter(item => item.type === 'chunk')
  const eagerWorkspaceModules = chunks.flatMap(item => Object.keys(item.modules)).filter(id => /\/src\/api\/client\.ts$|\/packages\/tmux-term\/|\/node_modules\/(?:@xterm|@codemirror|@tiptap)\//.test(id))
  assert.deepEqual(eagerWorkspaceModules, [], 'authentication code has no editor or terminal module side effects')
  const entry = chunks.find(item => item.isEntry)!
  const workspaceChunk = chunks.find(item => appPath in item.modules)!
  const bootstrapChunk = chunks.find(item => new URL('./AppBootstrap.tsx', import.meta.url).pathname in item.modules)!
  assert.ok(staticChunks(chunks, bootstrapChunk).has(entry.fileName), 'fixture exercises authentication importing shared startup exports without blocking entry evaluation')
  const scripts = new Map(chunks.map(item => [`/${item.fileName}`, item.code]))
  let auth = guest, failAuth = false, authRequests = 0, holdAuth = false, supplyAuth = false
  let releaseAuth: (() => void) | undefined
  let onAuthPending!: () => void
  const authPending = new Promise<void>(resolve => { onAuthPending = resolve })
  const shell = `<html><body><div id="root"></div><script type="module" src="/${entry.fileName}"></script></body></html>`
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url!, 'http://fixture').pathname
    if (scripts.has(pathname)) { res.setHeader('Content-Type', 'text/javascript'); res.end(scripts.get(pathname)); return }
    if (pathname === '/api/auth/me') {
      authRequests++
      res.setHeader('Content-Type', 'application/json')
      res.statusCode = failAuth ? 500 : 200
      const respond = () => res.end(JSON.stringify(failAuth ? { error: 'unavailable' } : auth))
      if (holdAuth) { releaseAuth = respond; onAuthPending() }
      else respond()
      return
    }
    res.setHeader('Content-Type', 'text/html')
    if (pathname.startsWith('/__mew_ui/')) { res.end(shell.replace('<body>', '<meta name="mew-p2p-app"><body>')); return }
    if (pathname === '/remote') {
      res.end(`<html><body><iframe src="/__mew_ui/abcdefghijklmnopqrstuvwxyz/index.html"></iframe><script>
        window.authRequests = 0; window.reloadRequests = 0; window.remoteAuth = ${JSON.stringify(auth)}; window.holdAuth = ${holdAuth};
        addEventListener('message', event => {
          if(event.data?.type !== 'mew-app-ready') return;
          const port = event.ports[0];
          port.onmessage = ({data}) => {
            if(data?.type === 'mew-app-reload') { window.reloadRequests++; return }
            if(typeof data !== 'string') return;
            const request = JSON.parse(data);
            if(request.type !== 'request') return;
            let result = {};
            if(request.path === '/api/auth/me') { window.authRequests++; result = window.remoteAuth }
            if(request.path === '/api/auth/mewlink') result = {state:'none',identity:null};
            if(request.path === '/api/auth/login') { window.remoteAuth=${JSON.stringify(owner)}; result={ok:true,mustChangePassword:false} }
            const respond = () => {
              port.postMessage(JSON.stringify({type:'response',id:request.id,status:200,headers:{'content-type':'application/json'},responseWindow:1}));
              port.postMessage(JSON.stringify({type:'chunk',id:request.id,data:btoa(JSON.stringify(result))}));
              port.postMessage(JSON.stringify({type:'end',id:request.id}));
            };
            if(request.path === '/api/auth/me' && window.holdAuth) window.releaseAuth = respond;
            else respond();
          };
          port.postMessage({type:'mew-app-context',instance:'fixture-instance',${supplyAuth ? `initialAuth:${JSON.stringify(auth)}` : ''}});
        });
      </script></body></html>`); return
    }
    res.end(shell)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const page = await browser.newPage({ locale: 'ko-KR' })
  page.setDefaultTimeout(4000)
  const requests: string[] = [], errors: string[] = []
  page.on('request', request => requests.push(new URL(request.url()).pathname))
  page.on('pageerror', error => errors.push(error.message))
  const requested = (chunk: typeof workspaceChunk) => requests.includes(`/${chunk.fileName}`)
  const reset = () => { requests.length = 0; authRequests = 0 }

  holdAuth = true
  await page.goto(origin, { waitUntil: 'commit' })
  await page.locator('[data-startup-screen]').waitFor()
  assert.equal(requested(workspaceChunk), false, 'local authentication delay still paints the startup screen')
  await authPending
  assert.ok(releaseAuth)
  releaseAuth!()
  await page.locator('[data-workspace-role="guest"]').waitFor()

  reset()
  await page.goto(`${origin}/remote`, { waitUntil: 'commit' })
  const frame = page.frameLocator('iframe')
  await frame.locator('[data-startup-screen]').waitFor()
  assert.equal(requested(workspaceChunk), false, 'remote bridge authentication does not block the first screen')
  await page.waitForFunction('typeof window.releaseAuth === "function"')
  await page.evaluate('window.releaseAuth()')
  await frame.getByRole('dialog').waitFor()
  holdAuth = false
  reset()
  await page.goto(`${origin}/remote`)
  await frame.getByRole('dialog').waitFor()
  assert.equal(requested(workspaceChunk), false, 'unauthenticated remote entry renders login without downloading the workspace')
  assert.equal(await page.evaluate('window.authRequests'), 1, 'scope initialization supplies the first auth result without a second round trip')
  assert.equal(await frame.getByRole('button', { name: '닫기', exact: true }).count(), 0)
  await frame.getByPlaceholder('이메일').fill('owner@test')
  await frame.getByPlaceholder('비밀번호', { exact: true }).fill('test-password')
  await frame.getByRole('button', { name: '로그인', exact: true }).click()
  await page.waitForFunction('window.reloadRequests === 1')
  assert.equal(requested(workspaceChunk), false, 'identity changes restart the app before workspace state is used')

  reset(); auth = { ...owner, mustChangePassword: true }
  await page.goto(`${origin}/remote`)
  await frame.getByPlaceholder('현재 비밀번호').waitFor()
  assert.equal(requested(workspaceChunk), false, 'temporary password entry does not fetch workspace modules')
  assert.equal(await page.evaluate('window.authRequests'), 1)

  reset(); auth = owner
  await page.goto(`${origin}/remote`)
  await frame.locator('[data-workspace-role="owner"]').waitFor()
  assert.equal(requested(workspaceChunk), true)
  assert.equal(await page.evaluate('window.authRequests'), 1)
  await page.evaluate('window.remoteAuth = ' + JSON.stringify(guest))
  await frame.locator('[data-workspace-role]').evaluate(el => el.ownerDocument.defaultView!.dispatchEvent(new Event('mew:permissions-changed')))
  await page.waitForFunction('window.reloadRequests === 1')

  reset(); supplyAuth = true; auth = owner
  await page.goto(`${origin}/remote`)
  await frame.locator('[data-workspace-role="owner"]').waitFor()
  assert.equal(await page.evaluate('window.authRequests'), 0, 'the live launcher authentication result avoids a second P2P lookup')
  supplyAuth = false

  reset(); auth = guest
  await page.goto(origin)
  await page.locator('[data-workspace-role="guest"]').waitFor()
  assert.equal(requested(workspaceChunk), true, 'ordinary local guest access still opens the workspace')
  assert.equal(authRequests, 1)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })

  reset(); failAuth = true
  await page.goto(origin)
  await page.locator('[data-workspace-role="guest"]').waitFor()
  assert.equal(authRequests, 1, 'local auth lookup failure preserves the guest fallback')
  failAuth = false

  assert.deepEqual(errors, [])
})
