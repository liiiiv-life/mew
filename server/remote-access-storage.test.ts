import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
const chrome = domBrowserExecutable()
test('remote accounts/instances isolate drafts and IndexedDB even when local account and session keys match', { skip: !chrome, timeout: 15_000 }, async t => {
  const source = `export * from '${new URL('../packages/ui/src/browser-storage-scope.ts', import.meta.url).pathname}';export * from '${new URL('../src/utils/agent-history-cache.ts', import.meta.url).pathname}';export * from '${new URL('../src/utils/agent-scheduled-cache.ts', import.meta.url).pathname}';`
  const bundle = await build({ input: 'virtual:storage', write: false, platform: 'browser', output: { format: 'iife', name: 'Cache' }, plugins: [{ name: 'storage', resolveId(id) { if (id === 'virtual:storage') return id }, load(id) { if (id === 'virtual:storage') return source } }] })
  const code = bundle.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n')
  const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<div id="root"></div><script>${code}</script>`) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const browser = await chromium.launch({ executablePath: chrome, chromiumSandbox: true }); t.after(() => browser.close())
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`)
  const results = await page.locator('#root').evaluate(async el => {
    const { Cache: cache } = el.ownerDocument.defaultView as unknown as { Cache: {
      setBrowserStorageScope(account?: string, instance?: string): void;
      scopedBrowserStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void; clear(): void };
      remoteStorageName(name: string): string;
      writeHistoryCache(key: string, tab: string, value: object): Promise<void>;
      readHistoryCache(key: string): Promise<{ generation: string } | null>;
      writeScheduledCache(key: string, jobs: object[]): Promise<void>;
      readScheduledCache(key: string): Promise<{ text: string }[] | null>;
    } }
    const key = JSON.stringify(['same-local-email', 'codex', 'tab', 'same-cwd'])
    const write = async (marker: string) => {
      cache.scopedBrowserStorage().setItem('draft', marker)
      await cache.writeHistoryCache(key, 'tab', { generation: marker, sessionId: 'same-session', start: 0, end: 0, total: 0, usersBefore: 0, events: [] })
      await cache.writeScheduledCache(key, [{ id: 'same-job', runtime: 'codex', tab: 'tab', cwd: 'same-cwd', text: marker, at: new Date().toISOString(), createdAt: new Date().toISOString() }])
    }
    const read = async () => ({ draft: cache.scopedBrowserStorage().getItem('draft'), history: (await cache.readHistoryCache(key))?.generation ?? null, scheduled: (await cache.readScheduledCache(key))?.[0]?.text ?? null })
    await write('local')
    cache.setBrowserStorageScope('account-one', 'instance-one'); await write('one'); const firstName = cache.remoteStorageName('history')
    cache.setBrowserStorageScope('account-one', 'instance-two'); const secondEmpty = await read(); await write('two')
    cache.setBrowserStorageScope('account-two', 'instance-one'); const otherEmpty = await read(); await write('other')
    cache.setBrowserStorageScope('account-one', 'instance-one'); const first = await read(); cache.scopedBrowserStorage().clear()
    cache.setBrowserStorageScope('account-one', 'instance-two'); const second = await read(), separateName = firstName !== cache.remoteStorageName('history')
    cache.setBrowserStorageScope(); const local = await read()
    return { first, secondEmpty, otherEmpty, second, separateName, local }
  })
  const value = (marker: string | null) => ({ draft: marker, history: marker, scheduled: marker })
  assert.deepEqual(results, { first: value('one'), secondEmpty: value(null), otherEmpty: value(null), second: value('two'), separateName: true, local: value('local') })
})
