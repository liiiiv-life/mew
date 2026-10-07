import test from 'node:test'
import assert from 'node:assert/strict'
import { readDebugAnalysis } from './debugger-analysis.ts'

test('profiles use actual samples/self sizes and OTLP span hierarchy retains exact durations', () => {
  const cpu = readDebugAnalysis(JSON.stringify({ nodes: [{ id: 1, callFrame: { functionName: 'main', url: 'main.js', lineNumber: 2 } }], samples: [1, 1], timeDeltas: [100, 200] }))
  assert.equal(cpu.rows[0].value, 0.3); assert.equal(cpu.rows[0].line, 3)
  const heap = readDebugAnalysis(JSON.stringify({ head: { callFrame: { functionName: 'root' }, selfSize: 0, children: [{ callFrame: { functionName: 'allocate' }, selfSize: 1024 }] } }))
  assert.equal(heap.rows[0].value, 1024)
  const snapshot = readDebugAnalysis(JSON.stringify({ snapshot: { meta: { node_fields: ['name', 'self_size'] } }, nodes: [0, 16, 0, 24], strings: ['Object'] }))
  assert.equal(snapshot.rows[0].value, 40)
  const trace = readDebugAnalysis(JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [{ name: 'parent', traceId: 't', spanId: 'p', startTimeUnixNano: '1700000000000000001', endTimeUnixNano: '1700000000004000001' }, { name: 'child', traceId: 't', spanId: 'c', parentSpanId: 'p', startTimeUnixNano: '1700000000001000001', endTimeUnixNano: '1700000000002000001', status: { code: 2 } }] }] }] }))
  assert.equal(trace.rows[0].value, 4); assert.equal(trace.rows[1].parentSpanId, 'p'); assert.equal(trace.rows[1].start, 1); assert.equal(trace.rows[1].detail, 'ERROR')
})
test('coverage exposes execution counts and sanitizer imports source locations without executing anything', () => {
  const coverage = readDebugAnalysis(JSON.stringify({ kind: 'coverage', result: [{ url: 'app.js', functions: [{ functionName: 'covered', ranges: [{ startOffset: 0, endOffset: 20, count: 3 }] }, { functionName: 'uncovered', ranges: [{ startOffset: 20, endOffset: 40, count: 0 }] }] }] }))
  assert.equal(coverage.rows[1].value, 0)
  const sanitizer = readDebugAnalysis('ERROR: AddressSanitizer: heap-use-after-free\n#0 read main.cpp:12:2\nSUMMARY: AddressSanitizer')
  assert.equal(sanitizer.rows[1].file, 'main.cpp'); assert.equal(sanitizer.rows[1].line, 12)
  assert.throws(() => readDebugAnalysis('{}'), /format/)
  assert.throws(() => readDebugAnalysis('x'.repeat(8_000_001)), /8MB/)
})
