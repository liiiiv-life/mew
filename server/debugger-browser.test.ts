import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('CDP browser analysis collects real profiles, pauses DOM changes and expires references', { skip: !domBrowserExecutable(), timeout: 30000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-cdp-debug-'))
  process.env.MEW_DATA_DIR = root; process.env.MEW_WORKSPACE = root
  const { BrowserInspection } = await import('./debugger-browser.ts'), { upsertUser } = await import('./auth.ts'), { setFeature } = await import('./access-policy.ts')
  const account = 'debug@example.test'; upsertUser(account, { hash: 'fixture', role: 'owner', mustChangePassword: false, createdAt: 0, passwordChangedAt: 0 })
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(async () => { await browser.close(); await fs.rm(root, { recursive: true, force: true }) })
  const page = await browser.newPage(); await page.setContent('<div id="target">fixture</div>')
  const session = await BrowserInspection.connect(account, root, page); t.after(() => session.close())
  await session.command('startCapture', { kind: 'cpu' }); await session.command('startCapture', { kind: 'heap' }); await session.command('startCapture', { kind: 'coverage' })
  await page.locator('#target').evaluate(el => { const arrays = Array.from({ length: 200 }, (_, i) => Array.from({ length: 100 }, (_, j) => i * j)); el.textContent = String(arrays.flat().reduce((a, b) => a + b, 0)) })
  const cpu = await session.command('stopCapture', { kind: 'cpu' }) as { nodes: unknown[] }, heap = await session.command('stopCapture', { kind: 'heap' }) as { head: unknown }, coverage = await session.command('stopCapture', { kind: 'coverage' }) as { result: unknown[] }
  assert.ok(cpu.nodes.length > 0); assert.ok(heap.head); assert.ok(coverage.result.length > 0)
  const snapshot = await session.command('heapSnapshot', {}) as { snapshot: { node_count: number } }
  assert.ok(snapshot.snapshot.node_count > 0)
  const artifact = session.snapshot().artifacts.at(-1)!
  assert.equal(artifact.kind, 'snapshot'); assert.equal((await session.command('artifact', { id: artifact.id }) as typeof snapshot).snapshot.node_count, snapshot.snapshot.node_count)
  const bp = await session.command('breakpoint', { kind: 'dom', value: '#target', type: 'subtree-modified' }) as { id: string }
  await assert.rejects(session.command('breakpoint', { kind: 'dom', value: '#absent', type: 'subtree-modified' }), /요소/)
  const changing = page.locator('#target').evaluate(el => el.append('changed'))
  const deadline = Date.now() + 3000
  while (!session.snapshot().frames.length) { assert.ok(Date.now() < deadline); await new Promise(r => setTimeout(r, 10)) }
  const stopped = session.snapshot(), frame = stopped.frames[0]
  assert.equal(stopped.reason, 'DOM')
  const evaluated = await session.command('evaluate', { revision: stopped.revision, frameId: frame.id, expression: '({counter: 3})' }) as { result: { objectId: string } }
  const props = await session.command('properties', { revision: stopped.revision, objectId: evaluated.result.objectId }) as { result: { name: string }[] }
  assert.ok(props.result.some(p => p.name === 'counter'))
  assert.match((await session.command('source', { scriptId: frame.scriptId }) as { content: string }).content, /append/)
  await session.command('resume', { revision: stopped.revision }); await changing
  await assert.rejects(session.command('evaluate', { revision: stopped.revision, frameId: frame.id, expression: '1' }), /시점/)
  await session.command('removeBreakpoint', { id: bp.id })
  await session.command('breakpoint', { kind: 'event', value: 'click' }); await session.command('breakpoint', { kind: 'xhr', value: '/fixture' })
  setFeature(account, 'browser', false)
  assert.equal(session.snapshot().closed, true)
  await assert.rejects(session.command('pause', {}), /종료/)
})
