import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentEvent } from './agentFold.ts'

const values = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
  get length() { return values.size },
  key: (index: number) => [...values.keys()][index] ?? null,
}

const {
  AGENT_EVENT_CACHE_MAX_BYTES,
  AGENT_EVENT_CACHE_TOTAL_MAX_BYTES,
  clearAgentEventCache,
  mergeAgentReplay,
  pruneAgentLocalCaches,
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

test('이벤트 하나가 상한보다 커도 세션 포인터는 유지한다', () => {
  values.clear()
  writeAgentEventCache('codex', 'huge-tab', '/work', {
    sessionId: 'huge-session',
    events: [message('x'.repeat(AGENT_EVENT_CACHE_MAX_BYTES))],
  })
  assert.deepEqual(readAgentEventCache('codex', 'huge-tab', '/work'), { sessionId: 'huge-session', events: [] })
})

test('계정 원장에 없는 탭의 전사와 컨트롤 캐시를 정리한다', () => {
  values.clear()
  writeAgentEventCache('codex', 'live-tab', '/work', { sessionId: 'live-session', events: [message('live')] })
  writeAgentEventCache('codex', 'closed-tab', '/work', { sessionId: 'closed-session', events: [message('closed')] })
  values.set('mew:agent-controls:codex:live-tab:/work', '{}')
  values.set('mew:agent-controls:codex:closed-tab:/work', '{}')

  pruneAgentLocalCaches(new Set(['live-tab']))

  assert.ok(readAgentEventCache('codex', 'live-tab', '/work'))
  assert.equal(readAgentEventCache('codex', 'closed-tab', '/work'), null)
  assert.equal(values.has('mew:agent-controls:codex:live-tab:/work'), true)
  assert.equal(values.has('mew:agent-controls:codex:closed-tab:/work'), false)
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


test('긴 전사는 최근 이벤트를 원형 그대로 보존하며 탭·전체 상한을 지킨다', () => {
  values.clear()
  const events = Array.from({ length: 30 }, (_, index) => message(`${index}:` + 'x'.repeat(30000)))
  for (let index = 0; index < 8; index += 1) {
    writeAgentEventCache('codex', `tab-${index}`, '/work', { sessionId: `session-${index}`, events })
  }
  const cached = readAgentEventCache('codex', 'tab-7', '/work')!
  assert.ok(cached.events.length > 0 && cached.events.length < events.length)
  assert.deepEqual(cached.events, events.slice(-cached.events.length))
  let total = 0
  for (const [key, value] of values) {
    const bytes = (key.length + value.length) * 2
    assert.ok(bytes <= AGENT_EVENT_CACHE_MAX_BYTES)
    total += bytes
  }
  assert.ok(total <= AGENT_EVENT_CACHE_TOTAL_MAX_BYTES)
  assert.deepEqual(mergeAgentReplay(cached.events, events, true, true), events)
})

test('quota 실패 뒤 전사 캐시만 비우고 활성 탭 저장을 재시도한다', () => {
  values.clear()
  writeAgentEventCache('codex', 'old', '/work', { sessionId: 'old', events: [message('old')] })
  values.set('unrelated', 'preserve')
  const original = localStorage.setItem
  let attempts = 0
  localStorage.setItem = (key, value) => {
    if (++attempts === 1) throw new Error('QuotaExceededError')
    original(key, value)
  }
  try {
    writeAgentEventCache('codex', 'active', '/work', { sessionId: 'active', events: [message('latest')] })
    assert.equal(attempts, 2)
    assert.equal(readAgentEventCache('codex', 'active', '/work')?.sessionId, 'active')
    assert.equal(values.get('unrelated'), 'preserve')
  } finally {
    localStorage.setItem = original
  }
})


test('서버 snapshot이 로컬 꼬리를 포함하면 앞부분 복원과 최신 이벤트를 중복 없이 반영한다', () => {
  const events = ['old', 'recent', 'latest', 'new'].map(message)
  assert.deepEqual(mergeAgentReplay(events.slice(1, 3), events, true), events)
})
