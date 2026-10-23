import type { BranchGuidanceSettings } from './branch-guidance.ts'

const previousBranchGuidanceKeys = ['strategy', 'baseBranch', 'developmentBranch', 'branchPrefix', 'worktree', 'mergeMethod', 'cleanup', 'workflow'] as const

/** Frozen v2 renderer: exact comparison distinguishes saved defaults from handwritten edits. */
export function previousBranchGuidanceText(settings: BranchGuidanceSettings): string {
  const ordered = Object.fromEntries(previousBranchGuidanceKeys.map(key => [key, settings[key as keyof BranchGuidanceSettings]]))
  const metadata = `<!-- mew:branch-guidance:v2 ${JSON.stringify(ordered)} -->`
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
    ? settings.workflow === 'manual'
      ? 'After an authorized integration, clean up a local task branch or worktree only when its deletion is authorized, its work is fully integrated, and it contains no uncommitted or unique work. Never delete the current branch, a protected branch, or a remote branch automatically.'
      : 'This enabled cleanup setting authorizes removing this task’s local branch and temporary worktree after successful integration. Verify that every task change is integrated, including patch equivalence after a squash merge, and that no uncommitted or unique work remains. First leave the task worktree and release its processes. Preserve other tasks’ active worktrees, protected branches, and all remote branches; never remove the checkout in which this agent session is still running.'
    : 'Keep task branches and worktrees after completion unless their deletion is explicitly requested.'
  const workflow = settings.workflow === 'manual'
    ? 'Follow the separate commit setting. Merge and push only when the user requests them; choosing a merge method alone does not authorize integration.'
    : 'The user selected Git automation for requested implementation tasks. This selection authorizes creating a task branch or worktree, committing only this task’s changes, running the appropriate checks and reviewing the diff, then integrating into the resolved target without asking for each Git step. It replaces Mew’s separate standard commit timing and push restriction within the selected scope; preserve handwritten restrictions and follow explicit user instructions, repository rules, and branch protection. Do not finish by handing the user an unmerged task branch when safe integration is possible. Recheck the target ref before integration and rerun affected checks after conflict resolution; resolve straightforward task-owned conflicts yourself and ask only when a decision about intent or another person’s work is required. If checks fail or unrelated changes make integration unsafe, preserve all work and report the specific blocker.'
  const remote = settings.workflow === 'remote'
    ? 'Remote automation also authorizes fetch and ordinary push to the existing configured upstream of the resolved integration target, or the repository’s established pull-request workflow when required. Honor required reviews and CI; never bypass protected-branch rules. Inspect outgoing commits and publish only this task’s authorized changes. If no unambiguous configured destination or working credentials exist, finish the local work and report what prevents remote synchronization. Never invent a remote, publish unrelated pending commits, force-push, or rewrite shared history.'
    : settings.workflow === 'local'
      ? 'Do not fetch, push, or create a remote pull request unless the user explicitly requests it. Local automation authorizes local integration only; follow the repository’s local review process without requiring a remote pull request.'
      : 'Do not fetch, push, or create a remote pull request unless the user explicitly requests it.'
  return [
    metadata,
    strategy,
    base,
    `Before editing, inspect the Git status, current branch, local refs, and worktrees. Reuse an existing suitable task branch for this task; otherwise create a distinct task branch using prefix ${JSON.stringify(settings.branchPrefix)} and a short safe task slug. For Git Flow, this prefix applies to feature work; release/ and hotfix/ retain their roles. Avoid direct task commits on the primary base, main, master, develop, or the configured development branch. If the folder is not a Git repository, skip this branch workflow.`,
    worktree,
    'Preserve all existing staged and unstaged work. Never automatically stash, reset, clean, overwrite, or move existing changes to enable a branch switch or worktree. Do not switch a branch checked out in another worktree. If a required local base is missing, use a known upstream only when fetching is already authorized by the user or the selected remote automation mode. Ask only when the base remains ambiguous or safe isolation requires a decision about existing work.',
    merge,
    workflow,
    remote,
    cleanup,
    settings.strategy === 'git-flow'
      ? 'Resolve the integration target from the task type: features return to the configured development branch; releases and hotfixes follow the existing repository workflow for both the primary and development branches.'
      : 'Integrate into the resolved primary base. Use a clean checkout or worktree of that target; never reset or stash another checkout to make integration possible.',
  ].join('\n')
}
