import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-transcript-'))
process.env.MEW_DATA_DIR = dataDir

const { readAgentTranscript, writeAgentTranscript } = await import('./agentTranscript.ts')
type AgentEvent = import('./agentAcp.ts').AgentEvent

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
