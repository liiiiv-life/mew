import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MIN_AGENT_INPUT_HEIGHT,
  agentInputMaxHeight,
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
