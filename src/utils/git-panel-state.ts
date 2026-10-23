import { uiText } from '@mew/ui/i18n-core'
import { WORKSPACE_PROJECT } from './active-project.ts'

export type GitRepositoryTab = { id: string; project: string; path: string; label: string }
export type GitPanelState = { tabs: GitRepositoryTab[]; activeId: string | null }

export function gitRepositoryTab(project: string, path: string): GitRepositoryTab {
  return { id: JSON.stringify([project, path]), project, path, label: project === 'docs' ? (path ? `Documents / ${path}` : 'Documents') : path || uiText("루트 프로젝트") }
}

/** Migrate old multi-repository tabs to the current root. Drafts never survive reload. */
export function restoreGitPanel(_value: unknown): GitPanelState {
  const tab = { ...gitRepositoryTab(WORKSPACE_PROJECT, ''), label: uiText("현재 프로젝트") }
  return { tabs: [tab], activeId: tab.id }
}
