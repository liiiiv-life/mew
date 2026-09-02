import path from 'node:path'
import { buildTreeAsync, isPathVisible, listTreeDirAsync, type TreeNode, type TreeOptions } from './tree.ts'
import { measure, measureSync } from './perfMarks.ts'

export type CatalogState = 'ready' | 'building' | 'stale'

export interface CatalogSnapshot {
  project: string
  version: number
  builtAt: number
  childrenByParent: ReadonlyMap<string, readonly TreeNode[]>
  files: readonly TreeNode[]
}

export interface CatalogUpdate {
  project: string
  version: number
  parents: string[]
  changedPaths: string[]
  removedPaths: string[]
  state: CatalogState
}

type ProjectCatalog = {
  snapshot: CatalogSnapshot | null
  build: Promise<CatalogSnapshot> | null
  update: Promise<void>
  stale: boolean
}

const projects = new Map<string, ProjectCatalog>()
const listeners = new Set<(update: CatalogUpdate) => void>()
let generation = 0

function stateFor(project: string): ProjectCatalog {
  let state = projects.get(project)
  if (!state) {
    state = { snapshot: null, build: null, update: Promise.resolve(), stale: false }
    projects.set(project, state)
  }
  return state
}

function parentOf(relPath: string): string {
  const normalized = relPath.replace(/^\/+|\/+$/g, '')
  const index = normalized.lastIndexOf('/')
  return index === -1 ? '' : normalized.slice(0, index)
}

function freezeNode(node: TreeNode): TreeNode {
  return Object.freeze({ name: node.name, path: node.path, type: node.type, ...(node.project ? { project: true } : {}) })
}

function snapshotFromTree(project: string, tree: TreeNode[], version: number): CatalogSnapshot {
  const childrenByParent = new Map<string, readonly TreeNode[]>()
  const files: TreeNode[] = []
  const visit = (nodes: TreeNode[], parent: string) => {
    const direct = nodes.map(freezeNode)
    childrenByParent.set(parent, Object.freeze(direct))
    for (const node of nodes) {
      if (node.type === 'file') files.push(freezeNode(node))
      else visit(node.children ?? [], node.path)
    }
  }
  visit(tree, '')
  return Object.freeze({
    project,
    version,
    builtAt: Date.now(),
    childrenByParent,
    files: Object.freeze(files),
  })
}

function visible(nodes: readonly TreeNode[], project: string, opts: TreeOptions): TreeNode[] {
  return nodes
    .filter((node) => isPathVisible(project, node.path, { ...opts, type: node.type === 'dir' ? 'dir' : 'file' }))
    .map((node) => ({ ...node }))
}

async function build(project: string, state: ProjectCatalog, buildGeneration: number): Promise<CatalogSnapshot> {
  try {
    const tree = await measure('catalog.build', {}, () => buildTreeAsync(project, { showAll: true }))
    const next = snapshotFromTree(project, tree, (state.snapshot?.version ?? 0) + 1)
    if (buildGeneration !== generation) return next
    state.snapshot = next
    state.stale = false
    emit({
      project,
      version: next.version,
      parents: [''],
      changedPaths: [...next.files].map((node) => node.path),
      removedPaths: [],
      state: 'ready',
    })
    return next
  } catch (error) {
    if (buildGeneration === generation) state.stale = state.snapshot !== null
    throw error
  } finally {
    if (buildGeneration === generation) state.build = null
  }
}

function start(project: string): ProjectCatalog {
  const state = stateFor(project)
  if (!state.snapshot && !state.build) state.build = build(project, state, generation)
  return state
}

function emit(update: CatalogUpdate) {
  for (const listener of listeners) {
    try { listener(update) } catch (error) { console.error('[mew] file catalog listener failed:', error) }
  }
}

