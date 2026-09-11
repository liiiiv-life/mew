// Ctrl+L 참조가 갈 창 고르기 — 마지막으로 연 창 하나에만 간다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { pickRefTarget } from './refTarget.ts'

test('마지막으로 연 창이 열려 있으면 그 창이 받는다', () => {
  assert.equal(pickRefTarget('chat', { terminal: false, agent: true, chat: true }), 'chat')
  assert.equal(pickRefTarget('agent', { terminal: false, agent: true, chat: false }), 'agent')
})

test('마지막으로 연 창이 닫혔으면 열려 있는 다른 창으로 간다', () => {
  assert.equal(pickRefTarget('chat', { terminal: false, agent: true, chat: false }), 'agent')
})

test('아무 창도 안 열려 있으면 갈 곳이 없다', () => {
  assert.equal(pickRefTarget('agent', { terminal: false, agent: false, chat: false }), null)
  assert.equal(pickRefTarget(null, { terminal: false, agent: false, chat: false }), null)
})

test('분리된 터미널을 마지막으로 사용했으면 참조는 터미널 하나만 받는다', () => {
  assert.equal(pickRefTarget('terminal', { agent: true, terminal: true, chat: true }), 'terminal')
  assert.equal(pickRefTarget('agent', { agent: false, terminal: true, chat: false }), 'terminal')
})
