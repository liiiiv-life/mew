import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { createGzip } from 'node:zlib'
import express from 'express'
import { build } from 'rolldown'
import { chromium, type Page } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { createRemoteUiRouter } from './remote-ui.ts'
import { remoteDispatcher } from './remote-access-dispatch.ts'
import type { AuthenticatedSession } from './auth.ts'
import type { RemoteFrame } from '../shared/remote-access.ts'

test('resource worker streams gzip UI and preserves raw peers, dynamic imports, worker scripts and cancellation', { skip: !domBrowserExecutable(), timeout: 20_000 }, async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-ui-resource-')), dist = path.join(temporary, 'dist')
  await fs.mkdir(path.join(dist, 'assets'), { recursive: true })
  t.after(() => fs.rm(temporary, { recursive: true, force: true }))
  const script = `import('./lazy.js').then(async({value})=>{const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});const message=await new Promise(resolve=>worker.onmessage=e=>resolve(e.data));worker.terminate();document.querySelector('#result').textContent=value+' '+message});\n/*${'static module payload '.repeat(12_000)}*/`
  await fs.writeFile(path.join(dist, 'assets/app.js'), script)
  await fs.writeFile(path.join(dist, 'assets/lazy.js'), 'export const value="dynamic module"')
  await fs.writeFile(path.join(dist, 'assets/worker.js'), "import {value} from './lazy.js';postMessage('worker '+value)")
  await fs.writeFile(path.join(dist, 'assets/app.css'), '#result { color: rgb(0, 128, 0); }')
  await fs.writeFile(path.join(dist, 'index.html'), '<html><head><meta name="mew-p2p-bootstrap" content="1"><link rel="stylesheet" href="./assets/app.css"></head><body><p id="result">Loading</p><script type="module" src="./assets/app.js"></script></body></html>')
  const bundle = await build({ input: 'virtual:resources', write: false, platform: 'browser', output: { format: 'iife', name: 'Remote' }, plugins: [{ name: 'resource-fixture', resolveId(id) { if (id === 'virtual:resources') return id }, load(id) { if (id === 'virtual:resources') return `export * from '${new URL('../src/utils/remote-transport.ts', import.meta.url).pathname}'; export * from '${new URL('../src/utils/remote-resources.ts', import.meta.url).pathname}'` } }] })
  const code = bundle.output.find(value => value.type === 'chunk')!.code
  const workerSource = await fs.readFile(new URL('../public/remote-resource-worker.js', import.meta.url), 'utf8')
  let withoutDecompression = false, centralWork = 0, pendingCancelled = false
  const fixture = http.createServer((req, res) => {
    if (req.url === '/remote-resource-worker.js') { res.setHeader('Content-Type', 'text/javascript'); res.end((withoutDecompression ? 'self.DecompressionStream=undefined;\n' : '') + workerSource); return }
    if (req.url?.startsWith('/api/') || req.url?.startsWith('/__mew_ui/')) { centralWork++; res.statusCode = 503; res.end('Connection required'); return }
    res.setHeader('Content-Type', 'text/html')
    res.end(`<div id="root"></div><script>${code}</script><script>
      class Channel extends EventTarget {readyState='open';bufferedAmount=0;send(raw){window.nodeSend(raw)}close(){this.readyState='closed'}}
      window.channel=new Channel();window.deliver=raw=>window.channel.dispatchEvent(new MessageEvent('message',{data:raw}));
      Remote.setRemoteTransport(new Remote.DataChannelTransport(window.channel));
      Remote.enableRemoteResources({centralOrigin:location.origin}).then(()=>window.ready=true);
    </script>`)
  })
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening')
  t.after(() => new Promise<void>(resolve => { fixture.closeAllConnections(); fixture.close(() => resolve()) }))
  const origin = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`, token = 'resource_fixture_abcdefghijklmnop'
  const app = express(), appServer = http.createServer(app)
  app.get('/api/remote-ui/file', (req, res, next) => {
    if (req.query.path === '/assets/broken.js') { res.type('js').setHeader('Content-Encoding', 'gzip'); res.end('invalid gzip'); return }
    if (req.query.path === '/assets/pending.js') {
      const gzip = createGzip()
      res.type('js').setHeader('Content-Encoding', 'gzip'); gzip.pipe(res); gzip.write('/*still loading*/'); gzip.flush()
      res.on('close', () => { pendingCancelled = true; gzip.destroy() })
      return
    }
    next()
  })
  app.use('/api/remote-ui', createRemoteUiRouter(dist))
  const owner: AuthenticatedSession = { email: 'owner@example.test', user: { hash: '', role: 'owner', mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 } }
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  for (const mode of ['gzip', 'legacy-server', 'legacy-browser'] as const) {
    withoutDecompression = mode === 'legacy-browser'
    const context = await browser.newContext(), page = await context.newPage()
    const errors: string[] = [], requests: string[] = [], encodings: string[] = []
    let transmitted = 0, dispatcher: ReturnType<typeof remoteDispatcher>
    page.on('pageerror', error => errors.push(error.message))
    const deliver = async (page: Page, raw: string) => page.evaluate(raw => (globalThis as unknown as { deliver(raw: string): void }).deliver(raw), raw)
    dispatcher = remoteDispatcher(appServer, { send: async raw => {
      const frame = JSON.parse(raw) as RemoteFrame
      if (frame.type === 'response') encodings.push(frame.headers['content-encoding'] ?? 'raw')
      if (frame.type === 'chunk') transmitted += Buffer.from(frame.data, 'base64').length
      await deliver(page, raw)
    }, close() {} }, () => owner, origin)
    await page.exposeFunction('nodeSend', (raw: string) => {
      const frame = JSON.parse(raw) as RemoteFrame
      if (frame.type === 'request') { requests.push(frame.path); if (mode === 'legacy-server') frame.path = frame.path.replace('&encoding=gzip', '') }
      void dispatcher.receive(JSON.stringify(frame))
    })
    t.after(async () => { dispatcher.close(); await context.close() })
    await page.goto(origin + '/launch/' + token)
    await page.waitForFunction('window.ready')
    await page.locator('#root').evaluate((el, token) => { const frame = el.ownerDocument.createElement('iframe'); frame.src = '/__mew_ui/' + token + '/index.html'; el.append(frame) }, token)
    const frame = page.frameLocator('iframe')
    await frame.getByText('dynamic module worker dynamic module', { exact: true }).waitFor()
    assert.equal(await frame.locator('#result').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).color), 'rgb(0, 128, 0)')
    assert.equal(await frame.locator('meta[name=mew-p2p-app]').getAttribute('content'), '1')
    assert.ok(requests.some(value => value.includes('encoding=gzip')) === (mode !== 'legacy-browser'))
    assert.ok(encodings.every(value => value === (mode === 'gzip' ? 'gzip' : 'raw')))
    assert.equal(requests.filter(value => value.includes('path=%2Fassets%2Fapp.js')).length, 1)
    if (mode === 'gzip') {
      assert.ok(transmitted < Buffer.byteLength(script) / 10, `${transmitted} transferred bytes for ${Buffer.byteLength(script)}B module and other UI files`)
      const probe = await page.locator('#root').evaluate(async (el, token) => {
        const response = await el.ownerDocument.defaultView!.fetch('/__mew_ui/' + token + '/assets/app.js')
        const headers = { encoding: response.headers.get('content-encoding'), length: response.headers.get('content-length'), cache: response.headers.get('cache-control') }
        const text = await response.text()
        const broken = await el.ownerDocument.defaultView!.fetch('/__mew_ui/' + token + '/assets/broken.js')
        let invalid = false
        try { await broken.text() } catch { invalid = true }
        const pending = await el.ownerDocument.defaultView!.fetch('/__mew_ui/' + token + '/assets/pending.js')
        const reader = pending.body!.getReader(), chunk = await reader.read()
        await reader.cancel()
        return { headers, text, invalid, started: !!chunk.value?.length }
      }, token)
      assert.deepEqual(probe.headers, { encoding: null, length: null, cache: 'no-store' })
      assert.equal(probe.text, script)
      assert.equal(probe.invalid, true)
      assert.equal(probe.started, true)
      await new Promise<void>((resolve, reject) => { const deadline = Date.now() + 1000; const check = () => pendingCancelled ? resolve() : Date.now() > deadline ? reject(new Error('Cancelled gzip did not close its upstream stream')) : setTimeout(check, 10); check() })
    }
    assert.deepEqual(errors, [])
    dispatcher.close(); await context.close()
  }
  assert.equal(centralWork, 0)
})

test('static UI cache revalidates across launch tokens, isolates hosts and rejects tampering or offline reuse', { skip: !domBrowserExecutable(), timeout: 30_000 }, async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-ui-cache-browser-'))
  t.after(() => fs.rm(temporary, { recursive: true, force: true }))
  const original = `export const value="host A";\n/*${'cached static module '.repeat(12_000)}*/`
  const changed = original.replace('host A', 'host A updated'), other = 'export const value="host B";'
  const hosts = new Map<string, { server: http.Server; dist: string }>()
  for (const [instance, script] of [['fixture-instance', original], ['other-instance', other]]) {
    const dist = path.join(temporary, instance)
    await fs.mkdir(path.join(dist, 'assets'), { recursive: true })
    await fs.writeFile(path.join(dist, 'assets/app.js'), script)
    await fs.writeFile(path.join(dist, 'index.html'), '<html><head><meta name="mew-p2p-bootstrap" content="1"></head><body>Installed UI</body></html>')
    const app = express(), server = http.createServer(app)
    app.get('/api/cache-probe', (_req, res) => { res.json({ instance }) })
    app.use('/api/remote-ui', createRemoteUiRouter(dist))
    hosts.set(instance, { server, dist })
  }
  const bundle = await build({ input: 'virtual:cache-resources', write: false, platform: 'browser', output: { format: 'iife', name: 'Remote' }, plugins: [{ name: 'cache-resource-fixture', resolveId(id) { if (id === 'virtual:cache-resources') return id }, load(id) { if (id === 'virtual:cache-resources') return `export * from '${new URL('../src/utils/remote-transport.ts', import.meta.url).pathname}'; export * from '${new URL('../src/utils/remote-resources.ts', import.meta.url).pathname}'` } }] })
  const code = bundle.output.find(value => value.type === 'chunk')!.code
  const workerSource = await fs.readFile(new URL('../public/remote-resource-worker.js', import.meta.url), 'utf8')
  let centralWork = 0
  const fixture = http.createServer((req, res) => {
    if (req.url === '/remote-resource-worker.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(workerSource); return }
    if (req.url?.startsWith('/api/') || req.url?.startsWith('/__mew_ui/')) { centralWork++; res.statusCode = 503; res.end('Connection required'); return }
    res.setHeader('Content-Type', 'text/html')
    res.end(`<div id="root"></div><script>${code}</script><script>
      class Channel extends EventTarget {readyState='open';bufferedAmount=0;send(raw){window.nodeSend(raw)}close(){this.readyState='closed'}}
      window.channel=new Channel();window.deliver=raw=>window.channel.dispatchEvent(new MessageEvent('message',{data:raw}));
      Remote.setRemoteTransport(new Remote.DataChannelTransport(window.channel));
      Remote.enableRemoteResources({instance:new URLSearchParams(location.search).get('instance'),centralOrigin:location.origin}).then(()=>window.ready=true);
    </script>`)
  })
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening')
  t.after(() => new Promise<void>(resolve => { fixture.closeAllConnections(); fixture.close(() => resolve()) }))
  const origin = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  const context = await browser.newContext(), page = await context.newPage()
  t.after(() => context.close())
  const owner: AuthenticatedSession = { email: 'owner@example.test', user: { hash: '', role: 'owner', mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 } }
  type Transfer = { path: string; method: string; headers: Record<string, string>; status?: number; bytes: number }
  const transfers: Transfer[] = [], pending = new Map<string, Transfer>(), errors: string[] = []
  let dispatcher: ReturnType<typeof remoteDispatcher> | undefined, token = '', visit = 0, legacyServer = false, mismatched304 = false
  page.on('pageerror', error => errors.push(error.message))
  await page.exposeFunction('nodeSend', (raw: string) => {
    const frame = JSON.parse(raw) as RemoteFrame
    if (frame.type === 'request') {
      const transfer = { path: frame.path, method: frame.method, headers: frame.headers, bytes: 0 }
      transfers.push(transfer); pending.set(frame.id, transfer)
      if (legacyServer) delete frame.headers['if-none-match']
    }
    void dispatcher?.receive(JSON.stringify(frame))
  })
  t.after(() => dispatcher?.close())
  const launch = async (instance = 'fixture-instance') => {
    dispatcher?.close(); pending.clear()
    dispatcher = remoteDispatcher(hosts.get(instance)!.server, { send: async raw => {
      const frame = JSON.parse(raw) as RemoteFrame, transfer = pending.get(frame.id)
      if (frame.type === 'response') {
        if (transfer) transfer.status = frame.status
        if (legacyServer) delete frame.headers.etag
        if (mismatched304 && frame.status === 304) frame.headers.etag = '"sha256-mismatched"'
      }
      if (frame.type === 'chunk' && transfer) transfer.bytes += Buffer.from(frame.data, 'base64').length
      await page.evaluate(raw => (globalThis as unknown as { deliver(raw: string): void }).deliver(raw), JSON.stringify(frame))
    }, close() {} }, () => owner, origin)
    token = `resource_cache_fixture_abcdefghijklmnop_${++visit}`
    await page.goto(`${origin}/launch/${token}?instance=${instance}`)
    await page.waitForFunction('window.ready')
  }
  const fetchFile = async (asset = '/assets/app.js', options: { method?: string; headers?: Record<string, string> } = {}) => page.locator('#root').evaluate(async (el, { asset, token, options }) => {
    const response = await el.ownerDocument.defaultView!.fetch(asset.startsWith('/api/') ? asset : '/__mew_ui/' + token + asset, options)
    return { status: response.status, text: await response.text(), etag: response.headers.get('etag'), encoding: response.headers.get('content-encoding'), cache: response.headers.get('cache-control') }
  }, { asset, token, options })
  const cacheKey = `${origin}/__mew_ui_cache/fixture-instance/${encodeURIComponent('/assets/app.js')}`
  const waitForCache = () => page.waitForFunction(`caches.open('mew-remote-ui-v1').then(cache=>cache.match(${JSON.stringify(cacheKey)})).then(Boolean)`)
  await launch()
  const cold = await fetchFile()
  assert.equal(cold.text, original)
  assert.equal(cold.etag, `"sha256-${createHash('sha256').update(original).digest('base64url')}-gzip"`)
  assert.equal(cold.encoding, null)
  assert.equal(cold.cache, 'no-store')
  assert.ok(transfers.at(-1)!.bytes > 0)
  await waitForCache()

  await launch()
  const warm = await fetchFile()
  assert.equal(warm.status, 200)
  assert.equal(warm.text, original)
  assert.equal(transfers.at(-1)!.status, 304)
  assert.equal(transfers.at(-1)!.bytes, 0)
  assert.equal(transfers.at(-1)!.headers['if-none-match'], cold.etag)

  await launch()
  mismatched304 = true
  const mismatchStart = transfers.length
  assert.equal((await fetchFile()).text, original)
  assert.deepEqual(transfers.slice(mismatchStart).map(value => value.status), [304, 200])
  assert.equal(transfers.at(-1)!.headers['if-none-match'], undefined)
  assert.ok(transfers.at(-1)!.bytes > 0)
  mismatched304 = false

  await launch()
  await page.locator('#root').evaluate(async (el, key) => {
    const win = el.ownerDocument.defaultView!, cache = await win.caches.open('mew-remote-ui-v1'), response = (await cache.match(key))!
    const headers = new win.Headers(response.headers)
    headers.set('x-mew-ui-cache-time', String(Date.now() - 8 * 24 * 60 * 60 * 1000))
    await cache.put(key, new win.Response(await response.arrayBuffer(), { status: 200, headers }))
  }, cacheKey)
  assert.equal((await fetchFile()).text, original)
  assert.equal(transfers.at(-1)!.status, 200)
  assert.equal(transfers.at(-1)!.headers['if-none-match'], undefined)
  assert.ok(transfers.at(-1)!.bytes > 0)

  await launch('other-instance')
  assert.equal((await fetchFile()).text, other)
  assert.equal(transfers.at(-1)!.status, 200)
  assert.equal(transfers.at(-1)!.headers['if-none-match'], undefined)

  await launch()
  await page.locator('#root').evaluate(async (el, key) => {
    const win = el.ownerDocument.defaultView!, cache = await win.caches.open('mew-remote-ui-v1'), response = (await cache.match(key))!
    await cache.put(key, new win.Response('export const value="tampered";', { status: 200, headers: response.headers }))
  }, cacheKey)
  assert.equal((await fetchFile()).text, original)
  assert.ok(transfers.at(-1)!.bytes > 0, 'a poisoned body must be downloaded again')
  await waitForCache()

  await fs.writeFile(path.join(hosts.get('fixture-instance')!.dist, 'assets/app.js'), changed)
  await launch()
  assert.equal((await fetchFile()).text, changed)
  assert.equal(transfers.at(-1)!.status, 200)
  assert.ok(transfers.at(-1)!.bytes > 0)
  await waitForCache()
  const index = await fetchFile('/index.html')
  assert.match(index.text, /mew-p2p-app/)
  assert.equal(transfers.at(-1)!.headers['if-none-match'], undefined)
  const api = await fetchFile('/api/cache-probe')
  assert.equal(JSON.parse(api.text).instance, 'fixture-instance')
  assert.equal(transfers.at(-1)!.headers['if-none-match'], undefined)
  assert.equal((await fetchFile('/assets/app.js', { method: 'HEAD' })).text, '')
  assert.equal(transfers.at(-1)!.headers['if-none-match'], undefined)
  const range = await fetchFile('/assets/app.js', { headers: { range: 'bytes=0-9' } })
  assert.equal(range.status, 206)
  assert.equal(range.text, changed.slice(0, 10))
  assert.equal(transfers.at(-1)!.headers['if-none-match'], undefined)
  const cachePaths = await page.evaluate("caches.open('mew-remote-ui-v1').then(cache=>cache.keys()).then(keys=>keys.map(key=>new URL(key.url).pathname))") as string[]
  assert.ok(cachePaths.every(value => !value.includes('index.html') && !value.includes('cache-probe')))

  await launch()
  await page.evaluate("window.cacheOpen=caches.open.bind(caches);caches.open=()=>Promise.reject(new Error('Cache storage unavailable'))")
  assert.equal((await fetchFile()).text, changed)
  assert.equal(transfers.at(-1)!.status, 200)
  assert.ok(transfers.at(-1)!.bytes > 0)
  await page.evaluate('caches.open=window.cacheOpen')

  legacyServer = true
  await launch()
  assert.equal((await fetchFile()).text, changed)
  assert.equal(transfers.at(-1)!.status, 200)
  assert.ok(transfers.at(-1)!.bytes > 0)
  legacyServer = false
  await launch()
  await fetchFile(); await waitForCache()
  await page.evaluate('Remote.setRemoteTransport(null)')
  const offline = await fetchFile()
  assert.equal(offline.status, 503)
  assert.notEqual(offline.text, changed)
  assert.equal(centralWork, 0)
  assert.deepEqual(errors, [])
})
