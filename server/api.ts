import express from 'express'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_PROJECT, isProtectedProject, listProjects, projectRoot, resolveProjectPath, UnknownProjectError, UnsafePathError, WORKSPACE_ROOT } from './paths.ts'
import { createProject, deleteProject, ProjectNameError, renameProject } from './projects.ts'
import { buildTree, isPathVisible } from './tree.ts'
import { flattenTextFiles, replaceInFile, searchInProject } from './search.ts'
import { commitFile, fileHistory, showAtCommit, showHeadContent } from './git.ts'
import { evaluateRules, isArchived } from './rules.ts'
import { copyFile, copyPathInto, createDocument, createFolder, renamePath, deletePath, writeFileInto, ConflictError } from './documents.ts'
import { lintContent } from './lint.ts'
import { parseTitle } from './frontmatter.ts'
import { noteAppWrite } from './appWrites.ts'
import { updateLinkLabelsFor } from './links.ts'
import { uploadAsset, R2NotConfiguredError } from './r2.ts'
import { createTmuxManager, createTmuxRouter } from '@mew/tmux-term/server'
import { CmdButtonError, commandSessionName, normalizeCmdButtons, readCmdButtons, writeCmdButtons } from './cmdButtons.ts'
import { normalizeTermButtons, readTermButtons, TermButtonError, writeTermButtons } from './termButtons.ts'
import { readTableLayout, TableLayoutError, writeTableLayout } from './tableLayout.ts'
import { ChatError, listChatFor, markChatRead, mentionedEmails, postChatMessage } from './chat.ts'
import { addComment, addThread, CommentsError, deleteComment, editComment, listThreads } from './comments.ts'
import { createDbRouter } from './db/routes.ts'
import { readProjectIcons, setProjectIcon } from './projectIcons.ts'
import { normalizeIconValue, SvgIconError } from './svgIcon.ts'
import { readProjectLayout, writeProjectLayout } from './projectLayout.ts'
import { DocsRepoError, exportDocs, importDocs } from './docsRepo.ts'
import { BrowseError, listDirs, resolveBrowsePath } from './fsBrowse.ts'
import { browserProxyFrameUrl } from './browserProxy.ts'
import { createTodo, deleteTodo, listTodos, TodoError, updateTodo, type TodoChange } from './todos.ts'
import { currentWorkspace, switchDocsRoot, switchWorkspace, WorkspaceError } from './workspace.ts'
import { collectSystemStats } from './sysStats.ts'
import { collectAndroidEnvStatus } from './androidEnv.ts'
import { listSkills } from './skills.ts'
import { readCrontab } from './crontab.ts'
import { agentCommand, jobCwd, jobSessionName, jobViews, otherLines, readJobs, saveSchedules, ScheduleError } from './schedules.ts'
import { AgentSetError, readSets, writeSets } from './agentSets.ts'
import { reloadSets } from './agentSetRunner.ts'
import { runtimeList } from './agentAcp.ts'
import { installRuntime, runtimeStatuses, RuntimeInstallError } from './agentRuntimeInstall.ts'
import { AgentDefaultError, readAgentDefault, writeAgentDefault } from './agentDefaults.ts'
import {
  DEFAULT_IGNORE,
  IgnoreListError,
  LOCKED_IGNORE,
  normalizeIgnoreList,
  readIgnoreList,
  writeIgnoreList,
} from './ignoreList.ts'
import { broadcast } from './presence.ts'
import { resetTreeWatchers, watchProjectTree } from './watcher.ts'
import { authOf, requireAuthenticated, requireRole, seesEveryFile } from './reqAuth.ts'
import {
  decorateTreeWithGuestAccess,
  filterTreeForGuest,
  isGuestEditable,
  isGuestViewable,
  listGuestVisibleProjects,
  setGuestRule,
} from './guestAccess.ts'
import {
  generateTempPassword,
  getUser,
  hashPassword,
  isAccountRole,
  isValidEmail,
  listUsers,
  normalizeEmail,
  upsertUser,
} from './auth.ts'

