import { mewFetch } from '../utils/remote-transport.ts'
import { uiText } from '@mew/ui/i18n-core'
import type { AgentCommandRecord, AgentCommandScope } from '../../shared/agent-command'

async function request<T>(suffix: string, body?: unknown): Promise<T> {
  const response = await mewFetch(`/api/agent/commands${suffix}`, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? uiText("명령 요청에 실패했습니다"))
  return value as T
}

export const listAgentCommands = (scope: AgentCommandScope) => request<{ commands: AgentCommandRecord[] }>(`?${new URLSearchParams(scope)}`)
export const startAgentCommand = (input: AgentCommandScope & { id: string; tab: string; command: string; afterUserCount: number }) => request<{ command: AgentCommandRecord }>('', input)
export const stopAgentCommand = (id: string) => request(`/${encodeURIComponent(id)}/stop`, {})
export const stopAgentTabCommands = (tab: string) => request(`/stop-tab/${encodeURIComponent(tab)}`, {})
export const readAgentCommandOutput = (id: string) => request<{ command: AgentCommandRecord; text: string }>(`/${encodeURIComponent(id)}/output`)
export const agentCommandArchiveUrl = (id: string) => `/api/agent/commands/${encodeURIComponent(id)}/archive`
