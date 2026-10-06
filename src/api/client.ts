import type { UpdatesStatus } from '../../shared/updates'
import type { GitRemoteProgress, GitRemoteEvent } from '../../shared/git-remote-progress'
import { gitFetch } from './git-auth-request'
import { uiText } from '@mew/ui/i18n-core'
import type { ProjectTabGroup } from '../../shared/project-tab-groups'
import type { GitAiCommitJob } from '../../shared/git-ai-commit'
import type { GitHubAuthStatus, GitHubLoginJob } from '../../shared/github-auth'
import type { Capabilities, AccessSettings, FileRule, Feature } from '../../shared/access-policy'
import type { FileFavorite } from '../../shared/file-favorites'
import type { MissingDirectory } from '../../shared/external-path'
import type { EditorApi, EditorDbApi, DbColumn, DbColumnType, DbRow, DbSummary, DbView, TableWidths } from '@mew/editor'
import type { TmuxPanelApi, TmuxSession } from '@mew/tmux-term'
import { isHiddenTmuxSession } from '@mew/tmux-term'
import { subscribeDb } from './dbSocket'
import { compressImage } from '../utils/compressImage'
import { detectInitialProject } from '../utils/active-project'

export type { TreeNode } from '@mew/editor'
export type { TmuxSession } from '@mew/tmux-term'
import type { TreeNode } from '@mew/editor'

const PROJECT_KEY = 'mew:project'

// 프로젝트 전환은 **페이지 이동이 아니다** — 앱 안에서 활성 프로젝트만 바뀐다(프로젝트 탭).
// 그래서 이 값은 상수가 아니라 런타임 상태이고, 요청을 보내는 순간에 읽어야 한다.
// 옛 `/{프로젝트}` 주소로 들어와도 그 프로젝트로 시작한다 — 밖에 나가 있는 링크를 살려두기 위해서다.
function detectProject(): string {
  return detectInitialProject(location.pathname, localStorage.getItem(PROJECT_KEY))
}

let currentProject = detectProject()

/** 지금 화면이 보고 있는 프로젝트. 모듈 상수가 아니므로 **호출 시점**에 읽는다 */
export function getProject(): string {
  return currentProject
}

/**
 * 활성 프로젝트를 바꾼다 — 화면(App)이 프로젝트 탭을 전환할 때 **렌더 전에 동기로** 부른다.
 * 이후의 모든 기본 스코프 요청이 새 프로젝트로 나간다. 전환 뒤에도 살아 있는 비동기 작업
 * (자동저장 디바운스 등)은 이 값을 믿으면 안 되고 자기 프로젝트를 인자로 넘겨야 한다.
 */
export function setProject(name: string): void {
  currentProject = name
  try {
    localStorage.setItem(PROJECT_KEY, name)
  } catch {
    // 사생활 보호 모드 등 — 저장 실패해도 이번 세션 동작에는 지장이 없다
  }
}

function projectQs(project: string = currentProject): string {
  return `project=${encodeURIComponent(project)}`
}

export interface ProjectInfo {
  name: string
  icon: string | null
  /** 프로젝트 선택 창 격자에서의 자리(0부터) — null이면 앞쪽 빈 칸부터 채운다 */
  slot: number | null
  /** 보호된 프로젝트(docs·앱 자신)면 true — 개명/삭제할 수 없다 */
  protected?: boolean
}

export interface RootProjectTabState {
  groups?: ProjectTabGroup[]
  paths: string[]
  icons: Record<string, string>
}

export interface AgentTabState {
  id: string
  label: string
  runtime?: string | null
  cwd?: string | null
  renamed?: boolean
  sessionIds?: Record<string, string>
  preset?: { id: string; name: string; thinkingId?: string; thinkingConfigId?: string; modelId: string; role: string }
}

export interface AgentTabsState {
  tabs: AgentTabState[]
  activeId: string | null
}

/** 새 에이전트 탭을 시작할 때 고르는 런타임·모델·역할 프리셋. */
export interface AgentSet {
  id: string
  name: string
  role: string
  runtime: string
  modelId: string
  thinkingId?: string
  thinkingConfigId?: string
}

/** 계정별·루트별 작업 화면 상태. 각 필드는 독립적으로 확장 가능한 JSON 값이다. */
export type WorkspaceUiState = Record<string, unknown>

/** 로그인 계정의 열린 루트 프로젝트와 아이콘(Owner 전용). */
export function fetchRootProjectTabs(): Promise<{ state: RootProjectTabState | null }> {
  return fetch('/api/user-ui/root-projects').then(json<{ state: RootProjectTabState | null }>)
}

export function saveRootProjectTabs(state: RootProjectTabState): Promise<{ state: RootProjectTabState }> {
  return fetch('/api/user-ui/root-projects', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  }).then(json<{ state: RootProjectTabState }>)
}

/** Both navigation surfaces read the project's own .mew icon file. */
export function fetchRootProjectIcons(paths: string[]): Promise<{ icons: Record<string, string> }> {
  return fetch('/api/project-icons/read', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths }),
  }).then(json<{ icons: Record<string, string> }>)
}

export function saveRootProjectIcon(path: string, icon: string): Promise<{ icon: string | null }> {
  return fetch('/api/project-icons', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, icon }),
  }).then(json<{ icon: string | null }>)
}

/** 로그인 계정의 루트 프로젝트별 에이전트 탭·ACP 세션 포인터. */
export type AgentSessionClaim = { workspacePath: string; tabId: string; sessionId: string }

export function fetchAgentTabs(workspacePath: string): Promise<{ state: AgentTabsState | null; claims: AgentSessionClaim[] }> {
  return fetch(`/api/user-ui/agent-tabs?workspace=${encodeURIComponent(workspacePath)}`).then(json<{ state: AgentTabsState | null; claims: AgentSessionClaim[] }>)
}

export function saveAgentTabs(workspacePath: string, state: AgentTabsState): Promise<{ state: AgentTabsState }> {
  return fetch('/api/user-ui/agent-tabs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, ...state }),
  }).then(json<{ state: AgentTabsState }>)
}

export function fetchWorkspaceUi(workspacePath: string): Promise<{ state: WorkspaceUiState | null }> {
  return fetch(`/api/user-ui/workspace?workspace=${encodeURIComponent(workspacePath)}`).then(json<{ state: WorkspaceUiState | null }>)
}

export function saveWorkspaceUi(workspacePath: string, state: WorkspaceUiState): Promise<{ state: WorkspaceUiState }> {
  return fetch('/api/user-ui/workspace', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, state }),
  }).then(json<{ state: WorkspaceUiState }>)
}

export function fetchProjects(): Promise<ProjectInfo[]> {
  return fetch('/api/projects').then(json<ProjectInfo[]>)
}

export function fetchAgentSets(): Promise<{ sets: AgentSet[] }> {
  return fetch('/api/agent-sets').then(json<{ sets: AgentSet[] }>)
}

export type AgentModelOption = { modelId: string; name: string }

export type AgentThinkingOption = { configId: string; options: { id: string; name: string }[] }

export function fetchAgentModels(runtime: string, signal?: AbortSignal): Promise<{ models: AgentModelOption[]; thinking?: AgentThinkingOption | null }> {
  return fetch(`/api/agent-runtimes/${encodeURIComponent(runtime)}/models`, { signal })
    .then(json<{ models: AgentModelOption[]; thinking?: AgentThinkingOption | null }>)
}

export function saveAgentSets(sets: AgentSet[]): Promise<{ sets: AgentSet[] }> {
  return fetch('/api/agent-sets', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sets }),
  }).then(json<{ sets: AgentSet[] }>)
}

export interface WorkspaceFileLink {
  project: string
  path: string
  line: number | null
}

/** 에이전트 마크다운의 로컬 경로를 현재 워크스페이스 안의 파일로 검증·해석한다. */
export function resolveAgentFileLink(href: string): Promise<{ target: WorkspaceFileLink | null }> {
  return fetch(`/api/agent-file-link?href=${encodeURIComponent(href)}`).then(json<{ target: WorkspaceFileLink | null }>)
}

/** 에이전트 주소창 경로를 서버 파일시스템 기준 절대 디렉터리로 검증·정규화한다. */
export function resolveAgentCwd(path: string, base = ''): Promise<{ cwd: string }> {
  const query = new URLSearchParams({ path, base })
  return fetch(`/api/agent-cwd?${query}`).then(json<{ cwd: string }>)
}

export interface AgentCwdSuggestions {
  directory: string
  prefix: string
  dirs: { name: string; path: string }[]
}

export function fetchAgentCwdSuggestions(input: string, base: string, entered = false): Promise<AgentCwdSuggestions> {
  const query = new URLSearchParams({ input, base, entered: String(entered) })
  return fetch(`/api/agent-cwd/suggestions?${query}`).then(json<AgentCwdSuggestions>)
}

