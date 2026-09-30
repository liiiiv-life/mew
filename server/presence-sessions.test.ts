import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { attachPresenceWebSocket } from './presence.ts'
import { readPresenceHistory } from './presence-history.ts'
import type { RequestAuth } from './reqAuth.ts'
import type { ActiveMewSessions } from '../shared/active-sessions.ts'

interface Update { type: string; participants: Record<string, string[]>; activeSessions?: ActiveMewSessions }

test('presence counts browser connections and protects the live identity roster', { timeout: 10_000 }, async (t) => {
  const guest: RequestAuth = { role: 'guest', email: null, mustChangePassword: false }
  const member: RequestAuth = { role: 'member', email: 'presence-test@example.invalid', mustChangePassword: false }
  const identities = new Map<string, RequestAuth>([['one', member], ['two', member]])
  const server = createServer()
  attachPresenceWebSocket(server, { getAuth: req => identities.get(String(req.headers['x-test-client'])) ?? guest })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const clients: WebSocket[] = []
  async function connect(key: string, agent = 'Mozilla/5.0 (iPhone) Version/18.0 Safari/605.1') {
    const ws = new WebSocket(`ws://127.0.0.1:${(address as { port: number }).port}/api/presence`, { headers: { 'x-test-client': key, 'user-agent': agent } })
    clients.push(ws)
    const updates: Update[] = []
    ws.on('message', raw => updates.push(JSON.parse(raw.toString()) as Update))
    await once(ws, 'open')
    async function until(check: (update: Update) => boolean): Promise<Update> {
      for (let i = 0; i < 200; i++) {
        const latest = updates.at(-1)
        if (latest && check(latest)) return latest
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      assert.fail(`No matching presence update: ${JSON.stringify(updates.at(-1))}`)
    }
    return { ws, updates, until }
  }
  try {
    const one = await connect('one')
    const first = (await one.until(m => m.activeSessions?.sessions.length === 1)).activeSessions!
    assert.equal(first.sessions[0].id, first.selfId)
    assert.equal(first.sessions[0].email, member.email)
    assert.equal(first.sessions[0].browser, 'Safari')
    assert.equal(first.sessions[0].device, 'iPhone')
    assert.equal(first.sessions[0].path, null)
    assert.equal(first.sessions[0].agents, null)
    assert.equal('memory' in first.sessions[0], false)
    assert.ok(first.sessions[0].connectedAt <= Date.now())

    const two = await connect('two', 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36 Edg/140.0')
    const second = (await two.until(m => m.activeSessions?.sessions.length === 2)).activeSessions!
    assert.notEqual(second.selfId, first.selfId)
    await one.until(m => m.activeSessions?.sessions.length === 2)
    assert.equal(second.sessions.filter(s => s.email === member.email).length, 2)
    assert.equal(second.sessions.find(s => s.id === second.selfId)?.browser, 'Edge')

    two.ws.send(JSON.stringify({ type: 'focus', path: '.workspace:src/example.ts', color: '#123456', workspaceLabel: 'mew', visible: false, email: 'spoof@example.invalid', displayName: 'Spoof', runningAgents: 2 }))
    const focused = (await one.until(m => m.activeSessions?.sessions.some(s => s.path === 'src/example.ts') === true)).activeSessions!.sessions.find(s => s.id === second.selfId)!
    assert.equal(focused.email, member.email)
    assert.notEqual(focused.displayName, 'Spoof')
    assert.equal(focused.project, '.workspace')
    assert.equal(focused.workspaceLabel, 'mew')
    assert.equal(focused.visible, false)
    assert.equal(focused.agents?.running, 2)
    assert.ok(focused.agents && focused.agents.reportedAt <= Date.now())
    assert.equal(one.updates.at(-1)?.activeSessions?.sessions.find(s => s.id === first.selfId)?.agents, null)
    // Stale reports expire during normal broadcasts; a peer cannot extend them.
    const later = t.mock.method(Date, 'now', () => focused.agents!.reportedAt + 90_001)
    one.ws.send(JSON.stringify({ type: 'focus', path: null }))
    await one.until(m => m.activeSessions?.sessions.find(s => s.id === second.selfId)?.agents === null)
    later.mock.restore()
    for (const invalid of [-1, 0.5, '1024', 1e100, null]) {
      two.ws.send(JSON.stringify({ type: 'focus', path: null, workspaceLabel: String(invalid), runningAgents: invalid }))
      const update = await one.until(m => m.activeSessions?.sessions.some(s => s.id === second.selfId && s.workspaceLabel === String(invalid)) === true)
      assert.equal(update.activeSessions!.sessions.find(s => s.id === second.selfId)?.agents, null)
    }
    two.ws.send(JSON.stringify({ type: 'focus', path: null, runningAgents: 0 }))
    await one.until(m => m.activeSessions?.sessions.find(s => s.id === second.selfId)?.agents?.running === 0)

    const visitor = await connect('guest')
    const guestUpdate = await visitor.until(m => m.type === 'participants')
    assert.equal(guestUpdate.activeSessions, undefined)
    assert.equal(JSON.stringify(guestUpdate).includes(member.email!), false)
    assert.equal(guestUpdate.participants['.workspace:src/example.ts'], undefined)
    const withGuest = (await one.until(m => m.activeSessions?.sessions.length === 3)).activeSessions!
    assert.equal(withGuest.sessions.filter(s => s.email === null).length, 1)

    two.ws.send(JSON.stringify({ type: 'focus', path: null, project: 'docs', workspaceLabel: 'other', visible: true }))
    const moved = (await one.until(m => m.activeSessions?.sessions.some(s => s.id === second.selfId && s.workspaceLabel === 'other') === true)).activeSessions!.sessions.find(s => s.id === second.selfId)!
    assert.equal(moved.path, null)
    assert.equal(moved.project, 'docs')
    assert.equal(moved.visible, true)

    // An existing socket loses roster access when its login session is revoked.
    identities.delete('two')
    two.ws.send(JSON.stringify({ type: 'focus', path: null }))
    await two.until(m => m.activeSessions === undefined)
    await one.until(m => m.activeSessions?.sessions.filter(s => s.email === null).length === 2)
    identities.set('two', { ...member, mustChangePassword: true })
    two.ws.send(JSON.stringify({ type: 'focus', path: null, workspaceLabel: 'password' }))
    await one.until(m => m.activeSessions?.sessions.some(s => s.workspaceLabel === 'password' && s.email === null) === true)
    assert.equal(two.updates.at(-1)?.activeSessions, undefined)

    visitor.ws.terminate()
    await one.until(m => m.activeSessions?.sessions.length === 2)
    two.ws.close()
    const remaining = (await one.until(m => m.activeSessions?.sessions.length === 1)).activeSessions!
    assert.equal(remaining.selfId, first.selfId)
    const from = first.sessions[0].connectedAt - 1, to = Date.now() + 120_000
    const history = readPresenceHistory({ from, to, dayFrom: from, dayTo: to }, { role: 'owner', email: null, mustChangePassword: false })
    const saved = history.records.filter(record => record.id === second.selfId)
    assert.ok(saved.length > 1)
    assert.ok(saved.every(record => record.disconnectedAt !== null))
    assert.ok(saved.some(record => record.email === member.email))
    assert.ok(saved.some(record => record.email === null))
    assert.equal(JSON.stringify(saved).includes('Spoof'), false)
    one.ws.send('null')
    one.ws.send(JSON.stringify({ type: 'focus', path: '.workspace:alive.md' }))
    await one.until(m => m.participants['.workspace:alive.md']?.length === 1)
  } finally {
    for (const client of clients) client.terminate()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
