import type { AgentSession } from './agentAcp.ts'
import { AgentCommandError, AgentCommandStore, type AgentCommandInput, publicCommand } from './agent-commands.ts'
import { getUser } from './auth.ts'
import { canUse } from './access-policy.ts'

function mayExecute(owner: string): boolean {
  const user = getUser(owner)
  if (!user || user.mustChangePassword) return false
  const auth = { email: owner, role: user.role, mustChangePassword: false }
  return canUse(auth, 'agent') && canUse(auth, 'terminal')
}

/** Called inside the independent agent host, so HTTP/browser disconnects cannot release the queue. */
export function queueAgentCommand(session: AgentSession, store: AgentCommandStore, owner: string, input: AgentCommandInput, authorize = mayExecute) {
  if (session.sessionId !== input.sessionId || session.runtime !== input.runtime || session.cwd !== input.cwd) {
    throw new AgentCommandError('대화가 변경되었습니다. 현재 대화에서 다시 보내세요')
  }
  const record = store.prepare(owner, input)
  if (record.state !== 'queued') return record
  try {
    session.enqueueTask({
      id: record.id,
      text: record.command,
      cancel: () => store.stop(owner, record.id),
      run: async context => {
        if (store.read(owner, record.id).state !== 'queued') return
        if (!authorize(owner)) {
          store.fail(owner, record.id, '에이전트와 터미널 권한이 필요합니다')
          return
        }
        const started = await store.launch(owner, record.id, context)
        if (started.state !== 'running') return
        // Completion is written only after the output is archived; release the next queue item then.
        while (store.read(owner, record.id).state === 'running') {
          await new Promise(resolve => setTimeout(resolve, 250))
          await store.list(owner, { runtime: input.runtime, cwd: input.cwd, sessionId: context.sessionId })
        }
      },
    })
  } catch (error) {
    store.fail(owner, record.id, error instanceof Error ? error.message : String(error))
    throw error
  }
  return publicCommand(store.read(owner, record.id))
}