export function scheduleAgentPrompt(input: {
  runtime: string
  tab: string
  cwd: string
  sessionId: string
  text: string
  skills: string[]
  at: string
}): Promise<{ job: AgentScheduledPrompt }> {
  return fetch('/api/agent/scheduled-prompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then(json<{ job: AgentScheduledPrompt }>)
}

export interface AgentScheduledPrompt {
  id: string
  runtime: string
  tab: string
  cwd: string
  text: string
  at: string
  createdAt: string
}

type AgentScheduledPromptScope = Pick<AgentScheduledPrompt, 'runtime' | 'tab' | 'cwd'>

export function fetchAgentScheduledPrompts(scope: AgentScheduledPromptScope): Promise<{ jobs: AgentScheduledPrompt[] }> {
  const params = new URLSearchParams(scope)
  return fetch(`/api/agent/scheduled-prompts?${params.toString()}`).then(json<{ jobs: AgentScheduledPrompt[] }>)
}

export function cancelAgentScheduledPrompt(id: string, scope: AgentScheduledPromptScope): Promise<{ ok: true }> {
  const params = new URLSearchParams(scope)
  return fetch(`/api/agent/scheduled-prompts/${encodeURIComponent(id)}?${params.toString()}`, { method: 'DELETE' }).then(json<{ ok: true }>)
}

export function updateAgentScheduledPrompt(id: string, input: AgentScheduledPromptScope & { text: string; skills: string[]; at: string }): Promise<{ job: AgentScheduledPrompt }> {
  return fetch(`/api/agent/scheduled-prompts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then(json<{ job: AgentScheduledPrompt }>)
}

/** 응답의 icon은 서버가 실제로 저장한 값 — 직접 넣은 SVG는 정리를 거치므로 보낸 값과 다를 수 있다 */
export function setProjectIcon(project: string, icon: string | null): Promise<{ ok: true; icon: string | null }> {
  return fetch('/api/project-icon', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, icon }),
  }).then(json<{ ok: true; icon: string | null }>)
}

/** 프로젝트 타일 배치(이름 → 격자 칸 번호)를 통째로 저장한다 */
export function setProjectLayout(layout: Record<string, number>): Promise<{ ok: true }> {
  return fetch('/api/project-layout', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout }),
  }).then(json<{ ok: true }>)
}

/** 새 프로젝트(워크스페이스 최상위 폴더)를 만든다 — owner 전용 */
export function createProject(name: string): Promise<{ ok: true; name: string }> {
  return fetch('/api/project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then(json<{ ok: true; name: string }>)
}

/** 프로젝트 폴더 이름을 바꾼다 — owner 전용 */
export function renameProject(oldName: string, newName: string): Promise<{ ok: true; name: string }> {
  return fetch('/api/project', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldName, newName }),
  }).then(json<{ ok: true; name: string }>)
}

/** 프로젝트 폴더를 통째로 삭제한다 — owner 전용, 되돌릴 수 없음 */
export function deleteProject(name: string): Promise<{ ok: true }> {
  return fetch(`/api/project?name=${encodeURIComponent(name)}`, { method: 'DELETE' }).then(json<{ ok: true }>)
}

export interface BrowseResult {
  path: string
  /** 최상위(/)면 null */
  parent: string | null
  dirs: { name: string; path: string }[]
}

/** 워크스페이스 밖 폴더를 훑는다 — owner 전용. 폴더만 돌아온다(파일 브라우저·워크스페이스 고르기) */
export function browseDirs(path = ''): Promise<BrowseResult> {
  return fetch(`/api/fs/dirs?path=${encodeURIComponent(path)}`).then(json<BrowseResult>)
}

export function fetchFileFavorites(): Promise<{ folders: FileFavorite[] }> {
  return fetch('/api/fs/favorites').then(json<{ folders: FileFavorite[] }>)
}

export const FILE_FAVORITES_CHANGED = 'mew:file-favorites-changed'

export function setFileFavorite(path: string, favorite: boolean): Promise<{ ok: true }> {
  return fetch('/api/fs/favorites', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, favorite }) }).then(json<{ ok: true }>).then(result => {
    window.dispatchEvent(new Event(FILE_FAVORITES_CHANGED))
    return result
  })
}

export interface ExternalEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  size: number | null
  git?: boolean
}

export interface ExternalEntriesResult {
  path: string
  canonicalPath?: string
  parent: string | null
  entries: ExternalEntry[]
}

export class MissingDirectoryError extends Error {
  missing: MissingDirectory
  constructor(message: string, missing: MissingDirectory) { super(message); this.missing = missing }
}

export async function browseExternalEntries(path = ''): Promise<ExternalEntriesResult> {
  const response = await fetch(`/api/fs/entries?path=${encodeURIComponent(path)}`)
  if (response.status === 404) {
    const body = await response.clone().json().catch(() => null)
    if (body?.code === 'MISSING_DIRECTORY' && typeof body.missing?.path === 'string'
      && typeof body.missing.existingPath === 'string' && typeof body.missing.missingName === 'string') {
      throw new MissingDirectoryError(body.error, body.missing)
    }
  }
  return json<ExternalEntriesResult>(response)
}

export function createExternalDirectory(path: string): Promise<{ ok: true; path: string }> {
  return fetch('/api/fs/directory', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }),
  }).then(json<{ ok: true; path: string }>)
}

export function fetchExternalFile(path: string): Promise<{ path: string; content: string; editable: true }> {
  return fetch(`/api/fs/file?path=${encodeURIComponent(path)}`)
    .then(json<{ path: string; content: string }>)
    .then((result) => ({ ...result, editable: true as const }))
}

export function saveExternalFile(path: string, content: string, expectedContent?: string): Promise<{ ok: true; path: string }> {
  return fetch('/api/fs/file', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content, expectedContent }),
  }).then(json<{ ok: true; path: string }>)
}

export function renameExternalPath(path: string, name: string): Promise<{ ok: true; path: string }> {
  return fetch('/api/fs/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, name }),
  }).then(json<{ ok: true; path: string }>)
}

export function deleteExternalPath(path: string): Promise<{ ok: true }> {
  return fetch(`/api/fs/path?path=${encodeURIComponent(path)}`, { method: 'DELETE' }).then(json<{ ok: true }>)
}

export function pasteExternalPath(
  source: string,
  destination: string,
  mode: 'copy' | 'cut',
): Promise<{ ok: true; path: string }> {
  return fetch('/api/fs/paste', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, destination, mode }),
  }).then(json<{ ok: true; path: string }>)
}

export function createExternalFolder(parent: string, name: string): Promise<{ ok: true; path: string }> {
  return fetch('/api/fs/folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent, name }),
  }).then(json<{ ok: true; path: string }>)
}

export function initializeExternalGit(path: string): Promise<{ ok: true; path: string }> {
  return fetch('/api/fs/git/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }).then(json<{ ok: true; path: string }>)
}

export function cloneExternalGit(parent: string, url: string, name?: string): Promise<{ ok: true; path: string }> {
  return fetch('/api/fs/git/clone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent, url, name }),
  }).then(json<{ ok: true; path: string }>)
}

export interface GitRepositoryInfo {
  workspace?: string
  repository: boolean
  path: string
  branch: string | null
  detached: boolean
  dirty: boolean
  ahead: number
  behind: number
  originUrl?: string | null
  remotes: string[]
}

export interface GitRepositoryEntry { path: string }

export interface GitLogEntry {
  hash: string
  parents: string[]
  refs: string[]
  subject: string
  author: string
  email: string
  date: string
}

export interface GitChangedFile { status: string; path: string; previousPath?: string; currentIp?: boolean }
export interface GitCommitDetail extends GitLogEntry { body: string; files: GitChangedFile[] }
export interface GitWorkingTreeDetail { files: GitChangedFile[] }
export interface GitWorkingTreeCommitResult { info: GitRepositoryInfo; hash: string }
export type GitCommitAction = 'branch' | 'tag' | 'checkout' | 'cherry-pick' | 'revert'

export function fetchGitRepository(path = '', project = currentProject): Promise<GitRepositoryInfo> {
  return fetch(`/api/git/repository?path=${encodeURIComponent(path)}&${projectQs(project)}`).then(json<GitRepositoryInfo>)
}

export function fetchGitHubAuth(project: string): Promise<GitHubAuthStatus> {
  return fetch(`/api/git-connections/github?${projectQs(project)}`).then(json<GitHubAuthStatus>)
}

export function disconnectGitHub(project: string): Promise<{ ok: true }> {
  return fetch(`/api/git-connections/github?${projectQs(project)}`, { method: 'DELETE' }).then(json<{ ok: true }>)
}

export function startGitHubLogin(project: string): Promise<{ job: GitHubLoginJob }> {
  return fetch(`/api/git-connections/github?${projectQs(project)}`, { method: 'POST' }).then(json<{ job: GitHubLoginJob }>)
}

export function stopGitHubLogin(project: string, id: string): Promise<{ ok: true }> {
  return fetch(`/api/git-connections/github/${encodeURIComponent(id)}/stop?${projectQs(project)}`, { method: 'POST' }).then(json<{ ok: true }>)
}

export function openGitHubLoginBrowser(project: string, id: string): Promise<{ streamUrl: string }> {
  return fetch(`/api/git-connections/github/${encodeURIComponent(id)}/browser?${projectQs(project)}`, { method: 'POST' }).then(json<{ streamUrl: string }>)
}

function gitAiCommitUrl(project: string, workspace: string, suffix = ''): string {
  return `/api/git/ai-commit${suffix}?${projectQs(project)}&workspace=${encodeURIComponent(workspace)}`
}
export function fetchGitAiCommit(project: string, workspace: string): Promise<{ job: GitAiCommitJob | null }> {
  return fetch(gitAiCommitUrl(project, workspace)).then(json<{ job: GitAiCommitJob | null }>)
}
export function startGitAiCommit(project: string, workspace: string, id: string, agentSetId: string, files: string[]): Promise<{ job: GitAiCommitJob }> {
  return gitFetch(gitAiCommitUrl(project, workspace), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, agentSetId, files }) }, project).then(json<{ job: GitAiCommitJob }>)
}
export function stopGitAiCommit(project: string, workspace: string, id: string): Promise<{ ok: true }> {
  return fetch(gitAiCommitUrl(project, workspace, `/${encodeURIComponent(id)}/stop`), { method: 'POST' }).then(json<{ ok: true }>)
}

export function createSubproject(path: string, project: string): Promise<{ ok: true }> {
  return fetch(`/api/subprojects?${projectQs(project)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }),
  }).then(json<{ ok: true }>)
}

