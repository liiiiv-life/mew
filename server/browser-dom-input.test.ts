import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import { WebSocket } from 'ws'
import { DomBrowserSession, domBrowserExecutable, type DomInput } from './browser-dom.ts'

class InputSocket extends EventEmitter {
  readyState = WebSocket.OPEN as number
  bufferedAmount = 0
  packets: { type: string; message?: string }[] = []
  closeCode?: number
  send(data: string) { this.packets.push(JSON.parse(data)) }
  close(code: number) { this.closeCode = code; this.readyState = WebSocket.CLOSED; this.emit('close') }
  input(input: DomInput | null) { this.emit('message', Buffer.from(JSON.stringify(input))) }
}

const field = (value: string, id = 1): DomInput => ({ kind: 'input', frame: 'main', generation: 1, id, value })
const enter: DomInput = { kind: 'key', frame: 'main', generation: 1, id: 1, key: 'Enter' }

test('history navigation starts before a blocked old-page title lookup resolves', async (t) => {
  for (const kind of ['back', 'forward'] as const) await t.test(kind, async () => {
    const session = new DomBrowserSession('navigation@example.test', kind, 'https://example.test/', [], '', true)
    const title = deferred()
    let started = false
    let reads = 0
    const socket = new InputSocket()
    session.socket = socket as unknown as WebSocket
    session.page = {
      url: () => 'https://example.test/',
      title: async () => { if (++reads === 1) await title.promise; return 'Document' },
      goBack: async () => { started = true },
      goForward: async () => { started = true },
      close: async () => {},
    } as unknown as NonNullable<DomBrowserSession['page']>
    const navigation = session.input({ kind })
    try {
      await setImmediate()
      assert.equal(started, true, 'page metadata must not delay navigation')
      await navigation
      const packets = socket.packets.length
      title.resolve()
      await setImmediate()
      assert.equal(socket.packets.length, packets, 'late old metadata must not replace the completed navigation status')
    } finally {
      title.resolve()
      await navigation
      await session.close()
    }
  })
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function fixture(t: test.TestContext) {
  const session = new DomBrowserSession('queue@example.test', 'queue', 'https://example.test', [], 'http://localhost')
  session.start = async () => {}
  const socket = new InputSocket()
  await session.attach(socket as unknown as WebSocket)
  t.after(() => session.close())
  return { session, socket }
}

test('a slow action followed by 500 input updates submits the latest value in order', async (t) => {
  const { session, socket } = await fixture(t)
  const gate = deferred()
  const applied: DomInput[] = []
  session.input = async (input) => {
    applied.push(input)
    if (input.kind === 'click') await gate.promise
  }
  socket.input({ kind: 'click', id: 1 })
  await setImmediate()
  for (let i = 0; i < 500; i++) socket.input(field(`text-${i}`))
  socket.input(enter)
  gate.resolve()
  await setImmediate()
  assert.deepEqual(applied, [{ kind: 'click', id: 1 }, field('text-499'), enter])
  assert.equal(socket.closeCode, undefined)
})

test('coalescing never crosses keys, fields, frames, or document generations', async (t) => {
  const { session, socket } = await fixture(t)
  const applied: DomInput[] = []
  session.input = async (input) => { applied.push(input) }
  const updates = [field('first'), enter, field('second'), field('other', 2),
    { ...field('child'), frame: 'child' }, { ...field('new document'), generation: 2 }]
  for (const input of updates) socket.input(input)
  await setImmediate()
  assert.deepEqual(applied, updates)
})

test('dialog responses bypass a full queue and stop cancels pending and active actions', async (t) => {
  const { session, socket } = await fixture(t)
  const applied: string[] = []
  let aborted = false
  session.input = async (input, signal) => {
    applied.push(input.kind)
    if (input.kind === 'click') await new Promise<void>((resolve) => signal?.addEventListener('abort', () => { aborted = true; resolve() }, { once: true }))
  }
  socket.input({ kind: 'click', id: 1 })
  await setImmediate()
  for (let i = 0; i < 100; i++) socket.input(enter)
  socket.input({ kind: 'dialog', accept: true })
  socket.input({ kind: 'stop' })
  await setImmediate()
  assert.deepEqual(applied, ['click', 'dialog', 'stop'])
  assert.equal(aborted, true)
  assert.equal(socket.closeCode, undefined)
})

test('unmergeable overflow reports failure and closes instead of silently dropping input', async (t) => {
  const { session, socket } = await fixture(t)
  const applied: DomInput[] = []
  session.input = async (input) => { applied.push(input) }
  for (let i = 0; i < 102; i++) socket.input(enter)
  await setImmediate()
  assert.equal(socket.closeCode, 1013)
  assert(socket.packets.some((packet) => packet.type === 'error' && packet.message?.includes('입력')))
  assert.deepEqual(applied, [])
})

test('reconnection and navigation discard work waiting for startup', async (t) => {
  const { session, socket } = await fixture(t)
  const gate = deferred()
  session.start = () => gate.promise
  const applied: DomInput[] = []
  session.input = async (input) => { applied.push(input) }
  socket.input(field('old connection'))
  socket.input(enter)
  const replacement = new InputSocket()
  const attaching = session.attach(replacement as unknown as WebSocket)
  replacement.input(field('before navigation'))
  replacement.input({ kind: 'navigate', url: 'https://example.test/next' })
  gate.resolve()
  await attaching
  await setImmediate()
  assert.deepEqual(applied, [{ kind: 'navigate', url: 'https://example.test/next' }])
})

test('one failed action does not poison later input and malformed packets cannot crash the handler', async (t) => {
  const { session, socket } = await fixture(t)
  const applied: DomInput[] = []
  session.input = async (input) => {
    if (input.kind === 'click') throw new Error('detached')
    applied.push(input)
  }
  socket.input({ kind: 'click', id: 1 })
  socket.input(field('after failure'))
  socket.input(enter)
  await setImmediate()
  assert.deepEqual(applied, [field('after failure'), enter])
  assert(socket.packets.some((packet) => packet.type === 'notice'))
  assert.doesNotThrow(() => socket.input(null))
  assert.equal(socket.closeCode, 1008)
})

test('a newer gesture cancels pending hover without reporting a failed user action', async (t) => {
  const { session, socket } = await fixture(t)
  let aborted = false
  const applied: string[] = []
  session.input = async (input, signal) => {
    if (input.kind === 'hover') await new Promise<void>((_resolve, reject) => {
      signal?.addEventListener('abort', () => { aborted = true; reject(new Error('superseded')) }, { once: true })
    })
    else applied.push(input.kind)
  }
  socket.input({ kind: 'hover', id: 1 })
  await setImmediate()
  socket.input({ kind: 'scroll', id: 2, x: 0, y: 500 })
  socket.input(enter)
  await setImmediate()
  assert.equal(aborted, true)
  assert.deepEqual(applied, ['scroll', 'key'])
  assert(!socket.packets.some((packet) => packet.type === 'notice'))
})

test('stale hover never scrolls the document or nested panes and visible hover still works', { skip: !domBrowserExecutable(), timeout: 20_000 }, async (t) => {
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.end(`<!doctype html><body style="margin:0;height:4000px">
      <button id="visible" onmouseover="this.textContent='hovered'">Visible</button>
      <div id="pane" style="height:100px;overflow:auto"><div style="height:1000px"></div><button id="nested">Nested</button></div>
      <button id="hidden" style="display:none">Hidden</button>
      <button id="far" style="position:absolute;top:3000px">Far</button>
      <input id="field" style="position:fixed;top:200px">`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const session = new DomBrowserSession('hover@example.test', 'hover', origin, [], origin)
  t.after(async () => { await session.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) })
  const socket = new InputSocket()
  await session.attach(socket as unknown as WebSocket)
  const page = session.page!
  await page.waitForFunction('window.rrwebRecord?.record.mirror.getId(document.querySelector("#far")) > 0')
  const ids = await page.evaluate<Record<string, number>>('Object.fromEntries([...document.querySelectorAll("[id]")].map(n => [n.id, rrwebRecord.record.mirror.getId(n)]))')
  const target = { frame: 'main', generation: session.generation }
  for (const name of ['far', 'nested', 'hidden', 'visible']) {
    // Await real processing so a later input cannot cancel the regression away.
    await session.input({ kind: 'hover', ...target, id: ids[name] }).catch(() => {})
    assert.equal(await page.evaluate('scrollY'), 0, `${name} hover scrolled the document`)
    assert.equal(await page.locator('#pane').evaluate((node) => node.scrollTop), 0, `${name} hover scrolled a pane`)
  }
  assert.equal(await page.locator('#visible').textContent(), 'hovered')
  socket.input({ kind: 'hover', ...target, id: ids.hidden })
  await page.waitForTimeout(300)
  socket.input({ kind: 'input', ...target, id: ids.field, value: 'still responsive' })
  await page.waitForFunction('document.querySelector("#field").value === "still responsive"')
  assert(!socket.packets.some((packet) => packet.type === 'notice'))
})

test('real Chromium recovers from an unavailable select option and submits the latest burst value', { skip: !domBrowserExecutable(), timeout: 20_000 }, async (t) => {
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.end('<!doctype html><select id="choice"><option value="available">Available</option></select><form onsubmit="event.preventDefault();document.querySelector(\'output\').textContent=document.querySelector(\'input\').value"><input><button>Submit</button></form><output></output>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const session = new DomBrowserSession('chromium-queue@example.test', 'queue', origin, [], origin)
  t.after(async () => { await session.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) })
  const socket = new InputSocket()
  await session.attach(socket as unknown as WebSocket)
  const page = session.page!
  await page.waitForFunction('window.rrwebRecord?.record.mirror.getId(document.querySelector("input")) > 0')
  // General profiles have no default action timeout. Reproduce that condition
  // without opening or touching an account's persistent browser profile.
  page.setDefaultTimeout(0)
  const ids = await page.evaluate<{ input: number; select: number }>('({ input: rrwebRecord.record.mirror.getId(document.querySelector("input")), select: rrwebRecord.record.mirror.getId(document.querySelector("select")) })')
  const target = { frame: 'main', generation: session.generation }
  socket.input({ kind: 'input', ...target, id: ids.select, value: 'missing' })
  for (let i = 0; i < 500; i++) socket.input({ kind: 'input', ...target, id: ids.input, value: `latest-${i}` })
  socket.input({ kind: 'key', ...target, id: ids.input, key: 'Enter' })
  await page.waitForFunction('document.querySelector("output").textContent === "latest-499"', undefined, { timeout: 7000 })
  assert.equal(socket.closeCode, undefined)
  assert(socket.packets.some((packet) => packet.type === 'notice'))
  // Cancel a real pending Playwright action; fresh input must proceed promptly.
  socket.input({ kind: 'input', ...target, id: ids.select, value: 'still-missing' })
  await setImmediate()
  socket.input({ kind: 'stop' })
  socket.input({ kind: 'input', ...target, id: ids.input, value: 'after-stop' })
  await page.waitForFunction('document.querySelector("input").value === "after-stop"', undefined, { timeout: 1500 })
})