export function subscribeFileCatalog(listener: (update: CatalogUpdate) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function warmFileCatalog(project: string): void {
  const state = start(project)
  void state.build?.catch(() => {})
}

export async function readyFileCatalog(project: string): Promise<CatalogSnapshot> {
  const state = start(project)
  if (state.snapshot) return state.snapshot
  return state.build!
}

export function fileCatalogStatus(project: string): { state: CatalogState; version: number } {
  const current = start(project)
  return {
    state: current.snapshot ? (current.stale ? 'stale' : 'ready') : 'building',
    version: current.snapshot?.version ?? 0,
  }
}

export async function listCatalogChildren(
  project: string,
  parent = '',
  opts: TreeOptions = {},
): Promise<{ state: CatalogState; version: number; entries: TreeNode[] }> {
  const current = start(project)
  const snapshot = current.snapshot
  if (!snapshot) {
    const entries = await measure('tree.list', { cached: false }, () => listTreeDirAsync(project, parent, opts))
    return { state: 'building', version: 0, entries }
  }
  return measureSync('tree.list', { cached: true }, () => ({
    state: current.stale ? 'stale' : 'ready',
    version: snapshot.version,
    entries: visible(snapshot.childrenByParent.get(parent) ?? [], project, opts),
  }))
}

export async function listCatalogFiles(project: string, opts: TreeOptions = {}): Promise<TreeNode[]> {
  const snapshot = await readyFileCatalog(project)
  return visible(snapshot.files, project, opts)
}

async function scanNewDirectory(
  project: string,
  relDir: string,
  out: Map<string, TreeNode[]>,
  changedFiles: string[],
): Promise<void> {
  const children = await listTreeDirAsync(project, relDir, { showAll: true })
  out.set(relDir, children.map(freezeNode))
  for (const child of children) {
    if (child.type === 'file') changedFiles.push(child.path)
    else await scanNewDirectory(project, child.path, out, changedFiles)
  }
}

export function refreshFileCatalogParent(project: string, parent = ''): Promise<boolean> {
  const current = start(project)
  const updateGeneration = generation
  const operation = current.update.then(async () => {
    const snapshot = await readyFileCatalog(project)
    const fresh = await measure('catalog.refresh-parent', {}, () => listTreeDirAsync(project, parent, { showAll: true }))
    const previous = snapshot.childrenByParent.get(parent) ?? []
    const previousByPath = new Map(previous.map((node) => [node.path, node]))
    const freshByPath = new Map(fresh.map((node) => [node.path, node]))
    const removedRoots = previous.filter((node) => !freshByPath.has(node.path)).map((node) => node.path)
    const addedDirs = fresh.filter((node) => node.type === 'dir' && !previousByPath.has(node.path)).map((node) => node.path)
    const changedPaths = fresh
      .filter((node) => {
        const old = previousByPath.get(node.path)
        return !old || old.type !== node.type || old.project !== node.project
      })
      .map((node) => node.path)
    const structurallyChanged = removedRoots.length > 0 || changedPaths.length > 0
    if (!structurallyChanged) return false

    const nextChildren = new Map(snapshot.childrenByParent)
    for (const removed of removedRoots) {
      for (const key of [...nextChildren.keys()]) {
        if (key === removed || key.startsWith(`${removed}/`)) nextChildren.delete(key)
      }
    }
    nextChildren.set(parent, Object.freeze(fresh.map(freezeNode)))
    for (const added of addedDirs) {
      await scanNewDirectory(project, added, nextChildren as Map<string, TreeNode[]>, changedPaths)
    }

    const files: TreeNode[] = []
    for (const children of nextChildren.values()) {
      for (const node of children) if (node.type === 'file') files.push(node)
    }
    const next: CatalogSnapshot = Object.freeze({
      project,
      version: snapshot.version + 1,
      builtAt: Date.now(),
      childrenByParent: nextChildren,
      files: Object.freeze(files),
    })
    if (updateGeneration !== generation) return false
    current.snapshot = next
    current.stale = false
    emit({
      project,
      version: next.version,
      parents: [parent],
      changedPaths,
      removedPaths: removedRoots,
      state: 'ready',
    })
    return true
  })
  current.update = operation.then(() => undefined).catch((error) => {
    if (updateGeneration === generation) {
      current.stale = true
      console.error('[mew] file catalog refresh failed:', error)
    }
  })
  return operation.catch(() => false)
}

/**
 * watcher가 filename을 잃었거나 대량 변경을 놓쳤을 때 쓰는 느린 안전망. 구조는 전체 비교하고,
 * 내용 변경은 catalog metadata만으로 알 수 없으므로 모든 현재 파일을 색인 갱신 후보로 보낸다.
 */
export function reconcileFileCatalog(project: string): Promise<boolean> {
  const current = start(project)
  const reconcileGeneration = generation
  const operation = current.update.then(async () => {
    const previous = await readyFileCatalog(project)
    const tree = await measure('catalog.reconcile', {}, () => buildTreeAsync(project, { showAll: true }))
    if (reconcileGeneration !== generation) return false
    const candidate = snapshotFromTree(project, tree, previous.version + 1)
    const sameStructure = candidate.childrenByParent.size === previous.childrenByParent.size
      && [...candidate.childrenByParent].every(([parent, nodes]) => {
        const old = previous.childrenByParent.get(parent)
        return old?.length === nodes.length && nodes.every((node, index) => {
          const before = old[index]
          return before.path === node.path && before.type === node.type && before.project === node.project
        })
      })
    const next = sameStructure
      ? previous
      : candidate
    if (!sameStructure) current.snapshot = next
    current.stale = false
    const currentPaths = new Set(candidate.files.map((node) => node.path))
    const removedPaths = previous.files.map((node) => node.path).filter((relPath) => !currentPaths.has(relPath))
    emit({
      project,
      version: next.version,
      parents: sameStructure ? [] : [''],
      // stat/size 비교는 SearchCatalog가 하므로 unchanged 파일은 DB write 없이 즉시 빠진다.
      changedPaths: candidate.files.map((node) => node.path),
      removedPaths,
      state: 'ready',
    })
    return !sameStructure
  })
  current.update = operation.then(() => undefined).catch((error) => {
    if (reconcileGeneration === generation) {
      current.stale = true
      console.error('[mew] file catalog reconcile failed:', error)
    }
  })
  return operation.catch(() => false)
}

export function noteFileContentChanged(project: string, relPath: string): void {
  const current = start(project)
  emit({
    project,
    version: current.snapshot?.version ?? 0,
    parents: [],
    changedPaths: [relPath],
    removedPaths: [],
    state: current.snapshot ? (current.stale ? 'stale' : 'ready') : 'building',
  })
}

export function resetFileCatalogs(): void {
  generation += 1
  projects.clear()
}

export function catalogParentOf(relPath: string): string {
  return parentOf(relPath.split(path.sep).join('/'))
}