export function initializeGitRepository(path = '', project = currentProject): Promise<GitRepositoryInfo> {
  return fetch(`/api/git/init?${projectQs(project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }).then(json<GitRepositoryInfo>)
}

export function fetchGitLog(path = '', project = currentProject, limit = 300): Promise<{ commits: GitLogEntry[] }> {
  return fetch(`/api/git/log?path=${encodeURIComponent(path)}&limit=${limit}&${projectQs(project)}`).then(json<{ commits: GitLogEntry[] }>)
}

export function fetchGitRepositories(project = currentProject): Promise<{ repositories: GitRepositoryEntry[] }> {
  return fetch(`/api/git/repositories?${projectQs(project)}`).then(json<{ repositories: GitRepositoryEntry[] }>)
}

export function fetchGitCommit(path: string, hash: string, project = currentProject): Promise<GitCommitDetail> {
  return fetch(`/api/git/commit?path=${encodeURIComponent(path)}&hash=${encodeURIComponent(hash)}&${projectQs(project)}`).then(json<GitCommitDetail>)
}

export function fetchGitDiff(path: string, hash: string, file: string, project = currentProject): Promise<{ diff: string }> {
  return fetch(`/api/git/diff?path=${encodeURIComponent(path)}&hash=${encodeURIComponent(hash)}&file=${encodeURIComponent(file)}&${projectQs(project)}`).then(json<{ diff: string }>)
}

export function fetchGitWorkingTree(path = '', project = currentProject): Promise<GitWorkingTreeDetail> {
  return fetch(`/api/git/working-tree?path=${encodeURIComponent(path)}&${projectQs(project)}`).then(json<GitWorkingTreeDetail>)
}

export function fetchGitWorkingTreeDiff(path: string, file: string, project = currentProject): Promise<{ diff: string }> {
  return fetch(`/api/git/working-tree/diff?path=${encodeURIComponent(path)}&file=${encodeURIComponent(file)}&${projectQs(project)}`).then(json<{ diff: string }>)
}

export function commitGitWorkingTree(path: string, title: string, description: string, project: string, files: string[]): Promise<GitWorkingTreeCommitResult> {
  return gitFetch(`/api/git/commit?${projectQs(project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, title, description, files }),
  }, project).then(json<GitWorkingTreeCommitResult>)
}

export function discardGitWorkingTree(path: string, project: string, workspace: string, files: string[]): Promise<{ ok: true }> {
  return fetch(`/api/git/discard?${projectQs(project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, workspace, files }),
  }).then(json<{ ok: true }>)
}

export function runGitCommitAction(path: string, action: GitCommitAction, hash: string, name?: string, project = currentProject): Promise<GitRepositoryInfo> {
  return gitFetch(`/api/git/action?${projectQs(project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, action, hash, name }),
  }, project).then(json<GitRepositoryInfo>)
}

export interface GitBranchRef { name: string; ref: string; kind: 'local' | 'remote' | 'tag' }

export function fetchGitBranches(path: string, project: string): Promise<{ branches: GitBranchRef[] }> {
  return fetch(`/api/git/branches?path=${encodeURIComponent(path)}&${projectQs(project)}`).then(json<{ branches: GitBranchRef[] }>)
}

export function runGitBranchAction(path: string, action: 'switch' | 'create', ref: string, name: string | undefined, project: string, workspace: string): Promise<GitRepositoryInfo> {
  return gitFetch(`/api/git/branches?${projectQs(project)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, action, ref, name, workspace }),
  }, project).then(json<GitRepositoryInfo>)
}

export async function runGitRemoteAction(path: string, action: 'pull' | 'push', project: string, workspace: string, onProgress?: (progress: GitRemoteProgress) => void): Promise<{ ok: true }> {
  const response = await gitFetch(`/api/git/remote?${projectQs(project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify({ path, action, workspace }),
  }, project)
  if (!response.ok || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) return json<{ ok: true }>(response)
  const reader = response.body?.getReader()
  if (!reader) throw new Error(uiText('Git 진행 상황 연결이 끊겼습니다. 저장소 상태를 확인하세요.'))
  const decoder = new TextDecoder()
  let pending = '', complete = false
  const consume = (line: string) => {
    if (!line.trim()) return
    const event = JSON.parse(line) as GitRemoteEvent
    if (event.type === 'error') throw new Error(event.error)
    if (event.type === 'complete') complete = true
    if (event.type === 'progress') onProgress?.(event.progress)
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      const lines = pending.split('\n')
      pending = lines.pop()!
      for (const line of lines) consume(line)
      if (done) { consume(pending); break }
    }
  } finally { reader.releaseLock() }
  if (!complete) throw new Error(uiText('Git 진행 상황 연결이 끊겼습니다. 저장소 상태를 확인하세요.'))
  return { ok: true }
}

export function externalRawUrl(path: string): string {
  return `/api/fs/raw?path=${encodeURIComponent(path)}`
}

export function externalDownloadUrl(path: string): string {
  return `/api/fs/download?path=${encodeURIComponent(path)}`
}

