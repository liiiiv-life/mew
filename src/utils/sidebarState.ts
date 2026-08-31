export type SidebarState = {
  docsExpanded: boolean
  expandedSubprojects: string[]
}

const KEY_PREFIX = 'mew:sidebar-state:'

export function sidebarStateKey(rootPath: string): string {
  return `${KEY_PREFIX}${rootPath}`
}

/** Documents와 하위 프로젝트는 파일 트리 바깥의 큰 접기 항목이라 별도로 기억한다. */
export function loadSidebarState(rootPath: string | null): SidebarState {
  if (!rootPath) return { docsExpanded: false, expandedSubprojects: [] }
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(sidebarStateKey(rootPath)) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null) return { docsExpanded: false, expandedSubprojects: [] }
    const value = parsed as Partial<SidebarState>
    return {
      docsExpanded: value.docsExpanded === true,
      expandedSubprojects: Array.isArray(value.expandedSubprojects)
        ? value.expandedSubprojects.filter((path): path is string => typeof path === 'string')
        : [],
    }
  } catch {
    return { docsExpanded: false, expandedSubprojects: [] }
  }
}

export function saveSidebarState(rootPath: string, value: SidebarState): void {
  localStorage.setItem(sidebarStateKey(rootPath), JSON.stringify(value))
}
