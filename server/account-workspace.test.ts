import * as Y from 'yjs'
import { encodeSyncUpdate, decodeMessage, SYNC_UPDATE } from './syncCodec.ts'
import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import express from 'express'
import { WebSocket } from 'ws'
import { createApiApp, tmuxManager } from './api.ts'
import { attachAuthContext, resolveAuth, authorizeCollab } from './reqAuth.ts'
import { createSession, upsertUser } from './auth.ts'
import { attachPresenceWebSocket, broadcast } from './presence.ts'
import { attachCollabWebSocket, closeAllRooms } from './collab.ts'
import { runAccountWorkspace } from './account-workspace.ts'
import { currentWorkspace } from './workspace.ts'
import { WORKSPACE_ROOT, setWorkspaceRoot, resolveProjectPath } from './paths.ts'
import { readActiveWorkspace, writeActiveWorkspace } from './userUiState.ts'
import { waitForSearchIndex } from './searchCatalog.ts'
import { resetTreeWatchers } from './watcher.ts'

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('project selection, requests, broadcasts and collaboration stay within each account root', { timeout: 15000 }, async () => {
  const original = WORKSPACE_ROOT
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-account-workspace-'))
  const roots = ['default', 'first', 'second'].map(name => path.join(root, name))
  for (const [index, folder] of roots.entries()) {
    fs.mkdirSync(path.join(folder, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(folder, 'same.txt'), `account ${index}`)
    fs.writeFileSync(path.join(folder, `only-${index}.txt`), `needle-${index}`)
  }
  setWorkspaceRoot(roots[0])
  const emails = ['first@example.invalid', 'second@example.invalid']
  const cookies = emails.map(email => {
    upsertUser(email, { hash: '', role: 'owner', mustChangePassword: false, createdAt: Date.now(), passwordChangedAt: 0 })
    return `mew_session=${createSession(email)}`
  })
  const app = express()
  app.use('/api', attachAuthContext, createApiApp())
  const server = http.createServer(app)
  attachPresenceWebSocket(server, { getAuth: resolveAuth })
  attachCollabWebSocket(server, { authorize: authorizeCollab })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const sockets: WebSocket[] = []
  async function connect(route: string, cookie?: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${route}`, { headers: cookie ? { Cookie: cookie } : {} })
    const messages: Buffer[] = []
    ws.on('message', data => messages.push(Buffer.from(data as Buffer)))
    sockets.push(ws)
    await once(ws, 'open')
    return { ws, messages }
  }
  async function request(cookie: string | undefined, route: string, body?: object) {
    const response = await fetch(`http://127.0.0.1:${port}/api${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    assert.equal(response.status, 200, await response.clone().text())
    return await response.json() as Record<string, unknown>
  }
  try {
    const first = await connect('/api/presence', cookies[0])
    const sameAccount = await connect('/api/presence', cookies[0])
    const other = await connect('/api/presence', cookies[1])
    const guest = await connect('/api/presence')
    for (const client of [first, sameAccount, other, guest]) client.messages.length = 0
    await request(cookies[0], '/workspace', { path: roots[1] })
    // A marker on each socket proves all preceding workspace notifications were received.
    broadcast({ type: 'test-marker' })
    for (let tries = 0; tries < 100 && !guest.messages.some(raw => JSON.parse(raw.toString()).type === 'test-marker'); tries++) await pause(10)
    const switched = (client: typeof first) => client.messages.filter(raw => JSON.parse(raw.toString()).type === 'workspace').length
    assert.equal(switched(first), 1)
    assert.equal(switched(sameAccount), 1)
    assert.equal(switched(other), 0)
    assert.equal(switched(guest), 0)
    assert.equal((await request(cookies[1], '/workspace')).path, roots[0])
    await request(cookies[1], '/workspace', { path: roots[2] })
    assert.equal(readActiveWorkspace(emails[0]), roots[1])
    assert.equal(readActiveWorkspace(emails[1]), roots[2])
    assert.equal(WORKSPACE_ROOT, roots[0])
    for (let turn = 0; turn < 3; turn++) {
      const values = await Promise.all(cookies.map(cookie => request(cookie, '/file?project=.workspace&path=same.txt')))
      assert.equal(values[0].content, 'account 1')
      assert.equal(values[1].content, 'account 2')
      const trees = await Promise.all(cookies.map(cookie => request(cookie, '/tree?project=.workspace')))
      assert.ok(JSON.stringify(trees[0]).includes('only-1.txt'))
      assert.ok(!JSON.stringify(trees[0]).includes('only-2.txt'))
      assert.ok(JSON.stringify(trees[1]).includes('only-2.txt'))
      assert.ok(!JSON.stringify(trees[1]).includes('only-1.txt'))
    }
    const searches = await Promise.all(cookies.map(cookie => request(cookie, '/search?project=.workspace&q=needle')))
    await Promise.all(emails.map(email => runAccountWorkspace(email, () => waitForSearchIndex('.workspace'))))
    const indexedSearches = await Promise.all(cookies.map(cookie => request(cookie, '/search?project=.workspace&q=needle')))
    for (const [index, results] of indexedSearches.entries()) {
      assert.ok(JSON.stringify(results).includes(`only-${index + 1}.txt`))
      assert.ok(!JSON.stringify(results).includes(`only-${2 - index}.txt`))
    }
    assert.equal(searches.length, 2)
    await Promise.all(emails.map((email, index) => runAccountWorkspace(email, async () => {
      await pause(index === 0 ? 20 : 5)
      assert.equal(currentWorkspace().path, roots[index + 1])
      assert.equal(resolveProjectPath('.workspace', 'same.txt'), path.join(roots[index + 1], 'same.txt'))
      assert.equal(tmuxManager.cwd, roots[index + 1])
    })))
    // Same wire room names under different roots must create distinct server rooms.
    const room = '/api/collab?room=.workspace%3Asame.txt'
    const roomA = await connect(room, cookies[0])
    const roomB = await connect(room, cookies[1])
    const roomA2 = await connect(room, cookies[0])
    assert.equal(roomA.ws.readyState, WebSocket.OPEN)
    assert.equal(roomB.ws.readyState, WebSocket.OPEN)
    assert.equal(roomA2.ws.readyState, WebSocket.OPEN)
    const doc = new Y.Doc()
    doc.getText('text').insert(0, 'first account edit')
    const received = new Promise<Buffer>(resolve => {
      const listener = (data: Buffer) => {
        const message = decodeMessage(data)
        if (message?.channel === 'sync' && message.syncType === SYNC_UPDATE) {
          roomA2.ws.off('message', listener)
          resolve(data)
        }
      }
      roomA2.ws.on('message', listener)
    })
    roomA.ws.send(encodeSyncUpdate(Y.encodeStateAsUpdate(doc)))
    const frame = await received
    const update = decodeMessage(Buffer.from(frame as Buffer))
    assert.equal(update?.channel, 'sync')
    if (update?.channel === 'sync') assert.equal(update.syncType, SYNC_UPDATE)
    await pause(30)
    assert.equal(roomB.messages.some(raw => {
      const message = decodeMessage(raw)
      return message?.channel === 'sync' && message.syncType === SYNC_UPDATE
    }), false, 'edits cannot reach a same-named file in another root')
    await request(cookies[0], '/workspace', { path: roots[0] })
    assert.equal(roomB.ws.readyState, WebSocket.OPEN, 'another account switch keeps the collaboration room alive')
    doc.destroy()
    writeActiveWorkspace(emails[0], path.join(root, 'missing'))
    assert.equal((await request(cookies[0], '/workspace')).path, roots[0])
  } finally {
    for (const ws of sockets) ws.terminate()
    closeAllRooms()
    await new Promise<void>(resolve => server.close(() => resolve()))
    resetTreeWatchers()
    setWorkspaceRoot(original)
    fs.rmSync(root, { recursive: true, force: true })
  }
})