export function openExternalProject(path: string): Promise<WorkspaceInfo & { project: string }> {
  return fetch('/api/fs/open-project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }).then(json<WorkspaceInfo & { project: string }>)
}

export interface WorkspaceInfo {
  path: string
  /** 그 폴더 안에서 프로젝트로 잡히는 것들 — 폴더 하나가 프로젝트 하나 */
  projects: string[]
  /** docs로 쓰는 폴더 — 워크스페이스 루트 기준 상대 경로 */
  docs: string
  /** 같은 폴더의 절대 경로 */
  docsPath: string
}

/** 지금 열려 있는 워크스페이스 — owner 전용(서버 기계의 경로다) */
export function fetchWorkspace(): Promise<WorkspaceInfo> {
  return fetch('/api/workspace').then(json<WorkspaceInfo>)
}

/** 워크스페이스를 통째로 바꾼다 — owner 전용. 성공하면 클라이언트가 새 루트 상태로 교체한다. */
export function switchWorkspace(path: string): Promise<WorkspaceInfo> {
  return fetch('/api/workspace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }).then(json<WorkspaceInfo>)
}

export function openSubproject(path: string, project: string, workspace: string): Promise<WorkspaceInfo> {
  return fetch(`/api/subprojects/open?project=${encodeURIComponent(project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, workspace }),
  }).then(json<WorkspaceInfo>)
}

/** 기억해 둔 활성 프로젝트를 버린다 — 워크스페이스가 바뀌면 그 이름은 남의 폴더 것이라 docs부터 다시 시작한다 */
export function forgetSavedProject(): void {
  try {
    localStorage.removeItem(PROJECT_KEY)
  } catch {
    // 저장소를 못 쓰는 브라우저 — 어차피 기억해 둔 것도 없다
  }
}

/** docs로 쓸 폴더를 워크스페이스 안에서 바꾼다 — owner 전용. 성공하면 **화면을 다시 띄워야 한다**(열린 docs 탭이 옛 폴더 것이다) */
export function setDocsRoot(path: string): Promise<WorkspaceInfo> {
  return fetch('/api/docs/root', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }).then(json<WorkspaceInfo>)
}

/** 외부 폴더로 docs를 덮어쓴다 — owner 전용, **기존 docs 내용은 사라진다**(호출 전 확인 필수) */
export function importDocs(path: string): Promise<{ ok: true }> {
  return fetch('/api/docs/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }).then(json<{ ok: true }>)
}

/** docs 폴더를 대상 폴더 아래 `docs`로 복사한다 — owner 전용. 응답의 path는 만들어진 폴더 */
export function exportDocs(path: string): Promise<{ ok: true; path: string }> {
  return fetch('/api/docs/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }).then(json<{ ok: true; path: string }>)
}

export function fetchBrowserFrameUrl(url: string): Promise<{ url: string }> {
  return fetch(`/api/browser-url?url=${encodeURIComponent(url)}`).then(json<{ url: string }>)
}

export type ServerBrowserTab = { id: string; url: string; title: string; streamUrl: string }
export function listServerBrowserTabs(): Promise<ServerBrowserTab[]> {
  return fetch('/api/browser-dom/tabs').then(json<ServerBrowserTab[]>)
}
export function openServerBrowserTab(id: string, url: string): Promise<ServerBrowserTab> {
  return fetch('/api/browser-dom/tabs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, url }) }).then(json<ServerBrowserTab>)
}
export function closeServerBrowserTab(id: string): Promise<{ ok: true }> {
  return fetch(`/api/browser-dom/tabs/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(json<{ ok: true }>)
}

export interface AndroidEnvCheck {
  id: string
  label: string
  ok: boolean
  detail: string
  fixes?: AndroidCommandItem[]
}

export interface AndroidCommandItem {
  id?: string
  context: string
  command?: string
  session?: string
  running?: boolean
}

export interface AndroidEnvStatus {
  platform: string
  architecture: string
  isWsl: boolean
  sdkRoot: string
  checks: AndroidEnvCheck[]
  suggestedCommands: Array<AndroidCommandItem & { id: string; command: string; session: string; running: boolean }>
}

export function fetchAndroidEnvStatus(): Promise<AndroidEnvStatus> {
  return fetch('/api/android/status').then(json<AndroidEnvStatus>)
}

export function runAndroidCommand(id: string): Promise<{ ok: true; session: string }> {
  return fetch(`/api/android/commands/${encodeURIComponent(id)}/run`, { method: 'POST' }).then(
    json<{ ok: true; session: string }>,
  )
}

/** 햄버거 메뉴의 서버 등록 mew 작업 — id 외의 셸 문자열은 절대 보내지 않는다. */
export interface MewUpdateStatus {
  supported: boolean
  canUpdate: boolean
  branch: string | null
  localHash: string | null
  remoteHash: string | null
  ahead: number
  behind: number
  available: boolean
  dirty: boolean
  running: boolean
  managedByMew: boolean
  error: string | null
  job: { state: 'queued' | 'running' | 'succeeded' | 'failed'; startedAt: number; finishedAt: number | null; message: string | null } | null
}

export function fetchMewUpdateStatus(refreshRemote = false): Promise<MewUpdateStatus> {
  return fetch(`/api/mew-update/status${refreshRemote ? '?refresh=1' : ''}`).then(json<MewUpdateStatus>)
}

export function runMewAction(id: 'restart' | 'build' | 'update'): Promise<{ ok: true; session: string }> {
  return fetch(`/api/mew-actions/${id}/run`, { method: 'POST' }).then(json<{ ok: true; session: string }>)
}

export interface SkillSummary {
  name: string
  description: string
  path: string
}

export function fetchSkills(cwd?: string, runtime?: string): Promise<{ skills: SkillSummary[] }> {
  const query = new URLSearchParams()
  if (cwd) query.set('cwd', cwd)
  if (runtime) query.set('runtime', runtime)
  return fetch(`/api/skills?${query}`).then(json<{ skills: SkillSummary[] }>)
}

export interface AgentRuntimeStatus {
  id: string
  label: string
  surface: 'acp' | 'terminal'
  installed: boolean
  installing: boolean
  installable: boolean
  uninstallable: boolean
  logoutable: boolean
}

export function fetchAgentRuntimes(): Promise<{ runtimes: AgentRuntimeStatus[] }> {
  return fetch('/api/agent-runtimes').then(json<{ runtimes: AgentRuntimeStatus[] }>)
}

export function startAgentTerminal(runtime: string, tab: string, cwd: string): Promise<{ ok: true; session: string }> {
  return fetch(`/api/agent-runtimes/${encodeURIComponent(runtime)}/terminal/${encodeURIComponent(tab)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd }),
  }).then(json<{ ok: true; session: string }>)
}

export function stopAgentTerminal(runtime: string, tab: string): Promise<{ ok: true }> {
  return fetch(`/api/agent-runtimes/${encodeURIComponent(runtime)}/terminal/${encodeURIComponent(tab)}`, {
    method: 'DELETE',
  }).then(json<{ ok: true }>)
}

export function installAgentRuntime(id: string): Promise<{ status: AgentRuntimeStatus; output: string }> {
  return fetch(`/api/agent-runtimes/${encodeURIComponent(id)}/install`, { method: 'POST' }).then(
    json<{ status: AgentRuntimeStatus; output: string }>,
  )
}

export function uninstallAgentRuntime(id: string): Promise<{ status: AgentRuntimeStatus; output: string }> {
  return fetch(`/api/agent-runtimes/${encodeURIComponent(id)}/install`, { method: 'DELETE' }).then(json<{ status: AgentRuntimeStatus; output: string }>)
}

export function logoutAgentRuntime(id: string): Promise<{ output: string }> {
  return fetch(`/api/agent-runtimes/${encodeURIComponent(id)}/logout`, { method: 'POST' }).then(json<{ output: string }>)
}

/** 런타임 설정 — env 값은 마스킹(마지막 4자)이라 원문을 되찾을 수 없다. 덮어쓸 때만 전송한다 */
export function fetchAgentRuntimeSetting(id: string): Promise<{ settings: RuntimeSettingView | null }> {
  return fetch(`/api/agent-runtimes/${encodeURIComponent(id)}/settings`).then(json<{ settings: RuntimeSettingView | null }>)
}

export function saveAgentRuntimeSetting(id: string, settings: RuntimeSettingInput): Promise<{ settings: RuntimeSettingView | null }> {
  return fetch(`/api/agent-runtimes/${encodeURIComponent(id)}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  }).then(json<{ settings: RuntimeSettingView | null }>)
}

export function deleteAgentRuntimeSetting(id: string): Promise<{ ok: boolean }> {
  return fetch(`/api/agent-runtimes/${encodeURIComponent(id)}/settings`, { method: 'DELETE' }).then(json<{ ok: boolean }>)
}

export function fetchAgentRuntimeAccount(id: string): Promise<{ account: import('../../shared/agent-access').RuntimeAccount }> {
  return fetch(`/api/agent-runtimes/${encodeURIComponent(id)}/account`, { cache: 'no-store' }).then(json<{ account: import('../../shared/agent-access').RuntimeAccount }>)
}

/** 저장된 런타임 설정의 마스킹 뷰 — 시크릿은 ****끝4자만 온다 */
export interface RuntimeSettingView {
  cmd?: string
  extraArgs?: string[]
  env?: Record<string, string>
}

/** 설정 팝업이 서버로 보내는 값. 빈 문자열 필드는 저장에서 뺀다 */
export interface RuntimeSettingInput {
  cmd?: string
  extraArgs?: string[]
  env?: Record<string, string>
}

export interface AgentAuthTerminal {
  session: string
  label: string
  running: true
  state: AgentAuthTerminalState
  exitCode: number | null
}

export type AgentAuthTerminalState = 'running' | 'succeeded' | 'failed' | 'interrupted'

export interface AgentAuthTerminalStatus {
  state: AgentAuthTerminalState
  exitCode: number | null
  verificationUrl: string | null
  verificationCode: string | null
  errorMessage: string | null
}

export function runAgentAuthTerminal(runtime: string, tab: string, cwd: string, methodId: string): Promise<AgentAuthTerminal> {
  return fetch(`/api/agent-runtimes/${encodeURIComponent(runtime)}/auth/${encodeURIComponent(methodId)}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tab, cwd }),
  })
    .then(json<{ ok: true } & AgentAuthTerminal>)
    .then(({ session, label, running, state, exitCode }) => ({ session, label, running, state, exitCode }))
}

export function fetchAgentAuthTerminalStatus(
  runtime: string,
  tab: string,
  methodId: string,
): Promise<AgentAuthTerminalStatus> {
  const query = new URLSearchParams({ tab })
  return fetch(
    `/api/agent-runtimes/${encodeURIComponent(runtime)}/auth/${encodeURIComponent(methodId)}/status?${query}`,
  ).then(json<AgentAuthTerminalStatus>)
}

export function openAgentAuthServerBrowser(
  runtime: string,
  tab: string,
  methodId: string,
): Promise<{ url: string; streamUrl: string }> {
  return fetch(`/api/agent-runtimes/${encodeURIComponent(runtime)}/auth/${encodeURIComponent(methodId)}/browser`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tab }),
  }).then(json<{ url: string; streamUrl: string }>)
}

export function submitAgentAuthBrowserInput(runtime: string, tab: string, methodId: string, input: string): Promise<{ ok: true }> {
  return fetch(`/api/agent-runtimes/${encodeURIComponent(runtime)}/auth/${encodeURIComponent(methodId)}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tab, input }),
  }).then(json<{ ok: true }>)
}

export interface AgentRuntimeDefault {
  modelId?: string
  thinkingId?: string
  modeId?: string
}

export function fetchAgentDefault(id: string): Promise<{ settings: AgentRuntimeDefault | null }> {
  return fetch(`/api/agent-defaults/${encodeURIComponent(id)}`).then(json<{ settings: AgentRuntimeDefault | null }>)
}

export function saveAgentDefault(id: string, settings: AgentRuntimeDefault): Promise<{ settings: AgentRuntimeDefault }> {
  return fetch(`/api/agent-defaults/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  }).then(json<{ settings: AgentRuntimeDefault }>)
}

export interface TodoItem {
  id: string
  text: string
  type: TodoType
  status: TodoStatus
  done: boolean
  /** 완료한 날짜(YYYY-MM-DD) 또는 null — 주기 항목 매일 초기화용 */
  doneDate: string | null
  /** YYYY-MM-DD 또는 null */
  due: string | null
  /** HH:MM(24시간제) 또는 null */
  time: string | null
  projects: string[]
  createdAt: string
  updatedAt: string
}

export type TodoType = 'today' | 'dated' | 'recurring'
export type TodoStatus = 'open' | 'done' | 'canceled' | 'missed'

/** 로그인 사용자의 할 일 — 홈 탭. 게스트에게는 닫혀 있다 */
export function fetchTodos(): Promise<{ items: TodoItem[] }> {
  return fetch('/api/todos').then(json<{ items: TodoItem[] }>)
}

export function createTodo(input: {
  text: string
  type?: TodoType
  due?: string | null
  time?: string | null
  projects?: string[]
}): Promise<{ item: TodoItem }> {
  return fetch('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then(json<{ item: TodoItem }>)
}

export function updateTodo(
  id: string,
  change: {
    text?: string
    type?: TodoType
    status?: TodoStatus
    done?: boolean
    due?: string | null
    time?: string | null
    projects?: string[]
  },
): Promise<{ item: TodoItem }> {
  return fetch(`/api/todos/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(change),
  }).then(json<{ item: TodoItem }>)
}

