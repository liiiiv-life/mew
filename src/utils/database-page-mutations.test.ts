import test from 'node:test'
import assert from 'node:assert/strict'
import { collectDatabasePageMutations, registerDatabasePageMutations, withDatabasePageMutations } from './database-page-mutations.ts'

const mutation = { path: 'Books/_Books.md', moves: [{ from: 'Books.md', to: 'Books/_Books.md' }], changed: ['Books.md', 'Books/_Books.md'] }

test('DB file mutations save drafts before requesting and remap tabs before releasing autosave', async () => {
  const events: string[] = []
  const unregister = registerDatabasePageMutations({
    async prepare(project) { events.push(`save:${project}`); return () => { events.push('release') } },
    apply(change, project) { assert.deepEqual(change, mutation); events.push(`map:${project}`) },
  })
  try {
    const result = await withDatabasePageMutations('docs', async () => {
      events.push('request')
      collectDatabasePageMutations({ documentPageMutations: [mutation] })
      return 'scalar result'
    })
    assert.equal(result, 'scalar result', 'mutation metadata is retained even when an API unwraps its result')
    assert.deepEqual(events, ['save:docs', 'request', 'map:docs', 'release'])
    events.length = 0
    await assert.rejects(withDatabasePageMutations('docs', async () => { throw new Error('denied') }), /denied/)
    assert.deepEqual(events, ['save:docs', 'release'])
  } finally { unregister() }
})

test('queued DB requests do not run against a replacement workspace', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const unregister = registerDatabasePageMutations({ async prepare() { return () => {} }, apply() { assert.fail('late response must not remap the new workspace') } })
  const first = withDatabasePageMutations('docs', async () => { await gate; collectDatabasePageMutations({ documentPageMutations: [mutation] }) })
  const second = withDatabasePageMutations('docs', async () => { assert.fail('stale queued request must not run') })
  const rejected = assert.rejects(second, /프로젝트가 변경/)
  await new Promise(resolve => setImmediate(resolve))
  unregister()
  release()
  await first
  await rejected
})
