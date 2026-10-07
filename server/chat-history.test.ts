import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { createApiApp } from './api.ts'
import { ChatError, deleteChatHistory, GROUP, listChatFor, markChatRead, postChatMessage } from './chat.ts'
import type { Role } from './reqAuth.ts'

const owner = 'owner@example.com'
const peer = 'peer@example.com'
const other = 'other@example.com'
const members = [owner, peer, other]

test('chat history deletion is owner-only and limited to the selected participating conversation', async () => {
  let role: Role = 'owner'
  let mustChangePassword = false
  const app = express()
  app.use((req, _res, next) => {
    req.auth = { role, email: role === 'guest' ? null : owner, mustChangePassword }
    next()
  })
  app.use('/api', createApiApp())
  const server = http.createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/chat`
  const remove = (conversation: unknown) => fetch(base, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation }),
  })
  try {
    postChatMessage(peer, 'group')
    postChatMessage(owner, 'outgoing DM', [peer])
    postChatMessage(peer, 'incoming DM', [owner])
    const hidden = postChatMessage(peer, 'other people DM', [other])
    for (const denied of ['manager', 'member', 'guest'] as const) {
      role = denied
      assert.equal((await remove(GROUP)).status, 403)
      assert.equal(listChatFor(owner, members).messages.length, 3)
      if (role !== 'guest') {
        const view = await (await fetch(base)).json() as { canDeleteHistory: boolean }
        assert.equal(view.canDeleteHistory, false)
      }
    }
    role = 'owner'
    mustChangePassword = true
    assert.equal((await remove(GROUP)).status, 403)
    mustChangePassword = false
    const view = await (await fetch(base)).json() as { canDeleteHistory: boolean; messages: { id: string }[] }
    assert.equal(view.canDeleteHistory, true)
    assert.equal(view.messages.some(message => message.id === hidden.id), false)
    for (const invalid of [null, '', ' ', 42, owner]) assert.equal((await remove(invalid)).status, 400)
    assert.deepEqual(await (await remove(peer)).json(), { ok: true, deleted: 2 })
    assert.deepEqual(listChatFor(owner, members).messages.map(message => message.text), ['group'])
    assert.deepEqual(listChatFor(other, members).messages.map(message => message.text), ['group', 'other people DM'])
    assert.deepEqual(await (await remove(peer)).json(), { ok: true, deleted: 0 })
    assert.deepEqual(await (await remove(GROUP)).json(), { ok: true, deleted: 1 })
    assert.deepEqual(listChatFor(owner, members).unread, {})
    assert.deepEqual(listChatFor(peer, members).messages.map(message => message.text), ['other people DM'])
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('deleting the latest messages preserves unread semantics even within the same millisecond', () => {
  const now = Date.now
  Date.now = () => 1234567890000
  try {
    // Prior test leaves only an unrelated DM; clear it as a participant.
    deleteChatHistory(peer, other)
    assert.throws(() => deleteChatHistory('', GROUP), ChatError)
    postChatMessage(owner, 'first')
    const last = postChatMessage(owner, 'second')
    markChatRead(peer, GROUP)
    assert.equal(deleteChatHistory(owner, GROUP), 2)
    const next = postChatMessage(owner, 'after deletion')
    assert.ok(next.time > last.time)
    assert.equal(listChatFor(peer, members).unread[GROUP], 1)
    assert.equal(listChatFor(owner, members).messages[0].unread, 2)
    deleteChatHistory(owner, GROUP)
    postChatMessage(owner, 'shared mention', [peer, other])
    assert.equal(deleteChatHistory(owner, peer), 1)
    assert.deepEqual(listChatFor(other, members).messages, [])
  } finally {
    Date.now = now
  }
})