export function deleteTodo(id: string): Promise<{ ok: true }> {
  return fetch(`/api/todos/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(json<{ ok: true }>)
}

/** archives/ 불변 규칙은 docs 프로젝트 전용 — 다른 프로젝트의 같은 이름 폴더에는 적용하지 않는다 */
export function isArchivedPath(path: string, project: string = currentProject): boolean {
  return project === 'docs' && (path === 'archives' || path.startsWith('archives/'))
}

export interface CommitResult {
  message: string
  files: string[]
  hash: string | null
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    if (res.status === 401) {
      // 세션 만료 — App이 이 이벤트를 받아 로그인 화면으로 전환한다
      window.dispatchEvent(new Event('mew:auth-expired'))
    }
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function fetchTaskList(workspace: string, email: string): Promise<import('../../shared/task-list').TaskBoard> {
  return json(await fetch(`/api/task-list?workspace=${encodeURIComponent(workspace)}`, { headers: { 'X-Mew-Task-Owner': encodeURIComponent(email) } }))
}
export async function patchTaskList(workspace: string, changes: import('../../shared/task-list').TaskChange[], email: string): Promise<import('../../shared/task-list').TaskBoard> {
  return json(await fetch('/api/task-list', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Mew-Task-Owner': encodeURIComponent(email) }, body: JSON.stringify({ workspace, changes }) }))
}

export type Role = 'owner' | 'manager' | 'member' | 'guest'

export interface AuthStatus {
  authenticated: boolean
  email: string | null
  role: Role
  mustChangePassword: boolean
  displayName: string | null
  avatarDataUrl: string | null
  capabilities?: Capabilities
  accessRevision?: string
}

export function fetchAuthStatus(): Promise<AuthStatus> {
  return fetch('/api/auth/me').then(json<AuthStatus>)
}

export function login(
  email: string,
  password: string,
): Promise<{ ok: true; email: string; role: Role; mustChangePassword: boolean }> {
  return fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then(json<{ ok: true; email: string; role: Role; mustChangePassword: boolean }>)
}

export function logout(): Promise<{ ok: true }> {
  return fetch('/api/auth/logout', { method: 'POST' }).then(json<{ ok: true }>)
}

export function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: true }> {
  return fetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  }).then(json<{ ok: true }>)
}

export interface MemberProfile {
  email: string
  displayName: string
  avatarDataUrl: string | null
}

export function updateProfile(displayName: string, avatarDataUrl: string | null): Promise<{ ok: true; profile: MemberProfile }> {
  return fetch('/api/auth/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName, avatarDataUrl }),
  }).then(json<{ ok: true; profile: MemberProfile }>)
}

/** 프로젝트 루트 또는 지정한 폴더의 직접 자식만 읽는다. */
export function fetchTree(project?: string, path = ''): Promise<TreeNode[]> {
  return fetch(`/api/tree?${projectQs(project)}&path=${encodeURIComponent(path)}`).then(json<TreeNode[]>)
}

export type TreeResponseV1 = { version: number; state: 'ready' | 'building' | 'stale'; entries: TreeNode[] }

export function fetchTreeV1(project?: string, path = ''): Promise<TreeResponseV1> {
  return fetch(`/api/tree?${projectQs(project)}&path=${encodeURIComponent(path)}&v=1`).then(json<TreeResponseV1>)
}

/** Ctrl+P처럼 전체 후보가 필요한 자리만 쓰는 완전 트리. 평상시 탐색기는 한 단계 지연 로드를 쓴다. */
export function fetchFullTree(project?: string, signal?: AbortSignal): Promise<TreeNode[]> {
  return fetch(`/api/tree?${projectQs(project)}`, { signal }).then(json<TreeNode[]>)
}

// 탭 상태를 다루는 호출(읽기·저장·규칙)은 프로젝트를 명시적으로 받는다 — 자동저장 디바운스처럼
// 프로젝트 전환보다 오래 사는 작업이 엉뚱한 프로젝트에 쓰지 않도록.
export function fetchFile(path: string, project?: string): Promise<{ path: string; content: string; editable: boolean }> {
  return fetch(`/api/file?path=${encodeURIComponent(path)}&${projectQs(project)}`).then(
    json<{ path: string; content: string; editable: boolean }>,
  )
}

export type FileVersion = { size: number; mtimeMs: number }
export type FileAnchorPreview = {
  path: string
  content: string
  editable: boolean
  partial: true
  anchorLine: number
  lineStart: number
  lineEnd: number
  /** 첫 preview는 끝까지 스캔하지 않으므로 null; 전체 본문 전환 뒤 CodeMirror가 정확한 줄 수를 안다. */
  totalLines: number | null
  version: FileVersion
}
export type FileAnchorPreviewResponse = FileAnchorPreview | { path: string; content: string; editable: boolean; partial: false; version: FileVersion }

/** 목표 줄이 있는 큰 plain 파일의 첫 조각. 작은 파일은 호환되는 전체 본문 응답을 돌려준다. */
export function fetchFileAnchorPreview(path: string, anchorLine: number, project?: string): Promise<FileAnchorPreviewResponse> {
  const qs = `path=${encodeURIComponent(path)}&anchorLine=${anchorLine}&chunkLines=400&${projectQs(project)}`
  return fetch(`/api/file?${qs}`).then(json<FileAnchorPreviewResponse>)
}

export interface SearchMatch {
  line: number
  column: number
  text: string
  matchStart: number
  matchEnd: number
  lineEnd?: number
  title?: string
  heading?: string
  tier?: 'current' | 'history'
  score?: number
  reveal?: string
}
export interface SearchFileResult {
  path: string
  matches: SearchMatch[]
  /** 통합 검색에서는 이 파일이 속한 Documents·루트·하위 프로젝트를 함께 돌려준다. */
  project?: { id: string; label: string; kind: 'docs' | 'root' | 'subproject' }
}
export interface SearchOptions {
  regex: boolean
  caseSensitive: boolean
  scopes?: string[]
}

export interface FileNameSearchResult {
  path: string
  project: string
  scope: { id: string; label: string; icon: string }
}

export interface FileNameSearchResponse {
  version: number
  state: 'ready' | 'building' | 'stale'
  results: FileNameSearchResult[]
}

export function searchFileNames(query: string, opts: SearchOptions, signal?: AbortSignal): Promise<FileNameSearchResponse> {
  const params = new URLSearchParams({ q: query, regex: opts.regex ? '1' : '0', case: opts.caseSensitive ? '1' : '0' })
  if (opts.scopes?.length) params.set('scopes', opts.scopes.join(','))
  return fetch(`/api/search/files?${params.toString()}`, { signal }).then(json<FileNameSearchResponse>)
}

/** 프로젝트 전체 파일 내용 검색(Ctrl+Shift+F) */
export function searchProject(query: string, opts: SearchOptions, project: string = currentProject): Promise<{ results: SearchFileResult[]; truncated: boolean }> {
  const params = new URLSearchParams({
    q: query,
    project,
    regex: opts.regex ? '1' : '0',
    case: opts.caseSensitive ? '1' : '0',
  })
  if (opts.scopes?.length) params.set('scopes', opts.scopes.join(','))
  return fetch(`/api/search?${params.toString()}`).then(json<{ results: SearchFileResult[]; truncated: boolean }>)
}

/** 서버가 찾은 파일을 SSE로 즉시 보낸다. 완료 전에도 onResult가 여러 번 호출된다. */
export async function searchProjectStream(
  query: string,
  opts: SearchOptions,
  project: string,
  onResult: (result: SearchFileResult) => void,
  signal?: AbortSignal,
): Promise<{ truncated: boolean; state: 'ready' | 'building' | 'stale' | 'disabled'; version: number; scannedDirtyFiles: number }> {
  const params = new URLSearchParams({ q: query, project, regex: opts.regex ? '1' : '0', case: opts.caseSensitive ? '1' : '0' })
  if (opts.scopes?.length) params.set('scopes', opts.scopes.join(','))
  const response = await fetch(`/api/search/stream?${params}`, { signal })
  if (!response.ok || !response.body) throw new Error(uiText("검색 스트림을 열 수 없습니다"))
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let truncated = false
  let state: 'ready' | 'building' | 'stale' | 'disabled' = 'ready'
  let version = 0
  let scannedDirtyFiles = 0
  while (true) {
    const { value, done } = await reader.read()
    pending += decoder.decode(value, { stream: !done })
    const events = pending.split('\n\n')
    pending = events.pop() ?? ''
    for (const event of events) {
      const name = event.match(/^event: (.+)$/m)?.[1]
      const data = event.match(/^data: (.+)$/m)?.[1]
      if (!name || !data) continue
      const payload = JSON.parse(data) as SearchFileResult | { truncated: boolean; state?: typeof state; version?: number; scannedDirtyFiles?: number } | { error: string }
      if (name === 'result') onResult(payload as SearchFileResult)
      else if (name === 'done') {
        const donePayload = payload as { truncated: boolean; state?: typeof state; version?: number; scannedDirtyFiles?: number }
        truncated = donePayload.truncated
        state = donePayload.state ?? 'ready'
        version = donePayload.version ?? 0
        scannedDirtyFiles = donePayload.scannedDirtyFiles ?? 0
      }
      else if (name === 'error') throw new Error((payload as { error: string }).error)
    }
    if (done) break
  }
  return { truncated, state, version, scannedDirtyFiles }
}

/** 한 파일 안의 모든 매치를 치환하고 커밋한다 — 전역 "모두 바꾸기"는 파일마다 호출한다 */
export function replaceInProjectFile(
  path: string,
  query: string,
  replace: string,
  opts: SearchOptions,
  project: string = currentProject,
): Promise<{ ok: true; count: number; commit: CommitResult | null }> {
  return fetch('/api/search/replace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, query, replace, regex: opts.regex, caseSensitive: opts.caseSensitive, project }),
  }).then(json<{ ok: true; count: number; commit: CommitResult | null }>)
}

export interface AdminUser {
  email: string
  role: Role
  mustChangePassword: boolean
  createdAt: number
}

export function fetchUsers(): Promise<AdminUser[]> {
  return fetch('/api/admin/users').then(json<AdminUser[]>)
}

export interface AccessPathSettings {
  workspace: string
  project: string
  path: string
  directory: boolean
  entries: TreeNode[]
  permissions: { subject: string; explicit: FileRule | null; effective: { view: boolean; edit: boolean } }[]
}
export function fetchAccessSettings(): Promise<AccessSettings> { return fetch('/api/admin/access').then(json<AccessSettings>) }
export function saveFeatureAccess(subject: string, feature: Feature, enabled: boolean | null): Promise<AccessSettings> {
  return fetch('/api/admin/access/feature', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject, feature, enabled }) }).then(json<AccessSettings>)
}
export function fetchAccessPath(project: string, path: string): Promise<AccessPathSettings> {
  return fetch(`/api/admin/access/path?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`).then(json<AccessPathSettings>)
}
export function saveFileAccess(subject: string, project: string, path: string, access: string, workspace: string): Promise<{ ok: true }> {
  return fetch('/api/admin/access/path', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject, project, path, access, workspace }) }).then(json<{ ok: true }>)
}

export function addUser(email: string, role: Role): Promise<{ ok: true; email: string; tempPassword: string }> {
  return fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  }).then(json<{ ok: true; email: string; tempPassword: string }>)
}

export function setUserRole(email: string, role: Role): Promise<{ ok: true }> {
  return fetch(`/api/admin/users/${encodeURIComponent(email)}/role`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  }).then(json<{ ok: true }>)
}

export interface FileHistoryEntry {
  hash: string
  date: string
  message: string
}

export function fetchFileHistory(path: string, project: string = currentProject): Promise<{ history: FileHistoryEntry[] }> {
  return fetch(`/api/file-history?path=${encodeURIComponent(path)}&${projectQs(project)}`).then(
    json<{ history: FileHistoryEntry[] }>,
  )
}

export function fetchFileAtCommit(path: string, hash: string, project: string = currentProject): Promise<{ content: string | null }> {
  return fetch(`/api/file-at-commit?path=${encodeURIComponent(path)}&hash=${encodeURIComponent(hash)}&${projectQs(project)}`).then(
    json<{ content: string | null }>,
  )
}

export function revertFileToCommit(
  path: string,
  hash: string,
  project: string = currentProject,
): Promise<{ ok: true; content: string; commit: CommitResult | null }> {
  return gitFetch('/api/file-revert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, hash, project }),
  }, project).then(json<{ ok: true; content: string; commit: CommitResult | null }>)
}

export function saveFile(
  path: string,
  content: string,
  commit = false,
  project: string = currentProject,
): Promise<{ ok: true; commit: CommitResult | null }> {
  return gitFetch('/api/file', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content, commit, project }),
  }, project).then(json<{ ok: true; commit: CommitResult | null }>)
}

export function deleteFile(path: string, project: string = currentProject): Promise<{ ok: true; commit: CommitResult | null }> {
  return fetch(`/api/file?path=${encodeURIComponent(path)}&${projectQs(project)}`, { method: 'DELETE' }).then(
    json<{ ok: true; commit: CommitResult | null }>,
  )
}

/**
 * 파일·폴더를 만들거나 옮긴 결과. `hidden`은 **작업은 성공했지만 내 사이드바에는 안 뜬다**는 뜻이다
 * (숨김 목록·확장자 필터. owner·manager는 필터가 없어 언제나 false) — 호출부가 조용한 실패로
 * 보이지 않게 안내를 띄운다. 규칙은 서버가 판정한다(server/tree.ts의 isPathVisible).
 */
export interface FileOpResult {
  ok: true
  relPath: string
  commit?: CommitResult | null
  hidden?: boolean
}

export function renamePath(oldPath: string, newPath: string, project: string = currentProject): Promise<FileOpResult> {
  return fetch('/api/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPath, newPath, project }),
  }).then(json<FileOpResult>)
}

export function createFolder(relPath: string, project: string = currentProject): Promise<FileOpResult> {
  return fetch('/api/new-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relPath, project }),
  }).then(json<FileOpResult>)
}

export interface LintDiagnostic {
  from: number
  to: number
  severity: 'error' | 'warning' | 'info'
  message: string
  code: string | null
}

/** 편집 중인 버퍼를 서버 oxlint로 검사한다 — 저장 여부와 무관 (뷰어 모드에서는 403) */
export function lintFile(path: string, content: string, project: string = currentProject): Promise<{ diagnostics: LintDiagnostic[] }> {
  return fetch('/api/lint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content, project }),
  }).then(json<{ diagnostics: LintDiagnostic[] }>)
}

export function copyFile(path: string, project: string = currentProject): Promise<FileOpResult> {
  return fetch('/api/copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, project }),
  }).then(json<FileOpResult>)
}

/** 파일·폴더를 다른 폴더(destDir, ''=루트) 안으로 복사한다 — 붙여넣기(Ctrl+V, copy 모드) */
export function copyInto(
  srcPath: string,
  destDir: string,
  project: string = currentProject,
  sourceWorkspacePath: string | null = null,
): Promise<FileOpResult> {
  return fetch('/api/copy-into', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ srcPath, destDir, project, ...(sourceWorkspacePath ? { sourceWorkspacePath } : {}) }),
  }).then(json<FileOpResult>)
}

/**
 * 바깥에서 사이드바로 끌어다 놓은 파일을 프로젝트의 destDir(''=루트) 안에 그대로 저장한다.
 * uploadAsset(.mew/assets 링크)과 달리 바이트를 손대지 않는다 — 사용자가 놓은 그 파일이 그 자리에 생겨야 한다.
 */
export function uploadInto(file: File, destDir: string, project: string = currentProject): Promise<FileOpResult> {
  const body = new FormData()
  body.append('file', file)
  body.append('destDir', destDir)
  body.append('project', project)
  return fetch('/api/upload-into', { method: 'POST', body }).then(json<FileOpResult>)
}

export function downloadUrl(path: string, project: string = currentProject): string {
  return `/api/download?path=${encodeURIComponent(path)}&${projectQs(project)}`
}

/** 미디어 파일(이미지·오디오·비디오·PDF)을 인라인으로 스트리밍하는 URL */
export function rawUrl(path: string, project: string = currentProject): string {
  return `/api/raw?path=${encodeURIComponent(path)}&${projectQs(project)}`
}

export interface DocRules {
  archived: boolean
  mocApplicable: boolean
  mocRegistered: boolean
  brokenLinks: string[]
}

export function fetchRules(path: string, project?: string): Promise<DocRules> {
  return fetch(`/api/rules?path=${encodeURIComponent(path)}&${projectQs(project)}`).then(json<DocRules>)
}

export function createNewDocument(relPath: string, title: string, project: string = currentProject): Promise<FileOpResult> {
  return fetch('/api/new-document', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relPath, title, project }),
  }).then(json<FileOpResult>)
}

/** 외부 링크 미리보기 — 서버가 대신 fetch해서 제목·설명을 뽑아준다 (뷰어 모드에선 403) */
/** 표 열 너비 — 본문 md에 담을 수 없어 프로젝트의 .mew/table-layout.json에 따로 저장된다 */
export function fetchTableLayout(path: string, project: string = currentProject): Promise<TableWidths> {
  return fetch(`/api/table-layout?path=${encodeURIComponent(path)}&${projectQs(project)}`)
    .then(json<{ tables: TableWidths }>)
    .then((r) => r.tables)
}

export function saveTableLayout(path: string, tables: TableWidths, project: string = currentProject): Promise<void> {
  return fetch('/api/table-layout', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, tables, project }),
  })
    .then(json<{ ok: true }>)
    .then(() => undefined)
}

// ---- 협업: 멤버 채팅 · 파일 댓글 ----
// 실시간 갱신은 presence 신호({type:'chat'}·{type:'comments'})를 받아 이 함수들로 다시 읽는 방식이다.

/** 단체방의 대화 키 — 서버의 GROUP과 같은 값이다(DM은 상대 이메일이 곧 키다) */
export const GROUP_CHAT = 'group'

export interface ChatMessage {
  id: string
  author: string
  /** 수신자 — 없으면 단체방, 있으면 보낸 사람과 이 사람들만 보는 DM */
  to?: string[]
  time: number
  /** 본문 — `[[프로젝트:상대경로]]` 파일 멘션 토큰을 담을 수 있다(그리는 쪽이 칩으로 바꾼다) */
  text: string
  /** 아직 이 메시지를 안 읽은 수신자 수. 0이면 숫자를 감춘다 */
  unread: number
}

/** 내가 볼 수 있는 메시지 전부(단체 + 내 DM)와 대화별 안 읽은 수 */
export interface ChatView {
  messages: ChatMessage[]
  unread: Record<string, number>
  /**
   * 서버가 DM을 아는가. 화면만 새로 받고 서버가 아직 옛 버전이면(빌드 후 재시작 전) `to`를 무시해
   * **DM이 단체방으로 나간다** — 그동안은 DM 자체를 잠근다. 옛 응답에는 unread 키가 없다.
   */
  dmSupported: boolean
}

export function fetchChat(): Promise<ChatView> {
  return fetch('/api/chat')
    .then(json<Partial<ChatView>>)
    .then((r) => ({ messages: r.messages ?? [], unread: r.unread ?? {}, dmSupported: r.unread !== undefined }))
}

/** to를 주면 그 사람들에게만 가는 DM이다 */
export function postChat(text: string, to?: string[]): Promise<ChatMessage> {
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(to && to.length > 0 ? { text, to } : { text }),
  })
    .then(json<{ ok: true; message: ChatMessage }>)
    .then((r) => r.message)
}

/** 이 대화를 여기까지 읽었다고 서버에 알린다 — 보낸 쪽 화면의 숫자가 줄어든다 */
export function markChatRead(conversation: string): Promise<void> {
  return fetch('/api/chat/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation }),
  })
    .then(json<{ ok: true }>)
    .then(() => undefined)
}

/** 멘션 자동완성용 계정 이메일 목록 — 로그인 사용자 전용 */
export function fetchMembers(): Promise<string[]> {
  return fetch('/api/members')
    .then(json<{ members: string[] }>)
    .then((r) => r.members)
}

export function fetchMemberProfiles(): Promise<MemberProfile[]> {
  return fetch('/api/member-profiles')
    .then(json<{ members: MemberProfile[] }>)
    .then((r) => r.members)
}

export interface CommentEntry {
  id: string
  author: string
  time: number
  text: string
  edited?: number
}

export interface CommentThread {
  id: string
  anchor: import('@mew/editor').CommentAnchor
  comments: CommentEntry[]
}

export function fetchComments(path: string, project: string = currentProject): Promise<CommentThread[]> {
  return fetch(`/api/comments?path=${encodeURIComponent(path)}&${projectQs(project)}`)
    .then(json<{ threads: CommentThread[] }>)
    .then((r) => r.threads)
}

/** threadId가 있으면 그 스레드에 답글, 없으면 anchor로 새 스레드를 만든다 */
export function postComment(
  path: string,
  body: { threadId?: string; anchor?: import('@mew/editor').CommentAnchor; text: string },
  project: string = currentProject,
): Promise<CommentThread> {
  return fetch('/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, project, ...body }),
  })
    .then(json<{ ok: true; thread: CommentThread }>)
    .then((r) => r.thread)
}

export function updateComment(
  path: string,
  threadId: string,
  commentId: string,
  text: string,
  project: string = currentProject,
): Promise<CommentThread> {
  return fetch('/api/comments', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, project, threadId, commentId, text }),
  })
    .then(json<{ ok: true; thread: CommentThread }>)
    .then((r) => r.thread)
}

/** 마지막 댓글을 지우면 스레드도 사라진다 — 그때 thread는 null */
export function deleteComment(
  path: string,
  threadId: string,
  commentId: string,
  project: string = currentProject,
): Promise<CommentThread | null> {
  const qs = `path=${encodeURIComponent(path)}&threadId=${encodeURIComponent(threadId)}&commentId=${encodeURIComponent(commentId)}&${projectQs(project)}`
  return fetch(`/api/comments?${qs}`, { method: 'DELETE' })
    .then(json<{ ok: true; thread: CommentThread | null }>)
    .then((r) => r.thread)
}

export function fetchLinkPreview(url: string): Promise<{ title: string | null; description: string | null }> {
  return fetch(`/api/link-preview?url=${encodeURIComponent(url)}`).then(
    json<{ title: string | null; description: string | null }>,
  )
}

export async function uploadAsset(file: File, project: string = currentProject): Promise<{ url: string; name: string; mimetype: string }> {
  // 큰 사진은 여기서 한 번 줄여 올린다 — 서버는 받은 바이트를 그대로 보관하므로 줄일 수 있는
  // 유일한 자리다. 대상이 아니거나 실패하면 원본이 그대로 넘어온다(compressImage는 던지지 않는다).
  const body = new FormData()
  body.append('file', await compressImage(file))
  body.append('project', project)
  return fetch('/api/upload', { method: 'POST', body })
    .then(json<{ path: string; name: string; mimetype: string }>)
    .then(({ path, name, mimetype }) => ({
      url: `/api/asset?path=${encodeURIComponent(path)}&${projectQs(project)}`,
      name,
      mimetype,
    }))
}

export function fetchTmuxSessions(): Promise<TmuxSession[]> {
  // 명령어 버튼이 띄운 세션(mewcmd-*)은 터미널 탭 목록에서 감춘다 — 팝업으로만 본다
  return fetch('/api/tmux/sessions')
    .then(json<TmuxSession[]>)
    .then((sessions) => sessions.filter((s) => !isHiddenTmuxSession(s.name)))
}

// ---- 호스트 자원 현황(프로파일링 팝업) ----

export interface GpuStat {
  name: string
  utilization: number | null
  memoryUsedMb: number | null
  memoryTotalMb: number | null
  temperature: number | null
}

export interface ProcStat {
  pid: number
  name: string
  cmd: string
  /** % — 코어 하나 기준이라 100을 넘을 수 있다 */
  cpu: number
  memMb: number
  gpuMemMb: number
}

export interface SystemStats {
  cpu: { model: string; cores: number; usage: number | null; loadavg: number[]; temperature: number | null }
  memory: { total: number; used: number; available: number }
  gpus: GpuStat[]
  processes: ProcStat[]
  uptime: number
  hostname: string
}

export function fetchSystemStats(signal?: AbortSignal): Promise<SystemStats> {
  return fetch('/api/system-stats', { signal }).then(json<SystemStats>)
}

// ---- 예약 에이전트 작업 (crontab 생성원) ----

export interface AgentJob {
  id: string
  name: string
  cron: string
  project: string
  agent: string
  agentSet?: AgentSet
  agentSetId?: string
  prompt: string
  enabled: boolean
}

export interface AgentJobView extends AgentJob {
  command: string
  lastRun: string | null
  /** 이 잡 전용 tmux 세션 이름(mewcmd-job-*) — 터미널 창으로 열어 본다 */
  session: string
  /** 그 세션이 지금 떠 있는지 */
  running: boolean
}

export interface SchedulesResponse {
  jobs: AgentJobView[]
  agentSets: AgentSet[]
  runtimes: { id: string; label: string }[]
  /** mew가 만들지 않은 크론 줄 — 읽기 전용 */
  otherLines: string[]
}

export function fetchSchedules(): Promise<SchedulesResponse> {
  return fetch('/api/schedules').then(json<SchedulesResponse>)
}

export function saveSchedules(jobs: AgentJob[]): Promise<SchedulesResponse> {
  return fetch('/api/schedules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs }),
  }).then(json<SchedulesResponse>)
}

/** 예약을 기다리지 않고 지금 한 번 돌린다 — 크론이 도는 것과 같은 세션·같은 명령이다 */
export function runSchedule(id: string): Promise<{ ok: true; session: string }> {
  return fetch('/api/schedules/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  }).then(json<{ ok: true; session: string }>)
}

// ---- 명령어 버튼 (.mew/cmd-button.json) ----

export interface CmdButtonState {
  name: string
  command: string
  /** true면 명령이 끝나자마자 이 세션을 스스로 닫는다(배포·빌드 등) */
  oneShot: boolean
  /** 이 버튼 전용 tmux 세션 이름(mewcmd-*) */
  session: string
  /** 그 세션이 지금 떠 있는지 */
  running: boolean
}

/** 저장 대상 — 실행 상태(session·running)는 서버가 계산해 붙여주는 값이라 보내지 않는다 */
export interface CmdButton {
  name: string
  command: string
  oneShot?: boolean
}

// 프로젝트 탭마다 자기 메뉴를 띄우므로(활성 프로젝트 것만 보는 게 아니다) 프로젝트를 명시적으로 받는다
export function fetchCmdButtons(project: string, path = ''): Promise<{ buttons: CmdButtonState[] }> {
  return fetch(`/api/cmd-buttons?${projectQs(project)}&path=${encodeURIComponent(path)}`).then(json<{ buttons: CmdButtonState[] }>)
}

export function runCmdButton(project: string, name: string, path = ''): Promise<{ ok: true; session: string }> {
  return fetch('/api/cmd-buttons/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, project, path }),
  }).then(json<{ ok: true; session: string }>)
}

/** 목록 전체를 통째로 저장한다 — 추가·수정·삭제 모두 이 한 경로를 쓴다 (term-buttons와 같은 방식) */
export function saveCmdButtons(project: string, buttons: CmdButton[], path = ''): Promise<{ buttons: CmdButtonState[] }> {
  return fetch('/api/cmd-buttons', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, buttons, path }),
  }).then(json<{ buttons: CmdButtonState[] }>)
}

// ---- 터미널 명령어 버튼 (.data/term-button.json — 전역, 모든 프로젝트·탭 공통) ----

export interface TermButton {
  name: string
  command: string
  /** 프로젝트 아이콘과 같은 표기(`i:{키}` · 이모지 · `svg:{마크업}`). 없으면 이름만 표시한다 */
  icon?: string
  /** 켜면 줄에서 이름을 감추고 아이콘만 그린다 — 아이콘이 있을 때만 의미가 있다 */
  iconOnly?: boolean
}

export function fetchTermButtons(): Promise<{ buttons: TermButton[] }> {
  return fetch('/api/term-buttons').then(json<{ buttons: TermButton[] }>)
}

/** 목록 전체를 통째로 저장한다 — 추가·수정·삭제 모두 이 한 경로를 쓴다 */
export function saveTermButtons(buttons: TermButton[]): Promise<{ buttons: TermButton[] }> {
  return fetch('/api/term-buttons', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buttons }),
  }).then(json<{ buttons: TermButton[] }>)
}

// ---- 숨김 목록 (.data/ignore.json — 전역, 모든 프로젝트 공통) ----

export interface IgnoreListState {
  /** 지금 숨기고 있는 폴더·파일 **이름**들 — 경로가 아니라 이름이라 어느 깊이에 있든 숨는다 */
  names: string[]
  /** 저장된 게 없을 때 쓰는 기본 목록 — "기본값으로" 버튼이 되돌리는 값 */
  defaults: string[]
  /** 목록에서 빼도 서버가 계속 막는 이름들(.git·node_modules·.data) — UI는 고정으로 보여준다 */
  locked: string[]
}

export function fetchIgnoreList(): Promise<IgnoreListState> {
  return fetch('/api/ignore').then(json<IgnoreListState>)
}

/** 목록 전체를 통째로 저장한다 — 저장 즉시 모든 세션의 트리가 다시 그려진다 */
export function saveIgnoreList(names: string[]): Promise<IgnoreListState> {
  return fetch('/api/ignore', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names }),
  }).then(json<IgnoreListState>)
}

export function createTmuxSession(name: string): Promise<{ ok: true; name: string }> {
  return fetch('/api/tmux/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then(json<{ ok: true; name: string }>)
}

export function killTmuxSession(name: string): Promise<{ ok: true }> {
  return fetch(`/api/tmux/sessions/${encodeURIComponent(name)}`, { method: 'DELETE' }).then(json<{ ok: true }>)
}

export function renameTmuxSession(name: string, newName: string): Promise<{ ok: true; name: string }> {
  return fetch(`/api/tmux/sessions/${encodeURIComponent(name)}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newName }),
  }).then(json<{ ok: true; name: string }>)
}

