import { discoverCloudStorage } from './cloud-storage.ts'
import express from 'express'
import { createRemoteDesktopRoutes } from './remote-desktop.ts'
import multer from 'multer'
import { GitError } from 'simple-git'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_PROJECT, isDeniedSegment, isProtectedProject, listProjects, projectRoot, resolveProjectPath, UnknownProjectError, UnsafePathError, WORKSPACE_PROJECT, WORKSPACE_ROOT } from './paths.ts'
import { createProject, deleteProject, ProjectNameError, renameProject } from './projects.ts'
import { buildTree, buildTreeAsync, isPathVisible } from './tree.ts'
import { flattenTextFiles, replaceInFile, searchInProject, searchInProjectProgressively } from './search.ts'
import {
  catalogParentOf,
  fileCatalogStatus,
  listCatalogChildren,
  listCatalogFiles,
  noteFileContentChanged,
  refreshFileCatalogParent,
  warmFileCatalog,
} from './fileCatalog.ts'
import { searchFileNames } from './fileNameSearch.ts'
import { ensureSearchIndex, exactSearchCandidates, type SearchIndexState } from './searchCatalog.ts'
import { currentRagIndex, ragEnabled, RagDisabledError, RagUnavailableError, validateRagProject } from './rag/index.ts'
import { commitFile, fileHistory, showAtCommit, showHeadContent } from './git.ts'
import { cloneExternalRepository, commitDetail, commitFileDiff, commitWorkingTree, GitWorkbenchError, initializeExternalRepository, initializeRepository, listRepositories, repositoryInfo, repositoryLog, runCommitAction, workingTreeDetail, workingTreeFileDiff } from './gitWorkbench.ts'
import { evaluateRules, isArchived } from './rules.ts'
import { registerPdfRoutes } from './pdf.ts'
import { copyFile, copyPathInto, createDocument, createFolder, renamePath, deletePath, moveFileInto, ConflictError } from './documents.ts'
import { lintContent } from './lint.ts'
import { parseTitle } from './frontmatter.ts'
import { noteAppWrite } from './appWrites.ts'
import { updateLinkLabelsFor } from './links.ts'
import { isLocalAssetPath, moveAssetIntoProject } from './localAssets.ts'
import { DATA_DIR } from './dataDir.ts'
import { createTmuxManager, createTmuxRouter } from '@mew/tmux-term/server'
import { CmdButtonError, commandSessionName, normalizeCmdButtons, oneShotCommand, readCmdButtons, writeCmdButtons } from './cmdButtons.ts'
import { normalizeTermButtons, readTermButtons, TermButtonError, writeTermButtons } from './termButtons.ts'
import { readTableLayout, TableLayoutError, writeTableLayout } from './tableLayout.ts'
import { ChatError, listChatFor, markChatRead, mentionedEmails, postChatMessage } from './chat.ts'
import { addComment, addThread, CommentsError, deleteComment, editComment, listThreads } from './comments.ts'
import { createDbRouter } from './db/routes.ts'
import { readProjectIcons, setProjectIcon } from './projectIcons.ts'
import { normalizeIconValue, SvgIconError } from './svgIcon.ts'
import { readProjectLayout, writeProjectLayout } from './projectLayout.ts'
import { DocsRepoError, exportDocs, importDocs } from './docsRepo.ts'
import {
  BrowseError,
  createExternalFolder,
  deleteExternalPath,
  listDirs,
  listEntries,
  pasteExternalPath,
  readExternalFile,
  renameExternalPath,
  resolveBrowsePath,
  resolveExistingPath,
  writeExternalFile,
} from './fsBrowse.ts'
import { browserProxyFrameUrl } from './browserProxy.ts'
import { createDomBrowserAuthSession, createDomBrowserRoutes, closeDomBrowserJob } from './browser-dom.ts'
import { createTodo, deleteTodo, listTodos, TodoError, updateTodo, type TodoChange } from './todos.ts'
import { currentWorkspace, switchDocsRoot, switchWorkspace, WorkspaceError } from './workspace.ts'
import { collectSystemStats } from './sysStats.ts'
import { MEW_APP_ROOT, MEW_UPDATE_SESSION, mewUpdateStatus, writeMewUpdateJob } from './mewUpdate.ts'
import { androidCommandById, collectAndroidEnvStatus } from './androidEnv.ts'
import { listSkills } from './skills.ts'
import { readCrontab } from './crontab.ts'
import { agentCommand, jobCwd, jobSessionName, jobViews, otherLines, readJobs, saveSchedules, ScheduleError } from './schedules.ts'
import { AgentSetError, readSets, writeSets } from './agentSets.ts'
import { acpRuntimeList, agentSetRuntimeList, isRuntime } from './agentAcp.ts'
import { isRuntimeLoginMethod, runtimeLoginSpec } from './agentRuntimes.ts'
import { terminalAuthFromHost } from './agentHost.ts'
import { authFailureMessageFromOutput, browserLoginDetailsFromOutput, prepareAgentAuthTerminal, readAgentAuthTerminalStatus } from './agentAuthTerminal.ts'
import { resolveWorkspaceLink } from './workspaceLinks.ts'
import { installRuntime, logoutRuntime, runtimeStatuses, RuntimeInstallError, uninstallRuntime } from './agentRuntimeInstall.ts'
import { readRuntimeAccount } from './agentAccount.ts'
import { AgentDefaultError, readAgentDefault, writeAgentDefault } from './agentDefaults.ts'
import { AgentCwdError, resolveAgentCwd, suggestAgentCwds } from './agentCwd.ts'
import { AgentScheduledPromptError, cancelAgentScheduledPrompt, listAgentScheduledPrompts, scheduleAgentPrompt, updateAgentScheduledPrompt } from './agentScheduledPrompts.ts'
import { AgentTerminalError, startAgentTerminal, stopAgentTerminal } from './agentTerminal.ts'
import { readAgentSessionClaims, readAgentTabs, readRootProjects, readWorkspaceUi, writeAgentTabs, writeRootProjects, writeWorkspaceUi } from './userUiState.ts'
import {
  AgentSettingError,
  deleteAgentSetting,
  describeAgentSetting,
  writeAgentSetting,
} from './agentSettings.ts'
import {
  DEFAULT_IGNORE,
  IgnoreListError,
  LOCKED_IGNORE,
  normalizeIgnoreList,
  readIgnoreList,
  writeIgnoreList,
} from './ignoreList.ts'
import { broadcast, broadcastTree } from './presence.ts'
import { resetTreeWatchers, watchProjectTree } from './watcher.ts'
import { measure, measureSync } from './perfMarks.ts'
import { authOf, requireAuthenticated, requireRole, requireFeature, requireAnyFeature, seesEveryFile } from './reqAuth.ts'
import { canUse, fileAccess, filterTreeForAccess, subtreeAccess, unrestrictedFiles, accessChanges } from './access-policy.ts'
import { createAccessRouter } from './access-routes.ts'
import {
  generateTempPassword,
  getUser,
  hashPassword,
  isAccountRole,
  isValidEmail,
  listUsers,
  normalizeEmail,
  upsertUser,
  userProfile,
} from './auth.ts'

/** tmux 세션은 워크스페이스 루트에서 시작한다 */
export const tmuxManager = createTmuxManager({ cwd: WORKSPACE_ROOT })

const AGENT_TAB_ID = /^[A-Za-z0-9_-]{1,64}$/
const ANCHOR_PREVIEW_MIN_BYTES = 512 * 1024
const DEFAULT_ANCHOR_CHUNK_LINES = 400
const MAX_ANCHOR_CHUNK_LINES = 2_000
// 앱 자체 작업은 서버가 등록한 값만 실행한다. 브라우저가 명령 문자열을 보낼 수는 없다.
const MEW_ACTIONS = {
  restart: { command: './mew restart', session: 'mewcmd-mew-restart' },
  build: { command: 'npm run build', session: 'mewcmd-mew-build' },
  update: { command: 'node server/runMewUpdate.ts', session: MEW_UPDATE_SESSION },
} as const

const UPLOAD_TEMP_DIR = path.join(DATA_DIR, 'uploads')
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, done) => fs.mkdir(UPLOAD_TEMP_DIR, { recursive: true, mode: 0o700 }, (err) => done(err, UPLOAD_TEMP_DIR)),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 10, parts: 12 },
})
const UPLOAD_WINDOW_MS = 15 * 60 * 1000
const MAX_UPLOADS_PER_WINDOW = 20
const uploadAttempts = new Map<string, number[]>()

/** 업로드 본문을 받기 전에 계정별 횟수를 제한해 디스크 고갈을 막는다. */
function limitUploads(req: express.Request, res: express.Response, next: express.NextFunction) {
  const key = authOf(req).email
  if (!key) return res.status(403).json({ error: '로그인이 필요합니다' })
  const now = Date.now()
  const recent = (uploadAttempts.get(key) ?? []).filter((at) => now - at < UPLOAD_WINDOW_MS)
  if (recent.length >= MAX_UPLOADS_PER_WINDOW) return res.status(429).json({ error: '업로드가 너무 많습니다 — 잠시 후 다시 시도하세요' })
  recent.push(now)
  uploadAttempts.set(key, recent)
  next()
}

function removeUploadTemp(file: Express.Multer.File | undefined) {
  if (file?.path) fs.rmSync(file.path, { force: true })
}

type StableTextFile = { content: string; size: number; mtimeMs: number }

/** `/file`은 UI 요청이므로 sync fs 호출로 다른 API까지 멈추게 하지 않는다. */
async function readStableTextFile(absPath: string): Promise<StableTextFile> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await fs.promises.stat(absPath)
    const content = await fs.promises.readFile(absPath, 'utf8')
    const after = await fs.promises.stat(absPath)
    if (before.size === after.size && before.mtimeMs === after.mtimeMs) return { content, size: after.size, mtimeMs: after.mtimeMs }
  }
  const [content, stat] = await Promise.all([fs.promises.readFile(absPath, 'utf8'), fs.promises.stat(absPath)])
  return { content, size: stat.size, mtimeMs: stat.mtimeMs }
}

/**
 * 목표 줄까지 필요한 바이트만 async stream으로 읽는다. 첫 preview에서 전체 파일 줄 수를 세려고
 * 끝까지 읽으면 기존 전체 읽기와 같아지므로, 정확한 총 줄 수는 뒤의 전체 본문 경로가 맡는다.
 */
async function readAnchoredTextChunk(absPath: string, anchorLine: number, chunkLines: number) {
  const before = Math.floor(chunkLines * 0.1)
  const lineStart = Math.max(1, anchorLine - before)
  const requestedEnd = lineStart + chunkLines - 1
  let line = 1
  let content = ''
  const stream = fs.createReadStream(absPath, { encoding: 'utf8', highWaterMark: 64 * 1024 })
  for await (const part of stream) {
    for (let i = 0; i < part.length; i += 1) {
      const char = part[i]
      if (line >= lineStart && line <= requestedEnd) content += char
      if (char !== '\n') continue
      if (line === requestedEnd) {
        stream.destroy()
        return { content, anchorLine, lineStart, lineEnd: requestedEnd }
      }
      line += 1
    }
  }
  if (content) return { content, anchorLine, lineStart, lineEnd: line }
  // 검색 결과의 줄은 서버 검색 결과라 보통 여기로 오지 않는다. 파일이 바뀌어 목표 줄이 없어졌으면
  // 받은 부분을 버리고 전체 읽기로 폴백한다.
  return null
}

/** 요청의 대상 프로젝트 — 쿼리(GET/DELETE) 또는 바디(POST/PUT), 없으면 docs */
function projectOf(req: express.Request): string {
  const fromQuery = req.query.project
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery
  const fromBody = (req.body as { project?: unknown } | null | undefined)?.project
  if (typeof fromBody === 'string' && fromBody) return fromBody
  return DEFAULT_PROJECT
}

type ScopedSearchFiles = {
  project: string
  all: string[]
  allowed: string[]
  owner: { id: string; label: string; kind: 'root' | 'docs' | 'subproject' } | null
  subprojects?: import('./tree.ts').TreeNode[]
}

async function catalogTextPaths(project: string): Promise<string[]> {
  return flattenTextFiles(await listCatalogFiles(project))
}

async function scopedSearchFiles(req: express.Request): Promise<ScopedSearchFiles[]> {
  const project = projectOf(req)
  if (project !== WORKSPACE_PROJECT) {
    const all = await catalogTextPaths(project)
    const allowed = all.filter((relPath) => fileAccess(authOf(req), project, relPath).view)
    return [{ project, all, allowed, owner: null }]
  }

  const [workspaceAll, docsAll, root] = await Promise.all([
    catalogTextPaths(WORKSPACE_PROJECT),
    catalogTextPaths(DEFAULT_PROJECT),
    listCatalogChildren(WORKSPACE_PROJECT),
  ])
  const requested = new Set(String(req.query.scopes ?? '').split(',').filter(Boolean))
  const subprojects = root.entries.filter((node) => node.type === 'dir' && node.project)
  const selectedSubs = subprojects.filter((node) => requested.has(`subproject:${node.path}`))
  const workspaceAllowed = workspaceAll.filter((relPath) => {
    if (!fileAccess(authOf(req), WORKSPACE_PROJECT, relPath).view) return false
    if (requested.size === 0) return true
    return selectedSubs.some((node) => relPath.startsWith(`${node.path}/`))
  })
  const includeDocs = requested.size === 0 || requested.has('docs')
  const docsAllowed = includeDocs
    ? docsAll.filter((relPath) => fileAccess(authOf(req), DEFAULT_PROJECT, relPath).view)
    : []
  return [
    {
      project: WORKSPACE_PROJECT,
      all: workspaceAll,
      allowed: workspaceAllowed,
      owner: { id: WORKSPACE_PROJECT, label: path.basename(projectRoot(WORKSPACE_PROJECT)), kind: 'root' },
      subprojects,
    },
    {
      project: DEFAULT_PROJECT,
      all: docsAll,
      allowed: docsAllowed,
      owner: { id: DEFAULT_PROJECT, label: 'Documents', kind: 'docs' },
    },
  ]
}

