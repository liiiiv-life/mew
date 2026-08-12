import test from 'node:test'
import assert from 'node:assert/strict'
import { foldEvents, type AgentEvent } from './agentFold.ts'

const user = (text: string): AgentEvent => ({
  type: 'update',
  update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text } },
})
const agent = (text: string): AgentEvent => ({
  type: 'update',
  update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
})

test('한 턴은 질문 하나와 답변 묶음 하나로 접힌다', () => {
  const items = foldEvents([user('안녕'), { type: 'turn_start' }, agent('반가워'), { type: 'turn_end', stopReason: 'end_turn' }])
  assert.deepEqual(items.map((i) => i.kind), ['user', 'turn'])
  const turn = items[1]
  assert.equal(turn.kind === 'turn' && turn.done, true)
})

test('턴은 어떻게 끝났는지를 들고 있다 — 색으로 중단·에러를 갈라 그린다', () => {
  const items = foldEvents([user('안녕'), { type: 'turn_start' }, { type: 'turn_end', stopReason: 'cancelled' }])
  const turn = items[1]
  assert.equal(turn.kind === 'turn' && turn.stopReason, 'cancelled')
  // 되받은 히스토리에는 turn_end가 없다 — 끝난 줄은 알아도 이유는 모른다
  const loaded = foldEvents([user('첫 질문'), agent('첫 답'), user('둘째 질문')])
  const first = loaded[1]
  assert.equal(first.kind === 'turn' && first.done && first.stopReason, null)
})

test('불러온 히스토리에는 turn_end가 없어도 질문마다 턴이 끊긴다', () => {
  // session/load 재생은 turn_start·turn_end 없이 메시지 청크만 흘려준다
  const items = foldEvents([user('첫 질문'), agent('첫 답'), user('둘째 질문'), agent('둘째 답')])
  assert.deepEqual(items.map((i) => i.kind), ['user', 'turn', 'user', 'turn'])
  const first = items[1]
  assert.equal(first.kind === 'turn' && first.children.length, 1, '첫 답이 첫 턴에만 들어간다')
})

test('도구 호출은 묶여서 상태 갱신을 받는다', () => {
  const items = foldEvents([
    user('해줘'),
    { type: 'turn_start' },
    { type: 'update', update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'ls', status: 'pending' } },
    { type: 'update', update: { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' } },
  ])
  const turn = items[1]
  assert.ok(turn.kind === 'turn')
  const group = turn.children[0]
  assert.ok(group.kind === 'tool_group')
  assert.deepEqual(group.tools, [{ id: 't1', title: 'ls', status: 'completed' }])
})

test('승인 응답은 해당 요청만 답한 상태로 바꾼다', () => {
  const items = foldEvents([
    { type: 'turn_start' },
    { type: 'permission', id: '1', toolCall: { title: 'rm' }, options: [{ optionId: 'allow', name: '허용', kind: 'allow_once' }] },
    { type: 'permission_done', id: '1' },
  ])
  const turn = items[0]
  assert.ok(turn.kind === 'turn')
  const permission = turn.children[0]
  assert.equal(permission.kind === 'permission' && permission.answered, true)
})

test('잇따른 사용자 발화는 한 말풍선에 줄바꿈으로 갈려 들어간다', () => {
  // 메시지 경계가 없는 청크 스트림이라 묶이는 것 자체는 정상이다 — 붙어서 한 줄이 되면 안 될 뿐
  const items = foldEvents([user('첫 질문'), user('둘째 질문'), agent('답')])
  assert.deepEqual(items.map((i) => (i.kind === 'user' ? i.text : i.kind)), ['첫 질문\n둘째 질문', 'turn'])
})