// ---- /db 데이터베이스 뷰 ----
// 모든 요청은 활성 프로젝트로 스코프된다(프로젝트 격리). 변경은 서버에서 requireAuthenticated.

const DB_BASE = '/api/db'

function dbList(project: string = currentProject): Promise<DbSummary[]> {
  return fetch(`${DB_BASE}?${projectQs(project)}`).then(json<DbSummary[]>)
}

function dbCreate(title: string, project: string = currentProject): Promise<DbView> {
  return fetch(DB_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, project }),
  }).then(json<DbView>)
}

function dbAttachExternal(schema: string, table: string, title?: string, project: string = currentProject): Promise<DbView> {
  return fetch(`${DB_BASE}/attach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema, table, title, project }),
  }).then(json<DbView>)
}

function dbGetView(id: string, project: string = currentProject): Promise<DbView> {
  return fetch(`${DB_BASE}/${encodeURIComponent(id)}?${projectQs(project)}`).then(json<DbView>)
}

function dbRemove(id: string, project: string = currentProject): Promise<void> {
  return fetch(`${DB_BASE}/${encodeURIComponent(id)}?${projectQs(project)}`, { method: 'DELETE' }).then(json<{ ok: true }>).then(() => {})
}

function dbRename(id: string, title: string, project: string = currentProject): Promise<void> {
  return fetch(`${DB_BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, project }),
  })
    .then(json<DbSummary>)
    .then(() => {})
}

