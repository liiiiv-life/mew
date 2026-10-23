import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import { defaultDebugConfig, breakpointKey } from '../shared/debugger.ts'
import { DebugSession, validateDebugConfig } from './debugger.ts'

async function waitFor(check: () => boolean) { const end = Date.now() + 4000; while (!check()) { assert.ok(Date.now() < end, 'fixture did not settle'); await new Promise(r => setTimeout(r, 10)) } }
function fixture(features = true) {
  const config = { ...defaultDebugConfig('custom', os.tmpdir()), command: process.execPath, args: [new URL('./fixtures/debug-adapter.cjs', import.meta.url).pathname, ...(features ? ['--features'] : [])], breakpoints: [{ file: 'main.js', line: 3, column: 1, enabled: true, ...(features ? { condition: 'counter > 0', hitCondition: '2', logMessage: 'value={counter}' } : {}) }] }
  return new DebugSession(config, os.tmpdir())
}
test('advanced DAP inspection, writes, sources and history preserve reference lifetimes', async t => {
  const session = fixture(); t.after(() => session.stop()); await session.start(); await waitFor(() => session.snapshot.frames.length > 0)
  assert.equal(session.snapshot.connections?.[0].id, 'c1')
  const scopes = await session.command('scopes', { frameId: 1 }); assert.equal(scopes.scopes[1].presentationHint, 'registers')
  const vars = await session.command('variables', { variablesReference: 10 }); assert.equal(vars.variables[1].indexedVariables, 240)
  assert.equal((await session.command('variables', { variablesReference: 20, start: 200, count: 100 })).variables.length, 40)
  assert.equal((await session.command('dataBreakpointInfo', { variablesReference: 10, name: 'counter' })).canPersist, false)
  const beforeWrite = session.command('evaluate', { expression: 'slow', frameId: 1 })
  await session.command('setVariable', { variablesReference: 10, name: 'counter', value: '12' })
  await assert.rejects(beforeWrite, /시점/)
  await assert.rejects(session.command('variables', { variablesReference: 10 }), /参照|참조/)
  await session.command('scopes', { frameId: 1 })
  assert.equal((await session.command('variables', { variablesReference: 10, format: { hex: true } })).variables[0].value, '0xc')
  const mem = await session.command('readMemory', { memoryReference: 'mem', count: 16 }); assert.equal(mem.unreadableBytes, 8)
  assert.equal((await session.command('writeMemory', { memoryReference: 'mem', data: 'CQo=' })).bytesWritten, 2)
  assert.deepEqual([...Buffer.from((await session.command('readMemory', { memoryReference: 'mem', count: 2 })).data, 'base64')], [9, 10])
  assert.equal((await session.command('disassemble', { memoryReference: '0x1000', instructionCount: 10 })).instructions[0].address, '0x1000')
  assert.equal((await session.command('modules')).modules[0].name, 'fixture.so')
  await assert.rejects(session.command('source', { sourceReference: 7 }), /ソース|소스/)
  await session.command('loadedSources'); assert.match((await session.command('source', { sourceReference: 7 })).content, /int main/)
  assert.equal((await session.command('exceptionInfo')).exceptionId, 'FixtureError')
  assert.equal((await session.command('completions', { text: 'co', column: 3, frameId: 1 })).targets[0].label, 'counter')
  assert.equal((await session.command('breakpointLocations', { source: { path: 'main.js' }, line: 3 })).breakpoints[1].column, 10)
  await session.command('evaluate', { expression: 'counter', context: 'watch', frameId: 1 })
  const revision = session.snapshot.stopRevision!, first = structuredClone(session.snapshot.history![0])
  const late = session.command('evaluate', { expression: 'slow', frameId: 1 })
  await session.command('next', { granularity: 'instruction', singleThread: true })
  await assert.rejects(late, /시점/)
  await waitFor(() => session.snapshot.frames.length > 0 && session.snapshot.stopRevision! > revision)
  await assert.rejects(session.command('evaluate', { expression: 'counter', frameId: 1, stopRevision: revision }), /시점/)
  await assert.rejects(session.command('variables', { variablesReference: 20 }), /참조/)
  assert.equal(session.snapshot.history![0].watches[0].value, first.watches[0].value, 'stored scalar values do not become live references')
  assert.equal(session.snapshot.history!.length, 2)
  await session.command('evaluate', { expression: 'disableMemory', frameId: 1 }); await waitFor(() => session.snapshot.capabilities.supportsReadMemoryRequest === false)
  await assert.rejects(session.command('readMemory', { memoryReference: 'mem', count: 1 }), /지원/)
})
test('optional commands and malformed inputs are rejected before adapter requests', async t => {
  const session = fixture(false); t.after(() => session.stop()); await session.start(); await waitFor(() => session.snapshot.frames.length > 0)
  for (const command of ['setVariable', 'stepBack', 'restart', 'readMemory', 'modules', 'gotoTargets']) await assert.rejects(session.command(command), /지원/)
  await assert.rejects(session.command('evaluate', { expression: 'x', frameId: 99 }), /프레임/)
  await assert.rejects(session.command('evaluate', { expression: 'x', request: 'launch' }), /명령|인수/)
  await assert.rejects(session.command('variables', { variablesReference: 10, count: 10000 }), /참조|count/)
  await assert.rejects(session.command('selectThread', { threadId: 99 }), /스레드/)
  await assert.rejects(session.command('continue', { connectionId: 'c99' }), /연결/)
})
test('execution targets and thread selection invalidate old frames', async t => {
  const session = fixture(); t.after(() => session.stop()); await session.start(); await waitFor(() => session.snapshot.frames.length > 0)
  await assert.rejects(session.command('stepIn', { targetId: 9 }), /대상/)
  await session.command('stepInTargets', { frameId: 1 }); await session.command('stepIn', { targetId: 9 }); await waitFor(() => session.snapshot.frames.length > 0)
  await session.command('selectThread', { threadId: 2 })
  assert.equal(session.snapshot.frames[0].id, 2)
  await assert.rejects(session.command('scopes', { frameId: 1 }), /프레임/)
})
test('dependent breakpoints validate cycles and arm after the triggering adapter ID', async t => {
  const session = fixture(), a = session.config.breakpoints[0]
  const b = { file: 'main.js', line: 4, enabled: true, trigger: breakpointKey(a) }
  session.config = validateDebugConfig({ ...session.config, breakpoints: [a, b] }); t.after(() => session.stop()); await session.start()
  await waitFor(() => session.snapshot.breakpoints.length === 2)
  assert.ok(session.snapshot.breakpoints.some(p => p.line === 4))
  assert.throws(() => validateDebugConfig({ ...session.config, breakpoints: [{ ...a, trigger: breakpointKey(b) }, b] }), /순환/)
  assert.throws(() => validateDebugConfig({ ...session.config, breakpoints: [b] }), /없거나/)
})
