import { WORKSPACE_PROJECT } from './active-project.ts'

export type GitRepositoryTab = { id: string; project: string; path: string; label: string }
export type GitPanelState = { tabs: GitRepositoryTab[]; activeId: string | null }

export function gitRepositoryTab(project: string, path: string): GitRepositoryTab {
  return { id: JSON.stringify([project, path]), project, path, label: project === 'docs' ? (path ? `Documents / ${path}` : 'Documents') : path || '루트 프로젝트' }
}

/** Only repository identity and order survive reload; working views and commit drafts stay in memory. */
export function restoreGitPanel(value: unknown): GitPanelState {
  const raw = value && typeof value === 'object' ? value as Partial<GitPanelState> : {}
  const seen = new Set<string>()
  const tabs = (Array.isArray(raw.tabs) ? raw.tabs : []).flatMap((entry) => {
    if (!entry || ![WORKSPACE_PROJECT, 'docs'].includes(entry.project) || typeof entry.path !== 'string' || entry.path.length > 400 || entry.path.startsWith('/') || entry.path.split('/').includes('..')) return []
    const tab = gitRepositoryTab(entry.project, entry.path)
    if (seen.has(tab.id)) return []
    seen.add(tab.id)
    return [tab]
  }).slice(0, 100)
  return { tabs, activeId: tabs.some((tab) => tab.id === raw.activeId) ? raw.activeId! : tabs[0]?.id ?? null }
}
