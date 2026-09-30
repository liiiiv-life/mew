// 예약 작업용 일회성 ACP runner. crontab/tmux는 이 파일만 실행하고, 실제 런타임 선택은 agentRuntimes.ts가 한다.
import fs from 'node:fs'
import { parseAgentContext } from './agent-context.ts'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AgentSession, type AgentEvent, isAcpRuntime } from './agentAcp.ts'
import { normalizeSets, type AgentSet } from './agentSets.ts'

export async function runScheduledPrompt(session: Pick<AgentSession, 'setModel' | 'runOnce'> & Partial<Pick<AgentSession, 'setThinking'>>, prompt: string, agentSet?: AgentSet) {
  if (agentSet?.modelId) await session.setModel(agentSet.modelId)
  if (agentSet?.thinkingId && agentSet.thinkingConfigId) await session.setThinking?.(agentSet.thinkingConfigId, agentSet.thinkingId)
  await session.runOnce(agentSet ? `${agentSet.role}\n\n---\n\n${prompt}` : prompt)
}

function arg(name: string): string {
  const flag = `--${name}`
  const i = process.argv.indexOf(flag)
  const value = i >= 0 ? process.argv[i + 1] : ''
  if (!value) throw new Error(`${flag} 값이 필요합니다`)
  return value
}

function lineFromEvent(event: AgentEvent): string | null {
  if (event.type === 'update') {
    const update = event.update
    if (update.sessionUpdate === 'agent_message_chunk' || update.sessionUpdate === 'user_message_chunk') {
      const content = update.content
      if (!Array.isArray(content) && content?.type === 'text') return content.text
    }
    if (update.sessionUpdate === 'tool_call') return `\n[tool] ${update.toolCallId}\n`
    if (update.sessionUpdate === 'tool_call_update') return `\n[tool:update] ${update.toolCallId}\n`
    return null
  }
  if (event.type === 'turn_start') return '\n[mew] turn started\n'
  if (event.type === 'turn_end') return `\n[mew] turn ended: ${event.stopReason}\n`
  if (event.type === 'error') return `\n[mew:error] ${event.message}\n`
  if (event.type === 'permission') return `\n[mew:permission] ${event.toolCall.title ?? event.toolCall.kind}\n`
  return null
}

async function main() {
  const runtime = arg('runtime')
  if (!isAcpRuntime(runtime)) throw new Error(`예약 실행을 지원하지 않는 에이전트 런타임입니다: ${runtime}`)
  const promptFile = arg('prompt-file')
  const logFile = arg('log-file')
  const cwd = arg('cwd')
  const prompt = fs.readFileSync(promptFile, 'utf8')
  const agentSet = process.argv.includes('--agent-set-file')
    ? normalizeSets([JSON.parse(fs.readFileSync(arg('agent-set-file'), 'utf8'))])[0] : undefined
  if (process.argv.includes('--agent-set-file') && (!agentSet || agentSet.runtime !== runtime)) {
    throw new Error('예약 작업의 에이전트셋과 런타임이 일치하지 않습니다')
  }
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  const log = fs.createWriteStream(logFile, { flags: 'a' })
  const write = (text: string) => {
    process.stdout.write(text)
    log.write(text)
  }

  write(`\n[mew] ${new Date().toISOString()} runtime=${runtime} cwd=${cwd}\n`)
  const context = process.argv.includes('--context') ? parseAgentContext(JSON.parse(arg('context'))) : undefined
  if (context === null) throw new Error('예약 작업의 문서 연결이 올바르지 않습니다')
  const session = await AgentSession.start(runtime, undefined, cwd, undefined, context)
  const detach = session.attach((event) => {
    const line = lineFromEvent(event)
    if (line) write(line)
  })
  try {
    await runScheduledPrompt(session, prompt, agentSet)
  } finally {
    detach()
    session.dispose()
    await new Promise<void>((resolve) => log.end(resolve))
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack || err.message : String(err)
  console.error(message)
  process.exitCode = 1
})
