import test from 'node:test'
import assert from 'node:assert/strict'
import { appendEventFold, createEventFold, foldEvents, formatDuration, isTurnComplete, type AgentEvent } from './agentFold.ts'

const user = (text: string): Extract<AgentEvent, { type: 'update' }> => ({
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

test('사용자 메시지는 전송 때의 모델·추론·권한 설정을 함께 보존한다', () => {
  const settings = { model: 'gpt-5.6-sol', thinking: 'high', permission: '전체 허용' }
  const event: AgentEvent = {
    type: 'update',
    update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: '첫 질문' } },
    settings,
  }
  const items = foldEvents([event])
  assert.equal(items[0]?.kind === 'user' && items[0].settings?.model, 'gpt-5.6-sol')
  assert.equal(items[0]?.kind === 'user' && items[0].settings?.thinking, 'high')
  assert.equal(items[0]?.kind === 'user' && items[0].settings?.permission, '전체 허용')
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

test('복원 전사의 마지막 턴은 현재 세션이 유휴면 완료로 그린다', () => {
  const [turn] = foldEvents([agent('복원한 마지막 답변')])
  assert.ok(turn?.kind === 'turn')
  assert.equal(turn.done, false, 'ACP 히스토리에는 turn_end가 없다')
  assert.equal(isTurnComplete(turn, false), true, '유휴 meta는 완료된 마지막 턴을 뜻한다')
  assert.equal(isTurnComplete(turn, true), false, '현재 작업 중이면 계속 진행 상태다')
  assert.equal(isTurnComplete(turn, null), false, 'meta 전에는 성급히 완료로 바꾸지 않는다')
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

test('복원 전사의 서로 다른 messageId는 연속 청크여도 각각의 버블로 남는다', () => {
  const history: AgentEvent[] = [
    { type: 'update', update: { sessionUpdate: 'user_message_chunk', messageId: 'user-1', content: { type: 'text', text: '첫 질문' } } },
    { type: 'update', update: { sessionUpdate: 'agent_message_chunk', messageId: 'assistant-1', content: { type: 'text', text: '첫 답' } } },
    { type: 'update', update: { sessionUpdate: 'user_message_chunk', messageId: 'user-2', content: { type: 'text', text: '둘째 질문' } } },
    { type: 'update', update: { sessionUpdate: 'agent_message_chunk', messageId: 'assistant-2', content: { type: 'text', text: '둘째 답' } } },
  ]
  const items = foldEvents(history)
  assert.deepEqual(items.map((item) => item.kind), ['user', 'turn', 'user', 'turn'])
  assert.equal(items[0]?.kind === 'user' && items[0].text, '첫 질문')
  assert.equal(items[1]?.kind === 'turn' && items[1].children[0]?.kind === 'agent' && items[1].children[0].text, '첫 답')
  assert.equal(items[2]?.kind === 'user' && items[2].text, '둘째 질문')
  assert.equal(items[3]?.kind === 'turn' && items[3].children[0]?.kind === 'agent' && items[3].children[0].text, '둘째 답')
})

test('첨부 사진은 바로 앞 사용자 메시지에 붙어 별도 버블로 그릴 수 있다', () => {
  const items = foldEvents([
    user('이 사진을 봐줘'),
    { type: 'user_images', images: [{ path: '.mew/files/photo.png', mimeType: 'image/png' }] },
    { type: 'turn_start' },
  ])
  const message = items[0]
  assert.ok(message.kind === 'user')
  assert.deepEqual(message.images, [{ path: '.mew/files/photo.png', mimeType: 'image/png' }])
})

test('턴은 서버가 새긴 걸린 시간을 durationMs로 들고, 없으면 null이다', () => {
  const items = foldEvents([user('안녕'), { type: 'turn_start', startedAt: 1000 }, { type: 'turn_end', stopReason: 'end_turn', durationMs: 3632000 }])
  const turn = items[1]
  assert.ok(turn.kind === 'turn')
  assert.equal(turn.startedAt, 1000)
  assert.equal(turn.durationMs, 3632000)

  // 옛 이벤트(필드 없음) — 시간을 모르는 히스토리라 감추는 게 맞다
  const legacy = foldEvents([user('안녕'), { type: 'turn_start' }, { type: 'turn_end', stopReason: 'end_turn' }])
  const legacyTurn = legacy[1]
  assert.ok(legacyTurn.kind === 'turn')
  assert.equal(legacyTurn.durationMs, null)
})

test('끝난 턴은 어댑터가 남긴 진행 중 도구도 완료로 닫는다', () => {
  const items = foldEvents([
    user('작업해'),
    { type: 'turn_start' },
    { type: 'update', update: { sessionUpdate: 'tool_call', toolCallId: 'tool-1', title: '파일 수정', status: 'in_progress' } },
    { type: 'turn_end', stopReason: 'end_turn' },
  ])
  const turn = items[1]
  assert.ok(turn.kind === 'turn')
  const group = turn.children[0]
  assert.ok(group.kind === 'tool_group')
  assert.equal(group.tools[0]?.status, 'completed')
})

test('formatDuration은 0인 윗 단위를 떼고 초 단위로 끝낸다', () => {
  assert.equal(formatDuration(15_000), '15초')
  assert.equal(formatDuration(36 * 60_000 + 32_000), '36분 32초')
  assert.equal(formatDuration(2 * 3_600_000 + 5 * 60_000 + 4_000), '2시간 5분 4초')
  assert.equal(formatDuration(59_900), '1분') // 반올림 — 59.9초는 1분이 된다
  assert.equal(formatDuration(0), '0초')
})

test('프레임 경계가 청크·사진·도구·승인 사이에 있어도 같은 대화를 복원한다', () => {
  const events: AgentEvent[] = [
    user('질문'), user('이어지는 내용'), { type: 'user_images', images: [{ path: 'photo.png', mimeType: 'image/png' }] },
    { type: 'turn_start', startedAt: 100 }, agent('첫 '), agent('답변'),
    { type: 'update', update: { sessionUpdate: 'tool_call', toolCallId: 'tool', title: '도구', status: 'pending' } },
    { type: 'permission', id: 'permission', toolCall: {}, options: [] },
    { type: 'update', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '생각' } } },
    { type: 'turn_end', stopReason: 'end_turn', durationMs: 1000 },
    user('다음 질문'), { type: 'turn_start' }, agent('다음 답변'),
    { type: 'permission_done', id: 'permission' },
    { type: 'update', update: { sessionUpdate: 'tool_call_update', toolCallId: 'tool', status: 'failed', title: '늦은 갱신' } },
  ]
  const expected = foldEvents(events, 'ko', 80)
  for (let size = 1; size <= events.length; size++) {
    let state = createEventFold('ko', 80)
    for (let start = 0; start < events.length; start += size) state = appendEventFold(state, events.slice(start, start + size))
    assert.deepEqual(state.items, expected, `프레임 크기 ${size}`)
  }
  const firstTurn = expected[1]
  assert.ok(firstTurn.kind === 'turn')
  assert.deepEqual(firstTurn.children.find(child => child.kind === 'tool_group'), {
    key: 'tg86', kind: 'tool_group', tools: [{ id: 'tool', title: '늦은 갱신', status: 'failed' }],
  })
  assert.equal(firstTurn.children.find(child => child.kind === 'permission')?.answered, true)
})

test('새 스트리밍 프레임과 늦은 도구 갱신은 이전 렌더의 객체를 변경하지 않는다', () => {
  const frozen = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
    for (const child of Object.values(value)) frozen(child)
    Object.freeze(value)
  }
  const first = appendEventFold(createEventFold(), [user('첫 질문'), agent('첫 답변'),
    { type: 'update', update: { sessionUpdate: 'tool_call', toolCallId: 'old', title: '도구', status: 'pending' } },
    { type: 'turn_end', stopReason: 'end_turn' }, user('두번째'), agent('둘째 답변')])
  const snapshot = structuredClone(first.items)
  frozen(first.items)
  const second = appendEventFold(first, [agent(' 꼬리')])
  assert.deepEqual(first.items, snapshot)
  assert.equal(second.items[0], first.items[0])
  assert.equal(second.items[1], first.items[1], '완료한 턴은 재사용한다')
  assert.notEqual(second.items[3], first.items[3], '진행 중 턴만 교체한다')
  frozen(second.items)
  const third = appendEventFold(second, [
    { type: 'update', update: { sessionUpdate: 'tool_call_update', toolCallId: 'old', status: 'failed' } },
  ])
  assert.equal(third.items[3], second.items[3], '늦은 도구 갱신이 현재 답변을 교체하지 않는다')
  assert.deepEqual(first.items, snapshot)
  assert.notEqual(third.items[1], second.items[1])
})

test('메시지 ID·첨부의 프레임 간 경계와 무시되는 이벤트의 순번을 보존한다', () => {
  let state = appendEventFold(createEventFold('ko', 30), [
    { ...user('첫 질문'), update: { ...user('첫 질문').update, messageId: 'one' } } as AgentEvent,
  ])
  const first = state
  state = appendEventFold(state, [{ type: 'user_images', images: [{ path: 'photo.png', mimeType: 'image/png' }] }])
  assert.equal(first.items[0].kind === 'user' && first.items[0].images.length, 0)
  state = appendEventFold(state, [
    { ...user('둘째 질문'), update: { ...user('둘째 질문').update, messageId: 'two' } } as AgentEvent,
    { type: 'ready', cwd: '/workspace' }, agent('답변'),
  ])
  assert.deepEqual(state.items.map(item => item.key), ['m30', 'm32', 'turn34'])
  const previous = state.items
  state = appendEventFold(state, [{ type: 'ready', cwd: '/workspace' }])
  assert.equal(state.items, previous, '화면을 바꾸지 않는 이벤트는 버블을 재생성하지 않는다')
})