function indexedSearchPaths(
  scope: ScopedSearchFiles,
  query: string,
  opts: { regex: boolean; caseSensitive: boolean },
): { paths: string[]; state: SearchIndexState; version: number; scannedDirtyFiles: number } {
  const initial = ensureSearchIndex(scope.project, scope.all)
  const version = fileCatalogStatus(scope.project).version
  if (opts.regex || query.length < 3) return { paths: scope.allowed, state: initial, version, scannedDirtyFiles: 0 }
  const allowed = new Set(scope.allowed)
  const indexed = exactSearchCandidates(scope.project, query, allowed)
  if (!indexed.paths) return { paths: scope.allowed, state: indexed.state, version, scannedDirtyFiles: 0 }
  const selected = new Set(indexed.paths)
  let dirty = 0
  for (const relPath of indexed.dirtyPaths) {
    if (allowed.has(relPath)) { selected.add(relPath); dirty++ }
  }
  return { paths: scope.allowed.filter((relPath) => selected.has(relPath)), state: indexed.state, version, scannedDirtyFiles: dirty }
}

async function refreshCatalogPaths(project: string, relPaths: string[]): Promise<void> {
  const parents = [...new Set(relPaths.map(catalogParentOf))]
  const changed: string[] = []
  for (const parent of parents) {
    if (await refreshFileCatalogParent(project, parent)) changed.push(parent)
  }
  if (!changed.length) return
  const status = fileCatalogStatus(project)
  broadcastTree({ type: 'tree', project, version: status.version, parents: changed })
}

function taggedSearchResult(scope: ScopedSearchFiles, result: import('./search.ts').SearchFileResult) {
  if (!scope.owner) return result
  const subproject = scope.subprojects?.find((node) => result.path.startsWith(`${node.path}/`))
  return {
    ...result,
    project: subproject
      ? { id: scope.project, label: subproject.name, kind: 'subproject' as const }
      : scope.owner,
  }
}

/**
 * 방금 만들거나 옮긴 이 경로가 **그 사용자의 사이드바에는 안 뜨는지** — 파일 조작 응답에 실어 보낸다.
 * 클라이언트는 이걸로 "만들어졌는데 목록에 없다"는 조용한 실패 대신 그 자리에서 안내를 띄운다.
 * 조작 자체는 이미 성공했으므로 여기서 실패로 뒤집지 않는다(가시성은 인가 경계가 아니다 — tree.ts).
 */
function hiddenFromTree(req: express.Request, relPath: string, type: 'file' | 'dir' = 'file'): boolean {
  return !isPathVisible(projectOf(req), relPath, { showAll: seesEveryFile(authOf(req).role), type })
}

function childrenAt(nodes: import('./tree.ts').TreeNode[], relPath: string): import('./tree.ts').TreeNode[] {
  if (!relPath) return nodes
  for (const node of nodes) {
    if (node.path === relPath) return node.children ?? []
    if (relPath.startsWith(node.path + '/')) return childrenAt(node.children ?? [], relPath)
  }
  return []
}

/** File ACLs cover direct URLs and mutations as well as the explorer UI. */
function filePermissionMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = authOf(req), project = projectOf(req), route = req.path
  const write = !['GET', 'HEAD'].includes(req.method)
  const body = req.body ?? {}
  const target = String((write ? body.path : req.query.path) ?? req.query.path ?? '')
  let allowed = true
  const fileRoutes = ['/file', '/raw', '/download', '/asset', '/file-history', '/file-at-commit', '/file-revert', '/lint', '/rules', '/table-layout', '/comments', '/search/replace', '/pdf']
  if (fileRoutes.includes(route) || route.startsWith('/pdf/')) {
    allowed = fileAccess(auth, project, target)[write ? 'edit' : 'view']
    if (route === '/file' && req.method === 'DELETE') allowed = subtreeAccess(auth, project, target, true)
    if (route === '/comments') allowed &&= canUse(auth, 'collaboration')
  } else if (route === '/rename') {
    allowed = subtreeAccess(auth, project, body.oldPath, true) && subtreeAccess(auth, project, body.newPath, true, false)
  } else if (route === '/copy' || route === '/copy-into') {
    allowed = (body.sourceWorkspacePath !== undefined && auth.role === 'owner' && canUse(auth, 'serverFiles') || subtreeAccess(auth, project, body.srcPath ?? body.path))
      && subtreeAccess(auth, project, route === '/copy' ? path.posix.dirname(body.path ?? '') : body.destDir, true, false)
  } else if (route === '/subprojects') {
    allowed = typeof body.path === 'string' && fileAccess(auth, project, body.path).edit
      && fileAccess(auth, project, `${body.path}/.mew`).edit
  } else if (route === '/new-folder' || route === '/new-document') {
    allowed = fileAccess(auth, project, body.relPath).edit
  } else if (route === '/upload' || route === '/upload-into' || route === '/project-icon' || route === '/project-layout') {
    allowed = canUse(auth, 'filesWrite') && canUse(auth, 'filesRead')
  } else if (route.startsWith('/git/') || route === '/rag/status' || route === '/rag/reindex') {
    allowed = unrestrictedFiles(auth, project, write)
  } else if (route === '/db' || route.startsWith('/db/')) {
    allowed = canUse(auth, 'database') && unrestrictedFiles(auth, project, write)
  }
  if (!allowed) { res.status(403).json({ error: '이 파일 또는 폴더에 접근할 권한이 없습니다' }); return }
  next()
}

