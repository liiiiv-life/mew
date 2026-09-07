import type { TreeNode } from '../api/client'

export type DirectoryChildren = Record<string, TreeNode[]>

export type TreePersistenceState = {
  openDirs: string[]
  scrollTop: number
  directoryChildren: DirectoryChildren
}

const CHILDREN_KEY_PREFIX = 'mew:tree-children:'

export function treeChildrenKey(project: string): string {
  return `${CHILDREN_KEY_PREFIX}${project}`
}

function normalizeTreeNode(value: unknown): TreeNode | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const node = value as Record<string, unknown>
  if (typeof node.name !== 'string' || typeof node.path !== 'string') return null
  if (node.type !== 'file' && node.type !== 'dir') return null

  const normalized: TreeNode = { name: node.name, path: node.path, type: node.type }
  if (node.project === true) normalized.project = true
  if (node.git === true) normalized.git = true
  if (node.guestAccess && typeof node.guestAccess === 'object' && !Array.isArray(node.guestAccess)) {
    const access = node.guestAccess as Record<string, unknown>
    normalized.guestAccess = { view: access.view === true, edit: access.edit === true }
  }
  if (Array.isArray(node.children)) normalized.children = node.children.map(normalizeTreeNode).filter((child): child is TreeNode => child !== null)
  return normalized
}

/** 저장된 값은 렌더링 전에 최소 TreeNode 형태만 남긴다. */
export function normalizeDirectoryChildren(value: unknown): DirectoryChildren {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: DirectoryChildren = {}
  for (const [path, children] of Object.entries(value)) {
    if (!path || !Array.isArray(children)) continue
    result[path] = children.map(normalizeTreeNode).filter((child): child is TreeNode => child !== null)
  }
  return result
}

/** 닫힌 폴더의 오래된 목록은 저장하지 않는다. 하위 폴더가 다시 열릴 상태면 그 목록도 유지한다. */
export function childrenForOpenDirs(openDirs: Iterable<string>, directoryChildren: DirectoryChildren): DirectoryChildren {
  const result: DirectoryChildren = {}
  for (const path of openDirs) {
    if (directoryChildren[path] !== undefined) result[path] = directoryChildren[path]
  }
  return result
}

export function loadDirectoryChildren(project: string): DirectoryChildren {
  try {
    return normalizeDirectoryChildren(JSON.parse(localStorage.getItem(treeChildrenKey(project)) ?? '{}'))
  } catch {
    return {}
  }
}

export function saveDirectoryChildren(project: string, value: DirectoryChildren): void {
  try {
    localStorage.setItem(treeChildrenKey(project), JSON.stringify(value))
  } catch {
    // localStorage quota·사생활 보호 모드에서는 메모리 캐시만 유지한다.
  }
}
