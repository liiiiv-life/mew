import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareDesktop } from './desktop-preparation.ts'

function fixture(responses: unknown[]) {
  const calls: string[] = [], available: boolean[] = [], notes: string[] = []
  const abort = new AbortController()
  const options = {
    signal: abort.signal, message: (value: string) => notes.push(value), installable: (value: boolean) => available.push(value),
    pause: async (_ms: number, signal: AbortSignal) => { signal.throwIfAborted() },
    request: (async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`)
      assert.ok(responses.length, 'no unplanned retry')
      const next = responses.shift()
      return next instanceof Response ? next : Response.json(next)
    }) as typeof fetch,
  }
  return { options, calls, available, notes, abort }
}

test('ready desktop skips installation; missing or stale desktop prepares once and rechecks before connecting', async () => {
  const ready = fixture([{ ready: true }])
  await prepareDesktop(ready.options)
  assert.deepEqual(ready.calls, ['GET /api/remote-desktop/status'])
  const setup = fixture([{ ready: false, installable: true }, { state: 'running' }, { state: 'running' }, { state: 'succeeded' }, { ready: true }])
  await prepareDesktop(setup.options)
  assert.equal(setup.calls.filter(call => call.startsWith('POST')).length, 1)
  assert.equal(setup.calls.at(-1), 'GET /api/remote-desktop/status')
  assert.deepEqual(setup.available, [true, false])
  assert.match(setup.notes[0], /몇 분/)
})

test('failed preparation does not loop; unsupported hosts and auth failures never start installation', async () => {
  for (const state of ['failed', 'interrupted']) {
    const f = fixture([{ ready: false, installable: true }, { state }])
    await assert.rejects(prepareDesktop(f.options), /준비/)
    assert.equal(f.calls.length, 2)
  }
  for (const response of [{ ready: false, installable: false, message: '데스크톱 로그인이 필요합니다.' }, new Response('', { status: 403 })]) {
    const f = fixture([response])
    await assert.rejects(prepareDesktop(f.options), /로그인/)
    assert.equal(f.calls.length, 1)
  }
  const stale = fixture([{ ready: false, installable: true }, { state: 'succeeded' }, { ready: false, message: '파일 확인 실패' }])
  await assert.rejects(prepareDesktop(stale.options), /파일 확인 실패/)
})

test('closing during preparation aborts polling without killing the shared installer or connecting', async () => {
  const f = fixture([{ ready: false, installable: true }, { state: 'running' }])
  f.options.pause = async () => { f.abort.abort(); f.abort.signal.throwIfAborted() }
  await assert.rejects(prepareDesktop(f.options), { name: 'AbortError' })
  assert.equal(f.calls.length, 2)
})
