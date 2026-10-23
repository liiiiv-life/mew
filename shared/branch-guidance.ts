export type BranchGuidanceSettings = {
  strategy: 'github-flow' | 'git-flow' | 'trunk' | 'inherit'
  baseBranch: string
  developmentBranch: string
  branchPrefix: string
  worktree: 'auto' | 'always' | 'never'
  mergeMethod: 'squash' | 'merge' | 'rebase'
  cleanup: boolean
  workflow: 'manual' | 'local' | 'remote'
}

export type BranchGuidanceSnapshot = { value: BranchGuidanceSettings; custom: boolean }

export const defaultBranchGuidance: BranchGuidanceSettings = {
  strategy: 'github-flow',
  baseBranch: '',
  developmentBranch: 'develop',
  branchPrefix: 'feat/',
  worktree: 'auto',
  mergeMethod: 'squash',
  cleanup: false,
  workflow: 'local',
}

export const BRANCH_NAME_MAX_LENGTH = 200
export const BRANCH_PREFIX_MAX_LENGTH = 80

function safeBranchName(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > BRANCH_NAME_MAX_LENGTH || value === 'HEAD') return false
  // Accept Git branch names using letters/numbers and safe separators only. This
  // also prevents names from becoming shell syntax or instructions in guidance.
  if (!/^[\p{L}\p{N}\p{M}_./-]+$/u.test(value) || value.startsWith('-') || value.endsWith('.') || value.includes('..')) return false
  return value.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.lock'))
}

/** Shared by API writes, stored metadata parsing, and the settings form. */
export function branchGuidanceValidationError(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '올바른 브랜치 설정을 입력하세요.'
  const item = value as Record<string, unknown>
  const keys = Object.keys(defaultBranchGuidance)
  if (Object.keys(item).length !== keys.length || Object.keys(item).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(item, key))) return '알 수 없거나 누락된 브랜치 설정 항목이 있습니다.'
  if (!['github-flow', 'git-flow', 'trunk', 'inherit'].includes(item.strategy as string)) return '올바른 브랜치 전략을 선택하세요.'
  if (item.baseBranch !== '' && !safeBranchName(item.baseBranch)) return `기본 브랜치는 ${BRANCH_NAME_MAX_LENGTH}자 이내의 유효한 브랜치 이름으로 입력하세요.`
  if (!safeBranchName(item.developmentBranch)) return `개발 브랜치는 ${BRANCH_NAME_MAX_LENGTH}자 이내의 유효한 브랜치 이름으로 입력하세요.`
  if (typeof item.branchPrefix !== 'string' || item.branchPrefix.length > BRANCH_PREFIX_MAX_LENGTH || !safeBranchName(`${item.branchPrefix}task`)) return `브랜치 접두사는 ${BRANCH_PREFIX_MAX_LENGTH}자 이내의 문자·숫자와 . _ / -로 입력하세요.`
  if (!['auto', 'always', 'never'].includes(item.worktree as string)) return '올바른 워크트리 사용 방식을 선택하세요.'
  if (!['squash', 'merge', 'rebase'].includes(item.mergeMethod as string)) return '올바른 병합 방식을 선택하세요.'
  if (typeof item.cleanup !== 'boolean') return '브랜치 정리 여부를 선택하세요.'
  if (!['manual', 'local', 'remote'].includes(item.workflow as string)) return '올바른 Git 자동 처리 범위를 선택하세요.'
  return null
}

/** Stable, versioned metadata and exact text allow handwritten edits to stay custom. */
export function branchGuidanceText(settings: BranchGuidanceSettings): string {
  const ordered = Object.fromEntries(Object.keys(defaultBranchGuidance).map(key => [key, settings[key as keyof BranchGuidanceSettings]]))
  const metadata = `<!-- mew:branch-guidance:v3 ${JSON.stringify(ordered)} -->`
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
    'For any new worktree, follow an explicit user or repository location first; otherwise use <primary-checkout>/.worktrees/<safe-branch-slug>, for example .worktrees/feat-example. Resolve the primary checkout from the shared Git directory and registered worktrees, including when already inside a linked worktree. In this default layout, never create nested worktrees or sibling folders such as <repository>-<branch>. Derive a single safe directory name from the branch, replacing / with -, and check existing paths before reusing a matching worktree.',
    'Before creating an internal worktree, verify that /.worktrees/ is ignored in the primary checkout; add that entry to its .gitignore if missing while preserving existing edits. Keep existing worktrees at their current paths unless the user requests relocation. For an authorized relocation, use git worktree move after confirming that no running process or session depends on its old path, and preserve all uncommitted work.',
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
