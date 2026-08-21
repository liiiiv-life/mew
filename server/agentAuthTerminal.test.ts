import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-auth-terminal-'))
process.env.MEW_DATA_DIR = dataDir
const { prepareAgentAuthTerminal, readAgentAuthTerminalStatus } = await import('./agentAuthTerminal.ts')
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

test('terminal auth 명령의 성공·실패 exit code를 원자적으로 기록한다', () => {
  const success = prepareAgentAuthTerminal('kimi', 'tab', 'login', {
    cmd: process.execPath,
    args: ['-e', 'process.exit(0)'],
    label: 'Kimi login',
  })
  execFileSync('bash', ['-lc', success])
  assert.deepEqual(readAgentAuthTerminalStatus('kimi', 'tab', 'login', true), {
    state: 'succeeded', exitCode: 0,
  })

  const failure = prepareAgentAuthTerminal('kimi', 'tab', 'login', {
    cmd: process.execPath,
    args: ['-e', 'process.exit(23)'],
    label: 'Kimi login',
  })
  execFileSync('bash', ['-lc', failure])
  assert.deepEqual(readAgentAuthTerminalStatus('kimi', 'tab', 'login', true), {
    state: 'failed', exitCode: 23,
  })
})

test('결과 없이 tmux가 사라지면 중단으로 구분한다', () => {
  prepareAgentAuthTerminal('kimi', 'interrupted-tab', 'login', {
    cmd: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 1000)'],
    label: 'Kimi login',
  })
  assert.deepEqual(readAgentAuthTerminalStatus('kimi', 'interrupted-tab', 'login', false), {
    state: 'interrupted', exitCode: null,
  })
})
