import test from 'node:test'
import assert from 'node:assert/strict'
import { stripRemoteSessionFrame, validRemoteSession } from './remote-session.ts'

test('local session changes reach the trusted launcher while installed app responses contain no bearer', () => {
  const token = 's'.repeat(43), sessions: string[] = []
  const raw = JSON.stringify({ type: 'response', id: 'login', status: 200, headers: { 'content-type': 'application/json', 'X-Mew-Session': token } })
  const response = JSON.parse(stripRemoteSessionFrame(raw, value => sessions.push(value)))
  assert.deepEqual(sessions, [token])
  assert.deepEqual(response.headers, { 'content-type': 'application/json' })
  assert.equal(stripRemoteSessionFrame(JSON.stringify({ type: 'end', id: 'login' }), () => assert.fail('No session in end frame')), '{"type":"end","id":"login"}')
})

test('logout clears persistence and malformed session headers are discarded without persisting', () => {
  const sessions: string[] = []
  for (const value of ['', 'short', 'a'.repeat(44), '!'.repeat(43)]) {
    const response = JSON.parse(stripRemoteSessionFrame(JSON.stringify({ type: 'response', id: 'logout', status: 200, headers: { 'x-mew-session': value } }), session => sessions.push(session)))
    assert.deepEqual(response.headers, {})
  }
  assert.deepEqual(sessions, [''])
  assert.equal(validRemoteSession(null), false)
  assert.equal(validRemoteSession('a'.repeat(43)), true)
})
