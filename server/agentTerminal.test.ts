import assert from 'node:assert/strict'
import test from 'node:test'
import type { TmuxManager, TmuxSession } from '@mew/tmux-term/server'
import { agentTerminalSessionName, startAgentTerminal, stopAgentTerminal } from './agentTerminal.ts'

function fakeTmux() {
  const sessions: TmuxSession[] = []
  const runs: Array<{ name: string; command: string; cwd: string }> = []
  const creates: Array<{ name: string; cwd?: string }> = []
  const kills: string[] = []
  const manager: TmuxManager = {
    cwd: '/workspace',
    list: async () => sessions,
    create: async (name, cwd) => {
      creates.push({ name, cwd })
      sessions.push({ name, createdAt: 1, attached: false, windows: 1 })
    },
    rename: async () => {},
    sendKey: async () => {},
    sendInput: async () => {},
    capture: async () => '',
    startCommand: async () => { throw new Error('Unexpected dedicated command') },
    runCommand: async (name, command, cwd) => {
      runs.push({ name, command, cwd })
      sessions.push({ name, createdAt: 1, attached: false, windows: 1 })
    },
    kill: async (name) => {
      kills.push(name)
      const index = sessions.findIndex((session) => session.name === name)
      if (index >= 0) sessions.splice(index, 1)
    },
  }
  return { manager, sessions, runs, creates, kills }
}

test('tmux 터미널 런타임은 탭 작업 폴더에서 기본 셸 세션만 만든다', async () => {
  const fake = fakeTmux()
  const first = await startAgentTerminal(fake.manager, 'tmux', 'shell-tab', '/workspace/project')
  await startAgentTerminal(fake.manager, 'tmux', 'shell-tab', '/workspace/project')
  assert.deepEqual(fake.creates, [{ name: first.session, cwd: '/workspace/project' }])
  assert.deepEqual(fake.runs, [])
})

test('탭을 닫으면 해당 terminal 세션만 종료하고 ACP 런타임은 거부한다', async () => {
  const fake = fakeTmux()
  const session = agentTerminalSessionName('tmux', 'tab_2')
  fake.sessions.push({ name: session, createdAt: 1, attached: false, windows: 1 })
  await stopAgentTerminal(fake.manager, 'tmux', 'tab_2')
  assert.deepEqual(fake.kills, [session])
  await assert.rejects(startAgentTerminal(fake.manager, 'codex', 'tab-3', '/workspace'))
})

test('Claude ACP 전환 후 terminal 시작을 거부하고 기존 tmux를 임의 종료하지 않는다', async () => {
  const fake = fakeTmux()
  await assert.rejects(startAgentTerminal(fake.manager, 'claude', 'tab-claude', '/workspace'))
  await assert.rejects(stopAgentTerminal(fake.manager, 'claude', 'tab-claude'))
  assert.deepEqual(fake.runs, [])
  assert.deepEqual(fake.kills, [])
})

test('Antigravity ACP 전환은 기존 terminal 프로세스를 종료하지 않는다', async () => {
  const fake = fakeTmux()
  await assert.rejects(startAgentTerminal(fake.manager, 'antigravity', 'old-tab', '/workspace'))
  await assert.rejects(stopAgentTerminal(fake.manager, 'antigravity', 'old-tab'))
  assert.deepEqual(fake.kills, [])
})
