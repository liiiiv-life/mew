import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { createAgentEventState, appendAgentEventState } from '../src/utils/agent-event-state.ts'
import { appendHistoryEventInPlace } from '../src/utils/agent-history-state.ts'
import { recentHistory } from '../src/utils/agent-history-cache.ts'

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
