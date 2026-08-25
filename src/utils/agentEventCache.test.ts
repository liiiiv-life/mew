import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentEvent } from './agentFold.ts'

const values = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
}

const {
  clearAgentEventCache,
  mergeAgentReplay,
  readAgentEventCache,
  writeAgentEventCache,
} = await import('./agentEventCache.ts')

const message = (text: string): AgentEvent => ({
  type: 'update',
  update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
})
const update = (
  sessionUpdate: 'user_message_chunk' | 'agent_message_chunk',
  text: string,
): AgentEvent => ({ type: 'update', update: { sessionUpdate, content: { type: 'text', text } } })

test('탭·런타임·cwd별 전사를 저장하고 즉시 다시 읽는다', () => {
  values.clear()
  const events = [message('abc')]
  writeAgentEventCache('claude', 'tab-a', '/work', { sessionId: 'session-a', events })

  assert.deepEqual(readAgentEventCache('claude', 'tab-a', '/work'), { sessionId: 'session-a', events })
  assert.equal(readAgentEventCache('claude', 'tab-a', '/elsewhere'), null)

  clearAgentEventCache('claude', 'tab-a', '/work')
  assert.equal(readAgentEventCache('claude', 'tab-a', '/work'), null)
})

test('같은 세션 replay는 캐시와 겹친 꼬리를 한 번만 남긴다', () => {
  const a = message('a')
  const b = message('b')
  const c = message('c')
  assert.deepEqual(mergeAgentReplay([a, b], [b, c], true), [a, b, c])
})

test('브라우저가 꺼진 사이 서버 버퍼를 넘겨 겹침이 없어도 캐시 앞부분은 보존한다', () => {
  const before = message('abc')
  const after = message('cdef')
  assert.deepEqual(mergeAgentReplay([before], [after], true), [before, after])
})

test('다른 세션 또는 빈 서버 전사는 캐시를 교체한다', () => {
  const cached = [message('old')]
  const replayed = [message('new')]
  assert.deepEqual(mergeAgentReplay(cached, replayed, false), replayed)
  assert.deepEqual(mergeAgentReplay(cached, [], true), [])
})

test('session/load로 복원한 replay는 형식이 다른 캐시와 합치지 않는다', () => {
  const cached: AgentEvent[] = [
    { type: 'turn_start' },
    update('user_message_chunk', '이전 질문'),
    update('agent_message_chunk', '이전 답변'),
    { type: 'turn_end', stopReason: 'end_turn' },
  ]
  const restored = [update('user_message_chunk', '이전 질문'), update('agent_message_chunk', '이전 답변')]

  assert.deepEqual(mergeAgentReplay(cached, restored, true, true), restored)
})
