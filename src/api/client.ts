import type { EditorApi, EditorDbApi, DbColumn, DbColumnType, DbRow, DbSummary, DbView, TableWidths } from '@mew/editor'
import type { TmuxPanelApi, TmuxSession } from '@mew/tmux-term'
import { isCommandSession } from '@mew/tmux-term'
import { subscribeDb } from './dbSocket'
import { compressImage } from '../utils/compressImage'

export type { TreeNode } from '@mew/editor'
export type { TmuxSession } from '@mew/tmux-term'
import type { TreeNode } from '@mew/editor'

const PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const PROJECT_KEY = 'mew:project'

// 프로젝트 전환은 **페이지 이동이 아니다** — 앱 안에서 활성 프로젝트만 바뀐다(프로젝트 탭).
// 그래서 이 값은 상수가 아니라 런타임 상태이고, 요청을 보내는 순간에 읽어야 한다.
// 옛 `/{프로젝트}` 주소로 들어와도 그 프로젝트로 시작한다 — 밖에 나가 있는 링크를 살려두기 위해서다.
function detectProject(): string {
  const seg = decodeURIComponent(location.pathname.split('/')[1] ?? '')
  if (PROJECT_NAME_RE.test(seg)) return seg
  const saved = localStorage.getItem(PROJECT_KEY)
  return saved && PROJECT_NAME_RE.test(saved) ? saved : 'docs'
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

export function fetchProjects(): Promise<ProjectInfo[]> {
  return fetch('/api/projects').then(json<ProjectInfo[]>)
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

export type Role = 'owner' | 'manager' | 'member' | 'guest'

export interface AuthStatus {
  authenticated: boolean
  email: string | null
  role: Role
  mustChangePassword: boolean
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

export function fetchTree(): Promise<TreeNode[]> {
  return fetch(`/api/tree?${projectQs()}`).then(json<TreeNode[]>)
}

// 탭 상태를 다루는 호출(읽기·저장·규칙)은 프로젝트를 명시적으로 받는다 — 자동저장 디바운스처럼
// 프로젝트 전환보다 오래 사는 작업이 엉뚱한 프로젝트에 쓰지 않도록.
export function fetchFile(path: string, project?: string): Promise<{ path: string; content: string; editable: boolean }> {
  return fetch(`/api/file?path=${encodeURIComponent(path)}&${projectQs(project)}`).then(
    json<{ path: string; content: string; editable: boolean }>,
  )
}

export interface SearchMatch {
  line: number
  column: number
  text: string
  matchStart: number
  matchEnd: number
}
export interface SearchFileResult {
  path: string
  matches: SearchMatch[]
}
export interface SearchOptions {
  regex: boolean
  caseSensitive: boolean
}

/** 프로젝트 전체 파일 내용 검색(Ctrl+Shift+F) */
export function searchProject(query: string, opts: SearchOptions): Promise<{ results: SearchFileResult[]; truncated: boolean }> {
  const params = new URLSearchParams({
    q: query,
    project: currentProject,
    regex: opts.regex ? '1' : '0',
    case: opts.caseSensitive ? '1' : '0',
  })
  return fetch(`/api/search?${params.toString()}`).then(json<{ results: SearchFileResult[]; truncated: boolean }>)
}

/** 한 파일 안의 모든 매치를 치환하고 커밋한다 — 전역 "모두 바꾸기"는 파일마다 호출한다 */
export function replaceInProjectFile(
  path: string,
  query: string,
  replace: string,
  opts: SearchOptions,
): Promise<{ ok: true; count: number; commit: CommitResult | null }> {
  return fetch('/api/search/replace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, query, replace, regex: opts.regex, caseSensitive: opts.caseSensitive, project: currentProject }),
  }).then(json<{ ok: true; count: number; commit: CommitResult | null }>)
}

export function setGuestAccess(path: string, view: boolean, edit: boolean): Promise<{ ok: true }> {
  return fetch('/api/guest-access', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, view, edit, project: currentProject }),
  }).then(json<{ ok: true }>)
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

export function fetchFileHistory(path: string): Promise<{ history: FileHistoryEntry[] }> {
  return fetch(`/api/file-history?path=${encodeURIComponent(path)}&${projectQs()}`).then(
    json<{ history: FileHistoryEntry[] }>,
  )
}

export function fetchFileAtCommit(path: string, hash: string): Promise<{ content: string | null }> {
  return fetch(`/api/file-at-commit?path=${encodeURIComponent(path)}&hash=${encodeURIComponent(hash)}&${projectQs()}`).then(
    json<{ content: string | null }>,
  )
}