function dbInsertRow(id: string, project: string = currentProject): Promise<DbRow> {
  return fetch(`${DB_BASE}/${encodeURIComponent(id)}/rows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project }),
  }).then(json<DbRow>)
}

function dbUpdateCell(id: string, rowId: string, columnId: string, value: unknown, project: string = currentProject): Promise<unknown> {
  return fetch(`${DB_BASE}/${encodeURIComponent(id)}/rows/${encodeURIComponent(rowId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, value, project }),
  })
    .then(json<{ value: unknown }>)
    .then((r) => r.value)
}

function dbDeleteRow(id: string, rowId: string, project: string = currentProject): Promise<void> {
  return fetch(`${DB_BASE}/${encodeURIComponent(id)}/rows/${encodeURIComponent(rowId)}?${projectQs(project)}`, {
    method: 'DELETE',
  })
    .then(json<{ ok: true }>)
    .then(() => {})
}

function dbAddColumn(id: string, name: string, type: DbColumnType, project: string = currentProject): Promise<DbColumn> {
  return fetch(`${DB_BASE}/${encodeURIComponent(id)}/columns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type, project }),
  }).then(json<DbColumn>)
}

function dbRenameColumn(id: string, columnId: string, name: string, project: string = currentProject): Promise<DbColumn> {
  return fetch(`${DB_BASE}/${encodeURIComponent(id)}/columns/${encodeURIComponent(columnId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, project }),
  }).then(json<DbColumn>)
}

