import test from 'node:test'
import assert from 'node:assert/strict'
import { appendAgentEventState, createAgentEventState } from './agent-event-state.ts'
import type { AgentEvent } from './agentFold.ts'

const user = (text: string): AgentEvent => ({ type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text } } })
const answer = (text: string): AgentEvent => ({ type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } })

test('reset과 replay 교체는 이전 턴·도구 위치·오류 상태를 되살리지 않는다', () => {
  const first = createAgentEventState([user('이전 질문'), answer('이전 답변'), { type: 'error', message: '이전 오류' }], 'ko', 0)
  const batch: AgentEvent[] = [answer('지울 꼬리'), { type: 'reset' }, user('지울 질문'), { type: 'reset' }, user('새 질문'), answer('새 답변')]
  const reset = appendAgentEventState(first, batch, false, 'ko', 0)
  assert.deepEqual(reset.events, [user('새 질문'), answer('새 답변')])
  assert.equal(reset.fold.hasError, false)
  assert.deepEqual(reset.fold.items.map(item => item.key), ['m0', 'turn1'])
  const replay = appendAgentEventState(reset, [user('다른 대화')], true, 'ko', 0)
  assert.deepEqual(replay.events, [user('다른 대화')])
  assert.deepEqual(replay.fold.items.map(item => item.key), ['m0'])
  assert.equal(first.fold.items[0].kind === 'user' && first.fold.items[0].text, '이전 질문')
})

test('언어·과거 구간의 시작 순번이 바뀌면 다음 프레임도 새 기준으로 접는다', () => {
  const first = createAgentEventState([user('질문'), answer('답변')], 'ko', 80)
  const changed = appendAgentEventState(first, [answer(' 꼬리')], false, 'en', 40)
  assert.equal(changed.fold.locale, 'en')
  assert.deepEqual(changed.fold.items.map(item => item.key), ['m40', 'turn41'])
  const turn = changed.fold.items[1]
  assert.equal(turn.kind === 'turn' && turn.children[0].kind === 'agent' && turn.children[0].text, '답변 꼬리')
  assert.deepEqual(first.fold.items.map(item => item.key), ['m80', 'turn81'])
})
