export type BranchFeatureReview = 'pending' | 'verified' | 'needs-fix'
export type BranchPreviewStatus = 'unconfigured' | 'unknown' | 'running' | 'stopped'

export interface BranchFeatureDirty { staged: number; unstaged: number; untracked: number }
export interface BranchFeatureCommit { hash: string; subject: string; committedAt: string }
export interface BranchFeature {
  branch: string
  revision: string
  title: string
  notes: string
  validation: string
  review: BranchFeatureReview
  previewPort: number | null
  previewPath: string
  previewStatus: BranchPreviewStatus
  current: boolean
  isBase: boolean
  worktreePath: string | null
  worktreePaths: string[]
  dirty: BranchFeatureDirty | null
  commit: BranchFeatureCommit | null
  updatedAt: string | null
}
export interface BranchFeatureSnapshot {
  workspace: string
  isGitRepository: boolean
  baseBranch: string | null
  currentBranch: string | null
  branches: BranchFeature[]
  canEdit: boolean
  canPreview: boolean
}
export interface BranchFeaturePatch {
  branch: string
  expectedRevision?: string
  title?: string
  notes?: string
  validation?: string
  review?: BranchFeatureReview
  previewPort?: number | null
  previewPath?: string
}
