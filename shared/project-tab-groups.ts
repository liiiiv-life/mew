export type ProjectTabGroup = { id: string; paths: string[]; collapsed: boolean }
export type ProjectTabLayout = { paths: string[]; groups: ProjectTabGroup[] }
export type ProjectTabDrop =
  | { type: 'group'; path: string }
  | { type: 'insert'; path: string; side: 'before' | 'after'; outsideGroup?: boolean }
  | { type: 'end' }

/** Keep each open path exactly once, with group members contiguous in tab order. */
export function normalizeProjectTabLayout(openPaths: string[], rawGroups: unknown): ProjectTabLayout {
  const paths = [...new Set(openPaths)]
  const available = new Set(paths)
  const claimed = new Set<string>()
  const ids = new Set<string>()
  const groups: ProjectTabGroup[] = []
  for (const raw of Array.isArray(rawGroups) ? rawGroups.slice(0, 100) : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const { id, paths: members, collapsed } = raw as Record<string, unknown>
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || ids.has(id) || !Array.isArray(members)) continue
    const memberSet = new Set(members.filter((p): p is string => typeof p === 'string' && available.has(p) && !claimed.has(p)))
    if (memberSet.size < 2) continue
    const groupPaths = paths.filter(p => memberSet.has(p))
    groups.push({ id, paths: groupPaths, collapsed: collapsed === true })
    ids.add(id)
    groupPaths.forEach(p => claimed.add(p))
  }
  const byPath = new Map(groups.flatMap(group => group.paths.map(p => [p, group] as const)))
  const emitted = new Set<string>()
  return {
    paths: paths.flatMap(p => {
      const group = byPath.get(p)
      if (!group) return [p]
      if (emitted.has(group.id)) return []
      emitted.add(group.id)
      return group.paths
    }),
    groups,
  }
}

export function moveProjectTab(layout: ProjectTabLayout, source: string, drop: ProjectTabDrop, newGroupId: string): ProjectTabLayout {
  const current = normalizeProjectTabLayout(layout.paths, layout.groups)
  if (!current.paths.includes(source)) return current
  if (drop.type !== 'end' && (!current.paths.includes(drop.path) || (drop.path === source && !(drop.type === 'insert' && drop.outsideGroup)))) return current
  const targetGroup = drop.type === 'end' ? undefined : current.groups.find(g => g.paths.includes(drop.path))
  if (drop.type === 'group' && targetGroup?.paths.includes(source)) return current
  const groups = current.groups.map(g => ({ ...g, paths: g.paths.filter(p => p !== source) }))
  const paths = current.paths.filter(p => p !== source)
  if (drop.type === 'end') paths.push(source)
  else if (drop.type === 'group') {
    if (targetGroup) {
      const group = groups.find(g => g.id === targetGroup.id)!
      paths.splice(paths.indexOf(group.paths.at(-1)!) + 1, 0, source)
      group.paths.push(source)
      group.collapsed = false
    } else {
      paths.splice(paths.indexOf(drop.path) + 1, 0, source)
      groups.push({ id: newGroupId, paths: [drop.path, source], collapsed: false })
    }
  } else {
    const anchor = drop.outsideGroup && targetGroup
      ? (drop.side === 'before' ? targetGroup.paths[0] : targetGroup.paths.at(-1)!)
      : drop.path
    // The anchor can be the source at a group's outer boundary.
    const remainingGroup = targetGroup?.paths.filter(p => p !== source)
    const resolvedAnchor = anchor === source && remainingGroup?.length
      ? (drop.side === 'before' ? remainingGroup[0] : remainingGroup.at(-1)!) : anchor
    paths.splice(paths.indexOf(resolvedAnchor) + (drop.side === 'after' ? 1 : 0), 0, source)
    if (targetGroup && !drop.outsideGroup) groups.find(g => g.id === targetGroup.id)!.paths.push(source)
  }
  return normalizeProjectTabLayout(paths, groups)
}

export function projectTabDropZone(x: number, left: number, width: number): 'before' | 'group' | 'after' {
  const ratio = (x - left) / width
  return ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'group'
}
