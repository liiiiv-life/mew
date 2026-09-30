export type FeatureStatus = 'implementing' | 'implemented' | 'verified' | 'needs-fix' | 'changed'
export type FeatureRunState = 'queued' | 'starting' | 'running' | 'blocked' | 'cancelling' | 'completed' | 'failed' | 'cancelled'
export type FeatureSort = 'updated' | 'name' | 'created'
export interface FeatureCommit { repository: string; hash: string; subject: string }
export interface FeatureReport { summary: string; validation: string; files: string[]; commits: FeatureCommit[] }
export interface FeatureSpecification { title: string; content: string; parentId: string | null; summary: string; validation: string }
export const featureSpecification = (feature: Feature): FeatureSpecification => ({ title: feature.title, content: feature.content, parentId: feature.parentId, summary: feature.report?.summary ?? '', validation: feature.report?.validation ?? '' })
export interface Feature {
  id: string
  parentId: string | null
  title: string
  content: string
  status: FeatureStatus
  version: number
  createdAt: string
  updatedAt: string
  documentPath?: string
  report?: FeatureReport | null
}
export interface FeatureRun {
  id: string
  owner: string
  title: string
  content: string
  targetId: string | null
  targetVersion: number | null
  parentId: string | null
  featureId: string | null
  featureVersion: number | null
  /** Selection-time snapshot; editing a preset never changes an accepted request. */
  agentSet: { id: string; name: string; runtime: string; modelId: string; role: string; thinkingId?: string; thinkingConfigId?: string }
  context: { projectRoot: string; docsRoot: string }
  tabId: string
  sessionId: string | null
  /** Written before transport send; recovery never resends an uncertain prompt. */
  dispatchedAt: string | null
  state: FeatureRunState
  reason: string
  error: string
  createdAt: string
  updatedAt: string
  report: FeatureReport | null
  edit?: { before: FeatureSpecification; after: FeatureSpecification; version: number }
}
export interface FeatureWorkspace { version: 1; workspace: string; revision: number; features: Feature[]; runs: FeatureRun[] }
export interface FeatureRequest { id: string; title: string; content: string; agentSetId: string; targetId?: string; parentId?: string; expectedVersion?: number; edit?: FeatureSpecification }
export const activeFeatureRun = (run: FeatureRun) => ['starting', 'running', 'blocked', 'cancelling'].includes(run.state)
export const pendingFeatureRun = (run: FeatureRun) => run.state === 'queued' || activeFeatureRun(run)

/** Sort siblings, preserving topology. Descendant changes bring their whole branch forward. */
export function featureRows(features: Feature[], sort: FeatureSort, collapsed = new Set<string>(), locale?: string): Array<{ feature: Feature; depth: number; hasChildren: boolean }> {
  const byParent = new Map<string | null, Feature[]>()
  for (const feature of features) {
    const siblings = byParent.get(feature.parentId) ?? []
    siblings.push(feature); byParent.set(feature.parentId, siblings)
  }
  const timestamps = new Map<string, string>()
  const stamp = (feature: Feature, ancestors = new Set<string>()): string => {
    if (timestamps.has(feature.id)) return timestamps.get(feature.id)!
    if (ancestors.has(feature.id)) return feature.updatedAt
    const next = new Set(ancestors).add(feature.id)
    const value = [feature.updatedAt, ...(byParent.get(feature.id) ?? []).map(child => stamp(child, next))].sort().at(-1)!
    timestamps.set(feature.id, value); return value
  }
  if (sort === 'updated') features.forEach(feature => stamp(feature))
  const rows: Array<{ feature: Feature; depth: number; hasChildren: boolean }> = [], visited = new Set<string>()
  const walk = (parentId: string | null, depth: number) => {
    const siblings = [...(byParent.get(parentId) ?? [])].sort((a, b) => (
      (sort === 'name' ? a.title.localeCompare(b.title, locale, { numeric: true }) : sort === 'created' ? a.createdAt.localeCompare(b.createdAt) : timestamps.get(b.id)!.localeCompare(timestamps.get(a.id)!)) || a.id.localeCompare(b.id)
    ))
    for (const feature of siblings) {
      if (visited.has(feature.id)) continue
      visited.add(feature.id)
      rows.push({ feature, depth, hasChildren: byParent.has(feature.id) })
      if (!collapsed.has(feature.id)) walk(feature.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}
