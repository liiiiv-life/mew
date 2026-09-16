import test from 'node:test'
import assert from 'node:assert/strict'
import { commandTimeline } from './agent-command-timeline.ts'
import { foldEvents, type AgentEvent } from './agentFold.ts'
import type { AgentCommandRecord } from '../../shared/agent-command.ts'

const command = (id: string, afterUserCount: number): AgentCommandRecord => ({
  id, afterUserCount, command: 'pwd', tab: 'tab', cwd: '/tmp', runtime: 'codex', sessionId: 'one',
  session: 'mewcmd-test', state: 'completed', startedAt: 1, finishedAt: 2, exitCode: 0,
})
test('CLI entries stay between AI turns across chunked replay without becoming AI messages', () => {
  const events: AgentEvent[] = [
    { type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'first' } } },
    { type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer' } } },
    { type: 'turn_end', stopReason: 'end_turn' },
    { type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'second' } } },
  ]
  const records = [command('before', 0), command('middle', 1), command('after', 2)]
  const timeline = commandTimeline(foldEvents(events), records)
  assert.deepEqual(timeline.map(item => item.kind === 'command' ? item.command.id : item.kind), ['before', 'user', 'turn', 'middle', 'user', 'after'])
  const chunked = [...events]
  chunked.splice(1, 0, { type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: ' continued' } } })
  assert.deepEqual(commandTimeline(foldEvents(chunked), records).map(item => item.kind), timeline.map(item => item.kind))
  assert.equal(foldEvents(events).length, 3)
})
