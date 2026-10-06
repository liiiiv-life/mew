export type DockKind = 'editor' | 'agent' | 'terminal' | 'browser' | 'git' | 'features' | 'memo' | 'tasks' | 'debugger'
export type DockSide = 'left' | 'right' | 'top' | 'bottom'
export type DockNode = { id: string } | { axis: 'row' | 'col'; ratio: number; first: DockNode; second: DockNode }
export type DockGroup = { id: string; kind: DockKind }
export type DockState = { version: 1; tree: DockNode | null; groups: DockGroup[]; tabs: Record<string, string>; active: Record<string, string> }
export type DockRect = { x: number; y: number; width: number; height: number }
export const emptyDock = (): DockState => ({ version: 1, tree: null, groups: [], tabs: {}, active: {} })
export function dockIds(node: DockNode | null): string[] {
  return !node ? [] : 'id' in node ? [node.id] : [...dockIds(node.first), ...dockIds(node.second)]
}
export function removeDock(node: DockNode | null, id: string): DockNode | null {
  if (!node || 'id' in node) return node?.id === id ? null : node
  const first = removeDock(node.first, id), second = removeDock(node.second, id)
  return first && second ? { ...node, first, second } : first ?? second
}
export function pruneDock(node: DockNode | null, visible: Set<string>): DockNode | null {
  if (!node || 'id' in node) return node && visible.has(node.id) ? node : null
  const first = pruneDock(node.first, visible), second = pruneDock(node.second, visible)
  return first && second ? { ...node, first, second } : first ?? second
}
export function defaultDockTree(editor: DockNode | null, groups: DockGroup[]): DockNode | null {
  const panel = (kind: DockKind): DockNode | null => {
    const group = groups.find((group) => group.kind === kind)
    return group ? { id: group.id } : null
  }
  const split = (axis: 'row' | 'col', ratio: number, first: DockNode | null, second: DockNode | null): DockNode | null =>
    first && second ? { axis, ratio, first, second } : first ?? second
  const editing = split('col', .69, editor, panel('terminal'))
  const tools = split('col', .4, panel('git'), split('col', .65, panel('agent'), panel('debugger')))
  const work = split('row', 2 / 3, editing, tools)
  const planning = split('col', .57, panel('features'), panel('tasks'))
  return split('row', .74, work, planning)
}

