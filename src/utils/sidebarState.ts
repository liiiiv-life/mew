import { scopedBrowserStorage } from '@mew/ui/browser-storage-scope'
import { writeBrowserStorage } from '@mew/ui/browser-storage'
export type SidebarState = {
  explorerScope?: 'docs' | 'files'
  docsExpanded: boolean
  expandedSubprojects: string[]
}

const KEY_PREFIX = 'mew:sidebar-state:'

export function sidebarStateKey(rootPath: string): string {
  return `${KEY_PREFIX}${rootPath}`
}

/** 탐색 범위를 복원한다. docsExpanded는 이전 펼침 상태와 호환하는 문서 보기 선택값이다. expandedSubprojects는 이전 저장 형식과의 호환용이며 App에서 무시한다. */
export function loadSidebarState(rootPath: string | null): SidebarState {
  if (!rootPath) return { docsExpanded: false, expandedSubprojects: [] }
  try {
    const parsed: unknown = JSON.parse(scopedBrowserStorage().getItem(sidebarStateKey(rootPath)) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null) return { docsExpanded: false, expandedSubprojects: [] }
    const value = parsed as Partial<SidebarState>
    return {
      docsExpanded: value.explorerScope === 'docs' || (value.explorerScope !== 'files' && value.docsExpanded === true),
      expandedSubprojects: Array.isArray(value.expandedSubprojects)
        ? value.expandedSubprojects.filter((path): path is string => typeof path === 'string')
        : [],
    }
  } catch {
    return { docsExpanded: false, expandedSubprojects: [] }
  }
}

export function saveSidebarState(rootPath: string, value: SidebarState): void {
  try {
    writeBrowserStorage(sidebarStateKey(rootPath), JSON.stringify(value))
  } catch {
    // 펼침 상태의 로컬 fallback 실패가 탐색과 계정 상태 저장을 막아서는 안 된다.
  }
}
