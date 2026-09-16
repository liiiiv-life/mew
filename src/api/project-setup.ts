import type { ProjectAgentSettings, ProjectSetupInput, ProjectSetupPlan } from '../../shared/project-agent-context'

async function request<T>(body?: unknown): Promise<T> {
  const response = await fetch('/api/docs/agent-context', body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`)
  return value as T
}

export const fetchProjectSetup = () => request<{ projectRoot: string; settings: ProjectAgentSettings }>()
export const previewProjectSetup = (input: ProjectSetupInput) => request<ProjectSetupPlan>({ ...input, action: 'preview' })
export const saveProjectSetup = (input: ProjectSetupInput, revision: string) => request<ProjectSetupPlan>({ ...input, action: 'apply', revision })
