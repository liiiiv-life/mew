import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_AGENT_QUEUE_EDIT_HEIGHT,
  MIN_AGENT_INPUT_HEIGHT,
  MIN_AGENT_QUEUE_EDIT_HEIGHT,
  agentInputMaxHeight,
  agentQueueEditMaxHeight,
  resizedHeightFromTop,
} from './agentInputLayout.ts'

test('agent input maximum leaves room for the session toolbar and conversation', () => {
  assert.equal(agentInputMaxHeight(900), 820)
})

test('agent input maximum excludes the covered viewport and queued controls', () => {
  assert.equal(agentInputMaxHeight(900, 240, 112), 500)
})

test('agent input maximum never falls below the usable composer minimum', () => {
  assert.equal(agentInputMaxHeight(180, 80, 64), MIN_AGENT_INPUT_HEIGHT)
})

test('queue editor maximum leaves the composer and conversation visible', () => {
  assert.equal(agentQueueEditMaxHeight(900), 360)
  assert.equal(agentQueueEditMaxHeight(240), MIN_AGENT_QUEUE_EDIT_HEIGHT)
  assert.ok(DEFAULT_AGENT_QUEUE_EDIT_HEIGHT > MIN_AGENT_QUEUE_EDIT_HEIGHT)
})

test('top resize grows upward, shrinks downward, and clamps both ends', () => {
  assert.equal(resizedHeightFromTop(72, 300, 250, 64, 360), 122)
  assert.equal(resizedHeightFromTop(72, 300, 340, 64, 360), 64)
  assert.equal(resizedHeightFromTop(300, 300, 100, 64, 360), 360)
})