export function revertFileToCommit(
  path: string,
  hash: string,
): Promise<{ ok: true; content: string; commit: CommitResult | null }> {
  return fetch('/api/file-revert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, hash, project: currentProject }),
  }).then(json<{ ok: true; content: string; commit: CommitResult | null }>)
}

export function saveFile(
  path: string,
  content: string,
  commit = false,
  project: string = currentProject,
): Promise<{ ok: true; commit: CommitResult | null }> {
  return fetch('/api/file', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content, commit, project }),
  }).then(json<{ ok: true; commit: CommitResult | null }>)
}

export function deleteFile(path: string): Promise<{ ok: true; commit: CommitResult | null }> {
  return fetch(`/api/file?path=${encodeURIComponent(path)}&${projectQs()}`, { method: 'DELETE' }).then(
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

export function renamePath(oldPath: string, newPath: string): Promise<FileOpResult> {
  return fetch('/api/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPath, newPath, project: currentProject }),
  }).then(json<FileOpResult>)
}

export function createFolder(relPath: string): Promise<FileOpResult> {
  return fetch('/api/new-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relPath, project: currentProject }),
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
export function lintFile(path: string, content: string): Promise<{ diagnostics: LintDiagnostic[] }> {
  return fetch('/api/lint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content, project: currentProject }),
  }).then(json<{ diagnostics: LintDiagnostic[] }>)
}

export function copyFile(path: string): Promise<FileOpResult> {
  return fetch('/api/copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, project: currentProject }),
  }).then(json<FileOpResult>)
}

/** 파일·폴더를 다른 폴더(destDir, ''=루트) 안으로 복사한다 — 붙여넣기(Ctrl+V, copy 모드) */
export function copyInto(srcPath: string, destDir: string): Promise<FileOpResult> {
  return fetch('/api/copy-into', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ srcPath, destDir, project: currentProject }),
  }).then(json<FileOpResult>)
}

export function downloadUrl(path: string): string {
  return `/api/download?path=${encodeURIComponent(path)}&${projectQs()}`
}

/** 미디어 파일(이미지·오디오·비디오·PDF)을 인라인으로 스트리밍하는 URL */
export function rawUrl(path: string): string {
  return `/api/raw?path=${encodeURIComponent(path)}&${projectQs()}`
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

export function createNewDocument(relPath: string, title: string): Promise<FileOpResult> {
  return fetch('/api/new-document', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relPath, title, project: currentProject }),
  }).then(json<FileOpResult>)
}

/** 외부 링크 미리보기 — 서버가 대신 fetch해서 제목·설명을 뽑아준다 (뷰어 모드에선 403) */
/** 표 열 너비 — 본문 md에 담을 수 없어 프로젝트의 .mew/table-layout.json에 따로 저장된다 */
export function fetchTableLayout(path: string): Promise<TableWidths> {
  return fetch(`/api/table-layout?path=${encodeURIComponent(path)}&${projectQs()}`)
    .then(json<{ tables: TableWidths }>)
    .then((r) => r.tables)
}

export function saveTableLayout(path: string, tables: TableWidths): Promise<void> {
  return fetch('/api/table-layout', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, tables, project: currentProject }),
  })
    .then(json<{ ok: true }>)
    .then(() => undefined)
}

export function fetchLinkPreview(url: string): Promise<{ title: string | null; description: string | null }> {
  return fetch(`/api/link-preview?url=${encodeURIComponent(url)}`).then(
    json<{ title: string | null; description: string | null }>,
  )
}

export async function uploadAsset(file: File): Promise<{ url: string; name: string; mimetype: string }> {
  // 큰 사진은 여기서 한 번 줄여 올린다 — 서버·R2는 받은 바이트를 그대로 보관하므로 줄일 수 있는
  // 유일한 자리다. 대상이 아니거나 실패하면 원본이 그대로 넘어온다(compressImage는 던지지 않는다).
  const body = new FormData()
  body.append('file', await compressImage(file))
  return fetch('/api/upload', { method: 'POST', body }).then(json<{ url: string; name: string; mimetype: string }>)
}

