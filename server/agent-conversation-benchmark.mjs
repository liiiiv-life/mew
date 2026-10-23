import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { createAgentEventState, appendAgentEventState } from '../src/utils/agent-event-state.ts'
import { appendHistoryEventInPlace } from '../src/utils/agent-history-state.ts'
import { recentHistory } from '../src/utils/agent-history-cache.ts'
import { HistoryIndex, expandHistoryWork } from '../shared/agent-history.ts'
import { agentDisplayEvent, compactHistoryWork } from '../shared/agent-display.ts'

const message = (role, text) => ({ type: 'update', update: {
  sessionUpdate: `${role}_message_chunk`, content: { type: 'text', text },
} })
const initial = []
for (let i = 0; i < 500; i++) {
  initial.push(message('user', `question ${i}`), { type: 'turn_start' })
  for (let j = 0; j < 20; j++) initial.push(message('agent', 'answer '.repeat(30)))
  initial.push({ type: 'turn_end', stopReason: 'end_turn', durationMs: 100 })
}
initial.push(message('user', 'live'), { type: 'turn_start' })
const history = () => ({ sessionId: 's', generation: 'g', start: 0, end: initial.length,
  total: initial.length, usersBefore: 0, events: initial.slice() })
const results = { turns: 500, events: initial.length, samples: 5, medianMs: {} }
function measure(name, run) {
  run()
  const samples = []
  for (let i = 0; i < results.samples; i++) {
    const started = performance.now()
    run()
    samples.push(performance.now() - started)
  }
  samples.sort((a, b) => a - b)
  results.medianMs[name] = Number(samples[Math.floor(samples.length / 2)].toFixed(2))
}
measure('fold200Frames', () => {
  let state = createAgentEventState(initial.slice(), 'ko', 0)
  for (let i = 0; i < 200; i++) state = appendAgentEventState(state, [message('agent', 'chunk')], false, 'ko', 0)
})
measure('append2000Events', () => {
  const state = history()
  for (let i = 0; i < 2000; i++) appendHistoryEventInPlace(state, message('agent', 'chunk'), { generation: state.generation, seq: state.end })
})
measure('recent200Snapshots', () => {
  const state = history()
  for (let i = 0; i < 200; i++) {
    appendHistoryEventInPlace(state, message('agent', 'chunk'), { generation: state.generation, seq: state.end })
    recentHistory(state)
  }
})

const workEvents = []
for (let turn = 0; turn < 30; turn++) {
  workEvents.push(message('user', `question ${turn}`), { type: 'turn_start' })
  for (let work = 0; work < 40; work++) workEvents.push(
    message('agent_thought', 'considering project requirements '.repeat(64)),
    { type: 'update', update: { sessionUpdate: 'tool_call', toolCallId: `${turn}-${work}`, title: 'Inspect project file', rawOutput: 'raw tool output '.repeat(256) } },
    { type: 'update', update: { sessionUpdate: 'tool_call_update', toolCallId: `${turn}-${work}`, status: 'completed' } },
  )
  workEvents.push(message('agent', 'readable answer '.repeat(40)), { type: 'turn_end', stopReason: 'end_turn', durationMs: 100 })
}
// The message helper uses role_message_chunk; thoughts use the ACP thought event name.
for (const event of workEvents) if (event.update?.sessionUpdate === 'agent_thought_message_chunk') event.update.sessionUpdate = 'agent_thought_chunk'
const workIndex = new HistoryIndex('work-benchmark')
for (const event of workEvents) workIndex.push(event)
results.lazyHistory = {}
for (const [name, turns, deferred] of [['display20', 20, false], ['deferred20', 20, true], ['deferred3', 3, true]]) {
  const range = workIndex.range({ turns })
  const source = workEvents.slice(range.start, range.end)
  const transport = deferred ? compactHistoryWork(source) : source.map(agentDisplayEvent)
  const json = JSON.stringify(transport)
  results.lazyHistory[name] = { bytes: Buffer.byteLength(json), wireEvents: transport.length, sequenceEvents: source.length }
  measure(`${name}ParseAndFold`, () => createAgentEventState(expandHistoryWork(JSON.parse(json)), 'ko', range.start))
}

// Only a disposable database; importing dataDir happens after setting its isolated location.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-conversation-benchmark-'))
process.env.MEW_DATA_DIR = temp
const { writeAgentTranscript, readAgentTranscriptRange, closeTranscriptDatabase } = await import('./agentTranscript.ts')
try {
  const events = Array.from({ length: 10_000 }, (_, i) => ({ type: 'error', message: `event ${i}` }))
  if (!writeAgentTranscript('test', '/bench', 'test', events)) throw new Error('Benchmark transcript write failed')
  measure('sqlite1000PagesOf100Events', () => {
    for (let i = 0; i < 1000; i++) readAgentTranscriptRange('test', '/bench', 'test', 9900, 10_000)
  })
} finally {
  closeTranscriptDatabase()
  fs.rmSync(temp, { recursive: true, force: true })
}
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
