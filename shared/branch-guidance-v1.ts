import type { BranchGuidanceSettings } from './branch-guidance.ts'

export type LegacyBranchGuidanceSettings = Omit<BranchGuidanceSettings, 'workflow'>
export const legacyBranchGuidanceKeys = ['strategy', 'baseBranch', 'developmentBranch', 'branchPrefix', 'worktree', 'mergeMethod', 'cleanup'] as const

/** Stable, versioned metadata and exact text allow handwritten edits to stay custom. */
export function legacyBranchGuidanceText(settings: LegacyBranchGuidanceSettings): string {
  const ordered = Object.fromEntries(legacyBranchGuidanceKeys.map(key => [key, settings[key as keyof LegacyBranchGuidanceSettings]]))
  const metadata = `<!-- mew:branch-guidance:v1 ${JSON.stringify(ordered)} -->`
  if (settings.strategy === 'inherit') return metadata
  const base = settings.baseBranch
    ? `Use the existing local branch ${JSON.stringify(settings.baseBranch)} as the primary base.`
    : 'Identify the primary base from the repository instructions and existing local convention, then the locally recorded origin/HEAD; use an existing local main or master only when the choice is unambiguous. Do not contact a remote to discover the default.'
  const strategy = {
    'github-flow': 'Use GitHub Flow: keep the primary base releasable, create a short-lived task branch from it, and integrate after the relevant checks pass. Use a reviewed pull request where supported, or follow the repository’s local review and integration workflow otherwise.',
    'git-flow': `Use Git Flow only within the repository’s existing branch layout; do not run git flow init or create missing long-lived branches automatically. Start feature branches from the existing local development branch ${JSON.stringify(settings.developmentBranch)}. Start release/ branches from that development branch and hotfix/ branches from the primary base. An authorized release or hotfix integration must account for both the primary base and development branch.`,
    trunk: 'Use trunk-based development: keep the primary base releasable and task branches very small and short-lived, normally integrating within one or two days. Validate and review each change before an authorized integration into the primary base; avoid long-lived feature or development branches.',
  }[settings.strategy]
  const worktree = {
    auto: 'Use a separate Git worktree when the checkout is shared, unrelated changes exist, or switching its branch would interfere with another task. Otherwise a safe branch switch in the current checkout is acceptable.',
    always: 'Use a separate Git worktree for task work; reuse an existing suitable task worktree when possible. Do not switch the branch of the shared original checkout.',
    never: 'Do not create a Git worktree automatically. Use the current checkout only when switching to or creating the task branch is safe; if isolation is needed, ask before continuing.',
  }[settings.worktree]
  const merge = {
    squash: 'Prefer a squash merge for an integration that the user has authorized.',
    merge: 'Prefer a merge commit for an integration that the user has authorized.',
    rebase: 'Prefer a rebase or fast-forward integration when authorized and supported by repository rules. Do not rewrite shared or published history or force-push without explicit authorization.',
  }[settings.mergeMethod]
  const cleanup = settings.cleanup
    ? 'After an authorized integration, clean up a local task branch or worktree only when its deletion is authorized, its work is fully integrated, and it contains no uncommitted or unique work. Never delete the current branch, a protected branch, or a remote branch automatically.'
    : 'Keep task branches and worktrees after completion unless their deletion is explicitly requested.'
  return [
    metadata,
    strategy,
    base,
    `Before editing, inspect the Git status, current branch, local refs, and worktrees. Reuse an existing suitable task branch for this task; otherwise create a distinct task branch using prefix ${JSON.stringify(settings.branchPrefix)} and a short safe task slug. For Git Flow, this prefix applies to feature work; release/ and hotfix/ retain their roles. Avoid direct task commits on the primary base, main, master, develop, or the configured development branch. If the folder is not a Git repository, skip this branch workflow.`,
    worktree,
    'Preserve all existing staged and unstaged work. Never automatically stash, reset, clean, overwrite, or move existing changes to enable a branch switch or worktree. Do not switch a branch checked out in another worktree. If a required local base is missing, the base is ambiguous, or safe isolation is impossible, ask before choosing a different base, fetching, or changing existing work.',
    merge,
    cleanup,
    'These preferences do not grant permission to commit, push, create a pull request, merge, rebase existing history, fetch, or delete branches or worktrees. Follow the user’s authorization, repository instructions, protected-branch rules, and the separate commit setting; stop before any integration or remote action that is not already authorized.',
  ].join('\n')
}
