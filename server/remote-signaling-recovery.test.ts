import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { RemoteSignalingRecovery } from '../shared/remote-signaling-recovery.ts'
import type { SignalStorage, SignalSqlValue } from '../shared/remote-signaling-state.ts'

test('detached signaling state survives reconstruction, stays bounded and never admits expired leases', t => {
  const database = new DatabaseSync(':memory:')
  t.after(() => database.close())
  const storage: SignalStorage = {
    sql: { exec<T extends Record<string, SignalSqlValue>>(query: string, ...bindings: SignalSqlValue[]) {
      const rows = database.prepare(query).all(...bindings) as T[]
      return { toArray: () => rows }
    } },
    transactionSync<T>(callback: () => T): T {
      database.exec('BEGIN')
      try { const result = callback(); database.exec('COMMIT'); return result }
      catch (error) { database.exec('ROLLBACK'); throw error }
    },
  }
  const first = new RemoteSignalingRecovery<{ connection: string; expires: number; generation: string }>(storage)
  const expires = Date.now() + 1000
  for (let i = 0; i < 8; i++) assert.equal(first.put({ connection: 'peer-' + i, expires, generation: 'generation-' + i }), true)
  assert.equal(first.put({ connection: 'over-limit', expires, generation: 'unknown' }), false)
  const restored = new RemoteSignalingRecovery<{ connection: string; expires: number; generation: string }>(storage)
  assert.deepEqual(restored.get('peer-2'), { connection: 'peer-2', expires, generation: 'generation-2' })
  assert.equal(restored.all().length, 8)
  assert.equal(restored.put({ connection: 'peer-2', expires: Date.now() - 1, generation: 'expired' }), false)
  assert.equal(restored.get('peer-2')!.expires, expires)
  restored.delete('peer-2'); restored.delete('peer-2')
  assert.equal(restored.get('peer-2'), undefined)
  assert.equal(restored.put({ connection: 'replacement', expires, generation: 'new' }), true)
})
