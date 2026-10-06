import type { StoredTabs } from '../hooks/useTabs'
import { leaf, splitLeaf } from './paneTree.ts'

const SCOPED_FILE_PREFIX = 'mew:file:'

export function workspaceDocumentFile(path: string, workspace: { path: string; docsPath?: string } | null): { project: string; path: string } {
  const absolute = workspace ? `${workspace.path.replace(/\/$/, '')}/${path}` : path
  const docsRoot = workspace?.docsPath?.replace(/\/$/, '')
  return docsRoot && absolute.startsWith(`${docsRoot}/`)
    ? { project: 'docs', path: absolute.slice(docsRoot.length + 1) }
    : { project: '.workspace', path }
}

/** UI identity only. API requests retain the original project and relative path. */
export function editorTabPath(project: string, path: string, workspaceProject = '.workspace'): string {
  return project === workspaceProject || path.startsWith('mew:') ? path : `${SCOPED_FILE_PREFIX}${encodeURIComponent(project)}/${path}`
}

export function editorFile(path: string, workspaceProject = '.workspace'): { project: string; path: string } {
  if (path.startsWith(SCOPED_FILE_PREFIX)) {
    const slash = path.indexOf('/', SCOPED_FILE_PREFIX.length)
    if (slash > SCOPED_FILE_PREFIX.length) {
      try { return { project: decodeURIComponent(path.slice(SCOPED_FILE_PREFIX.length, slash)), path: path.slice(slash + 1) } } catch { /* Invalid legacy identifier: keep it as a path. */ }
    }
  }
  return { project: workspaceProject, path }
}

/** Merge the old Documents state once; retain pane IDs used by the root's dock layout. */
export function mergeEditorTabs(workspace: StoredTabs | null, docs: StoredTabs | null): StoredTabs | null {
  if (workspace?.unifiedScopes) return workspace
  if (!docs) return workspace
  const mapPath = (path: string | null) => path === null ? null : editorTabPath('docs', path)
  const mapped = {
    ...docs,
    panes: docs.panes.map(pane => ({ ...pane, activePath: mapPath(pane.activePath), tabs: pane.tabs.map(tab => ({ ...tab, path: mapPath(tab.path)! })) })),
    unifiedScopes: true as const,
  }
  if (!workspace?.panes.some(pane => pane.tabs.length)) return mapped
  const panes = workspace.panes.map(pane => ({ ...pane, tabs: [...pane.tabs] }))
  let layout = workspace.layout
  for (const incoming of mapped.panes) {
    const existing = panes.find(pane => pane.id === incoming.id)
    if (existing) {
      const paths = new Set(existing.tabs.map(tab => tab.path))
      existing.tabs.push(...incoming.tabs.filter(tab => !paths.has(tab.path)))
      existing.activePath ??= incoming.activePath
    } else if (incoming.tabs.length) {
      layout = splitLeaf(layout ?? leaf(panes[0].id), workspace.focusedPaneId, incoming.id, 'right')
      panes.push(incoming)
    }
  }
  return { ...workspace, panes, layout, unifiedScopes: true }
}
