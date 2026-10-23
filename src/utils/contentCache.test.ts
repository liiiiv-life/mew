import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from '../../server/browser-dom-executable.ts'

type BrowserCache = typeof import('./contentCache.ts') & typeof import('@mew/ui/browser-storage-scope') & {
  rows(): Promise<Array<{ key: string; identity: string; workspace: string; savedAt: number; bytes: number }>>
  ageRows(): Promise<void>
}
const chrome = domBrowserExecutable()

test('본문 캐시는 비동기 IndexedDB와 제한된 프로젝트별 메모리를 사용한다', { skip: !chrome, timeout: 30_000 }, async t => {
  // Isolated browser fixture only: never builds or starts the Mew application.
  const source = `
export * from '${new URL('./contentCache.ts', import.meta.url).pathname}';
export * from '${new URL('../../packages/ui/src/browser-storage-scope.ts', import.meta.url).pathname}';
import {remoteStorageName} from '${new URL('../../packages/ui/src/browser-storage-scope.ts', import.meta.url).pathname}';
async function db(){return new Promise((resolve,reject)=>{const r=indexedDB.open(remoteStorageName('mew-file-content'),1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
export async function rows(){const d=await db();return new Promise(resolve=>{const tx=d.transaction('metadata','readonly');const r=tx.objectStore('metadata').getAll();tx.oncomplete=()=>{d.close();resolve(r.result)}})}
export async function ageRows(){const d=await db();return new Promise(resolve=>{const tx=d.transaction('metadata','readwrite');const s=tx.objectStore('metadata');const r=s.getAll();r.onsuccess=()=>{for(const v of r.result)s.put({...v,savedAt:Date.now()-8*24*60*60*1000})};tx.oncomplete=()=>{d.close();resolve()}})}
`
  const bundle = await build({ input: 'virtual:content-cache', write: false, platform: 'browser',
    output: { format: 'iife', name: 'Cache' }, plugins: [{ name: 'content-cache',
      resolveId(id) { if (id === 'virtual:content-cache') return id },
      load(id) { if (id === 'virtual:content-cache') return source },
    }] })
  const code = bundle.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n')
  const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<div id="root"></div><script>${code}</script>`) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const browser = await chromium.launch({ executablePath: chrome, chromiumSandbox: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`)

  await t.test('동기 열기는 저장소를 읽지 않고, 본문과 버전은 비동기로 복원한다', async () => {
    const result = await page.locator('#root').evaluate(async el => {
      const cache = (el.ownerDocument.defaultView as unknown as { Cache: BrowserCache }).Cache
      const database = el.ownerDocument.defaultView!.indexedDB
      const originalOpen = database.open.bind(database)
      let opened = 0
      database.open = (name, version) => { opened++; return originalOpen(name, version) }
      cache.setContentIdentity('restore@example.com')
      cache.putCachedFile('docs', 'first.md', { content: '# 지도', editable: false, version: { size: 6, mtimeMs: 7, tag: 'v1' } })
      const before = opened
      database.open = originalOpen
      for (let i = 0; i < 21; i++) cache.putCachedFile('docs', `fill${i}`, { content: '', editable: true })
      await cache.flushContentCache()
      const hotMiss = cache.getCachedFile('docs', 'first.md')
      const restored = await cache.loadCachedFile('docs', 'first.md')
      const persistentKeys = Object.keys(el.ownerDocument.defaultView!.localStorage).filter(key => key.startsWith('mew:content:'))
      return { before, hotMiss, restored, persistentKeys }
    })
    assert.deepEqual(result, { before: 0, hotMiss: undefined, restored: { content: '# 지도', editable: false, version: { size: 6, mtimeMs: 7, tag: 'v1' } }, persistentKeys: [] })
  })

  await t.test('루트 이동은 핫 캐시를 보존하고 대기 중 쓰기는 원래 루트에 저장한다', async () => {
    const result = await page.locator('#root').evaluate(async el => {
      const cache = (el.ownerDocument.defaultView as unknown as { Cache: BrowserCache }).Cache
      cache.setContentIdentity('roots@example.com')
      cache.setContentWorkspace('/projects/first')
      cache.putCachedFile('.workspace', 'README.md', { content: 'first', editable: true })
      cache.setContentWorkspace('/projects/second')
      cache.putCachedFile('.workspace', 'README.md', { content: 'second', editable: true })
      cache.setContentWorkspace('/projects/first')
      const first = cache.getCachedFile('.workspace', 'README.md')?.content
      cache.setContentWorkspace('/projects/second')
      const second = cache.getCachedFile('.workspace', 'README.md')?.content
      await cache.flushContentCache()
      return { first, second, roots: (await cache.rows()).map(row => row.workspace).sort() }
    })
    assert.deepEqual(result, { first: 'first', second: 'second', roots: ['/projects/first', '/projects/second'] })
  })

  await t.test('로그아웃·권한 초기화와 파일 삭제 뒤 대기 중 쓰기나 읽기가 본문을 되살리지 않는다', async () => {
    const result = await page.locator('#root').evaluate(async el => {
      const cache = (el.ownerDocument.defaultView as unknown as { Cache: BrowserCache }).Cache
      cache.setContentIdentity('secret@example.com')
      cache.putCachedFile('docs', 'secret.md', { content: 'secret', editable: true })
      cache.setContentIdentity(null)
      await cache.flushContentCache()
      const afterLogout = (await cache.rows()).length
      cache.setContentIdentity('delete@example.com')
      cache.putCachedFile('docs', 'gone.md', { content: 'gone', editable: true })
      cache.dropCachedFile('docs', 'gone.md')
      await cache.flushContentCache()
      const afterDrop = await cache.loadCachedFile('docs', 'gone.md')
      cache.putCachedFile('docs', 'permission.md', { content: 'private', editable: true })
      cache.clearFileContentCache()
      await cache.flushContentCache()
      const afterPermission = (await cache.rows()).length
      const times = { 'mew:content:delete@example.com:/projects/second:docs legacy.md': Date.now() }
      const storage = cache.scopedBrowserStorage()
      storage.setItem('mew:cache-times:v1', JSON.stringify(times))
      storage.setItem(Object.keys(times)[0], JSON.stringify({ content: 'legacy', editable: true }))
      const pending = cache.loadCachedFile('docs', 'legacy.md')
      cache.dropCachedFile('docs', 'legacy.md')
      const lateRead = await pending
      await cache.flushContentCache()
      const afterLate = await cache.loadCachedFile('docs', 'legacy.md')
      return { afterLogout, afterDrop, afterPermission, lateRead, afterLate }
    })
    assert.deepEqual(result, { afterLogout: 0, afterDrop: undefined, afterPermission: 0, lateRead: undefined, afterLate: undefined })
  })

  await t.test('항목 수·전체 크기·큰 파일 교체·7일 만료를 제한한다', async () => {
    const result = await page.locator('#root').evaluate(async el => {
      const cache = (el.ownerDocument.defaultView as unknown as { Cache: BrowserCache }).Cache
      cache.setContentIdentity('limits@example.com')
      cache.setContentWorkspace('/limits')
      for (let i = 0; i < 45; i++) cache.putCachedFile('docs', `d${i}`, { content: `body ${i}`, editable: true })
      await cache.flushContentCache()
      const count = (await cache.rows()).length
      const oldest = await cache.loadCachedFile('docs', 'd0')
      cache.putCachedFile('docs', 'grown', { content: 'old', editable: true })
      await cache.flushContentCache()
      cache.putCachedFile('docs', 'grown', { content: 'x'.repeat(200_000), editable: true })
      await cache.flushContentCache()
      const grewRemoved = !(await cache.rows()).some(row => row.key.endsWith(',"grown"]'))
      cache.clearFileContentCache()
      for (let i = 0; i < 45; i++) {
        cache.setContentWorkspace(`/budget/${i}`)
        cache.putCachedFile('docs', 'large', { content: 'x'.repeat(100_000), editable: true })
      }
      await cache.flushContentCache()
      const bytes = (await cache.rows()).reduce((sum, row) => sum + row.bytes, 0)
      cache.setContentWorkspace('/budget/44')
      for (let i = 0; i < 21; i++) cache.putCachedFile('docs', `filler${i}`, { content: '', editable: true })
      await cache.flushContentCache()
      await cache.ageRows()
      const stale = await cache.loadCachedFile('docs', 'large')
      cache.clearFileContentCache()
      for (let i = 0; i < 260; i++) {
        cache.setContentWorkspace(`/entry-budget/${i}`)
        cache.putCachedFile('docs', 'small', { content: '', editable: true })
      }
      await cache.flushContentCache()
      return { count, oldest, grewRemoved, bytes, stale, entries: (await cache.rows()).length }
    })
    assert.equal(result.count, 40)
    assert.equal(result.oldest, undefined)
    assert.equal(result.grewRemoved, true)
    assert.ok(result.bytes <= 2 * 1024 * 1024)
    assert.equal(result.stale, undefined)
    assert.equal(result.entries, 256)
  })

  await t.test('유효한 localStorage 본문을 이관하고 날짜 없는 옛 본문은 폐기한다', async () => {
    const result = await page.locator('#root').evaluate(async el => {
      const cache = (el.ownerDocument.defaultView as unknown as { Cache: BrowserCache }).Cache
      cache.setContentIdentity('migration@example.com')
      cache.setContentWorkspace('/migration')
      await cache.flushContentCache()
      const storage = cache.scopedBrowserStorage()
      const key = 'mew:content:migration@example.com:/migration:docs legacy.md'
      const missing = 'mew:content:migration@example.com:/migration:docs undated.md'
      storage.setItem(key, JSON.stringify({ content: 'legacy body', editable: false }))
      storage.setItem(missing, JSON.stringify({ content: 'undated body', editable: true }))
      storage.setItem('mew:cache-times:v1', JSON.stringify({ [key]: Date.now() }))
      const restored = await cache.loadCachedFile('docs', 'legacy.md')
      const undated = await cache.loadCachedFile('docs', 'undated.md')
      return { restored, legacy: storage.getItem(key), undated, missing: storage.getItem(missing), rows: (await cache.rows()).length }
    })
    assert.deepEqual(result, { restored: { content: 'legacy body', editable: false }, legacy: null, undated: undefined, missing: null, rows: 1 })
  })

  await t.test('원격 범위 변경 뒤 대기 쓰기·삭제가 다른 인스턴스에 적용되지 않는다', async () => {
    const result = await page.locator('#root').evaluate(async el => {
      const cache = (el.ownerDocument.defaultView as unknown as { Cache: BrowserCache }).Cache
      cache.setContentIdentity('remote@example.com')
      cache.setContentWorkspace('/same')
      cache.setBrowserStorageScope('account', 'one')
      cache.putCachedFile('docs', 'file', { content: 'one', editable: true })
      cache.setBrowserStorageScope('account', 'two')
      cache.putCachedFile('docs', 'file', { content: 'two', editable: true })
      cache.dropCachedFile('docs', 'deleted')
      cache.setBrowserStorageScope('account', 'one')
      cache.putCachedFile('docs', 'deleted', { content: 'keep', editable: true })
      await cache.flushContentCache()
      const one = (await cache.rows()).length
      const oneContent = cache.getCachedFile('docs', 'file')?.content
      cache.setBrowserStorageScope('account', 'two')
      const two = (await cache.rows()).length
      const twoContent = cache.getCachedFile('docs', 'file')?.content
      return { one, two, oneContent, twoContent }
    })
    assert.deepEqual(result, { one: 2, two: 1, oneContent: 'one', twoContent: 'two' })
  })

  await t.test('연속 로컬 변경을 합치며 이전 서버 버전을 재사용하지 않는다', async () => {
    const result = await page.locator('#root').evaluate(async el => {
      const cache = (el.ownerDocument.defaultView as unknown as { Cache: BrowserCache }).Cache
      cache.setBrowserStorageScope()
      cache.setContentIdentity('edit@example.com')
      cache.setContentWorkspace('/edit')
      cache.putCachedFile('docs', 'edit.md', { content: 'server', editable: true, version: { size: 6, mtimeMs: 1, tag: 'old' } })
      cache.putCachedFile('docs', 'edit.md', { content: 'local1', editable: true })
      cache.putCachedFile('docs', 'edit.md', { content: 'local2', editable: true })
      for (let i = 0; i < 21; i++) cache.putCachedFile('docs', `filler${i}`, { content: '', editable: true })
      await cache.flushContentCache()
      return await cache.loadCachedFile('docs', 'edit.md')
    })
    assert.deepEqual(result, { content: 'local2', editable: true })
  })

  await t.test('IndexedDB 사용이 차단되어도 메모리·유효한 기존 본문 읽기는 동작한다', async () => {
    const result = await page.locator('#root').evaluate(async el => {
      const win = el.ownerDocument.defaultView!
      const cache = (win as unknown as { Cache: BrowserCache }).Cache
      cache.setBrowserStorageScope('account', 'unavailable')
      cache.setContentIdentity('disabled@example.com')
      cache.setContentWorkspace('/disabled')
      const descriptor = Object.getOwnPropertyDescriptor(win, 'indexedDB')!
      Object.defineProperty(win, 'indexedDB', { configurable: true, value: { open() { throw new Error('Storage disabled') } } })
      try {
        cache.putCachedFile('docs', 'hot.md', { content: 'hot', editable: true })
        const hot = cache.getCachedFile('docs', 'hot.md')
        await cache.flushContentCache()
        const storage = cache.scopedBrowserStorage()
        const key = 'mew:content:disabled@example.com:/disabled:docs legacy.md'
        storage.setItem(key, JSON.stringify({ content: 'legacy', editable: false }))
        storage.setItem('mew:cache-times:v1', JSON.stringify({ [key]: Date.now() }))
        const cold = await cache.loadCachedFile('docs', 'legacy.md')
        return { hot, cold, retained: !!storage.getItem(key) }
      } finally { Object.defineProperty(win, 'indexedDB', descriptor) }
    })
    assert.deepEqual(result, { hot: { content: 'hot', editable: true }, cold: { content: 'legacy', editable: false }, retained: true })
  })
})
