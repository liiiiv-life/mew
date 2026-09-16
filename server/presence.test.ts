import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { treeSignalFor } from './presence.ts'

const signal = { type: 'tree' as const, project: '.workspace', version: 7, parents: ['private/name'] }

test('tree 부분 갱신 경로는 guest에게 노출하지 않는다', () => {
  assert.deepEqual(
    treeSignalFor({ role: 'guest', email: null, mustChangePassword: false }, signal),
    { type: 'tree' },
  )
  assert.equal(
    treeSignalFor({ role: 'member', email: 'member@example.com', mustChangePassword: false }, signal),
    signal,
  )
})
