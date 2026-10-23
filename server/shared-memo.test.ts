import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as Y from 'yjs'
import type { IncomingMessage } from 'node:http'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-memo-'))
process.env.MEW_DATA_DIR = directory
test.after(() => fs.rmSync(directory, { recursive: true, force: true }))

test('shared memo persists concurrent edits, deletion and CRDT identity; failed writes do not publish', async () => {
  const { createSharedMemoDoc } = await import('./shared-memo.ts')
  const file = path.join(directory, 'memo.json')
  let room = createSharedMemoDoc(file)
  const first = new Y.Doc(), second = new Y.Doc()
  try {
    Y.applyUpdate(first, room.encodeStateAsUpdate()); Y.applyUpdate(second, room.encodeStateAsUpdate())
    assert.equal(first.getXmlFragment('default').length, 1, 'the server seeds a single shared empty paragraph')
    first.getText('test').insert(0, 'A'); second.getText('test').insert(0, 'B')
    room.applyUpdate(Y.encodeStateAsUpdate(first)); room.applyUpdate(Y.encodeStateAsUpdate(second))
    Y.applyUpdate(first, room.encodeStateAsUpdate()); Y.applyUpdate(second, room.encodeStateAsUpdate())
    assert.equal(first.getText('test').length, 2)
    assert.equal(first.getText('test').toString(), second.getText('test').toString())
    const before = room.encodeStateAsUpdate()
    room.destroy(); room = createSharedMemoDoc(file)
    assert.deepEqual(room.encodeStateAsUpdate(), before)
    assert.equal(room.applyUpdate(Y.encodeStateAsUpdate(first)), null, 'reconnecting a known client never duplicates content')
    first.getText('test').delete(0, 2)
    room.applyUpdate(Y.encodeStateAsUpdate(first))
    room.destroy(); room = createSharedMemoDoc(file)
    Y.applyUpdate(second, room.encodeStateAsUpdate())
    assert.equal(second.getText('test').toString(), '', 'deletions survive all clients closing')
    const saved = room.encodeStateAsUpdate()
    fs.unlinkSync(file); fs.mkdirSync(file)
    first.getText('test').insert(0, 'unsaved')
    assert.throws(() => room.applyUpdate(Y.encodeStateAsUpdate(first)))
    assert.deepEqual(room.encodeStateAsUpdate(), saved)
    fs.rmdirSync(file); fs.writeFileSync(file, '{corrupt')
    assert.throws(() => createSharedMemoDoc(file))
    assert.equal(fs.readFileSync(file, 'utf8'), '{corrupt', 'corrupt storage is never replaced with an empty memo')
  } finally { room.destroy(); first.destroy(); second.destroy() }
})

test('memo authorization is global but still requires a current collaboration-enabled login', async () => {
  const { authorizeCollab } = await import('./reqAuth.ts')
  const { createSession, upsertUser, destroySession } = await import('./auth.ts')
  const { setFeature } = await import('./access-policy.ts')
  const { SHARED_MEMO_ROOM } = await import('../shared/shared-memo.ts')
  const email = 'memo@example.test'
  upsertUser(email, { hash: 'unused', role: 'member', createdAt: 0, passwordChangedAt: 0, mustChangePassword: false })
  const token = createSession(email)
  const request = (cookie = '', room = SHARED_MEMO_ROOM) => ({ url: `/api/collab?room=${encodeURIComponent(room)}`, headers: { cookie } }) as IncomingMessage
  assert.equal(authorizeCollab(request()), false)
  assert.equal(authorizeCollab(request(`mew_session=${token}`)), true)
  assert.equal(authorizeCollab(request(`mew_session=${token}`, `${SHARED_MEMO_ROOM}/other`)), false)
  setFeature(email, 'collaboration', false)
  assert.equal(authorizeCollab(request(`mew_session=${token}`)), false)
  setFeature(email, 'collaboration', true)
  upsertUser(email, { hash: 'unused', role: 'member', createdAt: 0, passwordChangedAt: 0, mustChangePassword: true })
  assert.equal(authorizeCollab(request(`mew_session=${token}`)), false)
  destroySession(token)
})
