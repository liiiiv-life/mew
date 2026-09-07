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
