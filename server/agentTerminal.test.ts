import assert from 'node:assert/strict'
import test from 'node:test'
import type { TmuxManager, TmuxSession } from '@mew/tmux-term/server'
import { agentTerminalSessionName, startAgentTerminal, stopAgentTerminal } from './agentTerminal.ts'

function fakeTmux() {
  const sessions: TmuxSession[] = []
  const runs: Array<{ name: string; command: string; cwd: string }> = []
  const kills: string[] = []
  const manager: TmuxManager = {
    cwd: '/workspace',
    list: async () => sessions,
    create: async () => {},
    rename: async () => {},
    sendKey: async () => {},
    sendInput: async () => {},
    capture: async () => '',
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
  return { manager, sessions, runs, kills }
}

test('terminal 런타임은 탭별 숨김 tmux에서 공식 CLI를 한 번만 실행한다', async () => {
  const previousCmd = process.env.MEW_AGENT_ANTIGRAVITY_CMD
  const previousArgs = process.env.MEW_AGENT_ANTIGRAVITY_ARGS
  process.env.MEW_AGENT_ANTIGRAVITY_CMD = '/opt/antigravity cli/agy'
  process.env.MEW_AGENT_ANTIGRAVITY_ARGS = '--theme dark'
  try {
    const fake = fakeTmux()
    const first = await startAgentTerminal(fake.manager, 'antigravity', 'tab-1', '/workspace/project')
    const second = await startAgentTerminal(fake.manager, 'antigravity', 'tab-1', '/workspace/project')
    assert.equal(first.session, second.session)
    assert.match(first.session, /^mewagent-[a-f0-9]{24}$/)
    assert.deepEqual(fake.runs, [{
      name: first.session,
      command: "'/opt/antigravity cli/agy' '--theme' 'dark'",
      cwd: '/workspace/project',
    }])
  } finally {
    if (previousCmd === undefined) delete process.env.MEW_AGENT_ANTIGRAVITY_CMD
    else process.env.MEW_AGENT_ANTIGRAVITY_CMD = previousCmd
    if (previousArgs === undefined) delete process.env.MEW_AGENT_ANTIGRAVITY_ARGS
    else process.env.MEW_AGENT_ANTIGRAVITY_ARGS = previousArgs
  }
})

test('탭을 닫으면 해당 terminal 세션만 종료하고 ACP 런타임은 거부한다', async () => {
  const fake = fakeTmux()
  const session = agentTerminalSessionName('claude', 'tab_2')
  fake.sessions.push({ name: session, createdAt: 1, attached: false, windows: 1 })
  await stopAgentTerminal(fake.manager, 'claude', 'tab_2')
  assert.deepEqual(fake.kills, [session])
  await assert.rejects(startAgentTerminal(fake.manager, 'codex', 'tab-3', '/workspace'))
})

test('Claude terminal은 중첩 실행 표식을 지우고 공식 CLI를 시작한다', async () => {
  const previousCmd = process.env.MEW_AGENT_CLAUDE_CLI_CMD
  process.env.MEW_AGENT_CLAUDE_CLI_CMD = '/opt/claude code/claude'
  try {
    const fake = fakeTmux()
    await startAgentTerminal(fake.manager, 'claude', 'tab-claude', '/workspace')
    assert.equal(fake.runs[0]?.command, "env '-u' 'CLAUDECODE' '/opt/claude code/claude'")
  } finally {
    if (previousCmd === undefined) delete process.env.MEW_AGENT_CLAUDE_CLI_CMD
    else process.env.MEW_AGENT_CLAUDE_CLI_CMD = previousCmd
  }
})