function dbDeleteColumn(id: string, columnId: string, project: string = currentProject): Promise<void> {
  return fetch(`${DB_BASE}/${encodeURIComponent(id)}/columns/${encodeURIComponent(columnId)}?${projectQs(project)}`, {
    method: 'DELETE',
  })
    .then(json<{ ok: true }>)
    .then(() => {})
}

function createDbApi(project?: string): EditorDbApi {
  return {
    list: () => dbList(project),
    create: title => dbCreate(title, project),
    attachExternal: (schema, table, title) => dbAttachExternal(schema, table, title, project),
    getView: id => dbGetView(id, project),
    remove: id => dbRemove(id, project),
    rename: (id, title) => dbRename(id, title, project),
    insertRow: id => dbInsertRow(id, project),
    updateCell: (id, rowId, columnId, value) => dbUpdateCell(id, rowId, columnId, value, project),
    deleteRow: (id, rowId) => dbDeleteRow(id, rowId, project),
    addColumn: (id, name, type) => dbAddColumn(id, name, type, project),
    renameColumn: (id, columnId, name) => dbRenameColumn(id, columnId, name, project),
    deleteColumn: (id, columnId) => dbDeleteColumn(id, columnId, project),
    subscribe: (id, listener) => subscribeDb(id, listener, project),
  }
}

export const dbApi = createDbApi()

// ---- 패키지 컴포넌트에 주입하는 서버 연동 객체 (모듈 상수 = 렌더 간 identity 안정) ----

export const editorApi: EditorApi = { fetchFile, uploadAsset, fetchLinkPreview, fetchTableLayout, saveTableLayout, db: dbApi }

/** Capture a pane's file scope so background callbacks cannot follow another pane's focus. */
export function createEditorApi(project: string): EditorApi {
  return {
    fetchFile: path => fetchFile(path, project),
    uploadAsset: file => uploadAsset(file, project),
    fetchLinkPreview,
    fetchTableLayout: path => fetchTableLayout(path, project),
    saveTableLayout: (path, tables) => saveTableLayout(path, tables, project),
    frontmatterOptions: {
      fetch: field => fetch(`/api/frontmatter-options?field=${encodeURIComponent(field)}&${projectQs(project)}`)
        .then(json<{ options: string[] | null }>).then(result => result.options),
      update: (field, change) => fetch('/api/frontmatter-options', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, field, ...change }),
      }).then(json<{ options: string[] }>).then(result => result.options),
    },
    db: createDbApi(project),
  }
}

export const tmuxApi: TmuxPanelApi = {
  fetchSessions: fetchTmuxSessions,
  createSession: createTmuxSession,
  killSession: killTmuxSession,
  renameSession: renameTmuxSession,
}

export function fetchUpdatesStatus(refresh = false): Promise<UpdatesStatus> {
  return fetch(`/api/updates/status${refresh ? '?refresh=1' : ''}`).then(json<UpdatesStatus>)
}
export function runUpdates(ids: string[]): Promise<UpdatesStatus> {
  return fetch('/api/updates/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }).then(json<UpdatesStatus>)
}

export function fetchDocumentGraph(signal?: AbortSignal): Promise<import('../../shared/document-graph').DocumentGraphData> {
  return fetch('/api/docs/graph', { signal }).then(json<import('../../shared/document-graph').DocumentGraphData>)
}

export function mutateDocumentPage(action: 'create' | 'rename' | 'delete' | 'move' | 'copy', path: string, name = '', destination = ''): Promise<import('../../shared/document-pages').DocumentPageMutation> {
  return fetch(`/api/docs/pages/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, name, destination }) }).then(json<import('../../shared/document-pages').DocumentPageMutation>)
}
