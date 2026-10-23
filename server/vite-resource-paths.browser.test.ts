import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { build } from 'vite'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const chrome = domBrowserExecutable()
const remotePrefix = '/__mew_ui/fixture/'

// Read the public path without importing the application's server plugins or config.
async function configuredBase(): Promise<string> {
  const source = ts.createSourceFile('vite.config.ts', await fs.readFile(new URL('../vite.config.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  const exported = source.statements.find(ts.isExportAssignment)
  assert.ok(exported && ts.isCallExpression(exported.expression))
  const config = exported.expression.arguments[0]
  assert.ok(config && ts.isObjectLiteralExpression(config))
  const property = config.properties.find((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && property.name.getText(source) === 'base')
  assert.ok(property && ts.isStringLiteral(property.initializer))
  return property.initializer.text
}

test('Vite preloads, imports, CSS and workers share one resource URL at local and P2P entrypoints', { skip: !chrome, timeout: 20_000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-vite-paths-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await Promise.all([
    fs.writeFile(path.join(root, 'index.html'), '<div id="root"></div><script type="module" src="/main.ts"></script>'),
    fs.writeFile(path.join(root, 'main.ts'), `import('./lazy.ts').then(module => module.start(document.querySelector('#root')))`),
    fs.writeFile(path.join(root, 'lazy.ts'), `import './lazy.css'; export async function start(root) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      const url = await new Promise(resolve => { worker.onmessage = event => resolve(event.data); });
      worker.terminate(); root.dataset.workerUrl = url; root.className = 'ready'; root.textContent = 'ready';
    }`),
    fs.writeFile(path.join(root, 'worker.ts'), 'postMessage(import.meta.url)'),
    fs.writeFile(path.join(root, 'lazy.css'), '.ready { color: rgb(17, 31, 47); background-image: url("./marker.svg"); }'),
    fs.writeFile(path.join(root, 'marker.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path fill="#123" d="M0 0h1v1H0z"/></svg>'),
  ])

  const browser = await chromium.launch({ executablePath: chrome, chromiumSandbox: true })
  t.after(() => browser.close())
  const configured = await configuredBase()
  for (const [base, entry, duplicated] of [
    ['/', `${remotePrefix}index.html`, true],
    [configured, '/browser', false],
    [configured, `${remotePrefix}index.html`, false],
  ] as const) {
    // Only the tiny temporary fixture is bundled; application plugins and dist are untouched.
    const bundle = await build({ root, configFile: false, envDir: false, publicDir: false, base, logLevel: 'silent', build: { write: false, assetsInlineLimit: 0 } })
    assert.ok(!Array.isArray(bundle) && 'output' in bundle)
    const files = new Map(bundle.output.map(file => [file.fileName, file.type === 'chunk' ? file.code : file.source]))
    const requests: string[] = []
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, 'http://fixture.test').pathname
      requests.push(url)
      // Model the resource worker's redirect for absolute assets in a prefixed app.
      if (entry.startsWith(remotePrefix) && url.startsWith('/assets/')) {
        res.writeHead(307, { Location: `${remotePrefix}${url.slice(1)}`, 'Cache-Control': 'no-store' }); res.end(); return
      }
      const fileName = url === entry ? 'index.html' : url.startsWith(remotePrefix) ? url.slice(remotePrefix.length) : url.slice(1)
      const body = files.get(fileName)
      if (body === undefined) { res.writeHead(404); res.end(); return }
      const extension = path.extname(fileName)
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' } as Record<string, string>)[extension] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
      res.end(body)
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    t.after(() => server.listening ? new Promise<void>(resolve => server.close(() => resolve())) : undefined)
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const imageLoaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('.svg'))
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}${entry}`)
    await page.locator('#root').filter({ hasText: 'ready' }).waitFor()
    const rendered = await page.locator('#root').evaluate(el => ({ color: el.ownerDocument.defaultView!.getComputedStyle(el).color, worker: el.getAttribute('data-worker-url'), styles: [...el.ownerDocument.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(link => link.href), preloads: [...el.ownerDocument.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')].map(link => link.href) }))
    await imageLoaded
    assert.deepEqual(errors, [])
    assert.equal(rendered.color, 'rgb(17, 31, 47)')
    const assetPrefix = entry.startsWith(remotePrefix) ? `${remotePrefix}assets/` : '/assets/'
    assert.ok(rendered.worker && new URL(rendered.worker).pathname.startsWith(assetPrefix))
    assert.ok(rendered.styles.length && rendered.preloads.length)
    const assetRequests = requests.filter(url => url.includes('/assets/'))
    const duplicates = assetRequests.filter((url, index) => assetRequests.indexOf(url) < index)
    if (duplicated) assert.ok(duplicates.length > 0, 'the absolute-base control must reproduce redundant transfers')
    else {
      assert.deepEqual(duplicates, [], `${entry} requests every module only once`)
      assert.ok(assetRequests.every(url => url.startsWith(assetPrefix)), `${entry} keeps all generated assets in the same scope`)
      assert.ok([...rendered.styles, ...rendered.preloads].every(url => new URL(url).pathname.startsWith(assetPrefix)))
      assert.ok(assetRequests.some(url => url.endsWith('.svg')), 'CSS assets use the same scope')
    }
    await context.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
