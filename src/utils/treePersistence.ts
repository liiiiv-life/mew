import { scopedBrowserStorage } from '@mew/ui/browser-storage-scope'
import { writeBrowserStorage } from '@mew/ui/browser-storage'
import type { TreeNode } from '../api/client'

export type DirectoryChildren = Record<string, TreeNode[]>

export type TreePersistenceState = {
  openDirs: string[]
  scrollTop: number
  centerAnchor?: TreeCenterAnchor
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
    return normalizeDirectoryChildren(JSON.parse(scopedBrowserStorage().getItem(treeChildrenKey(project)) ?? '{}'))
  } catch {
    return {}
  }
}

export function saveDirectoryChildren(project: string, value: DirectoryChildren): void {
  try {
    writeBrowserStorage(treeChildrenKey(project), JSON.stringify(value))
  } catch {
    // localStorage quota·사생활 보호 모드에서는 메모리 캐시만 유지한다.
  }
}

export type TreeCenterAnchor = { tree: string; path: string; fraction: number }

export function normalizeTreeCenterAnchor(value: unknown): TreeCenterAnchor | undefined {
  if (!value || typeof value !== 'object') return undefined
  const anchor = value as Partial<TreeCenterAnchor>
  if (typeof anchor.tree !== 'string' || typeof anchor.path !== 'string'
    || typeof anchor.fraction !== 'number' || !Number.isFinite(anchor.fraction)) return undefined
  return { tree: anchor.tree, path: anchor.path, fraction: Math.max(0, Math.min(1, anchor.fraction)) }
}

/** Only descend through expanded ancestors; remembered descendants of a closed folder stay lazy. */
export function visibleOpenDirectories(tree: TreeNode[], open: Set<string>, cache: DirectoryChildren, stopAtProjects = false): string[] {
  const result: string[] = []
  const visit = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.type !== 'dir' || !open.has(node.path) || (stopAtProjects && node.project)) continue
      result.push(node.path)
      visit(node.children ?? cache[node.path] ?? [])
    }
  }
  visit(tree)
  return result
}

export function readTreeCenter(list: HTMLElement): TreeCenterAnchor | undefined {
  const middle = list.getBoundingClientRect().top + list.clientHeight / 2
  let best: { row: HTMLElement; distance: number } | undefined
  for (const row of list.querySelectorAll<HTMLElement>('[data-path]')) {
    const rect = row.getBoundingClientRect()
    if (!rect.height) continue
    const distance = Math.max(rect.top - middle, middle - rect.bottom, 0)
    if (!best || distance < best.distance) best = { row, distance }
  }
  if (!best) return undefined
  const rect = best.row.getBoundingClientRect()
  return {
    tree: best.row.closest<HTMLElement>('[data-tree-key]')?.dataset.treeKey ?? '',
    path: best.row.dataset.path!,
    fraction: Math.max(0, Math.min(1, (middle - rect.top) / rect.height)),
  }
}

export const TREE_MATERIALIZE_EVENT = 'mew:tree-materialize'
export type TreeMaterializeDetail = { tree: string; path: string; fraction?: number }

export function materializeTreePath(list: HTMLElement, detail: TreeMaterializeDetail): boolean {
  const event = new CustomEvent(TREE_MATERIALIZE_EVENT, { detail, cancelable: true })
  list.dispatchEvent(event)
  return event.defaultPrevented
}

export function restoreTreeCenter(list: HTMLElement, anchor: TreeCenterAnchor): boolean {
  const row = [...list.querySelectorAll<HTMLElement>('[data-path]')].find((item) => (
    item.dataset.path === anchor.path && item.closest<HTMLElement>('[data-tree-key]')?.dataset.treeKey === anchor.tree
  ))
  if (!row) return materializeTreePath(list, anchor)
  if (!row.getBoundingClientRect().height || !list.clientHeight) return false
  const rect = row.getBoundingClientRect()
  list.scrollTop += rect.top + rect.height * anchor.fraction - list.getBoundingClientRect().top - list.clientHeight / 2
  return true
}
