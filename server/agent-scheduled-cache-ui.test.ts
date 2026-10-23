import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
test('scheduled messages restore before GET, persist mutations and reject stale responses', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {AgentPanel} from '${root}/src/components/AgentPanel.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import * as cache from '${root}/src/utils/agent-scheduled-cache.ts';
window.cache=cache;localStorage.setItem('mew:locale','ko');
if(location.search.includes('no-storage'))Object.defineProperty(window,'indexedDB',{value:{open(){throw new Error('storage unavailable')}}});
class Socket {
 static OPEN=1;readyState=0;
 constructor(){setTimeout(()=>{this.readyState=1;this.onopen?.();this.emit({type:'replay',restored:true,events:[]});this.emit({type:'meta',meta:{sessionId:'conversation',startedAt:new Date().toISOString(),turns:0,busy:false,queued:[],usage:null,canLoad:true,canList:true}})},20)}
 emit(event){this.onmessage?.({data:JSON.stringify(event)})}send(){}close(){this.readyState=3;this.onclose?.()}
}
window.WebSocket=Socket;
window.delayCache=location.search.includes('late-cache');
const account=new URLSearchParams(location.search).get('account')||'alice';
createRoot(document.getElementById('root')).render(<I18nProvider><div style={{height:'100vh',display:'flex'}}><AgentPanel cacheAccount={account} project="test" workspacePath="/workspace" tree={[]} focusedFilePath={null} onOpenFile={()=>{}} onClose={()=>{}} /></div></I18nProvider>);`
  const bundle = await build({ input: 'virtual:scheduled.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'scheduled-fixture',
    async resolveId(id, importer) {
      if (id === 'virtual:scheduled.tsx') return id
      if (id === '@mew/tmux-term') return 'virtual:terminal'
      if (id.endsWith('.css')) return 'virtual:style'
      if (id === '../utils/agent-scheduled-cache.ts' && importer?.endsWith('use-scheduled-prompts.ts')) return 'virtual:delayed-cache'
      if (id.endsWith('?raw')) { const resolved = await this.resolve(id.slice(0, -4), importer, { skipSelf: true }); if (resolved) return `${resolved.id}?raw` }
    },
    async load(id) {
      if (id === 'virtual:scheduled.tsx') return source
      if (id === 'virtual:terminal') return 'export const isHiddenTmuxSession=()=>false;export function TmuxTerminal(){return null}'
      if (id === 'virtual:style') return ''
      if (id === 'virtual:delayed-cache') return `import * as cache from '${root}/src/utils/agent-scheduled-cache.ts';export const writeScheduledCache=cache.writeScheduledCache;export async function readScheduledCache(key){const jobs=await cache.readScheduledCache(key);if(window.delayCache)await new Promise(resolve=>window.releaseCache=resolve);return jobs}`
      if (id.endsWith('?raw')) return `export default ${JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))}`
    },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const content = (await Promise.all(['src/components/AgentPanel.tsx', 'src/components/MentionTextarea.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  const key = JSON.stringify(['alice', 'codex', 'scheduled', '/workspace'])
  try {
    for (const width of [1100, 390]) for (const dark of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } })
      page.setDefaultTimeout(5000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      const original = { id: 'job', runtime: 'codex', tab: 'scheduled', cwd: '/workspace', text: '예약된 작업 유지', at: new Date(Date.now() + 86_400_000).toISOString(), createdAt: new Date().toISOString() }
      let jobs = [original]
      let listMode: 'normal' | 'delay' | 'fail' = 'normal'
      const gates: (() => void)[] = []
      await page.route('http://mew-scheduled.test/**', async route => {
        const request = route.request(), pathname = new URL(request.url()).pathname
        if (pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (pathname === '/api/user-ui/agent-tabs') return route.fulfill({ json: { state: { tabs: [{ id: 'scheduled', label: 'Scheduled', renamed: true, runtime: 'codex', cwd: '/workspace' }], activeId: 'scheduled' }, claims: [] } })
        if (pathname === '/api/agent-cwd') return route.fulfill({ json: { cwd: '/workspace' } })
        if (pathname === '/api/projects') return route.fulfill({ json: [] })
        if (pathname.startsWith('/api/agent/scheduled-prompts')) {
          if (request.method() === 'DELETE') { jobs = []; return route.fulfill({ json: { ok: true } }) }
          if (request.method() === 'PUT') { jobs = [{ ...jobs[0], ...request.postDataJSON() }]; return route.fulfill({ json: { job: jobs[0] } }) }
          if (request.method() === 'POST') { jobs = [{ ...original, ...request.postDataJSON(), id: 'new-job' }]; return route.fulfill({ json: { job: jobs[0] } }) }
          const snapshot = [...jobs]
          if (listMode === 'fail') return route.fulfill({ status: 503, json: { error: 'offline' } })
          if (listMode === 'delay') await new Promise<void>(resolve => gates.push(resolve))
          return route.fulfill({ json: { jobs: snapshot } })
        }
        if (pathname.startsWith('/api/')) return route.fulfill({ json: { settings: null, skills: [], jobs: [], commands: [], runtimes: [] } })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="${dark ? 'dark' : ''}" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      const cached = () => page.evaluate(key => (globalThis as any).cache.readScheduledCache(key), key)
      const waitCache = async (text: string | null) => {
        await page.waitForFunction(async ({ key, text }) => {
          const jobs = await (globalThis as any).cache.readScheduledCache(key)
          return jobs && (text === null ? jobs.length === 0 : jobs[0]?.text === text)
        }, { key, text })
      }
      await page.goto('http://mew-scheduled.test/')
      await page.getByRole('button', { name: original.text, exact: true }).waitFor()
      await waitCache(original.text)
      // A newly opened page shares the same device database, with all GETs held.
      listMode = 'delay'
      await page.reload()
      await page.getByRole('button', { name: original.text, exact: true }).waitFor()
      assert.ok(gates.length > 0, 'local list is visible before server responses')
      await page.screenshot({ path: `/tmp/mew-scheduled-cache-${width}-${dark ? 'dark' : 'light'}.png` })
      listMode = 'fail'
      // A confirmed edit remains visible and durable even when its follow-up GET fails.
      await page.getByRole('button', { name: original.text, exact: true }).click()
      await page.getByRole('textbox', { name: '예약 메시지 수정칸', exact: true }).fill('수정된 예약 작업')
      await page.getByRole('button', { name: '완료', exact: true }).click()
      await page.getByRole('button', { name: '수정된 예약 작업', exact: true }).waitFor()
      await waitCache('수정된 예약 작업')
      const staleResponse = page.waitForResponse(response => response.url().includes('/api/agent/scheduled-prompts') && response.request().method() === 'GET' && response.status() === 200)
      gates.splice(0).forEach(release => release())
      await staleResponse
      await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      assert.equal(await page.getByRole('button', { name: original.text, exact: true }).count(), 0, 'stale GET cannot undo the edit')
      assert.equal(await page.getByRole('button', { name: '수정된 예약 작업', exact: true }).count(), 1)
      await page.reload()
      await page.getByRole('button', { name: '수정된 예약 작업', exact: true }).waitFor()
      await page.getByRole('button', { name: '예약 메시지 취소', exact: true }).click()
      await page.getByRole('button', { name: '수정된 예약 작업', exact: true }).waitFor({ state: 'hidden' })
      await waitCache(null)
      await page.reload()
      await page.locator('[data-agent-composer]').waitFor()
      assert.equal(await page.getByRole('button', { name: '수정된 예약 작업', exact: true }).count(), 0)
      assert.deepEqual(await cached(), [])

      const input = page.locator('[contenteditable="true"][aria-placeholder="텍스트 입력"]')
      await input.fill('새 예약 작업')
      await page.getByRole('button', { name: '예약 메시지', exact: true }).click()
      await page.getByRole('button', { name: '예약', exact: true }).click()
      await page.getByRole('button', { name: '새 예약 작업', exact: true }).waitFor()
      await waitCache('새 예약 작업')
      await page.reload()
      await page.getByRole('button', { name: '새 예약 작업', exact: true }).waitFor()

      // A slow IndexedDB read must not resurrect a job removed by the server.
      await page.evaluate(({ key, job }) => (globalThis as any).cache.writeScheduledCache(key, [job]), { key, job: original })
      listMode = 'normal'
      jobs = []
      await page.goto('http://mew-scheduled.test/?late-cache')
      await page.waitForFunction('typeof window.releaseCache === "function"')
      await waitCache(null)
      await page.evaluate('window.releaseCache()')
      await page.locator('[data-agent-composer]').waitFor()
      assert.equal(await page.getByRole('button', { name: original.text, exact: true }).count(), 0)

      // Cached display data stays isolated by every scope field.
      listMode = 'fail'
      await page.goto('http://mew-scheduled.test/?account=bob')
      await page.locator('[data-agent-composer]').waitFor()
      await page.evaluate(({ key, job }) => (globalThis as any).cache.writeScheduledCache(key, [job]), { key, job: original })
      for (const scope of [['bob', 'codex', 'scheduled', '/workspace'], ['alice', 'claude', 'scheduled', '/workspace'], ['alice', 'codex', 'other-tab', '/workspace'], ['alice', 'codex', 'scheduled', '/other']]) {
        assert.equal(await page.evaluate(key => (globalThis as any).cache.readScheduledCache(key), JSON.stringify(scope)), null)
      }
      assert.equal(await page.getByRole('button', { name: original.text, exact: true }).count(), 0)

      // Quota failure preserves the previously committed snapshot.
      const result = await page.evaluate(async ({ key, job }) => {
        const cache = (globalThis as any).cache, store = (globalThis as any).IDBObjectStore
        const put = store.prototype.put
        store.prototype.put = () => { throw new Error('injected quota failure') }
        try { await cache.writeScheduledCache(key, [{ ...job, text: 'failed write' }]) }
        finally { store.prototype.put = put }
        return cache.readScheduledCache(key)
      }, { key, job: original })
      assert.deepEqual(result, [original])
      jobs = [original]
      listMode = 'normal'
      await page.goto('http://mew-scheduled.test/?no-storage')
      await page.getByRole('button', { name: original.text, exact: true }).waitFor()
      assert.equal(await cached(), null, 'unavailable IndexedDB never blocks the server list')
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
