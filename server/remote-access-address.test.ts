import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRemoteAddress } from './remote-access-address.ts'

test('public device addresses use the canonical username without central credentials', async t => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'https://mew.run/internal-account-id/laptop')
    assert.equal(init?.method, 'HEAD')
    assert.equal(init?.redirect, 'manual')
    assert.equal(init?.headers, undefined)
    return new Response(null, { status: 307, headers: { location: 'https://mew.run/alice/laptop' } })
  })
  assert.deepEqual(await resolveRemoteAddress('https://mew.saens.kr', 'internal-account-id', 'laptop'), {
    username: 'alice', url: 'https://mew.run/alice/laptop', dashboardUrl: 'https://mew.run/alice',
  })
})

test('unverified, foreign, and mismatched addresses never become device links', async t => {
  for (const location of [null, 'https://evil.example/alice/laptop', 'https://mew.run/alice/another-device', 'https://mew.run/internal-account-id/laptop', 'https://mew.run/alice/laptop?token=secret', 'https://mew.run/alice/laptop#fragment', 'https://user:password@mew.run/alice/laptop', 'https://mew.run/alice']) {
    await t.test(String(location), async t => {
      t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: location ? 307 : 200, headers: location ? { location } : {} }))
      await assert.rejects(resolveRemoteAddress('https://mew.run', 'internal-account-id', 'laptop'))
    })
  }
})
