import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-transcript-'))
process.env.MEW_DATA_DIR = dataDir

const { readAgentTranscript, reconcileAgentTranscript, writeAgentTranscript } = await import('./agentTranscript.ts')
type AgentEvent = import('./agentAcp.ts').AgentEvent

const message = (role: 'user' | 'agent', text: string): AgentEvent => ({ type: 'update', update: { sessionUpdate: role === 'user' ? 'user_message_chunk' : 'agent_message_chunk', content: { type: 'text', text } } })
const savedTurn: AgentEvent[] = [message('user', '원래 질문'), { type: 'turn_start', startedAt: 100 }, message('agent', '원래 '), message('agent', '답변'), { type: 'turn_end', stopReason: 'end_turn', durationMs: 1200 }]

test('외부에서 resume한 새 대화는 보존하고 같은 기존 턴은 시간과 원본 청크를 유지한다', () => {
  const tail = [message('user', '외부 추가 질문'), message('agent', '외부 추가 답변')]
  const loaded = [message('user', '원래 질문'), message('agent', '원래 답변'), ...tail]
  assert.deepEqual(reconcileAgentTranscript(savedTurn, loaded), [...savedTurn, ...tail])
  assert.deepEqual(reconcileAgentTranscript([...savedTurn, ...tail], loaded), [...savedTurn, ...tail], '다시 불러와도 중복되지 않는다')
})

test('히스토리가 바뀌거나 줄었으면 캐시의 다른 내용과 꼬리를 되살리지 않는다', () => {
  const changed = [message('user', '원래 질문'), message('agent', '새로 생성한 답변')]
  assert.deepEqual(reconcileAgentTranscript(savedTurn, changed), changed)
  assert.deepEqual(reconcileAgentTranscript([...savedTurn, message('user', '삭제된 질문'), message('agent', '삭제된 답변')], [message('user', '원래 질문'), message('agent', '원래 답변')]), savedTurn)
  const unrelated = [message('user', '다른 질문'), message('agent', '다른 답변')]
  assert.deepEqual(reconcileAgentTranscript(savedTurn, unrelated), unrelated)
})

test('텍스트 없이 컨텍스트만 복원하는 ACP는 저장된 전사를 계속 사용한다', () => {
  assert.deepEqual(reconcileAgentTranscript(savedTurn, []), savedTurn)
  assert.deepEqual(reconcileAgentTranscript(null, [message('agent', 'CLI 기록')]), [message('agent', 'CLI 기록')])
})

test('완료되지 않은 동일 문구와 반복 질문은 다른 턴의 소요 시간을 가져오지 않는다', () => {
  const fresh = [message('user', '원래 질문'), message('agent', '원래 답변'), message('user', '원래 질문'), message('agent', '원래 답변')]
  assert.deepEqual(reconcileAgentTranscript(savedTurn, fresh), [...savedTurn, ...fresh.slice(2)])
  assert.deepEqual(reconcileAgentTranscript(savedTurn.slice(0, -1), fresh.slice(0, 2)), fresh.slice(0, 2))
})

test('완료 전사는 런타임·경로·세션별로 보존하고 정확히 같은 키에서만 복원한다', (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const events: AgentEvent[] = [
    { type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: '작업해' } } },
    { type: 'turn_start' as const, startedAt: 100 },
    { type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '끝냈어' } } },
    { type: 'turn_end' as const, stopReason: 'end_turn', durationMs: 12_345 },
  ]
  writeAgentTranscript('codex', '/work', 'session-a', events)

  assert.deepEqual(readAgentTranscript('codex', '/work', 'session-a'), events)
  assert.equal(readAgentTranscript('codex', '/work', 'session-b'), null)
  assert.equal(readAgentTranscript('claude', '/work', 'session-a'), null)
})

test('500개가 넘는 완료 전사도 앞부분을 자르지 않는다', (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const events: AgentEvent[] = Array.from({ length: 620 }, (_, index) => ({
    type: 'update' as const,
    update: { sessionUpdate: 'agent_message_chunk' as const, content: { type: 'text', text: `chunk-${index}` } },
  }))
  writeAgentTranscript('codex', '/work', 'session-long', events)

  assert.deepEqual(readAgentTranscript('codex', '/work', 'session-long'), events)
})

test('최근 500개만 저장하던 v1 전사는 무시하고 ACP 원본 복원으로 폴백한다', (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const events: AgentEvent[] = [
    { type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '끝부분만' } } },
  ]
  writeAgentTranscript('codex', '/work', 'session-v1', events)
  const dir = path.join(dataDir, 'agent-transcripts')
  const file = fs.readdirSync(dir).find((name) => {
    const value = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as { sessionId?: string }
    return value.sessionId === 'session-v1'
  })
  assert.ok(file)
  const filePath = path.join(dir, file)
  const stored = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { version: number }
  fs.writeFileSync(filePath, `${JSON.stringify({ ...stored, version: 1 })}\n`)

  assert.equal(readAgentTranscript('codex', '/work', 'session-v1'), null)
})
