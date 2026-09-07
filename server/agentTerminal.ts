import crypto from 'node:crypto'
import { AGENT_TERMINAL_SESSION_PREFIX, type TmuxManager } from '@mew/tmux-term/server'
import { RUNTIMES, resolvedTerminalSpec } from './agentRuntimes.ts'
import { spawnSpecCommand } from './spawnSpecCommand.ts'

export { AGENT_TERMINAL_SESSION_PREFIX }
const TAB_ID = /^[A-Za-z0-9_-]{1,64}$/

export class AgentTerminalError extends Error {}

/** 실제 tmux 이름은 서버만 안다. runtime·tab은 해시에만 넣어 이름 길이와 문자 규칙을 고정한다. */
export function agentTerminalSessionName(runtime: string, tab: string): string {
  if (!TAB_ID.test(tab)) throw new AgentTerminalError('에이전트 탭 id가 올바르지 않습니다')
  const digest = crypto.createHash('sha256').update(`${runtime}\0${tab}`).digest('hex').slice(0, 24)
  return `${AGENT_TERMINAL_SESSION_PREFIX}${digest}`
}

export async function startAgentTerminal(
  manager: TmuxManager,
  runtime: string,
  tab: string,
  cwd: string,
): Promise<{ session: string }> {
  const entry = RUNTIMES[runtime]
  const spec = resolvedTerminalSpec(runtime)
  if (entry?.surface !== 'terminal' || !spec) throw new AgentTerminalError('터미널형 에이전트 런타임이 아닙니다')
  const session = agentTerminalSessionName(runtime, tab)
  const running = (await manager.list()).some((item) => item.name === session)
  if (!running) {
    if (entry.terminalLaunch === 'shell') await manager.create(session, cwd)
    else await manager.runCommand(session, spawnSpecCommand(spec), cwd)
  }
  return { session }
}

export async function stopAgentTerminal(manager: TmuxManager, runtime: string, tab: string): Promise<void> {
  if (RUNTIMES[runtime]?.surface !== 'terminal') throw new AgentTerminalError('터미널형 에이전트 런타임이 아닙니다')
  const session = agentTerminalSessionName(runtime, tab)
  if ((await manager.list()).some((item) => item.name === session)) await manager.kill(session)
}
