import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('RAG panel settings, scopes, retrieval, file links, errors and mobile layout', { skip: !domBrowserExecutable(), timeout: 40_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {RagPanel} from '${root}/src/components/rag-panel.tsx';
function Fixture(){const [project,setProject]=React.useState('.workspace');const [manage,setManage]=React.useState(true);window.setProject=setProject;window.setManage=setManage;return <div className="h-dvh w-full md:w-[480px]"><RagPanel key={project} workspace={project === '.workspace' ? '/fixture' : '/other'} canManage={manage} onClose={()=>window.ragClosed=true} onOpenFile={(...args)=>window.opened=args}/></div>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:rag.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'rag-fixture', resolveId(id) { if (id === 'virtual:rag.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' },
    load(id) { if (id === 'virtual:rag.tsx') return source; if (id === 'virtual:style') return '' },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const content = await fs.readFile(`${root}/src/components/rag-panel.tsx`, 'utf8')
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } }); page.setDefaultTimeout(5000)
      await page.addInitScript("localStorage.setItem('mew:locale','ko')")
      const errors: string[] = [], searches: URL[] = []
      page.on('pageerror', error => errors.push(error.message))
      const scopes: string[] = []
      let settings = { enabled: true, agentGuidance: true, environmentDisabled: false }, indexed = false, fail = false, builds = 0
      await page.route('http://mew-rag.test/**', async route => {
        const url = new URL(route.request().url()), p = url.pathname
        if (['/api/rag/status', '/api/rag/documents', '/api/search/semantic'].includes(p)) scopes.push(url.searchParams.get('project') ?? '')
        if (p === '/api/rag/settings') {
          if (route.request().method() === 'PUT') settings = { ...settings, ...route.request().postDataJSON() }
          return route.fulfill({ json: settings })
        }
        if (p === '/api/rag/status') return route.fulfill({ json: { enabled: settings.enabled && !settings.environmentDisabled, engine: 'LanceDB', dimensions: 384, database: 'fixture/chunks', model: 'Xenova/multilingual-e5-small:q8:mean-normalized', ready: indexed, indexedFiles: indexed ? 1 : 0, indexedChunks: indexed ? 3 : 0 } })
        if (p === '/api/rag/documents') return route.fulfill({ json: { documents: indexed ? [{ path: 'guide.md', chunks: 3, bytes: 100, modifiedAt: 0 }] : [] } })
        if (p === '/api/search/semantic') {
          searches.push(url)
          if (fail) return route.fulfill({ status: 503, json: { error: '모델을 준비하지 못했습니다' } })
          indexed = true
          return route.fulfill({ json: { results: [{ path: 'guide.md', line: 7, lineEnd: 9, text: '현재 프로젝트의 검색 문맥', title: 'Guide', heading: '', score: 0.9, tier: 'current', reveal: '' }], indexedFiles: 1, indexedChunks: 3, updatedFiles: 1, model: 'test' } })
        }
        if (p === '/api/rag/reindex') { scopes.push(route.request().postDataJSON().project); builds++; if (fail) return route.fulfill({ status: 503, json: { error: '모델을 준비하지 못했습니다' } }); indexed = true; return route.fulfill({ json: { ok: true, files: 1, chunks: 3, updated: 1 } }) }
        return route.fulfill(p === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html class="dark" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-rag.test/')
      await page.getByText('아직 색인 없음', { exact: true }).waitFor()
      assert.equal(builds, 0); assert.equal(searches.length, 0, 'opening the panel never starts indexing')
      await page.getByLabel('에이전트에 RAG 사용 안내', { exact: true }).uncheck()
      await page.getByText('공통 설정을 저장했습니다.').waitFor(); assert.equal(settings.agentGuidance, false)
      assert.equal(await page.getByRole('combobox').count(), 0, 'Docs is fixed; no scope selector')
      const start = page.getByRole('button', { name: '색인 시작', exact: true })
      await start.waitFor()
      fail = true; await start.click(); await page.getByRole('alert').waitFor()
      assert.equal(await start.isEnabled(), true, 'failed initial indexing can be retried')
      fail = false; await start.click()
      await page.getByText('Docs를 색인했습니다.', { exact: true }).waitFor()
      await page.getByRole('button', { name: '재색인', exact: true }).waitFor()
      assert.equal(await start.count(), 0)
      assert.equal(builds, 2)
      await page.getByLabel('프로젝트 지식 검색', { exact: true }).fill('문서 정책')
      await page.getByLabel('History / raw 포함').check()
      const search = page.getByRole('button', { name: '검색', exact: true })
      await search.click()
      await page.getByRole('button', { name: /guide.md:7/ }).click()
      assert.deepEqual(await page.evaluate('window.opened'), ['docs', 'guide.md', 7])
      assert.equal(searches[0].searchParams.get('workspace'), '/fixture'); assert.equal(searches[0].searchParams.get('project'), 'docs'); assert.equal(searches[0].searchParams.get('history'), '1')
      await page.getByLabel('파일 경로 필터').fill('missing')
      await page.getByText('일치하는 파일이 없습니다.', { exact: true }).waitFor()
      await page.getByLabel('파일 경로 필터').fill('guide')
      await page.getByRole('button', { name: 'guide.md 3 청크', exact: true }).click()
      assert.deepEqual(await page.evaluate('window.opened'), ['docs', 'guide.md', null])
      fail = true; await search.click(); await page.getByRole('alert').filter({ hasText: '모델을 준비하지 못했습니다' }).waitFor()
      fail = false; await search.click(); await page.getByRole('alert').waitFor({ state: 'detached' })
      await page.getByRole('button', { name: '재색인', exact: true }).click(); await page.getByText('재색인했습니다.', { exact: true }).waitFor(); assert.equal(builds, 3)
      assert.ok((await search.boundingBox())!.height <= 38, 'search label stays on one line')
      await page.screenshot({ path: `/tmp/mew-rag-${width}-dark.png` })
      await page.locator('section[aria-labelledby] > div').evaluate(el => { el.scrollTop = 0 })
      await page.screenshot({ path: `/tmp/mew-rag-${width}-settings.png` })
      await page.evaluate("document.documentElement.className='light'")
      await page.screenshot({ path: `/tmp/mew-rag-${width}-light.png` })
      assert.ok(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
      await page.evaluate('window.setManage(false)')
      assert.equal(await page.getByLabel('로컬 RAG 사용', { exact: true }).isDisabled(), true)
      assert.equal(await page.getByRole('button', { name: '재색인', exact: true }).count(), 0)
      settings.environmentDisabled = true
      await page.getByRole('button', { name: '새로고침', exact: true }).click()
      await page.getByText('서버 환경 설정(MEW_RAG_ENABLED=0)으로 비활성화되어 있습니다.').waitFor()
      assert.equal(await search.isDisabled(), true)
      await page.evaluate("window.setProject('other')")
      await page.getByRole('button', { name: /guide.md:7/ }).waitFor({ state: 'detached' })
      await page.getByRole('button', { name: 'RAG 닫기', exact: true }).click(); assert.equal(await page.evaluate('window.ragClosed'), true)
      assert.ok(scopes.length > 0 && scopes.every(scope => scope === 'docs'), 'all reads, search and rebuilds use Docs')
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
