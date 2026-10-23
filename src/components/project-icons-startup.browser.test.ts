import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import { once } from 'node:events'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from '../../server/browser-dom-executable.ts'

test('common project icons paint without the catalog; deferred icons keep their size and the picker still works', { skip: !domBrowserExecutable(), timeout: 25_000 }, async t => {
  const root = new URL('../../', import.meta.url).pathname
  const entryId = 'virtual:project-icon-startup.tsx'
  const catalogPath = `${root}src/utils/project-icon-catalog.ts`
  const pickerPath = `${root}src/components/IconPicker.tsx`
  const source = `import {useState} from '${root}node_modules/react/index.js';
    import {createRoot} from '${root}node_modules/react-dom/client.js';
    import {ProjectIcon} from '${root}src/components/ProjectIcon.tsx';
    import {ProjectSwitcher} from '${root}src/components/ProjectSwitcher.tsx';
    import {I18nProvider} from '${root}src/i18n.tsx';
    function Fixture(){ const [rare,showRare]=useState(false),[icon,setIcon]=useState('i:folder');
      return <><div style={{height:48}}><ProjectSwitcher paths={['/fixture']} activePath="/fixture" fallbackLabel="Fixture" canOpen={false} canChangeIcon icons={{'/fixture':icon}} onActivate={()=>{}} onIconChange={(_,value)=>setIcon(value)} onOpen={()=>{}} /></div>
      <button onClick={()=>showRare(true)}>Show rare icon</button><div data-rare>{rare&&<ProjectIcon icon="i:airplane" size={20}/>}</div>
      <div data-unknown><ProjectIcon icon="i:missing-icon" size={20}/></div><div data-emoji><ProjectIcon icon="📚" size={20}/></div><output>{icon}</output></> }
    createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: entryId, write: false, platform: 'browser', output: { format: 'esm' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, plugins: [{ name: 'project-icons-fixture', resolveId(id) { if (id === entryId) return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === entryId) return source; if (id === 'virtual:style') return '' } }] })
  const chunks = bundle.output.filter(item => item.type === 'chunk')
  const entry = chunks.find(item => item.isEntry)!
  const catalog = chunks.find(item => catalogPath in item.modules)!
  const picker = chunks.find(item => pickerPath in item.modules)!
  const scripts = new Map(chunks.map(chunk => [`/${chunk.fileName}`, chunk.code]))
  const requested = new Set<string>()
  const pendingCatalog: http.ServerResponse[] = []
  let holdCatalog = true
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url!, 'http://fixture').pathname
    requested.add(pathname)
    if (scripts.has(pathname)) {
      res.setHeader('Content-Type', 'text/javascript')
      if (holdCatalog && pathname === `/${catalog.fileName}`) { pendingCatalog.push(res); return }
      res.end(scripts.get(pathname)); return
    }
    res.setHeader('Content-Type', 'text/html')
    res.end(`<!doctype html><html><head><style>.inline-flex{display:inline-flex}.shrink-0{flex-shrink:0}</style></head><body><div id="root"></div><script type="module" src="/${entry.fileName}"></script></body></html>`)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const page = await browser.newPage()
  page.setDefaultTimeout(4000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`)
  await page.locator('[data-current-project] svg').waitFor()
  assert.equal(requested.has(`/${catalog.fileName}`), false, 'a common folder icon does not download the full catalog')
  assert.equal(requested.has(`/${picker.fileName}`), false, 'a closed icon picker is not downloaded')
  assert.equal(await page.locator('[data-unknown]').innerHTML(), '')
  assert.equal(await page.locator('[data-emoji]').textContent(), '📚')
  const catalogRequest = page.waitForRequest(request => new URL(request.url()).pathname === `/${catalog.fileName}`)
  await page.getByRole('button', { name: 'Show rare icon' }).click()
  await page.locator('[data-rare] > span').waitFor()
  const before = await page.locator('[data-rare] > span').boundingBox()
  assert.equal(before?.width, 20)
  assert.equal(before?.height, 20)
  assert.equal(await page.locator('[data-rare] svg').count(), 0)
  await catalogRequest
  holdCatalog = false
  for (const res of pendingCatalog) res.end(scripts.get(`/${catalog.fileName}`))
  await page.locator('[data-rare] svg').waitFor()
  assert.deepEqual(await page.locator('[data-rare] > span').boundingBox(), before, 'loading the icon cannot shift its allocated space')
  await page.locator('[data-current-project]').click({ button: 'right' })
  await page.getByRole('dialog').waitFor()
  await page.getByRole('button', { name: 'book', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.equal(await page.locator('output').textContent(), 'i:book')
  assert.equal(requested.has(`/${picker.fileName}`), true)
  assert.deepEqual(errors, [])
})