export function fetchTmuxSessions(): Promise<TmuxSession[]> {
  // 명령어 버튼이 띄운 세션(mewcmd-*)은 터미널 탭 목록에서 감춘다 — 팝업으로만 본다
  return fetch('/api/tmux/sessions')
    .then(json<TmuxSession[]>)
    .then((sessions) => sessions.filter((s) => !isCommandSession(s.name)))
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

export function fetchSystemStats(): Promise<SystemStats> {
  return fetch('/api/system-stats').then(json<SystemStats>)
}

// ---- 서버 사용자의 crontab ----

export function fetchCrontab(): Promise<{ text: string }> {
  return fetch('/api/crontab').then(json<{ text: string }>)
}

export function saveCrontab(text: string): Promise<{ text: string }> {
  return fetch('/api/crontab', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).then(json<{ text: string }>)
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
export function fetchCmdButtons(project: string): Promise<{ buttons: CmdButtonState[] }> {
  return fetch(`/api/cmd-buttons?${projectQs(project)}`).then(json<{ buttons: CmdButtonState[] }>)
}

export function runCmdButton(project: string, name: string): Promise<{ ok: true; session: string }> {
  return fetch('/api/cmd-buttons/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, project }),
  }).then(json<{ ok: true; session: string }>)
}

/** 목록 전체를 통째로 저장한다 — 추가·수정·삭제 모두 이 한 경로를 쓴다 (term-buttons와 같은 방식) */
export function saveCmdButtons(project: string, buttons: CmdButton[]): Promise<{ buttons: CmdButtonState[] }> {
  return fetch('/api/cmd-buttons', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, buttons }),
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

function dbList(): Promise<DbSummary[]> {
  return fetch(`${DB_BASE}?${projectQs()}`).then(json<DbSummary[]>)
}

function dbCreate(title: string): Promise<DbView> {
  return fetch(DB_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, project: currentProject }),
  }).then(json<DbView>)
}

function dbAttachExternal(schema: string, table: string, title?: string): Promise<DbView> {
  return fetch(`${DB_BASE}/attach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema, table, title, project: currentProject }),
  }).then(json<DbView>)
}

function dbGetView(id: string): Promise<DbView> {
  return fetch(`${DB_BASE}/${encodeURIComponent(id)}?${projectQs()}`).then(json<DbView>)
}

function dbRemove(id: string): Promise<void> {
  return fetch(`${DB_BASE}/${encodeURIComponent(id)}?${projectQs()}`, { method: 'DELETE' }).then(json<{ ok: true }>).then(() => {})
}

function dbRename(id: string, title: string): Promise<void> {
  return fetch(`${DB_BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, project: currentProject }),
  })
    .then(json<DbSummary>)
    .then(() => {})
}

function dbInsertRow(id: string): Promise<DbRow> {
  return fetch(`${DB_BASE}/${encodeURIComponent(id)}/rows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: currentProject }),
  }).then(json<DbRow>)
}

function dbUpdateCell(id: string, rowId: string, columnId: string, value: unknown): Promise<unknown> {
  return fetch(`${DB_BASE}/${encodeURIComponent(id)}/rows/${encodeURIComponent(rowId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnId, value, project: currentProject }),
  })
    .then(json<{ value: unknown }>)
    .then((r) => r.value)
}

function dbDeleteRow(id: string, rowId: string): Promise<void> {
  return fetch(`${DB_BASE}/${encodeURIComponent(id)}/rows/${encodeURIComponent(rowId)}?${projectQs()}`, {
    method: 'DELETE',
  })
    .then(json<{ ok: true }>)
    .then(() => {})
}

function dbAddColumn(id: string, name: string, type: DbColumnType): Promise<DbColumn> {
  return fetch(`${DB_BASE}/${encodeURIComponent(id)}/columns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type, project: currentProject }),
  }).then(json<DbColumn>)
}

function dbRenameColumn(id: string, columnId: string, name: string): Promise<DbColumn> {
  return fetch(`${DB_BASE}/${encodeURIComponent(id)}/columns/${encodeURIComponent(columnId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, project: currentProject }),
  }).then(json<DbColumn>)
}

function dbDeleteColumn(id: string, columnId: string): Promise<void> {
  return fetch(`${DB_BASE}/${encodeURIComponent(id)}/columns/${encodeURIComponent(columnId)}?${projectQs()}`, {
    method: 'DELETE',
  })
    .then(json<{ ok: true }>)
    .then(() => {})
}

export const dbApi: EditorDbApi = {
  list: dbList,
  create: dbCreate,
  attachExternal: dbAttachExternal,
  getView: dbGetView,
  remove: dbRemove,
  rename: dbRename,
  insertRow: dbInsertRow,
  updateCell: dbUpdateCell,
  deleteRow: dbDeleteRow,
  addColumn: dbAddColumn,
  renameColumn: dbRenameColumn,
  deleteColumn: dbDeleteColumn,
  subscribe: subscribeDb,
}

// ---- 패키지 컴포넌트에 주입하는 서버 연동 객체 (모듈 상수 = 렌더 간 identity 안정) ----

export const editorApi: EditorApi = { fetchFile, uploadAsset, fetchLinkPreview, fetchTableLayout, saveTableLayout, db: dbApi }

export const tmuxApi: TmuxPanelApi = {
  fetchSessions: fetchTmuxSessions,
  createSession: createTmuxSession,
  killSession: killTmuxSession,
  renameSession: renameTmuxSession,
}