export function createApiApp() {
  const app = express()
  app.use(express.json({ limit: '10mb' }))
  app.use('/admin/access', createAccessRouter())
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next() })
  app.use(filePermissionMiddleware)
  app.get('/file-access', (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json(req.query.external === '1' ? { view: canUse(authOf(req), 'serverFiles'), edit: canUse(authOf(req), 'serverFiles') } : fileAccess(authOf(req), projectOf(req), String(req.query.path ?? '')))
  })


  /** 이 계정이 경로를 볼 수 있는지 확인 — 아니면 403을 응답하고 false를 반환한다 */
  function requireFileView(req: express.Request, res: express.Response, relPath: string): boolean {
    if (!fileAccess(authOf(req), projectOf(req), relPath).view) {
      res.status(403).json({ error: '접근 권한이 없습니다' })
      return false
    }
    return true
  }

  /** 게스트가 이 경로를 편집할 수 있는지 확인 — 아니면 403을 응답하고 false를 반환한다 */
  function requireFileEdit(req: express.Request, res: express.Response, relPath: string): boolean {
    if (!fileAccess(authOf(req), projectOf(req), relPath).edit) {
      res.status(403).json({ error: '편집 권한이 없습니다' })
      return false
    }
    return true
  }

  registerPdfRoutes(app, (req, res, write) => {
    try {
      if (req.path === '/fs/pdf') {
        if (!canUse(authOf(req), 'serverFiles')) { res.status(403).end(); return null }
        const file = resolveExistingPath(req.query.path)
        return { file, editable: !fs.realpathSync(file).split(path.sep).includes('archives') }
      }
      const relPath = String(req.query.path ?? '')
      if (!requireFileView(req, res, relPath) || (write && !requireFileEdit(req, res, relPath))) return null
      const project = projectOf(req)
      const file = resolveProjectPath(project, relPath)
      const realFile = fs.realpathSync(file), realRoot = fs.realpathSync(projectRoot(project))
      const relative = path.relative(realRoot, realFile)
      if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative) || relative.split(path.sep).some(isDeniedSegment)) throw new UnsafePathError('PDF path escapes project')
      const editable = !realFile.split(path.sep).includes('archives') && fileAccess(authOf(req), project, relPath).edit
      return { file: realFile, editable, saved: () => noteFileContentChanged(project, relPath) }
    } catch (error) { handleError(res, error); return null }
  })

  app.get('/projects', (req, res) => {
    const icons = readProjectIcons()
    const layout = readProjectLayout()
    const names = listProjects().filter(project => unrestrictedFiles(authOf(req), project) || filterTreeForAccess(authOf(req), project, buildTree(project, { showAll: true })).length > 0)
    res.json(
      names.map((name) => ({
        name,
        icon: icons[name] ?? null,
        slot: layout[name] ?? null,
        // 보호된 프로젝트(docs·앱 자신)는 UI에서 개명/삭제 버튼을 감춘다 — 서버도 거부한다
        protected: isProtectedProject(name),
      })),
    )
  })

  // 로그인 계정의 작업 맥락 — 브라우저 localStorage가 아니라 서버가 기준이라 다른 기기·시크릿 창도
  // 같은 프로젝트·에이전트 탭을 복원한다(ADR 0093).
  app.get('/user-ui/root-projects', requireRole('owner'), (req, res) => {
    res.json({ state: readRootProjects(authOf(req).email!) })
  })

  app.put('/user-ui/root-projects', requireRole('owner'), (req, res) => {
    try {
      res.json({ state: writeRootProjects(authOf(req).email!, req.body) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/user-ui/agent-tabs', requireAnyFeature('agent', 'terminal'), (req, res) => {
    try {
      const workspacePath = String(req.query.workspace ?? '')
      const email = authOf(req).email!
      res.json({ state: readAgentTabs(email, workspacePath), claims: readAgentSessionClaims(email) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/user-ui/agent-tabs', requireAnyFeature('agent', 'terminal'), (req, res) => {
    try {
      const workspacePath = typeof req.body?.workspacePath === 'string' ? req.body.workspacePath : ''
      res.json({ state: writeAgentTabs(authOf(req).email!, workspacePath, req.body) })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 로그인한 계정의 작업 화면 — 탭·사이드바·스크롤·패널 상태를 루트 경로별로 한 원장에 둔다.
  app.get('/user-ui/workspace', requireAuthenticated, (req, res) => {
    try {
      res.json({ state: readWorkspaceUi(authOf(req).email!, String(req.query.workspace ?? '')) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/user-ui/workspace', requireAuthenticated, (req, res) => {
    try {
      const workspacePath = typeof req.body?.workspacePath === 'string' ? req.body.workspacePath : ''
      res.json({ state: writeWorkspaceUi(authOf(req).email!, workspacePath, req.body?.state) })
    } catch (err) {
      handleError(res, err)
    }
  })

  // ── 프로젝트 폴더 생성·개명·삭제 (owner 전용) ──────────────────────────────
  // 삭제는 폴더를 통째로 지우는 되돌릴 수 없는 작업 — 클라이언트가 이름 타이핑 확인을 받고 호출한다.
  app.post('/project', requireRole('owner'), (req, res) => {
    const { name } = req.body as { name?: unknown }
    try {
      if (typeof name !== 'string') {
        res.status(400).json({ error: '프로젝트 이름이 없습니다' })
        return
      }
      res.json({ ok: true, ...createProject(name.trim()) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/project', requireRole('owner'), (req, res) => {
    const { oldName, newName } = req.body as { oldName?: unknown; newName?: unknown }
    try {
      if (typeof oldName !== 'string' || typeof newName !== 'string') {
        res.status(400).json({ error: '프로젝트 이름이 없습니다' })
        return
      }
      res.json({ ok: true, ...renameProject(oldName, newName.trim()) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.delete('/project', requireRole('owner'), (req, res) => {
    const name = String(req.query.name ?? '')
    try {
      deleteProject(name)
      res.json({ ok: true })
    } catch (err) {
      handleError(res, err)
    }
  })

  // ── 서버 DOM 브라우저와 loopback 호환 프록시 ─────────────────────
  app.use('/browser-dom', createDomBrowserRoutes())
  app.use('/remote-desktop', createRemoteDesktopRoutes(tmuxManager))

  app.get('/browser-url', requireAnyFeature('browser', 'android'), (req, res) => {
    try {
      const target = String(req.query.url ?? '')
      if (!target.trim()) {
        res.status(400).json({ error: '주소가 없습니다' })
        return
      }
      res.json({ url: browserProxyFrameUrl(target, authOf(req).email ?? '') })
    } catch (err) {
      handleError(res, err)
    }
  })

  // ── Android 패널: 상태 확인 + 사용자가 누른 서버 등록표 명령만 one-shot tmux로 실행 ─────
  app.get('/android/status', requireFeature('android'), async (_req, res) => {
    try {
      const running = new Set((await tmuxManager.list()).map((session) => session.name))
      res.json(await collectAndroidEnvStatus(running))
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/android/commands/:id/run', requireFeature('android'), async (req, res) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
      const runnable = androidCommandById(id)
      if (!runnable) {
        res.status(404).json({ error: '해당 Android 안내 명령을 찾을 수 없습니다' })
        return
      }
      // Android 안내 명령은 모두 one-shot이다. 대화형 명령은 사용자가 팝업 터미널에서 응답할 수 있고,
      // 명령이 끝나면 프로젝트 명령어 버튼과 똑같이 자기 숨김 세션을 정리한다.
      await tmuxManager.runCommand(runnable.session, oneShotCommand(runnable.command, runnable.session), WORKSPACE_ROOT)
      res.json({ ok: true, session: runnable.session })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/mew-update/status', requireFeature('system'), async (req, res) => {
    try {
      const running = (await tmuxManager.list()).some((session) => session.name === MEW_UPDATE_SESSION)
      res.json(await mewUpdateStatus(req.query.refresh === '1', running))
    } catch (err) {
      handleError(res, err)
    }
  })

  // 앱 자체 조작은 UI가 준 임의 셸이 아니라 이 등록표의 항목으로만 한정한다.
  app.post('/mew-actions/:id/run', requireFeature('system'), async (req, res) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
      const action = MEW_ACTIONS[id as keyof typeof MEW_ACTIONS]
      if (!action) {
        res.status(404).json({ error: '해당 mew 작업을 찾을 수 없습니다' })
        return
      }
      const running = (await tmuxManager.list()).some((session) => session.name === action.session)
      if (running) {
        res.status(409).json({ error: '이미 실행 중입니다' })
        return
      }
      if (id === 'update') {
        const status = await mewUpdateStatus(true, false)
        if (status.error) {
          res.status(409).json({ error: status.error })
          return
        }
        if (!status.canUpdate) {
          res.status(409).json({ error: '이 서버는 외부 supervisor가 관리 중이라 화면에서 재시작할 수 없습니다' })
          return
        }
        if (!status.available) {
          res.status(409).json({ error: '이미 최신 버전입니다' })
          return
        }
        writeMewUpdateJob({ state: 'queued', startedAt: Date.now(), finishedAt: null, message: null })
      }
      await tmuxManager.runCommand(action.session, oneShotCommand(action.command, action.session), MEW_APP_ROOT)
      res.json({ ok: true, session: action.session })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/project-icon', requireAuthenticated, (req, res) => {
    const { project, icon } = req.body as { project?: unknown; icon?: unknown }
    try {
      if (typeof project !== 'string' || !project) {
        res.status(400).json({ error: '프로젝트 이름이 없습니다' })
        return
      }
      projectRoot(project) // 존재하는 프로젝트인지 확인
      if (icon !== null && typeof icon !== 'string') {
        res.status(400).json({ error: '아이콘은 문자열 또는 null이어야 합니다' })
        return
      }
      // 라인 아이콘 키·이모지·직접 넣은 SVG를 한 곳에서 검사한다 — 터미널 명령어 버튼도 같은 함수를 쓴다
      const value = normalizeIconValue(typeof icon === 'string' ? icon : '') || null
      setProjectIcon(project, value)
      // 저장된 값(정리를 거친 SVG)을 돌려준다 — 클라이언트는 보낸 값이 아니라 이걸 그린다
      res.json({ ok: true, icon: value })
    } catch (err) {
      if (err instanceof SvgIconError) {
        res.status(400).json({ error: err.message })
        return
      }
      handleError(res, err)
    }
  })

  // 격자 칸 번호의 상한 — 타일을 아무리 흩어놔도 이 안에 들어온다 (잘못된 값 저장 방지용)
  const MAX_SLOT = 999

  app.put('/project-layout', requireAuthenticated, (req, res) => {
    const { layout } = req.body as { layout?: unknown }
    if (typeof layout !== 'object' || layout === null || Array.isArray(layout)) {
      res.status(400).json({ error: '배치 정보가 없습니다' })
      return
    }
    try {
      const known = new Set(listProjects())
      const next: Record<string, number> = {}
      for (const [name, slot] of Object.entries(layout)) {
        if (!known.has(name)) continue // 사라진 프로젝트의 자리는 그냥 버린다
        if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot > MAX_SLOT) {
          res.status(400).json({ error: `자리 번호가 올바르지 않습니다: ${name}` })
          return
        }
        next[name] = slot
      }
      writeProjectLayout(next)
      res.json({ ok: true })
    } catch (err) {
      handleError(res, err)
    }
  })

  // ── 워크스페이스 자체 갈아끼우기 (owner 전용) ──────────────────────────────
  // 어느 폴더를 열고 있는지 = 서버 기계의 경로다. owner 밖으로 내보내지 않는다.
  app.get('/workspace', requireAuthenticated, (_req, res) => {
    try {
      res.json(currentWorkspace())
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/workspace', requireRole('owner'), (req, res) => {
    const { path: target } = req.body as { path?: unknown }
    try {
      if (typeof target !== 'string' || !target.trim()) {
        res.status(400).json({ error: '열 폴더 경로가 없습니다' })
        return
      }
      const info = switchWorkspace(resolveBrowsePath(target))
      // 세션 만들기가 모듈 초기화 때 받은 cwd를 쓴다 — 라이브 바인딩이 닿지 않는 유일한 곳이라 여기서 고친다
      tmuxManager.cwd = info.path
      res.json(info)
    } catch (err) {
      handleError(res, err)
    }
  })

  // 에이전트 답변의 로컬 파일 링크 — 셸을 쓸 수 있는 역할만 서버 절대경로를 프로젝트 경로로 바꿀 수 있다.
  app.get('/agent-file-link', requireFeature('agent'), (req, res) => {
    const href = req.query.href
    if (typeof href !== 'string') {
      res.status(400).json({ error: '파일 링크가 없습니다' })
      return
    }
    res.json({ target: resolveWorkspaceLink(href) })
  })

  // 주소창 입력을 세션을 끊기 전에 검증한다. 파일 접근 범위는 넓히지 않는다 — ACP/CLI 권한은 이미 OS 사용자 범위다.
  app.get('/agent-cwd', requireAnyFeature('agent', 'terminal'), (req, res) => {
    try {
      const base = resolveAgentCwd(String(req.query.base ?? ''), WORKSPACE_ROOT)
      res.json({ cwd: resolveAgentCwd(String(req.query.path ?? ''), WORKSPACE_ROOT, base) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/agent-cwd/suggestions', requireAnyFeature('agent', 'terminal'), (req, res) => {
    try {
      const base = resolveAgentCwd(String(req.query.base ?? ''), WORKSPACE_ROOT)
      res.json(suggestAgentCwds(String(req.query.input ?? ''), WORKSPACE_ROOT, base, req.query.entered === 'true'))
    } catch (err) {
      handleError(res, err)
    }
  })

  // ── docs 특별 레포와 워크스페이스 밖 폴더 고르기 (owner 전용) ────────────────
  // /fs/dirs는 워크스페이스 경계 밖을 그대로 보여준다 — 역할을 낮추지 말 것.
  app.get('/fs/dirs', requireRole('owner'), (req, res) => {
    try {
      res.json(listDirs(resolveBrowsePath(String(req.query.path ?? ''))))
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/fs/cloud-storage', requireRole('owner'), async (_req, res) => {
    try {
      res.json({ folders: await discoverCloudStorage() })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 서버 파일 탐색기 — 셸과 같은 OS 사용자 범위를 노출하므로 manager·owner만 쓴다.
  app.get('/fs/entries', requireFeature('serverFiles'), async (req, res) => {
    try {
      res.json(await listEntries(String(req.query.path ?? '')))
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/fs/file', requireFeature('serverFiles'), (req, res) => {
    try {
      res.json(readExternalFile(req.query.path))
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/fs/file', requireFeature('serverFiles'), (req, res) => {
    try {
      const { path: filePath, content } = req.body as { path?: unknown; content?: unknown }
      res.json({ ok: true, path: writeExternalFile(filePath, content) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/fs/rename', requireFeature('serverFiles'), (req, res) => {
    try {
      const { path: target, name } = req.body as { path?: unknown; name?: unknown }
      res.json({ ok: true, path: renameExternalPath(target, name) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.delete('/fs/path', requireFeature('serverFiles'), (req, res) => {
    try {
      deleteExternalPath(req.query.path)
      res.json({ ok: true })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/fs/paste', requireFeature('serverFiles'), (req, res) => {
    try {
      const { source, destination, mode } = req.body as { source?: unknown; destination?: unknown; mode?: unknown }
      res.json({ ok: true, path: pasteExternalPath(source, destination, mode) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/fs/folder', requireRole('owner'), (req, res) => {
    try {
      res.json({ ok: true, path: createExternalFolder(req.body?.parent, req.body?.name) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/fs/git/init', requireRole('owner'), async (req, res) => {
    try {
      res.json({ ok: true, path: await initializeExternalRepository(req.body?.path) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/fs/git/clone', requireRole('owner'), async (req, res) => {
    try {
      res.json({ ok: true, path: await cloneExternalRepository(req.body?.parent, req.body?.url, req.body?.name) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/fs/raw', requireFeature('serverFiles'), (req, res) => {
    try {
      const abs = resolveExistingPath(req.query.path)
      res.setHeader('X-Frame-Options', 'SAMEORIGIN')
      res.sendFile(abs, { dotfiles: 'allow' }, (err) => {
        if (err && !res.headersSent) handleError(res, err)
      })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/fs/download', requireFeature('serverFiles'), (req, res) => {
    try {
      const abs = resolveExistingPath(req.query.path)
      res.download(abs, path.basename(abs), { dotfiles: 'allow' }, (err) => {
        if (err && !res.headersSent) handleError(res, err)
      })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/fs/open-project', requireRole('owner'), (req, res) => {
    try {
      const abs = resolveExistingPath((req.body as { path?: unknown }).path)
      if (!fs.statSync(abs).isDirectory()) throw new BrowseError(`폴더가 아닙니다: ${abs}`)
      const info = switchWorkspace(abs, WORKSPACE_PROJECT)
      tmuxManager.cwd = info.path
      res.json({ ...info, project: WORKSPACE_PROJECT })
    } catch (err) {
      handleError(res, err)
    }
  })

  // Git 워크벤치 — 경로는 현재 루트 프로젝트 안으로 제한하고, 폴더 자체가 저장소일 때만 조작한다.
  app.get('/git/repository', requireFeature('git'), async (req, res) => {
    try { res.json(await repositoryInfo(projectOf(req), String(req.query.path ?? ''))) } catch (err) { handleError(res, err) }
  })

  app.post('/git/init', requireFeature('git'), async (req, res) => {
    try {
      const relPath = typeof req.body?.path === 'string' ? req.body.path : ''
      const info = await initializeRepository(projectOf(req), relPath)
      res.json(info)
    } catch (err) { handleError(res, err) }
  })

  app.get('/git/log', requireFeature('git'), async (req, res) => {
    try { res.json({ commits: await repositoryLog(projectOf(req), String(req.query.path ?? ''), Number(req.query.limit ?? 300)) }) } catch (err) { handleError(res, err) }
  })

  app.get('/git/repositories', requireFeature('git'), async (req, res) => {
    try { res.json({ repositories: await listRepositories(projectOf(req)) }) } catch (err) { handleError(res, err) }
  })

  app.get('/git/commit', requireFeature('git'), async (req, res) => {
    try { res.json(await commitDetail(projectOf(req), String(req.query.path ?? ''), req.query.hash)) } catch (err) { handleError(res, err) }
  })

  app.get('/git/diff', requireFeature('git'), async (req, res) => {
    try { res.json({ diff: await commitFileDiff(projectOf(req), String(req.query.path ?? ''), req.query.hash, req.query.file) }) } catch (err) { handleError(res, err) }
  })

  app.get('/git/working-tree', requireFeature('git'), async (req, res) => {
    try { res.json(await workingTreeDetail(projectOf(req), String(req.query.path ?? ''))) } catch (err) { handleError(res, err) }
  })

  app.get('/git/working-tree/diff', requireFeature('git'), async (req, res) => {
    try { res.json({ diff: await workingTreeFileDiff(projectOf(req), String(req.query.path ?? ''), req.query.file) }) } catch (err) { handleError(res, err) }
  })

  app.post('/git/commit', requireFeature('git'), async (req, res) => {
    try { res.json(await commitWorkingTree(projectOf(req), String(req.body?.path ?? ''), req.body?.title, req.body?.description)) } catch (err) { handleError(res, err) }
  })

  app.post('/git/action', requireFeature('git'), async (req, res) => {
    try {
      const info = await runCommitAction(projectOf(req), String(req.body?.path ?? ''), req.body?.action, req.body?.hash, req.body?.name)
      res.json(info)
    } catch (err) { handleError(res, err) }
  })

  // docs로 쓸 폴더 바꾸기 — 워크스페이스 **안**의 폴더만 받는다(workspace.ts가 경계를 검사한다)
  app.post('/docs/root', requireRole('owner'), (req, res) => {
    const { path: target } = req.body as { path?: unknown }
    try {
      if (typeof target !== 'string' || !target.trim()) {
        res.status(400).json({ error: 'docs로 쓸 폴더 경로가 없습니다' })
        return
      }
      res.json(switchDocsRoot(resolveBrowsePath(target)))
    } catch (err) {
      handleError(res, err)
    }
  })

  // 가져오기는 기존 docs를 통째로 지운다 — 클라이언트가 경고를 띄우고 확인을 받은 뒤 호출한다
  app.post('/docs/import', requireRole('owner'), (req, res) => {
    const { path: from } = req.body as { path?: unknown }
    try {
      if (typeof from !== 'string' || !from.trim()) {
        res.status(400).json({ error: '가져올 폴더 경로가 없습니다' })
        return
      }
      importDocs(resolveBrowsePath(from))
      // 폴더가 통째로 바뀌었다 — 옛 폴더를 물고 있는 감시자를 접고 모두에게 다시 받아 가라고 알린다
      resetTreeWatchers()
      broadcast({ type: 'tree' })
      res.json({ ok: true })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/docs/export', requireRole('owner'), (req, res) => {
    const { path: to } = req.body as { path?: unknown }
    try {
      if (typeof to !== 'string' || !to.trim()) {
        res.status(400).json({ error: '내보낼 폴더 경로가 없습니다' })
        return
      }
      res.json({ ok: true, path: exportDocs(resolveBrowsePath(to)) })
    } catch (err) {
      handleError(res, err)
    }
  })

  // ── 홈 탭: 로그인 사용자별 할 일 ───────────────────────────────────────────
  app.get('/todos', requireAuthenticated, (req, res) => {
    try {
      res.json({ items: listTodos(authOf(req).email ?? '') })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/todos', requireAuthenticated, (req, res) => {
    const { text, type, due, time, projects } = req.body as {
      text?: unknown
      type?: unknown
      due?: unknown
      time?: unknown
      projects?: unknown
    }
    if (typeof text !== 'string') {
      res.status(400).json({ error: '할 일을 입력하세요' })
      return
    }
    if (type !== undefined && type !== 'today' && type !== 'dated' && type !== 'recurring') {
      res.status(400).json({ error: '할 일 종류가 올바르지 않습니다' })
      return
    }
    if (due !== undefined && due !== null && typeof due !== 'string') {
      res.status(400).json({ error: '기한이 올바르지 않습니다' })
      return
    }
    if (time !== undefined && time !== null && typeof time !== 'string') {
      res.status(400).json({ error: '시간이 올바르지 않습니다' })
      return
    }
    if (projects !== undefined && !Array.isArray(projects)) {
      res.status(400).json({ error: '프로젝트 목록이 올바르지 않습니다' })
      return
    }
    try {
      res.json({ item: createTodo(authOf(req).email ?? '', { text, type, due: due ?? null, time: time ?? null, projects }) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.patch('/todos/:id', requireAuthenticated, (req, res) => {
    const id = req.params.id
    if (typeof id !== 'string') {
      res.status(400).json({ error: '할 일을 찾을 수 없습니다' })
      return
    }
    const { text, type, status, done, due, time, projects } = req.body as {
      text?: unknown
      type?: unknown
      status?: unknown
      done?: unknown
      due?: unknown
      time?: unknown
      projects?: unknown
    }
    const change: TodoChange = {}
    if (text !== undefined) {
      if (typeof text !== 'string') {
        res.status(400).json({ error: '할 일이 올바르지 않습니다' })
        return
      }
      change.text = text
    }
    if (type !== undefined) {
      if (type !== 'today' && type !== 'dated' && type !== 'recurring') {
        res.status(400).json({ error: '할 일 종류가 올바르지 않습니다' })
        return
      }
      change.type = type
    }
    if (status !== undefined) {
      if (status !== 'open' && status !== 'done' && status !== 'canceled' && status !== 'missed') {
        res.status(400).json({ error: '상태가 올바르지 않습니다' })
        return
      }
      change.status = status
    }
    if (done !== undefined) {
      if (typeof done !== 'boolean') {
        res.status(400).json({ error: '완료 여부가 올바르지 않습니다' })
        return
      }
      change.done = done
    }
    if (due !== undefined) {
      if (due !== null && typeof due !== 'string') {
        res.status(400).json({ error: '기한이 올바르지 않습니다' })
        return
      }
      change.due = due
    }
    if (time !== undefined) {
      if (time !== null && typeof time !== 'string') {
        res.status(400).json({ error: '시간이 올바르지 않습니다' })
        return
      }
      change.time = time
    }
    if (projects !== undefined) {
      if (!Array.isArray(projects)) {
        res.status(400).json({ error: '프로젝트 목록이 올바르지 않습니다' })
        return
      }
      change.projects = projects
    }
    try {
      res.json({ item: updateTodo(authOf(req).email ?? '', id, change) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.delete('/todos/:id', requireAuthenticated, (req, res) => {
    const id = req.params.id
    if (typeof id !== 'string') {
      res.status(400).json({ error: '할 일을 찾을 수 없습니다' })
      return
    }
    try {
      deleteTodo(authOf(req).email ?? '', id)
      res.json({ ok: true })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/tree', async (req, res) => {
    try {
      const project = projectOf(req)
      const role = authOf(req).role
      const requestedPath = typeof req.query.path === 'string' ? req.query.path : null
      // owner·manager는 걸러내지 않은 트리를 받는다 — 숨김 목록도 확장자 필터도 없다(seesEveryFile)
      // 로그인 사용자는 폴더별 한 단계 목록을 받아 사이드바를 지연 로딩한다. 게스트 트리는
      // 후손의 공개 규칙을 보고 부모 경로를 남겨야 하므로 기존 전체 필터를 유지한다.
      let tree: import('./tree.ts').TreeNode[]
      let catalogState: 'ready' | 'building' | 'stale' = 'ready'
      let catalogVersion = 0
      if (!unrestrictedFiles(authOf(req), project) || requestedPath === null) {
        tree = await buildTreeAsync(project, { showAll: seesEveryFile(role) })
        warmFileCatalog(project)
      } else {
        const listed = await listCatalogChildren(project, requestedPath, { showAll: seesEveryFile(role) })
        tree = listed.entries
        catalogState = listed.state
        catalogVersion = listed.version
      }
      // 이 프로젝트를 보는 세션이 있으니 트리 감시를 지연 등록한다 — 터미널·다른 세션이 만든 파일이
      // 사이드바에 바로 반영되도록(멱등). docs는 부팅 때부터 감시 중. 게스트는 감시를 유발하지 않는다.
      if (role !== 'guest') watchProjectTree(project)
      const filtered = filterTreeForAccess(authOf(req), project, tree)
      const entries = requestedPath !== null && !unrestrictedFiles(authOf(req), project) ? childrenAt(filtered, requestedPath) : filtered
      if (req.query.v === '1') res.json({ version: catalogVersion, state: catalogState, entries })
      else res.json(entries)
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/skills', requireFeature('agent'), (_req, res) => {
    try {
      res.json({ skills: listSkills() })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/file', async (req, res) => {
    const relPath = String(req.query.path ?? '')
    const project = projectOf(req)
    if (!requireFileView(req, res, relPath)) return
    try {
      const absPath = resolveProjectPath(project, relPath)
      const editable = fileAccess(authOf(req), project, relPath).edit
      const requestedAnchor = Number(req.query.anchorLine)
      const stat = await fs.promises.stat(absPath)
      if (Number.isInteger(requestedAnchor) && requestedAnchor > 0 && stat.size >= ANCHOR_PREVIEW_MIN_BYTES) {
        const requestedLines = Number(req.query.chunkLines)
        const chunkLines = Number.isInteger(requestedLines) && requestedLines > 0 ? Math.min(requestedLines, MAX_ANCHOR_CHUNK_LINES) : DEFAULT_ANCHOR_CHUNK_LINES
        const chunk = await readAnchoredTextChunk(absPath, requestedAnchor, chunkLines)
        if (chunk) {
          res.json({ path: relPath, editable, version: { size: stat.size, mtimeMs: stat.mtimeMs }, partial: true, totalLines: null, ...chunk })
          return
        }
      }
      const file = await readStableTextFile(absPath)
      res.json({ path: relPath, content: file.content, editable, version: { size: file.size, mtimeMs: file.mtimeMs }, partial: false })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/file-history', async (req, res) => {
    const relPath = String(req.query.path ?? '')
    if (authOf(req).role === 'guest') {
      res.status(403).json({ error: '접근 권한이 없습니다' })
      return
    }
    try {
      const history = await fileHistory(projectOf(req), relPath)
      res.json({ history })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/file-at-commit', async (req, res) => {
    const relPath = String(req.query.path ?? '')
    const hash = String(req.query.hash ?? '')
    const project = projectOf(req)
    if (!requireFileView(req, res, relPath)) return
    try {
      resolveProjectPath(project, relPath) // 경로 검증(트래버설 방지)
      const content = await showAtCommit(project, relPath, hash)
      res.json({ content })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 커밋 시점 내용을 디스크에 쓰고 커밋한다 — "내부 링크 라벨 = title" 동기화까지 PUT /file과
  // 동일하게 처리해야 하므로 그 로직을 공유한다.
  async function writeAndCommit(project: string, relPath: string, content: string, action: 'add' | 'update', commitMessage?: string, mayEdit: (relPath: string) => boolean = () => true) {
    const absPath = resolveProjectPath(project, relPath)
    fs.mkdirSync(path.dirname(absPath), { recursive: true })
    fs.writeFileSync(absPath, content, 'utf-8')
    // 협업 브리지가 이 쓰기를 "우리 메아리"로 걸러내게 기록 (외부 AI 변경만 방에 주입되도록)
    noteAppWrite(absPath, content)
    noteFileContentChanged(project, relPath)
    if (action === 'add') await refreshCatalogPaths(project, [relPath])

    // "내부 링크 라벨 = 대상 문서 title" 정책(docs 전용): 커밋 시점에만 title 변경을 감지해
    // 참조 문서들의 라벨을 전파한다 — 자동저장마다 하면 타이핑 중인 미완성 title이 퍼지므로,
    // 기준은 마지막 커밋(HEAD)의 title이다.
    let linkUpdates: string[] = []
    if (project === DEFAULT_PROJECT && relPath.endsWith('.md')) {
      const headContent = await showHeadContent(project, relPath)
      const oldTitle = headContent ? parseTitle(headContent) : null
      const newTitle = parseTitle(content)
      if (oldTitle && newTitle && oldTitle !== newTitle) {
        try {
          linkUpdates = updateLinkLabelsFor(relPath, newTitle, mayEdit)
          for (const updatedPath of linkUpdates) noteFileContentChanged(project, updatedPath)
        } catch (err) {
          console.error('link label sync failed:', err)
        }
      }
    }
    const message = commitMessage ?? (linkUpdates.length > 0 ? `docs: update ${relPath} + sync link labels` : undefined)
    return commitFile(project, [relPath, ...linkUpdates], action, message)
  }

  app.put('/file', async (req, res) => {
    const { path: relPath, content, commit } = req.body as { path: string; content: string; commit?: boolean }
    const project = projectOf(req)
    if (!requireFileEdit(req, res, relPath)) return
    try {
      if (project === DEFAULT_PROJECT && isArchived(relPath)) {
        res.status(403).json({ error: 'archives/ 문서는 불변입니다 — 편집할 수 없습니다' })
        return
      }
      const absPath = resolveProjectPath(project, relPath)
      const isNew = !fs.existsSync(absPath)
      // 게스트는 부분 편집 권한을 받아도 명시적 git 커밋은 절대 트리거할 수 없다
      const doCommit = commit && authOf(req).role !== 'guest'
      if (doCommit) {
        const result = await writeAndCommit(project, relPath, content, isNew ? 'add' : 'update', undefined, target => fileAccess(authOf(req), project, target).edit)
        res.json({ ok: true, commit: result })
      } else {
        fs.mkdirSync(path.dirname(absPath), { recursive: true })
        fs.writeFileSync(absPath, content, 'utf-8')
        // 자동저장(비커밋) 경로 — 협업 브리지가 메아리로 무시하도록 기록
        noteAppWrite(absPath, content)
        noteFileContentChanged(project, relPath)
        if (isNew) await refreshCatalogPaths(project, [relPath])
        res.json({ ok: true, commit: null })
      }
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/file-revert', requireAuthenticated, async (req, res) => {
    const { path: relPath, hash } = req.body as { path?: unknown; hash?: unknown }
    const project = projectOf(req)
    try {
      if (typeof relPath !== 'string' || !relPath || typeof hash !== 'string' || !hash) {
        res.status(400).json({ error: 'path와 hash가 필요합니다' })
        return
      }
      if (!requireFileEdit(req, res, relPath)) return
      if (project === DEFAULT_PROJECT && isArchived(relPath)) {
        res.status(403).json({ error: 'archives/ 문서는 불변입니다 — 되돌릴 수 없습니다' })
        return
      }
      resolveProjectPath(project, relPath) // 경로 검증(트래버설 방지)
      const content = await showAtCommit(project, relPath, hash)
      if (content === null) {
        res.status(404).json({ error: '해당 커밋에서 파일을 찾을 수 없습니다' })
        return
      }
      const result = await writeAndCommit(project, relPath, content, 'update', `${project}: revert ${relPath} to ${hash.slice(0, 7)}`, target => fileAccess(authOf(req), project, target).edit)
      res.json({ ok: true, content, commit: result })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.delete('/file', requireAuthenticated, async (req, res) => {
    const relPath = String(req.query.path ?? '')
    const project = projectOf(req)
    try {
      resolveProjectPath(project, relPath)
      if (project === DEFAULT_PROJECT && isArchived(relPath)) {
        res.status(403).json({ error: 'archives/ 문서는 삭제할 수 없습니다' })
        return
      }
      deletePath(project, relPath)
      noteFileContentChanged(project, relPath)
      await refreshCatalogPaths(project, [relPath])
      // 빈 디렉터리처럼 git이 전혀 알지 못하는 경로는 git add가 pathspec 오류를 던진다 —
      // 디스크 삭제 자체는 이미 끝났으므로 커밋 실패로 전체 요청을 실패시키지 않는다.
      let commit = null
      try {
        commit = await commitFile(project, relPath, 'delete', `${project}: delete ${relPath}`)
      } catch (err) {
        console.error('delete commit failed:', err)
      }
      res.json({ ok: true, commit })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 편집 중인 버퍼를 oxlint로 검사 — 디스크에 쓰지 않는다 (lint.ts가 임시 파일 사용)
  app.post('/lint', async (req, res) => {
    const { path: relPath, content } = req.body as { path?: unknown; content?: unknown }
    const project = projectOf(req)
    try {
      if (typeof relPath !== 'string' || typeof content !== 'string') {
        res.status(400).json({ error: 'path와 content가 필요합니다' })
        return
      }
      if (!requireFileEdit(req, res, relPath)) return
      if (content.length > 1_000_000) {
        res.json({ diagnostics: [] })
        return
      }
      resolveProjectPath(project, relPath) // 경로 탈출·차단 경로 검증 (파일 존재 여부는 무관)
      res.json({ diagnostics: await lintContent(relPath, content, projectRoot(project)) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/search/files', requireAuthenticated, async (req, res) => {
    const query = String(req.query.q ?? '')
    if (!query) { res.json({ state: 'ready', version: 0, results: [] }); return }
    if (query.length > 2_000) { res.status(400).json({ error: '검색어가 너무 깁니다' }); return }
    try {
      res.json(await searchFileNames(query, {
        regex: req.query.regex === '1',
        caseSensitive: req.query.case === '1',
        scopes: String(req.query.scopes ?? '').split(',').filter(Boolean),
        showAll: seesEveryFile(authOf(req).role),
        allowed: (project, relPath) => fileAccess(authOf(req), project, relPath).view,
      }))
    } catch (err) {
      if (err instanceof SyntaxError) { res.status(400).json({ error: '잘못된 정규식입니다' }); return }
      handleError(res, err)
    }
  })

  // 프로젝트 전체 파일 내용 검색(Ctrl+Shift+F) — 트리 가시성·게스트 필터를 그대로 거친 파일만 훑는다
  app.get('/search', async (req, res) => {
    const query = String(req.query.q ?? '')
    const opts = { regex: req.query.regex === '1', caseSensitive: req.query.case === '1' }
    try {
      if (query.length > 2_000) { res.status(400).json({ error: '검색어가 너무 깁니다' }); return }
      if (!query) {
        res.json({ results: [], truncated: false, state: 'ready', version: 0, scannedDirtyFiles: 0 })
        return
      }
      const scopes = await scopedSearchFiles(req)
      const results: ReturnType<typeof taggedSearchResult>[] = []
      let truncated = false
      let indexState: SearchIndexState = 'ready'
      let catalogVersion = 0
      let scannedDirtyFiles = 0
      for (const scope of scopes) {
        const selected = indexedSearchPaths(scope, query, opts)
        const searched = measureSync('search.scan', { files: selected.paths.length }, () => (
          searchInProject(scope.project, selected.paths, query, opts)
        ))
        results.push(...searched.results.map((result) => taggedSearchResult(scope, result)))
        truncated ||= searched.truncated
        catalogVersion = Math.max(catalogVersion, selected.version)
        scannedDirtyFiles += selected.scannedDirtyFiles
        if (selected.state !== 'ready') indexState = selected.state
      }
      res.json({ results, truncated, state: indexState, version: catalogVersion, scannedDirtyFiles })
    } catch (err) {
      if (err instanceof SyntaxError) {
        res.status(400).json({ error: '잘못된 정규식입니다' })
        return
      }
      handleError(res, err)
    }
  })

  // 내용 검색의 SSE 버전. 파일 하나를 찾는 즉시 보내므로 큰 프로젝트에서 끝까지 기다릴 필요가 없다.
  app.get('/search/stream', async (req, res) => {
    const query = String(req.query.q ?? '')
    const opts = { regex: req.query.regex === '1', caseSensitive: req.query.case === '1' }
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()
    const emit = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    let closed = false
    req.on('close', () => { closed = true })
    let batch: unknown[] = []
    let batchTimer: NodeJS.Timeout | null = null
    const flush = () => {
      if (batchTimer) clearTimeout(batchTimer)
      batchTimer = null
      if (!batch.length || closed) { batch = []; return }
      for (const result of batch) emit('result', result)
      batch = []
    }
    const queueResult = (result: unknown) => {
      if (closed) return
      batch.push(result)
      if (batch.length >= 20) flush()
      else if (!batchTimer) batchTimer = setTimeout(flush, 50)
    }
    try {
      if (query.length > 2_000) { emit('error', { error: '검색어가 너무 깁니다' }); res.end(); return }
      if (!query) { emit('done', { truncated: false, state: 'ready', version: 0, scannedDirtyFiles: 0 }); res.end(); return }
      const scopes = await scopedSearchFiles(req)
      let truncated = false
      let indexState: SearchIndexState = 'ready'
      let catalogVersion = 0
      let scannedDirtyFiles = 0
      for (const scope of scopes) {
        if (closed) break
        const selected = indexedSearchPaths(scope, query, opts)
        const result = await measure('search.scan', { files: selected.paths.length }, () => (
          searchInProjectProgressively(
            scope.project,
            selected.paths,
            query,
            opts,
            (file) => queueResult(taggedSearchResult(scope, file)),
            () => closed,
          )
        ))
        truncated ||= result.truncated
        catalogVersion = Math.max(catalogVersion, selected.version)
        scannedDirtyFiles += selected.scannedDirtyFiles
        if (selected.state !== 'ready') indexState = selected.state
      }
      flush()
      if (!closed) emit('done', { truncated, state: indexState, version: catalogVersion, scannedDirtyFiles })
    } catch (err) {
      if (!closed) emit('error', { error: err instanceof SyntaxError ? '잘못된 정규식입니다' : err instanceof Error ? err.message : '검색 실패' })
    }
    if (batchTimer) clearTimeout(batchTimer)
    if (!closed) res.end()
  })

  // 의미 검색(RAG retrieval) — 인덱스는 권한 경계가 아니라 파생 캐시다. 로그인 사용자만 허용하고,
  // 결과도 요청 시점의 기본 트리에 보이는 파일 집합으로 다시 제한한다.
  app.get('/search/semantic', requireAuthenticated, async (req, res) => {
    const project = projectOf(req)
    const query = String(req.query.q ?? '').trim()
    try {
      if (!query) {
        res.json({ results: [], indexedFiles: 0, indexedChunks: 0, updatedFiles: 0, model: '' })
        return
      }
      if (query.length > 2_000) {
        res.status(400).json({ error: '검색어가 너무 깁니다' })
        return
      }
      validateRagProject(project)
      const files = flattenTextFiles(await buildTreeAsync(project)).filter(relPath => fileAccess(authOf(req), project, relPath).view)
      res.json(await currentRagIndex().search(project, files, query, req.query.history === '1'))
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/rag/status', requireAuthenticated, (req, res) => {
    const project = projectOf(req)
    try {
      validateRagProject(project)
      if (!ragEnabled()) {
        res.json({ enabled: false, model: '', ready: false, indexedFiles: 0, indexedChunks: 0 })
        return
      }
      res.json(currentRagIndex().status(project))
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/rag/reindex', requireFeature('system'), async (req, res) => {
    const project = projectOf(req)
    try {
      validateRagProject(project)
      const files = flattenTextFiles(await buildTreeAsync(project)).filter(relPath => fileAccess(authOf(req), project, relPath).view)
      res.json({ ok: true, ...(await currentRagIndex().ensureProject(project, files, true)) })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 한 파일 안의 모든 매치를 치환하고 커밋한다 — 게스트는 대량 편집 불가(requireAuthenticated).
  // 프로젝트 전역 "모두 바꾸기"는 프론트가 파일마다 이 라우트를 부른다.
  app.post('/search/replace', requireAuthenticated, async (req, res) => {
    const { path: relPath, query, replace, regex, caseSensitive } = req.body as {
      path?: unknown
      query?: unknown
      replace?: unknown
      regex?: unknown
      caseSensitive?: unknown
    }
    const project = projectOf(req)
    try {
      if (typeof relPath !== 'string' || !relPath || typeof query !== 'string' || !query || typeof replace !== 'string') {
        res.status(400).json({ error: 'path·query·replace가 필요합니다' })
        return
      }
      resolveProjectPath(project, relPath) // 경로 탈출·차단 경로 검증
      if (project === DEFAULT_PROJECT && isArchived(relPath)) {
        res.status(403).json({ error: 'archives/ 문서는 불변입니다 — 바꿀 수 없습니다' })
        return
      }
      const { content, count } = replaceInFile(project, relPath, query, replace, {
        regex: regex === true,
        caseSensitive: caseSensitive === true,
      })
      if (count === 0) {
        res.json({ ok: true, count: 0, commit: null })
        return
      }
      const commit = await writeAndCommit(project, relPath, content, 'update', `${project}: replace in ${relPath} (${count})`)
      res.json({ ok: true, count, commit })
    } catch (err) {
      if (err instanceof SyntaxError) {
        res.status(400).json({ error: '잘못된 정규식입니다' })
        return
      }
      handleError(res, err)
    }
  })

  app.post('/copy', requireAuthenticated, async (req, res) => {
    const { path: relPath } = req.body as { path?: unknown }
    const project = projectOf(req)
    try {
      if (typeof relPath !== 'string' || !relPath) {
        res.status(400).json({ error: 'path가 필요합니다' })
        return
      }
      if (project === DEFAULT_PROJECT && isArchived(relPath)) {
        res.status(403).json({ error: 'archives/ 문서는 복제할 수 없습니다' })
        return
      }
      const newRelPath = copyFile(project, relPath)
      const commit = await commitFile(project, newRelPath, 'add', `${project}: copy ${relPath} → ${newRelPath}`)
      res.json({ ok: true, relPath: newRelPath, commit, hidden: hiddenFromTree(req, newRelPath) })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 파일·폴더를 다른 폴더 안으로 복사(붙여넣기) — 드래그 이동/잘라내기는 /rename(=이동)을 재사용하고,
  // 이 라우트는 "복사 후 붙여넣기"만 담당한다. destDir=''는 프로젝트 루트.
  app.post('/copy-into', requireAuthenticated, async (req, res) => {
    const { srcPath, destDir, sourceWorkspacePath } = req.body as { srcPath?: unknown; destDir?: unknown; sourceWorkspacePath?: unknown }
    const project = projectOf(req)
    try {
      if (typeof srcPath !== 'string' || !srcPath || typeof destDir !== 'string') {
        res.status(400).json({ error: 'srcPath와 destDir가 필요합니다' })
        return
      }
      // 루트 프로젝트를 바꾸면 `.workspace`는 새 루트를 가리킨다. 이전 루트에서 복사한 항목은
      // owner가 보낸 원래 루트 안에서만 해석해 복사한다. 임의 절대경로 접근 표면이므로 owner만 된다.
      if (sourceWorkspacePath !== undefined) {
        if (authOf(req).role !== 'owner' || typeof sourceWorkspacePath !== 'string' || !path.isAbsolute(sourceWorkspacePath)) {
          res.status(403).json({ error: '다른 프로젝트에서 복사한 항목은 owner만 붙여넣을 수 있습니다' })
          return
        }
        const sourceRoot = resolveExistingPath(sourceWorkspacePath)
        if (!fs.statSync(sourceRoot).isDirectory()) {
          res.status(400).json({ error: '원본 프로젝트 폴더가 아닙니다' })
          return
        }
        const sourceAbs = path.resolve(sourceRoot, srcPath)
        if (sourceAbs === sourceRoot || !sourceAbs.startsWith(sourceRoot + path.sep)
          || path.relative(sourceRoot, sourceAbs).split(path.sep).some(isDeniedSegment)) {
          res.status(400).json({ error: '원본 경로가 올바르지 않습니다' })
          return
        }
        if (project === DEFAULT_PROJECT && isArchived(destDir)) {
          res.status(403).json({ error: 'archives/ 문서는 복사할 수 없습니다' })
          return
        }
        const destAbs = resolveProjectPath(project, destDir)
        const copiedAbs = pasteExternalPath(sourceAbs, destAbs, 'copy')
        const newRelPath = path.relative(projectRoot(project), copiedAbs).split(path.sep).join('/')
        await refreshCatalogPaths(project, [newRelPath])
        const commit = await commitFile(project, newRelPath, 'add', `${project}: copy ${srcPath} → ${newRelPath}`)
        const type = fs.statSync(copiedAbs).isDirectory() ? 'dir' : 'file'
        res.json({ ok: true, relPath: newRelPath, commit, hidden: hiddenFromTree(req, newRelPath, type) })
        return
      }
      if (project === DEFAULT_PROJECT && (isArchived(srcPath) || isArchived(destDir))) {
        res.status(403).json({ error: 'archives/ 문서는 복사할 수 없습니다' })
        return
      }
      const newRelPath = copyPathInto(project, srcPath, destDir)
      await refreshCatalogPaths(project, [newRelPath])
      const commit = await commitFile(project, newRelPath, 'add', `${project}: copy ${srcPath} → ${newRelPath}`)
      const type = fs.statSync(resolveProjectPath(project, newRelPath)).isDirectory() ? 'dir' : 'file'
      res.json({ ok: true, relPath: newRelPath, commit, hidden: hiddenFromTree(req, newRelPath, type) })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 이미지·오디오·비디오·PDF를 브라우저가 인라인으로 렌더링하도록 스트리밍한다.
  // sendFile이 확장자 기반 Content-Type과 Range 요청(비디오 탐색)을 처리한다.
  app.get('/raw', (req, res) => {
    const relPath = String(req.query.path ?? '')
    if (!requireFileView(req, res, relPath)) return
    try {
      const absPath = resolveProjectPath(projectOf(req), relPath)
      // serve.ts의 전역 X-Frame-Options: DENY는 유지하되, PDF를 같은 오리진 iframe에
      // 담을 수 있어야 하므로 이 라우트만 SAMEORIGIN으로 완화한다
      res.setHeader('X-Frame-Options', 'SAMEORIGIN')
      // dotfiles: 'allow' — express의 send는 기본으로 점으로 시작하는 폴더·파일을 통째로 404 낸다.
      // 이 워크스페이스는 문서가 `.mew/docs/` 밑에 산다: 그냥 두면 그 아래 PDF·xlsx가 전부 500이었다
      // ({"error":"Internal error"}). 접근 판정은 이미 위에서 끝났다 —
      // resolveProjectPath가 루트 탈출과 .git·node_modules·.data를 막고, requireFileView가 게스트를 건다
      res.sendFile(absPath, { dotfiles: 'allow' }, (err) => {
        if (err && !res.headersSent) handleError(res, err)
      })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/download', (req, res) => {
    const relPath = String(req.query.path ?? '')
    if (!requireFileView(req, res, relPath)) return
    try {
      const absPath = resolveProjectPath(projectOf(req), relPath)
      // dotfiles는 /raw와 같은 이유로 열어 둔다 — `.mew/docs/` 밑 파일 내려받기가 통째로 막혀 있었다.
      // 옵션을 주려면 파일 이름 자리를 채워야 한다 — express가 기본으로 쓰는 값(경로의 마지막 조각)과 같다
      res.download(absPath, path.basename(absPath), { dotfiles: 'allow' }, (err) => {
        if (err && !res.headersSent) handleError(res, err)
      })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/rename', requireAuthenticated, async (req, res) => {
    const { oldPath, newPath } = req.body as { oldPath: string; newPath: string }
    const project = projectOf(req)
    try {
      if (project === DEFAULT_PROJECT) {
        if (isArchived(oldPath) || isArchived(newPath)) {
          res.status(403).json({ error: 'archives/ 문서는 이름을 바꿀 수 없습니다' })
          return
        }
        if (oldPath.endsWith('.md') && !newPath.endsWith('.md')) {
          res.status(400).json({ error: '.md 파일만 이름을 바꿀 수 있습니다' })
          return
        }
      }
      renamePath(project, oldPath, newPath)
      noteFileContentChanged(project, oldPath)
      noteFileContentChanged(project, newPath)
      await refreshCatalogPaths(project, [oldPath, newPath])
      const commit = await commitFile(project, [oldPath, newPath], 'rename', `${project}: rename ${oldPath} → ${newPath}`)
      const type = fs.statSync(resolveProjectPath(project, newPath)).isDirectory() ? 'dir' : 'file'
      res.json({ ok: true, relPath: newPath, commit, hidden: hiddenFromTree(req, newPath, type) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/new-folder', requireAuthenticated, async (req, res) => {
    const { relPath } = req.body as { relPath: string }
    const project = projectOf(req)
    try {
      if (project === DEFAULT_PROJECT && isArchived(relPath)) {
        res.status(403).json({ error: 'archives/ 밑에는 새 폴더를 만들 수 없습니다' })
        return
      }
      createFolder(project, relPath)
      await refreshCatalogPaths(project, [relPath])
      res.json({ ok: true, relPath, hidden: hiddenFromTree(req, relPath, 'dir') })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/rules', (req, res) => {
    const relPath = String(req.query.path ?? '')
    const project = projectOf(req)
    if (!requireFileView(req, res, relPath)) return
    try {
      resolveProjectPath(project, relPath)
      if (project !== DEFAULT_PROJECT) {
        // MOC 커버리지·archives 불변 규칙은 docs SSoT 전용
        res.json({ archived: false, mocApplicable: false, mocRegistered: true, brokenLinks: [] })
        return
      }
      res.json(evaluateRules(relPath))
    } catch (err) {
      handleError(res, err)
    }
  })

  // 표 열 너비 — 마크다운이 담지 못하는 레이아웃이라 <프로젝트>/.mew/table-layout.json에 따로 둔다.
  // 본문(.md)은 건드리지 않으므로 저장·불러오기가 실패해도 문서 자체는 멀쩡하다.
  app.get('/table-layout', (req, res) => {
    const relPath = String(req.query.path ?? '')
    const project = projectOf(req)
    if (!requireFileView(req, res, relPath)) return
    try {
      resolveProjectPath(project, relPath) // 경로 탈출·차단 경로 검증
      res.json({ tables: readTableLayout(project, relPath) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/table-layout', requireAuthenticated, (req, res) => {
    const { path: relPath, tables } = req.body as { path?: unknown; tables?: unknown }
    const project = projectOf(req)
    try {
      if (typeof relPath !== 'string' || !relPath) {
        res.status(400).json({ error: 'path가 필요합니다' })
        return
      }
      resolveProjectPath(project, relPath)
      res.json({ ok: true, tables: writeTableLayout(project, relPath, tables) })
    } catch (err) {
      if (err instanceof TableLayoutError) {
        res.status(400).json({ error: err.message })
        return
      }
      handleError(res, err)
    }
  })

  // ── 협업: 멤버 채팅 · 파일 댓글 ──────────────────────────────────────────────
  // 실시간 전달은 presence 신호({type:'chat'}·{type:'comments'})가 전부다 — 신호에 내용·경로를
  // 싣지 않는다(broadcast는 게스트에게도 간다). 받는 쪽이 REST로 다시 읽는다. 전부 로그인 전용.

  /** 계정 목록 — 채팅 상대와 읽음 계산의 모집단이다 */
  const memberEmails = () => listUsers().map(({ email }) => email)

  // 단체방 + 내 DM을 한 번에 준다(원장이 500줄뿐이다). 남의 DM은 애초에 실리지 않는다
  app.get('/chat', requireFeature('chat'), (req, res) => {
    res.json(listChatFor(authOf(req).email ?? '', memberEmails()))
  })

  app.post('/chat', requireFeature('chat'), (req, res) => {
    const { text, to } = (req.body ?? {}) as { text?: unknown; to?: unknown }
    try {
      const author = authOf(req).email ?? ''
      // 수신자는 실재하는 계정만 — 오타 하나로 아무도 못 보는 메시지가 남지 않게 한다
      let recipients: string[] | undefined
      if (to !== undefined && to !== null) {
        if (!Array.isArray(to)) {
          res.status(400).json({ error: '수신자 형식이 잘못됐습니다' })
          return
        }
        const members = memberEmails()
        const unknown = to.filter((email) => typeof email !== 'string' || !members.includes(email))
        if (unknown.length > 0) {
          res.status(400).json({ error: '없는 계정에는 보낼 수 없습니다' })
          return
        }
        recipients = to as string[]
      }
      const message = postChatMessage(author, text, recipients)
      broadcast({ type: 'chat' })
      res.json({ ok: true, message })
    } catch (err) {
      if (err instanceof ChatError) {
        res.status(400).json({ error: err.message })
        return
      }
      handleError(res, err)
    }
  })

  // 이 대화를 여기까지 읽었다 — 보낸 쪽 화면의 숫자가 줄어야 하므로 읽음도 방송한다
  app.post('/chat/read', requireFeature('chat'), (req, res) => {
    const conversation = (req.body as { conversation?: unknown } | null)?.conversation
    if (typeof conversation !== 'string' || !conversation) {
      res.status(400).json({ error: 'conversation이 필요합니다' })
      return
    }
    try {
      if (markChatRead(authOf(req).email ?? '', conversation)) broadcast({ type: 'chat' })
      res.json({ ok: true })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 멘션 자동완성용 계정 목록 — 이메일만. /admin/users(owner 전용)와 달리 역할·상태는 주지 않는다
  app.get('/members', requireAuthenticated, (_req, res) => {
    res.json({ members: listUsers().map(({ email }) => email) })
  })

  // 채팅 등 협업 UI용 공개 프로필. 계정 역할·비밀번호 상태는 내보내지 않는다.
  app.get('/member-profiles', requireAuthenticated, (_req, res) => {
    res.json({ members: listUsers().map(({ email, record }) => userProfile(email, record)) })
  })

  app.get('/comments', requireAuthenticated, (req, res) => {
    const relPath = String(req.query.path ?? '')
    const project = projectOf(req)
    try {
      resolveProjectPath(project, relPath) // 경로 탈출·차단 경로 검증
      res.json({ threads: listThreads(project, relPath) })
    } catch (err) {
      handleError(res, err)
    }
  })

  // threadId가 있으면 그 스레드에 답글, 없으면 anchor로 새 스레드 — 작성자는 언제나 세션에서 온다
  app.post('/comments', requireAuthenticated, (req, res) => {
    const { path: relPath, threadId, anchor, text } = req.body as {
      path?: unknown
      threadId?: unknown
      anchor?: unknown
      text?: unknown
    }
    const project = projectOf(req)
    try {
      if (typeof relPath !== 'string' || !relPath) {
        res.status(400).json({ error: 'path가 필요합니다' })
        return
      }
      resolveProjectPath(project, relPath)
      const author = authOf(req).email ?? ''
      const thread =
        typeof threadId === 'string' && threadId
          ? addComment(project, relPath, threadId, author, text)
          : addThread(project, relPath, anchor, author, text)
      broadcast({ type: 'comments' })
      // 댓글 속 @이메일 멘션 — 그 사람이 보는 채팅에 파일 멘션과 함께 흘려 준다
      // 지목된 사람에게만 간다(ADR 0049 §4·0050) — 단체방에 흘리면 남의 대화가 새어 나간다
      const mentioned = mentionedEmails(String(text), memberEmails())
      if (mentioned.length > 0) {
        postChatMessage(author, `[[${project}:${relPath}]] 댓글에서 — ${String(text).trim().slice(0, 500)}`, mentioned)
        broadcast({ type: 'chat' })
      }
      res.json({ ok: true, thread })
    } catch (err) {
      if (err instanceof CommentsError) {
        res.status(400).json({ error: err.message })
        return
      }
      handleError(res, err)
    }
  })

  app.put('/comments', requireAuthenticated, (req, res) => {
    const { path: relPath, threadId, commentId, text } = req.body as {
      path?: unknown
      threadId?: unknown
      commentId?: unknown
      text?: unknown
    }
    const project = projectOf(req)
    try {
      if (typeof relPath !== 'string' || typeof threadId !== 'string' || typeof commentId !== 'string') {
        res.status(400).json({ error: 'path, threadId, commentId가 필요합니다' })
        return
      }
      resolveProjectPath(project, relPath)
      const auth = authOf(req)
      const thread = editComment(project, relPath, threadId, commentId, { email: auth.email ?? '', isOwner: auth.role === 'owner' }, text)
      broadcast({ type: 'comments' })
      res.json({ ok: true, thread })
    } catch (err) {
      if (err instanceof CommentsError) {
        res.status(400).json({ error: err.message })
        return
      }
      handleError(res, err)
    }
  })

  app.delete('/comments', requireAuthenticated, (req, res) => {
    const relPath = String(req.query.path ?? '')
    const threadId = String(req.query.threadId ?? '')
    const commentId = String(req.query.commentId ?? '')
    const project = projectOf(req)
    try {
      resolveProjectPath(project, relPath)
      const auth = authOf(req)
      const thread = deleteComment(project, relPath, threadId, commentId, { email: auth.email ?? '', isOwner: auth.role === 'owner' })
      broadcast({ type: 'comments' })
      res.json({ ok: true, thread })
    } catch (err) {
      if (err instanceof CommentsError) {
        res.status(400).json({ error: err.message })
        return
      }
      handleError(res, err)
    }
  })

  // 서버가 사용자가 준 URL로 외부·내부망을 요청하지 않는다. 링크는 URL만 표시한다.
  app.get('/link-preview', requireAuthenticated, (_req, res) => {
    res.json({ title: null, description: null })
  })

  app.post('/upload', requireAuthenticated, limitUploads, upload.single('file'), async (req, res) => {
    const file = req.file
    const project = projectOf(req)
    if (!file) {
      res.status(400).json({ error: '파일이 없습니다' })
      return
    }
    try {
      if (!subtreeAccess(authOf(req), project, '.mew/assets', true, false)) { res.status(403).json({ error: '첨부 경로에 쓸 권한이 없습니다' }); return }
      const relPath = moveAssetIntoProject(project, file.path, file.originalname, file.mimetype)
      noteFileContentChanged(project, relPath)
      await refreshCatalogPaths(project, [relPath])
      await commitFile(project, relPath, 'add', `${project}: upload ${relPath}`)
      res.json({ path: relPath, name: file.originalname, mimetype: file.mimetype })
    } catch (err) {
      handleError(res, err)
    } finally {
      removeUploadTemp(file)
    }
  })

  // UUID 첨부도 일반 파일과 같은 ACL을 적용한다. UUID 형식 검증은 추가 경로 제한이다.
  app.get('/asset', (req, res) => {
    const relPath = String(req.query.path ?? '')
    if (!isLocalAssetPath(relPath)) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    try {
      const absPath = resolveProjectPath(projectOf(req), relPath)
      res.setHeader('Cache-Control', 'private, no-store')
      res.sendFile(absPath, { dotfiles: 'allow' }, (err) => {
        if (err && !res.headersSent) handleError(res, err)
      })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 바깥에서 사이드바(파일 트리)로 끌어다 놓은 파일 — 에디터 asset과 달리 프로젝트 폴더의 그 자리에 그대로 저장한다.
  // multer가 먼저 돌아 destDir·project 같은 텍스트 필드도 req.body에 채워 준다.
  app.post('/upload-into', requireAuthenticated, limitUploads, upload.single('file'), async (req, res) => {
    const file = req.file
    const destDir = String((req.body as { destDir?: unknown }).destDir ?? '')
    const project = projectOf(req)
    try {
      if (!file) {
        res.status(400).json({ error: '파일이 없습니다' })
        return
      }
      if (project === DEFAULT_PROJECT && isArchived(destDir)) {
        res.status(403).json({ error: 'archives/ 밑에는 파일을 올릴 수 없습니다' })
        return
      }
      if (!subtreeAccess(authOf(req), project, destDir, true, false)) { res.status(403).json({ error: '업로드 경로에 쓸 권한이 없습니다' }); return }
      const relPath = moveFileInto(project, destDir, file.originalname, file.path)
      noteFileContentChanged(project, relPath)
      await refreshCatalogPaths(project, [relPath])
      const commit = await commitFile(project, relPath, 'add', `${project}: upload ${relPath}`)
      res.json({ ok: true, relPath, commit, hidden: hiddenFromTree(req, relPath) })
    } catch (err) {
      handleError(res, err)
    } finally {
      removeUploadTemp(file)
    }
  })

  app.post('/new-document', requireAuthenticated, async (req, res) => {
    const { relPath, title } = req.body as { relPath: string; title: string }
    const project = projectOf(req)
    try {
      if (project === DEFAULT_PROJECT && isArchived(relPath)) {
        res.status(403).json({ error: 'archives/ 밑에는 새 문서를 만들 수 없습니다' })
        return
      }
      if (typeof relPath !== 'string' || !relPath.trim()) {
        res.status(400).json({ error: '파일명을 입력하세요' })
        return
      }
      if (typeof title !== 'string' || !title.trim()) {
        res.status(400).json({ error: '제목을 입력하세요' })
        return
      }
      createDocument(project, relPath, title)
      noteFileContentChanged(project, relPath)
      await refreshCatalogPaths(project, [relPath])
      const commit = await commitFile(project, relPath, 'add')
      res.json({ ok: true, relPath, commit, hidden: hiddenFromTree(req, relPath) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/guest-access', (_req, res) => { res.status(410).json({ error: '파일 권한은 계정 관리에서 설정하세요' }) })

  app.get('/admin/users', requireRole('owner'), (_req, res) => {
    res.json(
      listUsers().map(({ email, record }) => ({
        email,
        role: record.role,
        mustChangePassword: record.mustChangePassword,
        createdAt: record.createdAt,
      })),
    )
  })

  app.post('/admin/users', requireRole('owner'), (req, res) => {
    const { email: rawEmail, role } = req.body as { email?: unknown; role?: unknown }
    const email = normalizeEmail(rawEmail)
    if (!isValidEmail(email)) {
      res.status(400).json({ error: '올바른 이메일을 입력하세요' })
      return
    }
    if (!isAccountRole(role)) {
      res.status(400).json({ error: '올바른 역할을 선택하세요' })
      return
    }
    if (getUser(email)) {
      res.status(409).json({ error: '이미 등록된 이메일입니다' })
      return
    }
    const tempPassword = generateTempPassword()
    const now = Date.now()
    upsertUser(email, { hash: hashPassword(tempPassword), role, mustChangePassword: true, createdAt: now, passwordChangedAt: now })
    res.json({ ok: true, email, tempPassword })
  })

  app.put('/admin/users/:email/role', requireRole('owner'), (req, res) => {
    const email = normalizeEmail(req.params.email)
    const { role } = req.body as { role?: unknown }
    if (!isAccountRole(role)) {
      res.status(400).json({ error: '올바른 역할을 선택하세요' })
      return
    }
    const user = getUser(email)
    if (!user) {
      res.status(404).json({ error: '등록되지 않은 사용자입니다' })
      return
    }
    if (user.role === 'owner' && role !== 'owner' && listUsers().filter(entry => entry.record.role === 'owner').length === 1) {
      res.status(400).json({ error: '마지막 owner의 역할은 변경할 수 없습니다' }); return
    }
    upsertUser(email, { ...user, role })
    accessChanges.emit('change')
    res.json({ ok: true })
  })

  app.use('/tmux', requireFeature('terminal'), createTmuxRouter(tmuxManager))

  // 호스트 자원 현황(프로파일링 팝업) — 서버가 도는 기계의 정보라 셸과 같은 역할로 묶는다
  app.get('/system-stats', requireFeature('system'), async (_req, res) => {
    try {
      res.json(await collectSystemStats())
    } catch (err) {
      handleError(res, err)
    }
  })

  // 에이전트 런타임 설치는 서버 머신에 실행 파일을 쓰는 작업 — 터미널과 같은 역할만.
  app.get('/agent-runtimes', requireAnyFeature('agent', 'terminal'), (_req, res) => {
    res.json({ runtimes: runtimeStatuses() })
  })

  app.get('/agent-runtimes/:id/account', requireFeature('agent'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    try { res.json({ account: await readRuntimeAccount(String(req.params.id)) }) }
    catch { res.status(400).json({ error: '지원하지 않는 런타임입니다' }) }
  })

  // terminal형 런타임은 통합 패널의 탭별 전용 tmux에서 공식 TUI 또는 기본 셸을 실행한다. 브라우저는
  // runtime·tab·cwd만 보내며 실행 방식과 실제 tmux 이름은 서버 등록표가 정한다(ADR 0117·0119).
  app.post('/agent-runtimes/:id/terminal/:tab', requireFeature('terminal'), (req, res, next) => req.params.id === 'tmux' ? next() : requireFeature('agent')(req, res, next), async (req, res) => {
    try {
      const cwd = resolveAgentCwd(typeof req.body?.cwd === 'string' ? req.body.cwd : '', WORKSPACE_ROOT)
      res.json({ ok: true, ...await startAgentTerminal(tmuxManager, String(req.params.id), String(req.params.tab), cwd) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.delete('/agent-runtimes/:id/terminal/:tab', requireFeature('terminal'), (req, res, next) => req.params.id === 'tmux' ? next() : requireFeature('agent')(req, res, next), async (req, res) => {
    try {
      await stopAgentTerminal(tmuxManager, String(req.params.id), String(req.params.tab))
      res.json({ ok: true })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/agent-runtimes/:id/install', requireFeature('agent'), async (req, res) => {
    try {
      res.json(await installRuntime(String(req.params.id)))
    } catch (err) {
      handleError(res, err)
    }
  })

  app.delete('/agent-runtimes/:id/install', requireFeature('agent'), async (req, res) => {
    try { res.json(await uninstallRuntime(String(req.params.id))) } catch (err) { handleError(res, err) }
  })

  app.post('/agent-runtimes/:id/logout', requireFeature('agent'), async (req, res) => {
    try { res.json(await logoutRuntime(String(req.params.id))) } catch (err) { handleError(res, err) }
  })

  // terminal auth는 사용자가 브라우저 안 tmux에서 직접 조작한다. 요청은 런타임·탭·노출된 method id만
  // 받고, 실제 실행 파일·인자는 ACP 세션 또는 런타임 등록표가 보관한 고정 spec에서 꺼낸다.
  app.post('/agent-runtimes/:id/auth/:method/run', requireFeature('agent'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const methodId = String(req.params.method)
      const tab = typeof req.body?.tab === 'string' ? req.body.tab : ''
      const cwd = resolveAgentCwd(req.body?.cwd ?? '', WORKSPACE_ROOT)
      if (!isRuntime(id) || !AGENT_TAB_ID.test(tab) || !methodId || methodId.length > 100) {
        res.status(400).json({ error: '로그인 요청이 올바르지 않습니다' })
        return
      }
      const spec = await terminalAuthFromHost(id, tab, cwd, methodId)
      const session = commandSessionName('agent-auth', `${id}:${tab}:${methodId}`)
      let running = (await tmuxManager.list()).some((item) => item.name === session)
      const previous = readAgentAuthTerminalStatus(id, tab, methodId, running, spec.completionFile)
      if (!running || previous.state !== 'running') {
        // 끝난 로그인 셸을 재사용하면 capture-pane에 남은 만료 URL을 새 로그인 주소로 오인한다.
        // 실패·성공한 세션은 새로 만들어 상태 파일과 화면 출력을 함께 초기화한다.
        if (running) await tmuxManager.kill(session)
        const command = prepareAgentAuthTerminal(id, tab, methodId, spec)
        await tmuxManager.runCommand(session, command, WORKSPACE_ROOT)
        running = true
      }
      const status = readAgentAuthTerminalStatus(id, tab, methodId, running, spec.completionFile)
      res.json({ ok: true, session, label: spec.label, running, ...status })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(400).json({ error: message })
    }
  })

  app.get('/agent-runtimes/:id/auth/:method/status', requireFeature('agent'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const methodId = String(req.params.method)
      const tab = typeof req.query.tab === 'string' ? req.query.tab : ''
      if (!isRuntime(id) || !AGENT_TAB_ID.test(tab) || !methodId || methodId.length > 100) {
        res.status(400).json({ error: '로그인 상태 요청이 올바르지 않습니다' })
        return
      }
      const session = commandSessionName('agent-auth', `${id}:${tab}:${methodId}`)
      const running = (await tmuxManager.list()).some((item) => item.name === session)
      const registered = isRuntimeLoginMethod(id, methodId) ? runtimeLoginSpec(id, methodId) : null
      const status = readAgentAuthTerminalStatus(id, tab, methodId, running, registered?.completionFile)
      if (registered?.surface === 'browser' && ['succeeded', 'failed', 'interrupted'].includes(status.state)) {
        await closeDomBrowserJob(authOf(req).email ?? '', session)
      }
      const output = running ? await tmuxManager.capture(session, 120) : ''
      const details = registered?.surface === 'browser' && registered.verificationHosts
        ? browserLoginDetailsFromOutput(output, registered.verificationHosts)
        : { verificationUrl: null, verificationCode: null }
      // 수동 승인 코드는 pane에 echo될 수 있다. 그 작업은 원문에서 실패 한 줄도 브라우저로 돌려주지 않는다.
      const errorMessage = status.state === 'failed' && !registered?.browserInput ? authFailureMessageFromOutput(output) : null
      res.json({ ...status, ...details, errorMessage })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 등록된 OAuth 작업이 출력한 URL만 일회성 서버 브라우저로 연다. 클라이언트가
  // 임의 URL을 보내지 않고, 이후 탐색은 일반 내부 브라우저와 같은 프로필에서 실행한다.
  app.post('/agent-runtimes/:id/auth/:method/browser', requireFeature('agent'), requireFeature('browser'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const methodId = String(req.params.method)
      const tab = typeof req.body?.tab === 'string' ? req.body.tab : ''
      if (!isRuntime(id) || !AGENT_TAB_ID.test(tab) || !methodId || methodId.length > 100) {
        res.status(400).json({ error: '로그인 브라우저 요청이 올바르지 않습니다' })
        return
      }
      const registered = isRuntimeLoginMethod(id, methodId) ? runtimeLoginSpec(id, methodId) : null
      if (registered?.surface !== 'browser' || !registered.verificationHosts) {
        res.status(400).json({ error: '이 로그인 방법은 내장 브라우저를 사용하지 않습니다' })
        return
      }
      const session = commandSessionName('agent-auth', `${id}:${tab}:${methodId}`)
      const running = (await tmuxManager.list()).some((item) => item.name === session)
      if (!running) {
        res.status(409).json({ error: '진행 중인 로그인 작업이 없습니다' })
        return
      }
      const output = await tmuxManager.capture(session, 120)
      const details = browserLoginDetailsFromOutput(output, registered.verificationHosts)
      if (!details.verificationUrl) {
        res.status(409).json({ error: '로그인 링크가 아직 준비되지 않았습니다' })
        return
      }
      res.json({
        url: details.verificationUrl,
        streamUrl: await createDomBrowserAuthSession(authOf(req).email ?? '', session, details.verificationUrl),
      })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 브라우저 OAuth가 돌려준 일회용 코드를 해당 고정 로그인 작업의 TTY에만 전달한다.
  // 값은 상태 파일·로그·이벤트·전사 어느 곳에도 저장하지 않는다.
  app.post('/agent-runtimes/:id/auth/:method/input', requireFeature('agent'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const methodId = String(req.params.method)
      const tab = typeof req.body?.tab === 'string' ? req.body.tab : ''
      const input = typeof req.body?.input === 'string' ? req.body.input.trim() : ''
      if (!isRuntime(id) || !AGENT_TAB_ID.test(tab) || !methodId || methodId.length > 100) {
        res.status(400).json({ error: '로그인 입력 요청이 올바르지 않습니다' })
        return
      }
      const registered = isRuntimeLoginMethod(id, methodId) ? runtimeLoginSpec(id, methodId) : null
      if (registered?.surface !== 'browser' || registered.browserInput !== 'authorization-code') {
        res.status(400).json({ error: '이 로그인 방법은 브라우저 입력을 받지 않습니다' })
        return
      }
      const hasControlCharacter = [...input].some((character) => {
        const code = character.charCodeAt(0)
        return code < 32 || code === 127
      })
      if (!input || input.length > 4096 || hasControlCharacter) {
        res.status(400).json({ error: '올바른 인증 코드를 입력하세요' })
        return
      }
      const session = commandSessionName('agent-auth', `${id}:${tab}:${methodId}`)
      const running = (await tmuxManager.list()).some((item) => item.name === session)
      if (!running) {
        res.status(409).json({ error: '진행 중인 로그인 작업이 없습니다' })
        return
      }
      await tmuxManager.sendInput(session, input)
      res.json({ ok: true })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 에이전트 창에서 고른 모델·권한을 런타임별 기본값으로 영속화한다. 저장 위치는 DATA_DIR이고,
  // 다음 session/new·session/load부터 공통 AgentSession 경로가 적용한다.
  app.get('/agent-defaults/:id', requireFeature('agent'), (req, res) => {
    try {
      res.json({ settings: readAgentDefault(String(req.params.id)) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/agent-defaults/:id', requireFeature('agent'), (req, res) => {
    try {
      res.json({ settings: writeAgentDefault(String(req.params.id), req.body) })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 런타임 설정 — 실행 파일·추가 인자·공급자 env(API 키·엔드포인트). 시크릿이므로 응답은 마스킹값이고
  // 전체 값은 절대 브라우저로 돌아오지 않는다. 저장 즉시 다음 spawn부터 적용된다.
  app.get('/agent-runtimes/:id/settings', requireFeature('agent'), (req, res) => {
    try {
      res.json({ settings: describeAgentSetting(String(req.params.id)) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/agent-runtimes/:id/settings', requireFeature('agent'), (req, res) => {
    try {
      writeAgentSetting(String(req.params.id), req.body)
      // 마스킹 뷰로 회신 — 이후 세션부터 새 spec이 적용된다
      res.json({ settings: describeAgentSetting(String(req.params.id)) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.delete('/agent-runtimes/:id/settings', requireFeature('agent'), (req, res) => {
    try {
      deleteAgentSetting(String(req.params.id))
      res.json({ ok: true })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 예약 에이전트 작업 — 임의 프롬프트가 무인 실행되는 표면이라 tmux와 동일하게 owner/manager만.
  // 손으로 쓴 크론 줄(otherLines)은 읽기 전용으로 함께 내려준다 — 여기서 지워지지 않는다는 걸 보이려고.
  // 실행은 잡 전용 tmux 세션에서 이뤄지므로 그 세션이 떠 있는지(running)도 함께 계산해 붙인다.
  const liveSessions = async () => new Set((await tmuxManager.list()).map((s) => s.name))

  app.get('/schedules', requireFeature('schedules'), async (_req, res) => {
    try {
      res.json({
        jobs: jobViews(readJobs(), await liveSessions()),
        otherLines: otherLines(await readCrontab()).filter((l) => l.trim() !== ''),
        runtimes: acpRuntimeList(),
      })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/schedules', requireFeature('schedules'), async (req, res) => {
    try {
      const { jobs } = req.body as { jobs?: unknown }
      const before = readJobs()
      const saved = await saveSchedules(jobs)
      // 지워진 잡의 세션은 탭 목록에도 안 뜨는 숨은 세션이라 여기서 정리하지 않으면 죽일 방법이 없다
      const live = await liveSessions()
      const kept = new Set(saved.map((j) => j.id))
      for (const job of before) {
        if (kept.has(job.id)) continue
        const session = jobSessionName(job.id)
        if (live.has(session)) await tmuxManager.kill(session).catch(() => {})
      }
      res.json({
        jobs: jobViews(saved, await liveSessions()),
        otherLines: otherLines(await readCrontab()).filter((l) => l.trim() !== ''),
        runtimes: acpRuntimeList(),
      })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 탭 대화에 한 번만 보내는 예약. cron 작업과 달리 원 ACP 세션을 이어서 쓴다.
  app.post('/agent/scheduled-prompts', requireFeature('agent'), (req, res) => {
    try {
      const body = req.body as Record<string, unknown>
      const cwd = resolveAgentCwd(typeof body.cwd === 'string' ? body.cwd : '', WORKSPACE_ROOT)
      res.json({ job: scheduleAgentPrompt({ ...body, cwd }) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/agent/scheduled-prompts', requireFeature('agent'), (req, res) => {
    try {
      const cwd = resolveAgentCwd(String(req.query.cwd ?? ''), WORKSPACE_ROOT)
      res.json({ jobs: listAgentScheduledPrompts({ runtime: req.query.runtime, tab: req.query.tab, cwd }) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.delete('/agent/scheduled-prompts/:id', requireFeature('agent'), (req, res) => {
    try {
      const cwd = resolveAgentCwd(String(req.query.cwd ?? ''), WORKSPACE_ROOT)
      const cancelled = cancelAgentScheduledPrompt({ id: req.params.id, runtime: req.query.runtime, tab: req.query.tab, cwd })
      if (!cancelled) return res.status(404).json({ error: '예약 메시지를 찾을 수 없습니다' })
      res.json({ ok: true })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/agent/scheduled-prompts/:id', requireFeature('agent'), (req, res) => {
    try {
      const body = req.body as Record<string, unknown>
      const cwd = resolveAgentCwd(typeof body.cwd === 'string' ? body.cwd : '', WORKSPACE_ROOT)
      res.json({ job: updateAgentScheduledPrompt({ ...body, id: req.params.id, cwd }) })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 에이전트셋 정의 — 새 에이전트 탭을 시작할 때 고르는 프리셋이다.
  app.get('/agent-sets', requireFeature('agent'), (_req, res) => {
    try {
      res.json({ sets: readSets(), runtimes: agentSetRuntimeList() })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/agent-sets', requireFeature('agent'), (req, res) => {
    try {
      const { sets } = req.body as { sets?: unknown }
      const saved = writeSets(sets)
      res.json({ sets: saved })
    } catch (err) {
      handleError(res, err)
    }
  })

  // "지금 실행" — 크론이 도는 것과 똑같이 잡 전용 세션에 에이전트 명령을 타이핑한다(같은 문자열).
  // 프롬프트·명령은 언제나 서버가 저장된 잡에서 만든다 — 요청 본문에서는 id만 받는다.
  app.post('/schedules/run', requireFeature('schedules'), async (req, res) => {
    try {
      const { id } = req.body as { id?: unknown }
      const job = typeof id === 'string' ? readJobs().find((j) => j.id === id) : undefined
      if (!job) {
        res.status(404).json({ error: '해당 예약 작업을 찾을 수 없습니다' })
        return
      }
      const session = jobSessionName(job.id)
      await tmuxManager.runCommand(session, agentCommand(job), jobCwd(job.project))
      res.json({ ok: true, session })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 명령어 버튼 — <프로젝트>/.mew/cmd-button.json 을 읽어 목록·실행 상태를 준다. 임의 명령 실행이므로
  // tmux와 동일하게 owner/manager만. 명령 문자열은 언제나 서버가 파일에서 읽고(요청 본문의 명령은 신뢰하지
  // 않음), 실행은 특수 프리픽스 세션(탭에서 숨겨짐)에서 프로젝트 폴더를 cwd로 이뤄진다.
  app.get('/cmd-buttons', requireFeature('terminal'), async (req, res) => {
    try {
      const project = projectOf(req)
      projectRoot(project) // 존재하는 프로젝트인지 확인(없으면 throw)
      const running = new Set((await tmuxManager.list()).map((s) => s.name))
      const buttons = readCmdButtons(project).map((b) => {
        const session = commandSessionName(project, b.name)
        return { name: b.name, command: b.command, oneShot: !!b.oneShot, session, running: running.has(session) }
      })
      res.json({ buttons })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 목록 전체를 통째로 저장한다(추가·수정·삭제 공통). 파일을 직접 고치는 것과 같은 자리에 쓰므로
  // 손편집과 UI 편집이 한 파일을 공유한다. 이름을 바꾸면 세션 이름 해시도 바뀌어 옛 실행 세션과의
  // 연결이 끊긴다(그 세션은 살아 있되 이 버튼에서는 더 이상 보이지 않는다).
  app.put('/cmd-buttons', requireFeature('terminal'), async (req, res) => {
    try {
      const project = projectOf(req)
      projectRoot(project) // 존재하는 프로젝트인지 확인(없으면 throw)
      const buttons = normalizeCmdButtons((req.body as { buttons?: unknown }).buttons)
      writeCmdButtons(project, buttons)
      const running = new Set((await tmuxManager.list()).map((s) => s.name))
      res.json({
        buttons: buttons.map((b) => {
          const session = commandSessionName(project, b.name)
          return { name: b.name, command: b.command, oneShot: !!b.oneShot, session, running: running.has(session) }
        }),
      })
    } catch (err) {
      if (err instanceof CmdButtonError) {
        res.status(400).json({ error: err.message })
        return
      }
      handleError(res, err)
    }
  })

  app.post('/cmd-buttons/run', requireFeature('terminal'), async (req, res) => {
    try {
      const project = projectOf(req)
      const root = projectRoot(project)
      const { name } = req.body as { name?: unknown }
      if (typeof name !== 'string' || !name) {
        res.status(400).json({ error: '버튼 이름이 없습니다' })
        return
      }
      const button = readCmdButtons(project).find((b) => b.name === name)
      if (!button) {
        res.status(404).json({ error: '해당 명령어 버튼을 찾을 수 없습니다' })
        return
      }
      const session = commandSessionName(project, button.name)
      // 일회성 명령은 끝나자마자 자기 세션을 스스로 닫는다 — 세션 이름은 SESSION_NAME_RE로 검증된
      // 값이라 셸에 그대로 이어 붙여도 안전하다
      const command = button.oneShot ? oneShotCommand(button.command, session) : button.command
      await tmuxManager.runCommand(session, command, root)
      res.json({ ok: true, session })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 터미널 명령어 버튼 — 프로젝트와 무관한 전역 목록(.data/term-button.json)이라 project 파라미터가
  // 없다. 실행은 서버가 하지 않는다: 클라이언트가 이미 열려 있는 tmux 세션의 WebSocket으로 직접
  // 타이핑해 보낸다(그 소켓 자체가 owner/manager 경계). 여기서는 목록만 읽고 쓴다.
  app.get('/term-buttons', requireFeature('terminal'), (_req, res) => {
    try {
      res.json({ buttons: readTermButtons() })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/term-buttons', requireFeature('terminal'), (req, res) => {
    try {
      const buttons = normalizeTermButtons((req.body as { buttons?: unknown }).buttons)
      writeTermButtons(buttons)
      res.json({ buttons })
    } catch (err) {
      if (err instanceof TermButtonError) {
        res.status(400).json({ error: err.message })
        return
      }
      handleError(res, err)
    }
  })

  // 숨김 목록 — 트리·검색·감시에서 건너뛸 이름들. 전역(.data/ignore.json)이고 모두의 화면을 바꾸므로
  // 터미널·명령어 버튼과 같은 owner/manager 경계에 둔다.
  app.get('/ignore', requireFeature('system'), (_req, res) => {
    res.json({ names: readIgnoreList(), defaults: DEFAULT_IGNORE, locked: LOCKED_IGNORE })
  })

  app.put('/ignore', requireFeature('system'), (req, res) => {
    try {
      const names = normalizeIgnoreList((req.body as { names?: unknown }).names)
      writeIgnoreList(names)
      // 살아 있는 감시자는 옛 규칙으로 만든 트리 서명을 들고 있어 새 규칙을 "변화 없음"으로 흘려버린다.
      // 접어두고 tree 신호를 보내면, 클라이언트가 새로 받아 갈 때 새 규칙으로 다시 등록된다.
      resetTreeWatchers()
      broadcast({ type: 'tree' })
      res.json({ names, defaults: DEFAULT_IGNORE, locked: LOCKED_IGNORE })
    } catch (err) {
      if (err instanceof IgnoreListError) {
        res.status(400).json({ error: err.message })
        return
      }
      handleError(res, err)
    }
  })

  // /db 데이터베이스 뷰 — 게스트에게 행 데이터가 새지 않도록 전 라우트 인증 필요(실시간 소켓 authorizeCollab과 동일 정책)
  app.use('/db', requireFeature('database'), createDbRouter())

  return app
}

function handleError(res: express.Response, err: unknown) {
  if (err instanceof UnsafePathError) {
    res.status(400).json({ error: err.message })
    return
  }
  if (err instanceof UnknownProjectError) {
    res.status(404).json({ error: err.message })
    return
  }
  if (err instanceof ConflictError) {
    res.status(409).json({ error: err.message })
    return
  }
  if (err instanceof ProjectNameError) {
    res.status(400).json({ error: err.message })
    return
  }
  if (err instanceof ScheduleError || err instanceof AgentSetError || err instanceof RuntimeInstallError || err instanceof AgentDefaultError || err instanceof AgentSettingError || err instanceof AgentCwdError || err instanceof AgentScheduledPromptError || err instanceof AgentTerminalError) {
    res.status(400).json({ error: err.message })
    return
  }
  if (err instanceof TodoError || err instanceof WorkspaceError) {
    res.status(400).json({ error: err.message })
    return
  }
  if (err instanceof DocsRepoError || err instanceof BrowseError) {
    res.status(400).json({ error: err.message })
    return
  }
  if (err instanceof GitWorkbenchError) {
    res.status(400).json({ error: err.message })
    return
  }
  if (err instanceof GitError) {
    // manager·owner가 직접 요청한 Git 작업의 충돌/dirty working tree 이유는 GUI에서 해결 판단에 필요하다.
    res.status(409).json({ error: err.message })
    return
  }
  if (err instanceof RagDisabledError || err instanceof RagUnavailableError) {
    res.status(503).json({ error: err.message })
    return
  }
  if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
    res.status(404).json({ error: 'Not found' })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'Internal error' })
}
