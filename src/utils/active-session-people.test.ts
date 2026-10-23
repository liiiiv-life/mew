import test from 'node:test'
import assert from 'node:assert/strict'
import { otherConnectedPeople } from './active-session-people.ts'
import type { ActiveMewSession, ActiveMewSessions } from '../../shared/active-sessions.ts'

const session = (id: string, email: string | null): ActiveMewSession => ({ id, email, displayName: null, browser: null, device: null, connectedAt: 0, workspaceLabel: null, project: null, path: null, visible: true })
const roster = (...sessions: ActiveMewSession[]): ActiveMewSessions => ({ selfId: 'self', sessions })

test('other people excludes this account on every device and deduplicates authenticated identities', () => {
  assert.equal(otherConnectedPeople(roster(session('self', 'me@example.test'), session('phone', ' ME@example.test ')), 'me@example.test'), 0)
  assert.equal(otherConnectedPeople(roster(session('self', 'me@example.test'), session('a', 'Other@example.test'), session('b', ' other@example.test ')), 'me@example.test'), 1)
})

test('separate people and anonymous connections count individually without counting the current session', () => {
  const presence = roster(session('self', null), session('one', 'one@example.test'), session('two', 'two@example.test'), session('guest-one', null), session('guest-two', null))
  assert.equal(otherConnectedPeople(presence, null), 4)
  assert.equal(otherConnectedPeople(null, 'me@example.test'), 0)
})

test('roster identity covers a missing profile email and profile changes use the new current account', () => {
  const presence = roster(session('self', 'me@example.test'), session('phone', 'me@example.test'), session('other', 'other@example.test'))
  assert.equal(otherConnectedPeople(presence, null), 1)
  assert.equal(otherConnectedPeople(presence, 'other@example.test'), 1)
})
