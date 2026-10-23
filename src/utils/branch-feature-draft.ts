import { globalSessionStorage, remoteStorageName } from '@mew/ui/browser-storage-scope'
import type { BranchFeatureReview } from '../../shared/branch-features.ts'

export interface BranchFeatureDraft {
  title: string
  notes: string
  validation: string
  port: string
  path: string
  review: BranchFeatureReview
}
export interface SavedBranchFeatureDraft {
  branch: string
  draft: BranchFeatureDraft
  baseDraft: BranchFeatureDraft
  baseRevision?: string
}

const fallback = new Map<string, string | null>()

function keyFor(workspace: string): string {
  return remoteStorageName(`mew:branch-feature-draft:${workspace}`)
}
function draftOf(value: unknown): BranchFeatureDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const draft = value as Record<string, unknown>
  for (const [key, maximum] of [['title', 200], ['notes', 10_000], ['validation', 10_000], ['port', 5], ['path', 2048]] as const) {
    if (typeof draft[key] !== 'string' || draft[key].length > maximum) return null
  }
  if (!['pending', 'verified', 'needs-fix'].includes(draft.review as string)) return null
  return { title: draft.title as string, notes: draft.notes as string, validation: draft.validation as string, port: draft.port as string, path: draft.path as string, review: draft.review as BranchFeatureReview }
}
function savedOf(value: unknown): SavedBranchFeatureDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const saved = value as Record<string, unknown>
  if (typeof saved.branch !== 'string' || !saved.branch || saved.branch.length > 1024) return null
  if (saved.baseRevision !== undefined && (typeof saved.baseRevision !== 'string' || !/^[a-f0-9]{64}$/.test(saved.baseRevision))) return null
  const draft = draftOf(saved.draft), baseDraft = draftOf(saved.baseDraft)
  if (!draft || !baseDraft) return null
  return { branch: saved.branch, draft, baseDraft, ...(saved.baseRevision === undefined ? {} : { baseRevision: saved.baseRevision as string }) }
}
function parse(raw: string | null): SavedBranchFeatureDraft | null {
  if (raw === null || raw.length > 300_000) return null
  try { return savedOf(JSON.parse(raw)) } catch { return null }
}

export function readBranchFeatureDraft(workspace: string): SavedBranchFeatureDraft | null {
  const key = keyFor(workspace)
  if (fallback.has(key)) return parse(fallback.get(key) ?? null)
  try { return parse(globalSessionStorage().getItem(key)) } catch { return null }
}

export function writeBranchFeatureDraft(workspace: string, value: SavedBranchFeatureDraft | null): void {
  const key = keyFor(workspace)
  const saved = value === null ? null : savedOf(value)
  if (value !== null && saved === null) return
  const raw = saved === null ? null : JSON.stringify(saved)
  fallback.set(key, raw)
  try {
    const storage = globalSessionStorage()
    if (raw === null) storage.removeItem(key)
    else storage.setItem(key, raw)
    fallback.delete(key)
  } catch { /* Keep this tab's draft when session storage is unavailable. */ }
}