/** Place a newly mounted panel without rearranging any existing branches. */
export function addDockGroup(tree: DockNode | null, group: DockGroup, groups: DockGroup[]): DockNode {
  if (!tree) return { id: group.id }
  const ids = dockIds(tree)
  const anchorKind = group.kind === 'terminal' ? 'editor' : group.kind === 'git' ? 'agent' : group.kind === 'agent' ? 'git' : group.kind === 'tasks' ? 'features' : group.kind === 'features' ? 'tasks' : null
  const anchor = groups.find((candidate) => candidate.kind === anchorKind && ids.includes(candidate.id))
  if (anchor) {
    const before = group.kind === 'git' || group.kind === 'features'
    const ratio = group.kind === 'terminal' ? .69 : group.kind === 'git' || group.kind === 'agent' ? .4 : .57
    const visit = (node: DockNode): DockNode => {
      if ('id' in node) return node.id === anchor.id ? { axis: 'col', ratio, first: before ? { id: group.id } : node, second: before ? node : { id: group.id } } : node
      return { ...node, first: visit(node.first), second: visit(node.second) }
    }
    return visit(tree)
  }
  return { axis: 'row', ratio: group.kind === 'agent' || group.kind === 'git' ? 2 / 3 : .74, first: tree, second: { id: group.id } }
}
function containsBrowser(node: DockNode, groups: DockGroup[]): boolean {
  return dockIds(node).some((id) => groups.some((group) => group.id === id && group.kind === 'browser'))
}
/** A browser is inserted beside the entire vertical branch, never inside it. */
export function insertDock(tree: DockNode | null, source: string, target: string, side: DockSide, groups: DockGroup[]): DockNode | null {
  if (source === target) return tree
  const browser = groups.some((group) => group.id === source && group.kind === 'browser')
  if (browser && (side === 'top' || side === 'bottom')) return tree
  const base = removeDock(tree, source)
  if (!base) return { id: source }
  if (!dockIds(base).includes(target)) return tree
  const split = (node: DockNode): DockNode => {
    const vertical = side === 'top' || side === 'bottom'
    if (vertical && containsBrowser(node, groups)) return node
    const before = side === 'left' || side === 'top'
    return { axis: vertical ? 'col' : 'row', ratio: .5, first: before ? { id: source } : node, second: before ? node : { id: source } }
  }
  const visit = (node: DockNode): DockNode => {
    if ('id' in node) return node.id === target ? split(node) : node
    if (browser && node.axis === 'col' && dockIds(node).includes(target)) return split(node)
    return { ...node, first: visit(node.first), second: visit(node.second) }
  }
  const next = visit(base)
  return dockIds(next).includes(source) ? next : tree
}
export function dockRects(tree: DockNode | null, rect: DockRect, result: Record<string, DockRect> = {}): Record<string, DockRect> {
  if (!tree) return result
  if ('id' in tree) { result[tree.id] = rect; return result }
  const horizontal = tree.axis === 'row', length = horizontal ? rect.width : rect.height
  const firstSize = Math.max(0, length - 4) * tree.ratio
  dockRects(tree.first, { ...rect, [horizontal ? 'width' : 'height']: firstSize }, result)
  dockRects(tree.second, { ...rect, [horizontal ? 'x' : 'y']: (horizontal ? rect.x : rect.y) + firstSize + 4, [horizontal ? 'width' : 'height']: Math.max(0, length - firstSize - 4) }, result)
  return result
}
export function normalizeDock(value: unknown): DockState {
  if (!value || typeof value !== 'object' || (value as DockState).version !== 1) return emptyDock()
  const raw = value as DockState, seen = new Set<string>()
  const groups = Array.isArray(raw.groups) ? raw.groups.filter((g) => g && typeof g.id === 'string' && g.id.length < 300 && ['editor', 'agent', 'terminal', 'browser', 'git', 'features', 'memo', 'tasks', 'debugger'].includes(g.kind) && !seen.has(g.id) && !!seen.add(g.id)).slice(0, 64) : []
  const used = new Set<string>()
  const walk = (node: DockNode | null, depth = 0): DockNode | null => {
    if (!node || typeof node !== 'object' || depth > 32) return null
    if ('id' in node) {
      if (!seen.has(node.id) || used.has(node.id)) return null
      used.add(node.id); return { id: node.id }
    }
    if (node.axis !== 'row' && node.axis !== 'col') return null
    const first = walk(node.first, depth + 1), second = walk(node.second, depth + 1)
    if (!first || !second) return first ?? second
    // Reject persisted layouts that flatten a browser.
    return { axis: node.axis === 'col' && (containsBrowser(first, groups) || containsBrowser(second, groups)) ? 'row' : node.axis, ratio: Number.isFinite(node.ratio) ? Math.max(.15, Math.min(.85, node.ratio)) : .5, first, second }
  }
  const strings = (record: unknown): Record<string, string> => record && typeof record === 'object' && !Array.isArray(record) ? Object.fromEntries(Object.entries(record).filter(([k, v]) => k.length < 1000 && typeof v === 'string' && v.length < 1000).slice(0, 2000)) : {}
  return { version: 1, groups, tree: walk(raw.tree), tabs: strings(raw.tabs), active: strings(raw.active) }
}

/** Close one layout group, retaining its sessions in a surviving group (or the default for reopening). */
export function closeDockGroup(state: DockState, id: string, tabIds: readonly string[], sibling?: string): DockState {
  const group = state.groups.find((group) => group.id === id)
  if (!group) return state
  const destination = sibling ?? group.kind
  const groups = state.groups.filter((group) => group.id !== id)
  if (!groups.some((group) => group.id === destination)) groups.push({ id: destination, kind: group.kind })
  const tabs = Object.fromEntries(Object.entries(state.tabs).map(([key, assigned]) => [key, assigned === id ? destination : assigned]))
  for (const tab of tabIds) tabs[`${group.kind}:${tab}`] = destination
  const active = { ...state.active }
  delete active[id]
  const selected = state.active[destination] ?? state.active[id] ?? tabIds[0]
  if (selected) active[destination] = selected
  return { ...state, groups, tree: removeDock(state.tree, id), tabs, active }
}
