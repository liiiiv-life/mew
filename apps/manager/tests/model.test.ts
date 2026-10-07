import test from 'node:test'
import assert from 'node:assert/strict'
import { canRetryUpdate, canUpdate, stateOf } from '../src/model.ts'
import { fixture } from './fixture.ts'
test('reboot, unsupported hardware and foreign distributions cannot start installation', () => {
  for (const system of [{ ...fixture.system, rebootRequired: true }, { ...fixture.system, virtualization: false }, { ...fixture.system, supported: false }, { ...fixture.system, managed: false }, { ...fixture.system, distroVersion: 1 }]) {
    assert.equal(stateOf({ ...fixture, system, linux: null }).action, null)
  }
  assert.equal(stateOf({ ...fixture, linux: null }).action, 'install')
})
test('server response and process state determine open, restart and start actions', () => {
  assert.equal(stateOf(fixture).action, 'open')
  assert.equal(stateOf({ ...fixture, httpOk: false }).action, 'restart')
  assert.equal(stateOf({ ...fixture, linux: { ...fixture.linux!, running: false }, httpOk: false }).action, 'start')
})
test('updates require a clean managed main branch with only upstream commits', () => {
  const update = { ahead: 0, behind: 3, latest: 'b2c3d4e5', commits: [] }
  assert.equal(canUpdate(fixture, update), true)
  assert.equal(canUpdate(fixture, { ...update, ahead: 1 }), false)
  assert.equal(canUpdate(fixture, { ...update, behind: 0 }), false)
  assert.equal(canUpdate({ ...fixture, linux: { ...fixture.linux!, dirty: true } }, update), false)
  assert.equal(canUpdate({ ...fixture, linux: { ...fixture.linux!, branch: 'experiment' } }, update), false)
  assert.equal(canUpdate({ ...fixture, system: { ...fixture.system, managed: false } }, update), false)
})

test('failed update remains retryable after pull reached latest HEAD', () => {
  const snapshot = { ...fixture, lastOperation: { action: 'update', status: 'failed', time: Date.now() } }
  assert.equal(canUpdate(snapshot, { ahead: 0, behind: 0, latest: 'new-head', commits: [] }), false)
  assert.equal(canRetryUpdate(snapshot), true)
  assert.equal(canRetryUpdate({ ...snapshot, linux: { ...snapshot.linux!, dirty: true } }), false)
})