/** tmux 세션은 워크스페이스 루트에서 시작한다 */
export const tmuxManager = createTmuxManager({ cwd: WORKSPACE_ROOT })

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } })

/** 요청의 대상 프로젝트 — 쿼리(GET/DELETE) 또는 바디(POST/PUT), 없으면 docs */
function projectOf(req: express.Request): string {
  const fromQuery = req.query.project
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery
  const fromBody = (req.body as { project?: unknown } | null | undefined)?.project
  if (typeof fromBody === 'string' && fromBody) return fromBody
  return DEFAULT_PROJECT
}

/**
 * 방금 만들거나 옮긴 이 경로가 **그 사용자의 사이드바에는 안 뜨는지** — 파일 조작 응답에 실어 보낸다.
 * 클라이언트는 이걸로 "만들어졌는데 목록에 없다"는 조용한 실패 대신 그 자리에서 안내를 띄운다.
 * 조작 자체는 이미 성공했으므로 여기서 실패로 뒤집지 않는다(가시성은 인가 경계가 아니다 — tree.ts).
 */
function hiddenFromTree(req: express.Request, relPath: string, type: 'file' | 'dir' = 'file'): boolean {
  return !isPathVisible(projectOf(req), relPath, { showAll: seesEveryFile(authOf(req).role), type })
}

export function createApiApp() {
  const app = express()
  app.use(express.json({ limit: '10mb' }))

  /** 게스트가 이 경로를 볼 수 있는지 확인 — 아니면 403을 응답하고 false를 반환한다 */
  function requireGuestView(req: express.Request, res: express.Response, relPath: string): boolean {
    if (authOf(req).role !== 'guest') return true
    if (!isGuestViewable(projectOf(req), relPath)) {
      res.status(403).json({ error: '접근 권한이 없습니다' })
      return false
    }
    return true
  }

  /** 게스트가 이 경로를 편집할 수 있는지 확인 — 아니면 403을 응답하고 false를 반환한다 */
  function requireGuestEdit(req: express.Request, res: express.Response, relPath: string): boolean {
    if (authOf(req).role !== 'guest') return true
    if (!isGuestEditable(projectOf(req), relPath)) {
      res.status(403).json({ error: '편집 권한이 없습니다' })
      return false
    }
    return true
  }

  app.get('/projects', (req, res) => {
    const icons = readProjectIcons()
    const layout = readProjectLayout()
    const names = authOf(req).role === 'guest' ? listGuestVisibleProjects() : listProjects()
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

  // ── 브라우저 창: sandbox iframe용 짧은 프록시 URL 발급 ─────────────────────
  app.get('/browser-url', requireRole('manager', 'owner'), (req, res) => {
    try {
      const target = String(req.query.url ?? '')
      if (!target.trim()) {
        res.status(400).json({ error: '주소가 없습니다' })
        return
      }
      res.json({ url: browserProxyFrameUrl(target) })
    } catch (err) {
      handleError(res, err)
    }
  })

  // ── Android 패널: 무거운 emulator는 실행하지 않고, 로컬 도구 상태만 확인한다 ─────
  app.get('/android/status', requireRole('manager', 'owner'), async (_req, res) => {
    try {
      res.json(await collectAndroidEnvStatus())
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
  app.get('/workspace', requireRole('owner'), (_req, res) => {
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

  // ── docs 특별 레포와 워크스페이스 밖 폴더 고르기 (owner 전용) ────────────────
  // /fs/dirs는 워크스페이스 경계 밖을 그대로 보여준다 — 역할을 낮추지 말 것.
  app.get('/fs/dirs', requireRole('owner'), (req, res) => {
    try {
      res.json(listDirs(resolveBrowsePath(String(req.query.path ?? ''))))
    } catch (err) {
      handleError(res, err)
    }
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

  app.get('/tree', (req, res) => {
    try {
      const project = projectOf(req)
      const role = authOf(req).role
      // owner·manager는 걸러내지 않은 트리를 받는다 — 숨김 목록도 확장자 필터도 없다(seesEveryFile)
      const tree = buildTree(project, { showAll: seesEveryFile(role) })
      // 이 프로젝트를 보는 세션이 있으니 트리 감시를 지연 등록한다 — 터미널·다른 세션이 만든 파일이
      // 사이드바에 바로 반영되도록(멱등). docs는 부팅 때부터 감시 중. 게스트는 감시를 유발하지 않는다.
      if (role !== 'guest') watchProjectTree(project)
      res.json(role === 'guest' ? filterTreeForGuest(project, tree) : decorateTreeWithGuestAccess(project, tree))
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/skills', requireRole('owner', 'manager'), (_req, res) => {
    try {
      res.json({ skills: listSkills() })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/file', (req, res) => {
    const relPath = String(req.query.path ?? '')
    const project = projectOf(req)
    if (!requireGuestView(req, res, relPath)) return
    try {
      const absPath = resolveProjectPath(project, relPath)
      const content = fs.readFileSync(absPath, 'utf-8')
      const editable = authOf(req).role === 'guest' ? isGuestEditable(project, relPath) : true
      res.json({ path: relPath, content, editable })
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
    if (!requireGuestView(req, res, relPath)) return
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
  async function writeAndCommit(project: string, relPath: string, content: string, action: 'add' | 'update', commitMessage?: string) {
    const absPath = resolveProjectPath(project, relPath)
    fs.mkdirSync(path.dirname(absPath), { recursive: true })
    fs.writeFileSync(absPath, content, 'utf-8')
    // 협업 브리지가 이 쓰기를 "우리 메아리"로 걸러내게 기록 (외부 AI 변경만 방에 주입되도록)
    noteAppWrite(absPath, content)

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
          linkUpdates = updateLinkLabelsFor(relPath, newTitle)
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
    if (!requireGuestEdit(req, res, relPath)) return
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
        const result = await writeAndCommit(project, relPath, content, isNew ? 'add' : 'update')
        res.json({ ok: true, commit: result })
      } else {
        fs.mkdirSync(path.dirname(absPath), { recursive: true })
        fs.writeFileSync(absPath, content, 'utf-8')
        // 자동저장(비커밋) 경로 — 협업 브리지가 메아리로 무시하도록 기록
        noteAppWrite(absPath, content)
        res.json({ ok: true, commit: null })
      }
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/file-revert', async (req, res) => {
    const { path: relPath, hash } = req.body as { path?: unknown; hash?: unknown }
    const project = projectOf(req)
    try {
      if (typeof relPath !== 'string' || !relPath || typeof hash !== 'string' || !hash) {
        res.status(400).json({ error: 'path와 hash가 필요합니다' })
        return
      }
      if (!requireGuestEdit(req, res, relPath)) return
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
      const result = await writeAndCommit(project, relPath, content, 'update', `${project}: revert ${relPath} to ${hash.slice(0, 7)}`)
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
      if (!requireGuestEdit(req, res, relPath)) return
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

  // 프로젝트 전체 파일 내용 검색(Ctrl+Shift+F) — 트리 가시성·게스트 필터를 그대로 거친 파일만 훑는다
  app.get('/search', (req, res) => {
    const project = projectOf(req)
    const query = String(req.query.q ?? '')
    const opts = { regex: req.query.regex === '1', caseSensitive: req.query.case === '1' }
    try {
      if (!query) {
        res.json({ results: [], truncated: false })
        return
      }
      const tree = buildTree(project)
      const visible = authOf(req).role === 'guest' ? filterTreeForGuest(project, tree) : tree
      const files = flattenTextFiles(visible)
      res.json(searchInProject(project, files, query, opts))
    } catch (err) {
      if (err instanceof SyntaxError) {
        res.status(400).json({ error: '잘못된 정규식입니다' })
        return
      }
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
    const { srcPath, destDir } = req.body as { srcPath?: unknown; destDir?: unknown }
    const project = projectOf(req)
    try {
      if (typeof srcPath !== 'string' || !srcPath || typeof destDir !== 'string') {
        res.status(400).json({ error: 'srcPath와 destDir가 필요합니다' })
        return
      }
      if (project === DEFAULT_PROJECT && (isArchived(srcPath) || isArchived(destDir))) {
        res.status(403).json({ error: 'archives/ 문서는 복사할 수 없습니다' })
        return
      }
      const newRelPath = copyPathInto(project, srcPath, destDir)
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
    if (!requireGuestView(req, res, relPath)) return
    try {
      const absPath = resolveProjectPath(projectOf(req), relPath)
      // serve.ts의 전역 X-Frame-Options: DENY는 유지하되, PDF를 같은 오리진 iframe에
      // 담을 수 있어야 하므로 이 라우트만 SAMEORIGIN으로 완화한다
      res.setHeader('X-Frame-Options', 'SAMEORIGIN')
      // dotfiles: 'allow' — express의 send는 기본으로 점으로 시작하는 폴더·파일을 통째로 404 낸다.
      // 이 워크스페이스는 문서가 `.mew/docs/` 밑에 산다: 그냥 두면 그 아래 PDF·xlsx가 전부 500이었다
      // ({"error":"Internal error"}). 접근 판정은 이미 위에서 끝났다 —
      // resolveProjectPath가 루트 탈출과 .git·node_modules·.data를 막고, requireGuestView가 게스트를 건다
      res.sendFile(absPath, { dotfiles: 'allow' }, (err) => {
        if (err && !res.headersSent) handleError(res, err)
      })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/download', (req, res) => {
    const relPath = String(req.query.path ?? '')
    if (!requireGuestView(req, res, relPath)) return
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
      const commit = await commitFile(project, [oldPath, newPath], 'rename', `${project}: rename ${oldPath} → ${newPath}`)
      const type = fs.statSync(resolveProjectPath(project, newPath)).isDirectory() ? 'dir' : 'file'
      res.json({ ok: true, relPath: newPath, commit, hidden: hiddenFromTree(req, newPath, type) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.post('/new-folder', requireAuthenticated, (req, res) => {
    const { relPath } = req.body as { relPath: string }
    const project = projectOf(req)
    try {
      if (project === DEFAULT_PROJECT && isArchived(relPath)) {
        res.status(403).json({ error: 'archives/ 밑에는 새 폴더를 만들 수 없습니다' })
        return
      }
      createFolder(project, relPath)
      res.json({ ok: true, relPath, hidden: hiddenFromTree(req, relPath, 'dir') })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/rules', (req, res) => {
    const relPath = String(req.query.path ?? '')
    const project = projectOf(req)
    if (!requireGuestView(req, res, relPath)) return
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
    if (!requireGuestView(req, res, relPath)) return
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
  app.get('/chat', requireAuthenticated, (req, res) => {
    res.json(listChatFor(authOf(req).email ?? '', memberEmails()))
  })

  app.post('/chat', requireAuthenticated, (req, res) => {
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
  app.post('/chat/read', requireAuthenticated, (req, res) => {
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

  // 외부 링크 미리보기(제목·설명) — 브라우저 CORS를 피해 서버가 대신 가져온다.
  app.get('/link-preview', requireAuthenticated, async (req, res) => {
    const url = String(req.query.url ?? '')
    if (!/^https?:\/\//i.test(url)) {
      res.status(400).json({ error: '올바른 http(s) URL이 아닙니다' })
      return
    }
    try {
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; mew-link-preview)' },
      })
      const html = (await resp.text()).slice(0, 200_000)
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() || null
      const metaTag = /<meta[^>]+(?:name|property)=["'](?:og:description|description)["'][^>]*>/i.exec(html)?.[0] ?? null
      const description = metaTag ? /content=["']([^"']*)["']/i.exec(metaTag)?.[1] || null : null
      res.json({
        title: title ? decodeEntities(title) : null,
        description: description ? decodeEntities(description) : null,
      })
    } catch {
      // 타임아웃·네트워크 실패 등 — 미리보기 없음으로 응답 (클라이언트는 URL만 표시)
      res.json({ title: null, description: null })
    }
  })

  app.post('/upload', requireAuthenticated, upload.single('file'), async (req, res) => {
    const file = req.file
    if (!file) {
      res.status(400).json({ error: '파일이 없습니다' })
      return
    }
    try {
      const url = await uploadAsset(file.buffer, file.originalname, file.mimetype)
      res.json({ url, name: file.originalname, mimetype: file.mimetype })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 바깥에서 사이드바(파일 트리)로 끌어다 놓은 파일 — R2가 아니라 프로젝트 폴더의 그 자리에 그대로 저장한다.
  // multer가 먼저 돌아 destDir·project 같은 텍스트 필드도 req.body에 채워 준다.
  app.post('/upload-into', requireAuthenticated, upload.single('file'), async (req, res) => {
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
      const relPath = writeFileInto(project, destDir, file.originalname, file.buffer)
      const commit = await commitFile(project, relPath, 'add', `${project}: upload ${relPath}`)
      res.json({ ok: true, relPath, commit, hidden: hiddenFromTree(req, relPath) })
    } catch (err) {
      handleError(res, err)
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
      if (!relPath.endsWith('.md')) {
        res.status(400).json({ error: '.md 파일만 생성할 수 있습니다' })
        return
      }
      if (!title.trim()) {
        res.status(400).json({ error: '제목을 입력하세요' })
        return
      }
      createDocument(project, relPath, title)
      const commit = await commitFile(project, relPath, 'add')
      res.json({ ok: true, relPath, commit, hidden: hiddenFromTree(req, relPath) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/guest-access', requireAuthenticated, (req, res) => {
    const { path: relPath, view, edit } = req.body as { path?: unknown; view?: unknown; edit?: unknown }
    const project = projectOf(req)
    try {
      if (typeof relPath !== 'string' || typeof view !== 'boolean' || typeof edit !== 'boolean') {
        res.status(400).json({ error: 'path, view, edit가 필요합니다' })
        return
      }
      resolveProjectPath(project, relPath) // 경로 검증(트래버설·미존재 방지)
      setGuestRule(project, relPath, view, edit)
      res.json({ ok: true })
    } catch (err) {
      handleError(res, err)
    }
  })

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
    upsertUser(email, { ...user, role })
    res.json({ ok: true })
  })

  app.use('/tmux', requireRole('owner', 'manager'), createTmuxRouter(tmuxManager))

  // 호스트 자원 현황(프로파일링 팝업) — 서버가 도는 기계의 정보라 셸과 같은 역할로 묶는다
  app.get('/system-stats', requireRole('owner', 'manager'), async (_req, res) => {
    try {
      res.json(await collectSystemStats())
    } catch (err) {
      handleError(res, err)
    }
  })

  // 에이전트 런타임 설치는 서버 머신에 실행 파일을 쓰는 작업 — 터미널과 같은 역할만.
  app.get('/agent-runtimes', requireRole('owner', 'manager'), (_req, res) => {
    res.json({ runtimes: runtimeStatuses() })
  })

  app.post('/agent-runtimes/:id/install', requireRole('owner', 'manager'), async (req, res) => {
    try {
      res.json(await installRuntime(String(req.params.id)))
    } catch (err) {
      handleError(res, err)
    }
  })

  // 에이전트 창에서 고른 모델·권한을 런타임별 기본값으로 영속화한다. 저장 위치는 DATA_DIR이고,
  // 다음 session/new·session/load부터 공통 AgentSession 경로가 적용한다.
  app.get('/agent-defaults/:id', requireRole('owner', 'manager'), (req, res) => {
    try {
      res.json({ settings: readAgentDefault(String(req.params.id)) })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/agent-defaults/:id', requireRole('owner', 'manager'), (req, res) => {
    try {
      res.json({ settings: writeAgentDefault(String(req.params.id), req.body) })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 예약 에이전트 작업 — 임의 프롬프트가 무인 실행되는 표면이라 tmux와 동일하게 owner/manager만.
  // 손으로 쓴 크론 줄(otherLines)은 읽기 전용으로 함께 내려준다 — 여기서 지워지지 않는다는 걸 보이려고.
  // 실행은 잡 전용 tmux 세션에서 이뤄지므로 그 세션이 떠 있는지(running)도 함께 계산해 붙인다.
  const liveSessions = async () => new Set((await tmuxManager.list()).map((s) => s.name))

  app.get('/schedules', requireRole('owner', 'manager'), async (_req, res) => {
    try {
      res.json({
        jobs: jobViews(readJobs(), await liveSessions()),
        otherLines: otherLines(await readCrontab()).filter((l) => l.trim() !== ''),
        runtimes: runtimeList(),
      })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/schedules', requireRole('owner', 'manager'), async (req, res) => {
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
        runtimes: runtimeList(),
      })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 에이전트셋 정의 — 임의 프롬프트가 무인 실행되는 표면이라 예약 작업·터미널과 같은 게이트.
  // 돌아가는 상태(켜짐·큐·작업)는 여기 없다 — 그건 WS(/api/agentset/ws)가 흘린다.
  app.get('/agent-sets', requireRole('owner', 'manager'), (_req, res) => {
    try {
      res.json({ sets: readSets(), runtimes: runtimeList() })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/agent-sets', requireRole('owner', 'manager'), (req, res) => {
    try {
      const { sets } = req.body as { sets?: unknown }
      const saved = writeSets(sets)
      // 러너를 새 정의에 맞춘다 — 지워진 셋은 접히고, 런타임·모델·역할이 바뀐 셋은 다음 작업에 새로 뜬다
      reloadSets()
      res.json({ sets: saved })
    } catch (err) {
      handleError(res, err)
    }
  })

  // "지금 실행" — 크론이 도는 것과 똑같이 잡 전용 세션에 에이전트 명령을 타이핑한다(같은 문자열).
  // 프롬프트·명령은 언제나 서버가 저장된 잡에서 만든다 — 요청 본문에서는 id만 받는다.
  app.post('/schedules/run', requireRole('owner', 'manager'), async (req, res) => {
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
  app.get('/cmd-buttons', requireRole('owner', 'manager'), async (req, res) => {
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
  app.put('/cmd-buttons', requireRole('owner', 'manager'), async (req, res) => {
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

  app.post('/cmd-buttons/run', requireRole('owner', 'manager'), async (req, res) => {
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
      const command = button.oneShot ? `${button.command}; tmux kill-session -t ${session}` : button.command
      await tmuxManager.runCommand(session, command, root)
      res.json({ ok: true, session })
    } catch (err) {
      handleError(res, err)
    }
  })

  // 터미널 명령어 버튼 — 프로젝트와 무관한 전역 목록(.data/term-button.json)이라 project 파라미터가
  // 없다. 실행은 서버가 하지 않는다: 클라이언트가 이미 열려 있는 tmux 세션의 WebSocket으로 직접
  // 타이핑해 보낸다(그 소켓 자체가 owner/manager 경계). 여기서는 목록만 읽고 쓴다.
  app.get('/term-buttons', requireRole('owner', 'manager'), (_req, res) => {
    try {
      res.json({ buttons: readTermButtons() })
    } catch (err) {
      handleError(res, err)
    }
  })

  app.put('/term-buttons', requireRole('owner', 'manager'), (req, res) => {
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
  app.get('/ignore', requireRole('owner', 'manager'), (_req, res) => {
    res.json({ names: readIgnoreList(), defaults: DEFAULT_IGNORE, locked: LOCKED_IGNORE })
  })

  app.put('/ignore', requireRole('owner', 'manager'), (req, res) => {
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
  app.use('/db', requireAuthenticated, createDbRouter())

  return app
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
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
  if (err instanceof ScheduleError || err instanceof AgentSetError || err instanceof RuntimeInstallError || err instanceof AgentDefaultError) {
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
  if (err instanceof R2NotConfiguredError) {
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
