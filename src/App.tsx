import { defaultCapabilities, type Feature } from '../shared/access-policy'
import { writeBrowserStorage } from '@mew/ui/browser-storage'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  editorApi,
  fetchAuthStatus,
  fetchMewUpdateStatus,
  fetchRootProjectTabs,
  fetchWorkspaceUi,
  fetchProjects,
  fetchWorkspace,
  fetchTreeV1,
  isArchivedPath,
  revertFileToCommit,
  runMewAction,
  setProject,
  saveRootProjectTabs,
  saveWorkspaceUi,
  switchWorkspace,
  type AuthStatus,
  type MewUpdateStatus,
  type TreeNode,
  type WorkspaceUiState,
} from './api/client'
import { RootProjectTabs } from './components/RootProjectTabs'
import { OpenProjectDialog } from './components/OpenProjectDialog'
import { DocsSettingsModal } from './components/DocsSettingsModal'
import { HeaderMenu, type HeaderMenuItem } from './components/HeaderMenu'
import { FabMenu } from './components/FabMenu'
import { Mewcat } from './components/Mewcat'
import { ServerFileExplorer } from './components/ServerFileExplorer'
import { LoginPage } from './components/LoginPage'
import { SettingsModal } from './components/SettingsModal'
import { AdminSettingsModal } from './components/AdminSettingsModal'
import { DatabaseListModal } from './components/DatabaseListModal'
import { SystemStatsModal } from './components/SystemStatsModal'
import { ScheduleModal } from './components/ScheduleModal'
import { SidebarCreateButtons } from './components/sidebar-create-buttons'
import { useSidebarCreate } from './hooks/use-sidebar-create'
import { FileTree, type TreePersistenceState } from './components/FileTree'
import { CommandButtonMenu } from './components/CommandButtonMenu'
import { ProjectIcon } from './components/ProjectIcon'
import { SearchPanel } from './components/SearchPanel'
import type { SearchMatch } from './api/client'
import { AgentPanel } from './components/AgentPanel'
import { BrowserPanel } from './components/BrowserPanel'
import { DockWorkspace, DockPanel, type DockHandle } from './components/DockWorkspace'
import type { DockState } from './utils/dock-layout'
import { AndroidPanel } from './components/AndroidPanel'
import { ChatPanel } from './components/ChatPanel'
import { FileHistoryModal } from './components/FileHistoryModal'
import { dispatchFocusedShortcut, getBinding, matchesShortcut } from '@mew/shortcuts'
import { ConfirmDialog, hasDirPathDrag, hasPathDrag, pathFromDrag, useToast } from '@mew/ui'
import { EditorPane, type PaneHandle } from './components/EditorPane'
import { TermButtonBar } from './components/TermButtonBar'
import { mediaKind } from './utils/media'
import { setContentIdentity, setContentWorkspace, clearFileContentCache } from './utils/contentCache'
import { useTabs, type StoredTabs } from './hooks/useTabs'
import { dropZoneAt, paneIds, type DropSide, type DropZone } from './utils/paneTree'
import { usePresence } from './hooks/usePresence'
import { usePanelWidth } from './hooks/usePanelWidth'
import { outsideTerminal } from './utils/terminalFocus'
import {
  WORKSPACE_PANEL_IDS,
  bringMobilePanelToFront,
  closeMobilePanel,
  restoreMobilePanelStack,
  selectMobilePanel,
  type MobileForeground,
  type WorkspacePanelId,
} from './utils/mobile-panel-stack'
import { pickRefTarget, type RefPanel } from './utils/refTarget'
import { WORKSPACE_PROJECT } from './utils/active-project'
import { useWorkspacePanelDismissals } from './hooks/use-panel-dismissals'
import { useI18n } from './i18n'
import { applyFontPreferences, loadFontPreferences, normalizeFontPreferences, saveFontPreferences } from './utils/fontPreferences'
import { loadAccentColor, applyAccentColor, saveAccentColor, type AccentColor } from './utils/accentColor'
import { loadMewcatSkin, saveMewcatSkin, type MewcatSkinSelection } from './utils/mewcatSkin'
import { externalTabPath, isExternalTabPath } from './utils/externalFiles'
import { loadSidebarState, saveSidebarState } from './utils/sidebarState'
import { GitPanel } from './components/git-panel'
import { RemoteDesktop } from './components/remote-desktop'
import type { GitPanelState } from './utils/git-panel-state'
import { normalizeDirectoryChildren, normalizeTreeCenterAnchor } from './utils/treePersistence'

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen().catch(() => {})
}

const isDesktop = () => window.matchMedia('(min-width: 768px)').matches

const fetchTreeEntries = (project?: string, path = '') => fetchTreeV1(project, path).then((response) => response.entries)

function mobileForegroundPanelKey(rootProjectPath: string): string {
  return `mew:mobile-foreground-panel:${rootProjectPath}`
}

function loadMobileForegroundPanel(rootProjectPath: string): MobileForeground | null {
  try {
    const value = localStorage.getItem(mobileForegroundPanelKey(rootProjectPath))
    if (value === 'editor') return value
    return WORKSPACE_PANEL_IDS.includes(value as WorkspacePanelId) ? value as WorkspacePanelId : null
  } catch {
    return null
  }
}

function saveMobileForegroundPanel(rootProjectPath: string | null, foreground: MobileForeground): void {
  try {
    if (rootProjectPath) writeBrowserStorage(mobileForegroundPanelKey(rootProjectPath), foreground)
  } catch {
    // 다음 접속의 전면 창 기억이 실패해도 지금 선택한 파일은 에디터로 전달한다.
  }
}

type Theme = 'dark' | 'light'
const THEME_KEY = 'mew:theme'
const TOC_KEY = 'mew:toc-open'
const LEGACY_TMUX_OPEN_KEY = 'mew:tmux-open'
const TERMINAL_OPEN_KEY = 'mew:terminal-open'
/** 에이전트 창이 열려 있었는지 — 터미널과 같이 프로젝트와 무관한 화면 상태다(세션 스코프가 워크스페이스다) */
const AGENT_OPEN_KEY = 'mew:agent-open'
const BROWSER_OPEN_KEY = 'mew:browser-open'
const GIT_OPEN_KEY = 'mew:git-open'
const ANDROID_OPEN_KEY = 'mew:android-open'
const OPEN_PROJECTS_KEY = 'mew:open-project-paths'
const ROOT_PROJECT_ICONS_KEY = 'mew:root-project-icons'
/** 지울 수 없는 기본 프로젝트 — 보고 있던 프로젝트가 사라지면 여기로 빠진다 */
const DEFAULT_PROJECT = 'docs'
type AccountSidebarState = { docsExpanded: boolean; expandedSubprojects: string[] }
type AccountTreeStates = Record<string, TreePersistenceState>

function accountSidebar(value: unknown): AccountSidebarState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const state = value as Partial<AccountSidebarState>
  if (typeof state.docsExpanded !== 'boolean' || !Array.isArray(state.expandedSubprojects)) return null
  return { docsExpanded: state.docsExpanded, expandedSubprojects: state.expandedSubprojects.filter((path): path is string => typeof path === 'string') }
}

function accountTrees(value: unknown): AccountTreeStates {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: AccountTreeStates = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const state = raw as { openDirs?: unknown; scrollTop?: unknown; centerAnchor?: unknown; directoryChildren?: unknown }
    if (!Array.isArray(state.openDirs) || typeof state.scrollTop !== 'number') continue
    result[key] = {
      openDirs: state.openDirs.filter((path): path is string => typeof path === 'string'),
      scrollTop: Math.max(0, state.scrollTop),
      directoryChildren: normalizeDirectoryChildren(state.directoryChildren),
      centerAnchor: normalizeTreeCenterAnchor(state.centerAnchor),
    }
  }
  return result
}

function accountTabs(value: unknown): Record<string, StoredTabs> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, state]) => state && typeof state === 'object' && !Array.isArray(state))) as Record<string, StoredTabs>
}
function loadTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
}

function loadOpenProjectPaths(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(OPEN_PROJECTS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string' && value !== '') : []
  } catch {
    return []
  }
}

function loadRootProjectIcons(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ROOT_PROJECT_ICONS_KEY) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, string> : {}
  } catch {
    return {}
  }
}

function projectLabel(projectPath: string | null): string {
  if (!projectPath) return 'Project'
  return projectPath.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || projectPath
}

// 터미널이 열려 있었는지는 프로젝트와 무관한 화면 상태다(tmux 세션은 워크스페이스 하나뿐).
// 예전에는 프로젝트별 탭 저장분 안에 함께 들어 있었으므로 그쪽도 한 번 봐준다.
interface EditorAppProps {
  /** 로그인 상태 — 로그인하지 않았으면 role: 'guest', email: null */
  auth: AuthStatus
  onLoggedOut: () => void
  onRequestLogin: () => void
  onProfileChanged: (profile: { displayName: string; avatarDataUrl: string | null }) => void
}

function EditorApp({ auth, onLoggedOut, onRequestLogin, onProfileChanged }: EditorAppProps) {
  const { t } = useI18n()
  const { role, email: authEmail } = auth
  const isGuest = role === 'guest'
  const isOwner = role === 'owner'
  const caps = useMemo(() => auth.capabilities ?? defaultCapabilities(role), [auth.capabilities, role])
  const canUseTerminal = caps.terminal

  // 사용자에게 보이는 프로젝트는 서버가 현재 연 루트 폴더다. 내부 API 식별자는 호환을 위해
  // `.workspace`를 유지하고 Documents를 열 때만 `docs`로 전환한다.
  const [project, setActiveProject] = useState(() => {
    const initial = isGuest ? DEFAULT_PROJECT : WORKSPACE_PROJECT
    setProject(initial)
    return initial
  })
  const [rootProjectPath, setRootProjectPath] = useState<string | null>(null)
  const rootProjectPathRef = useRef(rootProjectPath)
  rootProjectPathRef.current = rootProjectPath
  const [workspaceUi, setWorkspaceUi] = useState<WorkspaceUiState>({})
  const [workspaceUiLoaded, setWorkspaceUiLoaded] = useState(false)
  const [workspaceUiRevision, setWorkspaceUiRevision] = useState(0)
  // 절대경로 탭 목록은 owner UI에만 노출한다. manager는 셸 권한상 현재 경로를 볼 수 있지만 다른
  // 브라우저 사용자가 남긴 owner 전용 목록까지 물려받지는 않는다.
  const [openProjectPaths, setOpenProjectPaths] = useState<string[]>(() => (isOwner ? loadOpenProjectPaths() : []))
  const [rootProjectIcons, setRootProjectIcons] = useState<Record<string, string>>(() => (isOwner ? loadRootProjectIcons() : {}))
  const [rootProjectTabsSynced, setRootProjectTabsSynced] = useState(!isOwner)
  const [openProjectDialog, setOpenProjectDialog] = useState(false)
  const [closeProjectPath, setCloseProjectPath] = useState<string | null>(null)
  const [switchingRootProject, setSwitchingRootProject] = useState(false)
  const fullscreenGuardRef = useRef(false)

  const [tree, setTree] = useState<TreeNode[]>([])
  // 사이드바는 활성 편집 스코프와 무관하게 Documents와 루트 내용을 함께 보여 준다.
  const [rootTree, setRootTree] = useState<TreeNode[]>([])
  const [subprojectIcons, setSubprojectIcons] = useState<Record<string, string>>({})
  const [docsTree, setDocsTree] = useState<TreeNode[]>([])
  const [docsExpanded, setDocsExpanded] = useState(false)
  const [expandedSubprojects, setExpandedSubprojects] = useState<Set<string>>(() => new Set())
  // 루트가 바뀌는 렌더에서는 이전 프로젝트 상태를 새 키에 쓰지 않도록, 복원 한 프레임을 건너뛴다.
  const sidebarStateRestorePendingRef = useRef<string | null>(null)
  const sidebarStateLoadedRootRef = useRef<string | null>(null)
  const chromeStateLoadedRootRef = useRef<string | null>(null)
  const chromeStateRestorePendingRef = useRef<string | null>(null)
  // 모바일 전면 창은 화면 크기 의존 상태라 계정 원장이 아니라 이 기기에만 남긴다.
  const mobilePanelStackRestorePendingRef = useRef<string | null>(null)
  const mobilePanelStackRestoredRootRef = useRef<string | null>(null)
  const [subprojectTrees, setSubprojectTrees] = useState<Record<string, TreeNode[]>>({})
  const [loadingSubprojects, setLoadingSubprojects] = useState<Set<string>>(new Set())
  const [treeInvalidation, setTreeInvalidation] = useState<{ n: number; project: string; version: number; parents: string[] }>({ n: 0, project: '', version: 0, parents: [] })
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop)
  // 터미널·에이전트의 기능 권한과 열림 상태는 독립이다.
  const dockRef = useRef<DockHandle>(null)
  const [terminalOpen, setTerminalOpen] = useState(() => canUseTerminal && (localStorage.getItem(TERMINAL_OPEN_KEY) !== null ? localStorage.getItem(TERMINAL_OPEN_KEY) === '1' : localStorage.getItem(LEGACY_TMUX_OPEN_KEY) === '1' || localStorage.getItem(AGENT_OPEN_KEY) === '1'))
  const [agentOpen, setAgentOpen] = useState(() => caps.agent && localStorage.getItem(AGENT_OPEN_KEY) === '1')
  // 브라우저 창은 별도 기능 권한으로 검사한다.
  const browserMounted = useRef(false)
  const [browserOpen, setBrowserOpen] = useState(() => caps.browser && localStorage.getItem(BROWSER_OPEN_KEY) === '1')
  if (browserOpen) browserMounted.current = true
  const gitMounted = useRef(false)
  const [gitOpen, setGitOpen] = useState(() => caps.git && localStorage.getItem(GIT_OPEN_KEY) === '1')
  const [remoteDesktopOpen, setRemoteDesktopOpen] = useState(false)
  if (gitOpen) gitMounted.current = true
  // Android 패널 — emulator는 외부 도구라 여기서는 상태 점검과 loopback gateway 표시만 한다
  const [androidOpen, setAndroidOpen] = useState(() => caps.android && localStorage.getItem(ANDROID_OPEN_KEY) === '1')
  // 멤버 채팅 창(Alt+C)은 채팅 기능 권한을 따른다.
  const [chatOpen, setChatOpen] = useState(false)
  // 모바일 보조창은 종류별 예외 없이 이 스택 하나로 전면 순서와 뒤로가기 순서를 공유한다.
  // 새 패널을 WORKSPACE_PANEL_IDS에 넣으면 아래 registry가 빠진 연결을 타입 오류로 알려 준다.
  const [mobilePanelStack, setMobilePanelStack] = useState<WorkspacePanelId[]>(() =>
    WORKSPACE_PANEL_IDS.filter((panel) => {
      if (panel === 'sidebar') return sidebarOpen
      if (panel === 'chat') return chatOpen
      if (panel === 'agent') return agentOpen
      if (panel === 'terminal') return terminalOpen
      if (panel === 'browser') return browserOpen
      if (panel === 'git') return gitOpen
      return androidOpen
    }),
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [dbListOpen, setDbListOpen] = useState(false)
  const [sysStatsOpen, setSysStatsOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [mewUpdate, setMewUpdate] = useState<MewUpdateStatus | null>(null)
  const [mewUpdating, setMewUpdating] = useState(false)

  const workspacePanelOpen = useMemo(() => ({
    sidebar: sidebarOpen,
    chat: chatOpen,
    agent: agentOpen,
    terminal: terminalOpen,
    browser: browserOpen,
    git: gitOpen,
    android: androidOpen,
  } satisfies Record<WorkspacePanelId, boolean>), [
    sidebarOpen, chatOpen, agentOpen, terminalOpen, browserOpen, gitOpen, androidOpen,
  ])
  const workspacePanelSetters = useMemo(() => ({
    sidebar: setSidebarOpen,
    chat: setChatOpen,
    agent: setAgentOpen,
    terminal: setTerminalOpen,
    browser: setBrowserOpen,
    git: setGitOpen,
    android: setAndroidOpen,
  } satisfies Record<WorkspacePanelId, (open: boolean) => void>), [])

  const mobileForegroundPanel = mobilePanelStack.at(-1) ?? null

  const openWorkspacePanel = useCallback((panel: WorkspacePanelId) => {
    workspacePanelSetters[panel](true)
    setMobilePanelStack((stack) => bringMobilePanelToFront(stack, panel))
    if (!isDesktop()) saveMobileForegroundPanel(rootProjectPath, panel)
  }, [rootProjectPath, workspacePanelSetters])

  const closeWorkspacePanel = useCallback((panel: WorkspacePanelId) => {
    workspacePanelSetters[panel](false)
    setMobilePanelStack((stack) => {
      const next = closeMobilePanel(stack, panel)
      if (!isDesktop()) saveMobileForegroundPanel(rootProjectPath, next.at(-1) ?? 'editor')
      return next
    })
  }, [rootProjectPath, workspacePanelSetters])

  const toggleWorkspacePanel = useCallback((panel: WorkspacePanelId) => {
    const open = workspacePanelOpen[panel]
    if (isDesktop()) {
      workspacePanelSetters[panel](!open)
      setMobilePanelStack((stack) => open
        ? closeMobilePanel(stack, panel)
        : bringMobilePanelToFront(stack, panel))
      return
    }
    const next = selectMobilePanel(mobilePanelStack, panel, open)
    workspacePanelSetters[panel](next.open)
    setMobilePanelStack(next.stack)
    saveMobileForegroundPanel(rootProjectPath, next.stack.at(-1) ?? 'editor')
  }, [mobilePanelStack, rootProjectPath, workspacePanelOpen, workspacePanelSetters])

  const bringWorkspacePanelToFront = useCallback((panel: WorkspacePanelId) => {
    if (!isDesktop() && mobileForegroundPanel !== panel) {
      setMobilePanelStack((stack) => bringMobilePanelToFront(stack, panel))
      saveMobileForegroundPanel(rootProjectPath, panel)
    }
  }, [mobileForegroundPanel, rootProjectPath])

  const closeAllWorkspacePanels = useCallback(() => {
    for (const panel of WORKSPACE_PANEL_IDS) workspacePanelSetters[panel](false)
    setMobilePanelStack([])
    if (!isDesktop()) saveMobileForegroundPanel(rootProjectPath, 'editor')
  }, [rootProjectPath, workspacePanelSetters])

  // 모바일에서 파일을 열 때는 패널의 열림 상태를 바꾸지 않는다. 그래야 화면을 데스크톱으로
  // 넓혔을 때 열린 패널들이 그대로 남는다. 보조 패널 스택만 비워 에디터를 전면에 둔다.
  const showMobileEditor = useCallback(() => {
    if (!isDesktop()) {
      setMobilePanelStack([])
      saveMobileForegroundPanel(rootProjectPath, 'editor')
    }
  }, [rootProjectPath])

  const mobilePanelLayer = useCallback((panel: WorkspacePanelId) => {
    // 스택에 전면 패널이 없으면 에디터를 보여 준다. 패널은 열려 있는 채라 데스크톱으로
    // 전환하면 다시 보이며, 모바일에서 해당 도구 버튼을 누르면 즉시 다시 전면으로 온다.
    return mobileForegroundPanel === panel ? 'z-[31]' : 'max-md:hidden z-30'
  }, [mobileForegroundPanel])
  // docs 탭을 꾹 누르면 뜨는 폴더 가져오기/내보내기 창 — owner 전용
  const [docsSettingsOpen, setDocsSettingsOpen] = useState(false)
  // 채팅 멘션·에이전트 답변의 파일 링크 — 다른 프로젝트면 옮긴 다음 렌더에서 파일과 줄을 연다
  const [pendingOpen, setPendingOpen] = useState<{ project: string; path: string; line: number | null } | null>(null)
  const [serverFileExplorerOpen, setServerFileExplorerOpen] = useState(false)
  const [tocOpen, setTocOpen] = useState(() => localStorage.getItem(TOC_KEY) !== '0')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [fontPreferences, setFontPreferences] = useState(loadFontPreferences)
  const [accentColor, setAccentColor] = useState<AccentColor>(loadAccentColor)
  const [mewcatSkin, setMewcatSkin] = useState<MewcatSkinSelection>(loadMewcatSkin)
  const [searchFocusSignal] = useState(0)
  // 사이드바 뷰: 탐색기 · 파일명 검색(Ctrl+P) · 파일 내용 검색(Ctrl+Shift+F) · 명령
  const [sidebarView, setSidebarView] = useState<'files' | 'search' | 'content-search' | 'commands'>('files')
  const [projectSearchFocus, setProjectSearchFocus] = useState(0)
  const sidebarCreate = useSidebarCreate(rootProjectPath, (scope) => {
    setSidebarView('files')
    if (scope === 'docs') setDocsExpanded(true)
    else if (scope.startsWith('subproject:')) setExpandedSubprojects(current => new Set([...current, scope.slice('subproject:'.length)]))
  })
  // Alt+N 새 파일 신호 — parentPath가 있으면 그 폴더에(에디터 포커스였을 때 활성 문서 폴더),
  // null이면 FileTree가 자기 선택 항목 기준으로 이름 입력을 연다
  const [newFileSignal, setNewFileSignal] = useState<{ n: number; parentPath: string | null }>({ n: 0, parentPath: null })
  // 사이드바에서 지금 문서 자리를 드러내라는 신호(부모 폴더 펼치기 + 스크롤). 경로가 아니라 신호인 이유는
  // **이미 열려 있는 탭을 다시 눌렀을 때**다 — 그때는 활성 경로가 그대로라 경로만 보면 아무 일도 안 일어난다
  const [revealSignal, setRevealSignal] = useState(0)
  // 탭을 끌고 있는 동안 그림자가 뜰 칸과 자리 — 손을 떼면 그 자리가 실제 분할·이동이 된다
  const [dropTarget, setDropTarget] = useState<{ paneId: string; zone: DropZone } | null>(null)
  // 칸별 에디터 손잡이(선택 영역·찾기·되돌리기)와 본문 영역 DOM(드롭 자리 판정)
  const paneHandles = useRef(new Map<string, PaneHandle>())
  const paneEls = useRef(new Map<string, HTMLElement>())
  // 탭 줄도 드롭 자리다 — 다른 칸의 탭 줄에 놓으면 그 칸으로 **옮기기**(분할 아님)
  const paneBarEls = useRef(new Map<string, HTMLElement>())
  // 파일 검색어는 FileTree가 소유하지만, Esc로 사이드바를 닫을지는 App의 오버레이 스택이 결정한다.
  const sidebarSearchCancelRef = useRef<(() => boolean) | null>(null)
  // 프로젝트 검색 결과를 클릭해 파일을 연 뒤, 그 파일 내용이 로드되면 해당 위치로 점프시키기 위한 대기 정보
  const [pendingReveal, setPendingReveal] = useState<{ path: string; line: number; query?: string } | null>(null)

  // 흐름을 끊지 않는 짧은 안내 — 사이드바 작업 결과가 내 트리에 안 뜨거나, 파일을 못 열었을 때
  const { toast, showToast } = useToast()

  const refreshMewUpdate = useCallback(async (announce = false) => {
    try {
      const status = await fetchMewUpdateStatus(true)
      setMewUpdate(status)
      if (!announce) return
      if (status.error) showToast(`업데이트를 확인하지 못했습니다: ${status.error}`)
      else if (status.available && !status.canUpdate) showToast('새 버전이 있습니다. 터미널에서 업데이트해 주세요.')
      else if (status.available) showToast(`origin/main에 새 커밋 ${status.behind}개가 있습니다`)
      else showToast('Mew가 최신 버전입니다')
    } catch (err) {
      if (announce) showToast(err instanceof Error ? err.message : String(err))
    }
  }, [showToast])

  useEffect(() => {
    if (caps.system) void refreshMewUpdate()
  }, [caps.system, refreshMewUpdate])

  const startMewUpdate = useCallback(async () => {
    if (!mewUpdate?.available) {
      await refreshMewUpdate(true)
      return
    }
    if (!mewUpdate.canUpdate) {
      showToast(mewUpdate.error ?? '터미널에서 업데이트해 주세요.')
      return
    }
    setMewUpdating(true)
    try {
      await runMewAction('update')
      showToast('업데이트 중…')
    } catch (err) {
      setMewUpdating(false)
      showToast(err instanceof Error ? err.message : String(err))
    }
  }, [mewUpdate, refreshMewUpdate, showToast])

  useEffect(() => {
    if (!mewUpdating) return
    let alive = true
    const poll = async () => {
      try {
        const status = await fetchMewUpdateStatus(false)
        if (!alive) return
        setMewUpdate(status)
        if (status.running || status.job?.state === 'queued' || status.job?.state === 'running') return
        if (status.job?.state === 'succeeded') {
          location.reload()
          return
        }
        if (status.job?.state === 'failed') {
          setMewUpdating(false)
          showToast(status.job.message ?? '업데이트에 실패했습니다. 실행 로그를 확인하세요.')
        }
      } catch {
        // 업데이트 중에는 서버가 한 번 재시작된다. 새 서버가 뜰 때까지 계속 확인한다.
      }
    }
    void poll()
    const timer = window.setInterval(poll, 1_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [mewUpdating, showToast])

  const loadWorkspaceTreeChildren = useCallback((path: string) => fetchTreeEntries(WORKSPACE_PROJECT, path), [])
  const loadDocsTreeChildren = useCallback((path: string) => fetchTreeEntries(DEFAULT_PROJECT, path), [])

  useEffect(() => {
    if (!rootProjectPath || isGuest) {
      setWorkspaceUi({})
      setWorkspaceUiLoaded(isGuest)
      return
    }
    let alive = true
    setWorkspaceUiLoaded(false)
    void fetchWorkspaceUi(rootProjectPath)
      .then(({ state }) => {
        if (!alive) return
        setWorkspaceUi(state ?? {})
        setWorkspaceUiRevision((revision) => revision + 1)
        setWorkspaceUiLoaded(true)
      })
      .catch(console.error)
    return () => { alive = false }
  }, [isGuest, rootProjectPath])

  useEffect(() => {
    if (!rootProjectPath || isGuest || !workspaceUiLoaded) return
    const timer = window.setTimeout(() => {
      void saveWorkspaceUi(rootProjectPath, workspaceUi).catch(console.error)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [isGuest, rootProjectPath, workspaceUi, workspaceUiLoaded])

  useEffect(() => {
    if (!workspaceUiLoaded) return
    if (sidebarStateLoadedRootRef.current === rootProjectPath) return
    const saved = accountSidebar(workspaceUi.sidebar)
    const state = saved ?? loadSidebarState(rootProjectPath)
    if (!saved && rootProjectPath && !isGuest) setWorkspaceUi((previous) => ({ ...previous, sidebar: state }))
    sidebarStateLoadedRootRef.current = rootProjectPath
    sidebarStateRestorePendingRef.current = rootProjectPath
    setDocsExpanded(state.docsExpanded)
    setExpandedSubprojects(new Set(state.expandedSubprojects))
  }, [isGuest, rootProjectPath, workspaceUi.sidebar, workspaceUiLoaded])

  useEffect(() => {
    if (!rootProjectPath || !workspaceUiLoaded || sidebarStateLoadedRootRef.current !== rootProjectPath) return
    if (sidebarStateRestorePendingRef.current === rootProjectPath) {
      sidebarStateRestorePendingRef.current = null
      return
    }
    saveSidebarState(rootProjectPath, { docsExpanded, expandedSubprojects: [...expandedSubprojects] })
    if (!isGuest) setWorkspaceUi((previous) => ({ ...previous, sidebar: { docsExpanded, expandedSubprojects: [...expandedSubprojects] } }))
  }, [docsExpanded, expandedSubprojects, isGuest, rootProjectPath, workspaceUiLoaded])

  const refreshTree = useCallback((signal?: { project?: string; version?: number; parents?: string[] }) => {
    if (signal?.project && signal.parents) {
      setTreeInvalidation((previous) => ({
        n: previous.n + 1,
        project: signal.project!,
        version: signal.version ?? previous.version,
        parents: signal.parents!,
      }))
      const jobs: Promise<unknown>[] = []
      if (signal.parents.includes('')) {
        if (signal.project === WORKSPACE_PROJECT) {
          const request = fetchTreeEntries(WORKSPACE_PROJECT)
          jobs.push(request.then(setRootTree))
          if (project === WORKSPACE_PROJECT) jobs.push(request.then(setTree))
        } else if (signal.project === DEFAULT_PROJECT) {
          const request = fetchTreeEntries(DEFAULT_PROJECT)
          jobs.push(request.then(setDocsTree))
          if (project === DEFAULT_PROJECT) jobs.push(request.then(setTree))
        } else if (project === signal.project) {
          jobs.push(fetchTreeEntries(signal.project).then(setTree))
        }
      }
      if (signal.project === WORKSPACE_PROJECT) {
        for (const parent of signal.parents) {
          if (subprojectTrees[parent] === undefined) continue
          jobs.push(fetchTreeEntries(WORKSPACE_PROJECT, parent).then((entries) => {
            setSubprojectTrees((previous) => ({ ...previous, [parent]: entries }))
          }))
        }
      }
      return Promise.all(jobs).then(() => undefined).catch(console.error)
    }
    const workspace = fetchTreeEntries(WORKSPACE_PROJECT)
    const docs = fetchTreeEntries(DEFAULT_PROJECT)
    void workspace.then(setRootTree).catch(console.error)
    void docs.then(setDocsTree).catch(console.error)
    if (project === WORKSPACE_PROJECT) return workspace.then(setTree).catch(console.error)
    if (project === DEFAULT_PROJECT) return docs.then(setTree).catch(console.error)
    return fetchTreeEntries(project).then(setTree).catch(console.error)
  }, [project, subprojectTrees])

  useEffect(() => {
    void fetchProjects()
      .then((projects) => setSubprojectIcons(Object.fromEntries(
        projects.flatMap(({ name, icon }) => icon ? [[name, icon] as const] : []),
      )))
      .catch(console.error)
  }, [rootProjectPath])

  // 서버 상태가 비어 있을 때만 이 브라우저의 기존 localStorage를 최초 값으로 올린다. 시크릿 창의
  // 빈 저장소가 이미 쓰고 있던 계정 상태를 덮어쓰지 않도록, 내려받기 전에는 저장하지 않는다.
  useEffect(() => {
    if (!isOwner) return
    let alive = true
    void fetchRootProjectTabs()
      .then(({ state }) => {
        if (!alive) return
        if (state) {
          setOpenProjectPaths(state.paths)
          setRootProjectIcons(state.icons)
        }
        setRootProjectTabsSynced(true)
      })
      .catch(console.error)
    return () => { alive = false }
  }, [isOwner])

  useEffect(() => {
    if (!isOwner) return
    writeBrowserStorage(OPEN_PROJECTS_KEY, JSON.stringify(openProjectPaths))
    writeBrowserStorage(ROOT_PROJECT_ICONS_KEY, JSON.stringify(rootProjectIcons))
    if (!rootProjectTabsSynced) return
    void saveRootProjectTabs({ paths: openProjectPaths, icons: rootProjectIcons }).catch(console.error)
  }, [isOwner, openProjectPaths, rootProjectIcons, rootProjectTabsSynced])

  const rememberProjectPath = useCallback((projectPath: string) => {
    setOpenProjectPaths((previous) => {
      const next = [...new Set([...previous, projectPath])]
      return next
    })
  }, [])

  const changeRootProjectIcon = useCallback((projectPath: string, icon: string) => {
    setRootProjectIcons((previous) => {
      const next = { ...previous }
      if (icon) next[projectPath] = icon
      else delete next[projectPath]
      return next
    })
  }, [])

  const applyWorkspace = useCallback((info: { path: string }) => {
    // 서버 API의 `.workspace`/`docs` 이름은 모든 루트에서 같으므로, 절대 경로를 클라이언트
    // 탭·본문 캐시의 실제 경계로 사용한다.
    setProject(WORKSPACE_PROJECT)
    setContentWorkspace(info.path)
    setActiveProject(WORKSPACE_PROJECT)
    if (info.path !== rootProjectPathRef.current) setWorkspaceUiLoaded(false)
    setRootProjectPath(info.path)
    // 계정 UI·탭 복원을 기다리지 않고, 워크스페이스를 받은 첫 렌더부터 직전 모바일
    // 전면 화면을 올린다. 그렇지 않으면 빈 에디터의 자동 사이드바가 잠깐 보인다.
    if (!isDesktop()) {
      const foreground = loadMobileForegroundPanel(info.path)
      setMobilePanelStack(foreground && foreground !== 'editor' ? [foreground] : [])
      if (foreground && foreground !== 'editor') workspacePanelSetters[foreground](true)
    }
    rememberProjectPath(info.path)
    setTree([])
    setRootTree([])
    setDocsTree([])
    setSubprojectTrees({})
    setLoadingSubprojects(new Set())
    setExpandedSubprojects(new Set())
    setPendingOpen(null)
  }, [rememberProjectPath, workspacePanelSetters])

  const handleWorkspaceBroadcast = useCallback(() => {
    void fetchWorkspace().then(applyWorkspace).catch(console.error)
  }, [applyWorkspace])

  const openRootProject = useCallback(async (projectPath: string) => {
    rememberProjectPath(projectPath)
    setProject(WORKSPACE_PROJECT)
    if (projectPath === rootProjectPath) {
      setActiveProject(WORKSPACE_PROJECT)
      setOpenProjectDialog(false)
      return
    }
    setSwitchingRootProject(true)
    try {
      const info = await switchWorkspace(projectPath)
      applyWorkspace(info)
      setOpenProjectDialog(false)
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
    } finally {
      setSwitchingRootProject(false)
    }
  }, [applyWorkspace, rememberProjectPath, rootProjectPath, showToast])

  const closeRootProject = useCallback(async (projectPath: string) => {
    const paths = [...new Set(openProjectPaths)].filter((path) => path !== projectPath)
    if (paths.length === 0) return
    setCloseProjectPath(null)
    setOpenProjectPaths(paths)
    setRootProjectIcons((previous) => {
      const next = { ...previous }
      delete next[projectPath]
      return next
    })
    if (projectPath === rootProjectPath) await openRootProject(paths.at(-1)!)
  }, [openProjectPaths, openRootProject, rootProjectPath])

  /**
   * 프로젝트 전환 — 페이지 이동이 아니다. client.ts의 모듈 값을 **먼저 동기로** 바꾼 뒤 리렌더를
   * 걸어야, 이번 렌더에서 나가는 요청들이 전부 새 프로젝트로 간다.
   */
  const switchProject = useCallback((name: string) => {
    setProject(name)
    setActiveProject(name)
  }, [])

  const syncedAccountTabs = useMemo(() => accountTabs(workspaceUi.tabs), [workspaceUi.tabs])
  const saveAccountTabs = useCallback((tabProject: string, state: StoredTabs) => {
    if (isGuest) return
    setWorkspaceUi((previous) => ({ ...previous, tabs: { ...accountTabs(previous.tabs), [tabProject]: state } }))
  }, [isGuest])

  const {
    hydrated: tabsHydrated,
    panes,
    layout,
    focusedPaneId,
    focusPane,
    tabs,
    activePath,
    activeTab,
    setActivePath,
    openFile,
    openExternalFile,
    pinTab,
    reorderTabs,
    setTabViewMode,
    updateTabContent,
    saveCurrentTab,
    applyRevertedContent,
    closeTab,
    moveTabToPane,
    splitEmptyPane,
    remapPaths,
    removePaths,
  } = useTabs(
    project,
    refreshTree,
    showToast,
    rootProjectPath ?? undefined,
    syncedAccountTabs,
    saveAccountTabs,
    workspaceUiLoaded,
  )

  const hasOpenFiles = panes.some((pane) => pane.tabs.length > 0)
  useEffect(() => {
    // 복원 전에는 항상 빈 칸으로 한 번 렌더된다. 저장된 파일 탭이 실제로 복원된 뒤 판정해야
    // 파일이 있는 프로젝트에서 사이드바가 잘못 열리지 않는다.
    // 첫 렌더에는 아직 어느 루트 프로젝트의 상태를 읽을지 모른다. 이때 사이드바를
    // 기본으로 열면 저장된 전면 패널이 도착하기 전 잠깐 번쩍인다.
    if (!tabsHydrated || hasOpenFiles || !rootProjectPath) return
    // 빈 에디터의 첫 진입점은 사이드바지만, 모바일에서 직전 전면 상태를 따로 기억한
    // 경우에는 그 상태를 덮지 않는다. `editor`도 명시 상태라 빈 스택과 구별한다.
    if (!isDesktop() && loadMobileForegroundPanel(rootProjectPath) !== null) return
    openWorkspacePanel('sidebar')
  }, [project, tabsHydrated, hasOpenFiles, openWorkspacePanel, rootProjectPath])

  const registerPaneHandle = useCallback((id: string, handle: PaneHandle | null) => {
    if (handle) paneHandles.current.set(id, handle)
    else paneHandles.current.delete(id)
  }, [])

  const registerPaneElement = useCallback((id: string, el: HTMLElement | null) => {
    if (el) paneEls.current.set(id, el)
    else paneEls.current.delete(id)
  }, [])

  const registerPaneTabBar = useCallback((id: string, el: HTMLElement | null) => {
    if (el) paneBarEls.current.set(id, el)
    else paneBarEls.current.delete(id)
  }, [])

  const registerSidebarSearchCancel = useCallback((cancel: (() => boolean) | null) => {
    sidebarSearchCancelRef.current = cancel
  }, [])

  /** 지금 포커스된 칸의 에디터 — 커밋·찾기·되돌리기·터미널 붙여넣기가 가리키는 곳 */
  const focusedEditor = useCallback(() => paneHandles.current.get(focusedPaneId) ?? null, [focusedPaneId])

  const hitAt = (els: Map<string, HTMLElement>, x: number, y: number) => {
    for (const [id, el] of els) {
      const rect = el.getBoundingClientRect()
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return { id, el, rect }
    }
    return null
  }

  /**
   * 이 좌표에 놓으면 무엇이 되는지. 본문 가장자리는 분할, 본문 가운데와 **탭 줄**은 그 칸으로 옮기기다 —
   * 탭 줄에서는 자리를 따지지 않는다(줄 안에서 끄는 건 순서 바꾸기이므로 제 칸이면 아무 일도 없다).
   */
  const handleTabDragMove = useCallback((paneId: string, path: string, x: number, y: number) => {
    dockRef.current?.preview(`editor:${paneId}`, path, x, y)
  }, [])

  /**
   * 사이드바 **파일** 드래그가 이 좌표에서 분할 드롭이 되는지 — 탭 드래그와 같은 가장자리 규칙이다.
   * 가운데는 기존 뜻(에디터에 경로 입력)을 지키러 가로채지 않고, 폴더는 분할 대상이 아니다.
   * contains 검사는 모바일에서 사이드바가 칸 위를 fixed로 덮을 때 좌표만으로 오인하는 것을 막는다.
   */
  const pathDropTargetAt = (e: React.DragEvent): { paneId: string; zone: DropSide } | null => {
    if (!hasPathDrag(e.dataTransfer) || hasDirPathDrag(e.dataTransfer)) return null
    const hit = hitAt(paneEls.current, e.clientX, e.clientY)
    if (!hit || !hit.el.contains(e.target as Node)) return null
    const zone = dropZoneAt(hit.rect, e.clientX, e.clientY)
    return zone === 'center' ? null : { paneId: hit.id, zone }
  }

  const handlePathDragOver = (e: React.DragEvent) => {
    if (!hasPathDrag(e.dataTransfer)) return
    const target = pathDropTargetAt(e)
    if (target) {
      // preventDefault가 있어야 drop 자체가 발생한다 — 가장자리에서만 허용해 가운데는 에디터에 넘긴다
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
    setDropTarget(target)
  }

  const handlePathDrop = (e: React.DragEvent) => {
    const target = pathDropTargetAt(e)
    if (!target) return
    setDropTarget(null)
    const path = pathFromDrag(e.dataTransfer)
    if (!path) return
    // 캡처 단계에서 끊어야 ProseMirror의 드롭(경로 텍스트 입력)이 뒤따라 돌지 않는다
    e.preventDefault()
    e.stopPropagation()
    const paneId = splitEmptyPane(target.paneId, target.zone)
    dockRef.current?.placeEditor(paneId, target.paneId, target.zone)
    openFile(path, { paneId, preview: false, forceNewTab: true })
  }

  const handleTabDrop = useCallback((paneId: string, path: string, x: number, y: number) => {
    dockRef.current?.drop(`editor:${paneId}`, path, x, y)
  }, [])
  const handleDockEditorDrop = (path: string, source: string, target: string | null) => {
    const destination = target ?? splitEmptyPane(source, 'right')
    moveTabToPane(path, source, destination)
    return destination
  }
  const saveDockLayout = useCallback((dock: DockState) => setWorkspaceUi((previous) => ({ ...previous, dock })), [])
  const saveGitPanelState = useCallback((git: GitPanelState) => setWorkspaceUi((previous) => ({ ...previous, git })), [])

  // 경로별로 지금 몇 개의 세션이 이 문서를 "포커스"하고 있는지 (열어만 둔 탭은 안 셈)
  // + 서버 watcher의 트리 변경 알림 — 다른 세션·에이전트가 만든 파일도 사이드바에 바로 반영
  const tabPresence = usePresence(
    project,
    activePath && !isExternalTabPath(activePath) ? activePath : null,
    authEmail,
    refreshTree,
    handleWorkspaceBroadcast,
  )

  const { width: sidebarWidth, startResize: startSidebarResize } = usePanelWidth('mew:sidebar-width', {
    min: 180,
    max: 480,
    initial: 256,
  })
  const { width: androidWidth, startResize: startAndroidResize } = usePanelWidth('mew:android-panel-width', {
    min: 380,
    max: 1200,
    initial: 760,
    invert: true,
  })

  // Esc·안드로이드 뒤로가기로 열린 것을 한 겹씩 닫는다 — 모달·팝업도 같은 스택에 등록돼 있어
  // (useOverlayDismiss) 그쪽이 떠 있으면 언제나 먼저 닫히고, 패널은 마지막에 닫힌다.
  // App이 직접 소유하는 보조 패널은 여기 한 번에 등록한다. 모달·드롭다운은 각 컴포넌트가 같은 전역
  // 오버레이 스택에 등록하므로, Esc·모바일 뒤로가기는 가장 나중에 연 창 하나만 닫는다.
  useWorkspacePanelDismissals({
    sidebar: {
      open: sidebarOpen,
      close: () => closeWorkspacePanel('sidebar'),
      // 검색 중이면 첫 Esc는 FileTree가 소비한다. 검색이 비어 있을 때 다음 Esc가 패널을 닫는다.
      closeOnEscape: () => !(sidebarSearchCancelRef.current?.() ?? false),
    },
    chat: { open: chatOpen, close: () => closeWorkspacePanel('chat') },
    terminal: { open: terminalOpen, close: () => closeWorkspacePanel('terminal'), closeOnEscape: outsideTerminal },
    agent: { open: agentOpen, close: () => closeWorkspacePanel('agent'), closeOnEscape: outsideTerminal },
    browser: { open: browserOpen, close: () => closeWorkspacePanel('browser') },
    git: { open: gitOpen, close: () => closeWorkspacePanel('git') },
    android: { open: androidOpen, close: () => closeWorkspacePanel('android') },
  }, mobileForegroundPanel)

  const activeRelativePath = activeTab?.path ?? null

  // Ctrl+L 참조는 **마지막으로 연 보조창 하나**에만 간다(예전엔 열려 있는 창 전부가 받아 적었다).
  // 여는 순간을 기억해 두고, 그 창이 닫혀 있으면 지금 열려 있는 다른 창으로 흘려보낸다.
  const lastPanelRef = useRef<RefPanel | null>(null)
  // 플로팅 핸들의 "현재 창 탭" 명령이 가리키는 마지막 탭형 창.
  // 핸들을 누르면 DOM 포커스가 옮겨가므로 포커스 대신 포인터 사용 기록을 따로 둔다.
  const activeTabbedSurfaceRef = useRef<'editor' | 'agent' | 'terminal' | 'browser' | 'git' | 'sidebar'>('editor')
  const [gitNextTabSignal, setGitNextTabSignal] = useState(0)
  const [gitPreviousTabSignal, setGitPreviousTabSignal] = useState(0)
  const [browserNextTabSignal, setBrowserNextTabSignal] = useState(0)
  const [browserPreviousTabSignal, setBrowserPreviousTabSignal] = useState(0)
  const [agentNextTabSignal, setAgentNextTabSignal] = useState(0)
  const [agentPreviousTabSignal, setAgentPreviousTabSignal] = useState(0)
  useEffect(() => {
    if (isDesktop()) return
    if (mobileForegroundPanel === 'agent' || mobileForegroundPanel === 'terminal') {
      activeTabbedSurfaceRef.current = mobileForegroundPanel
      lastPanelRef.current = mobileForegroundPanel
    } else if (mobileForegroundPanel === 'browser' || mobileForegroundPanel === 'git') {
      activeTabbedSurfaceRef.current = mobileForegroundPanel
    } else if (mobileForegroundPanel === 'sidebar') {
      activeTabbedSurfaceRef.current = 'sidebar'
    } else if (mobileForegroundPanel === 'chat') {
      lastPanelRef.current = 'chat'
    }
  }, [mobileForegroundPanel])
  useEffect(() => {
    if (agentOpen) {
      lastPanelRef.current = 'agent'
      activeTabbedSurfaceRef.current = 'agent'
    }
  }, [agentOpen])
  useEffect(() => { writeBrowserStorage(TERMINAL_OPEN_KEY, terminalOpen ? '1' : '0') }, [terminalOpen])
  useEffect(() => { if (terminalOpen) { lastPanelRef.current = 'terminal'; activeTabbedSurfaceRef.current = 'terminal' } }, [terminalOpen])
  useEffect(() => { if (browserOpen) activeTabbedSurfaceRef.current = 'browser' }, [browserOpen])
  useEffect(() => { writeBrowserStorage(GIT_OPEN_KEY, gitOpen ? '1' : '0'); if (gitOpen) activeTabbedSurfaceRef.current = 'git' }, [gitOpen])
  useEffect(() => {
    if (sidebarOpen) activeTabbedSurfaceRef.current = 'sidebar'
  }, [sidebarOpen])
  useEffect(() => {
    if (chatOpen) lastPanelRef.current = 'chat'
  }, [chatOpen])

  const switchSidebarTab = useCallback((direction: 'next' | 'previous') => {
    const views: typeof sidebarView[] = canUseTerminal
      ? ['files', 'search', 'content-search', 'commands']
      : ['files', 'search', 'content-search']
    const index = views.indexOf(sidebarView)
    const nextIndex = direction === 'next'
      ? (index + 1) % views.length
      : (index - 1 + views.length) % views.length
    const nextView = views[nextIndex]
    setSidebarView(nextView)
    if (nextView === 'search' || nextView === 'content-search') setProjectSearchFocus((value) => value + 1)
  }, [canUseTerminal, sidebarView])

  const switchCurrentWindowTabRight = useCallback(() => {
    let surface = activeTabbedSurfaceRef.current
    if (surface === 'agent' && !agentOpen || surface === 'terminal' && !terminalOpen) surface = 'editor'
    if (surface === 'browser' && !browserOpen) surface = 'editor'
    if (surface === 'git' && !gitOpen) surface = 'editor'
    if (surface === 'sidebar' && !sidebarOpen) surface = agentOpen ? 'agent' : 'editor'
    activeTabbedSurfaceRef.current = surface
    if (surface === 'browser') { setBrowserNextTabSignal((value) => value + 1); return }
    if (surface === 'git') { setGitNextTabSignal((value) => value + 1); return }
    if (surface === 'agent' || surface === 'terminal') {
      setAgentNextTabSignal((value) => value + 1)
      return
    }
    if (surface === 'sidebar') {
      switchSidebarTab('next')
      return
    }
    if (tabs.length < 2 || !activePath) return
    const index = tabs.findIndex((tab) => tab.path === activePath)
    if (index < 0) return
    setActivePath(tabs[(index + 1) % tabs.length].path, focusedPaneId)
  }, [activePath, agentOpen, terminalOpen, browserOpen, gitOpen, focusedPaneId, setActivePath, sidebarOpen, switchSidebarTab, tabs])

  const switchCurrentWindowTabLeft = useCallback(() => {
    let surface = activeTabbedSurfaceRef.current
    if (surface === 'agent' && !agentOpen || surface === 'terminal' && !terminalOpen) surface = 'editor'
    if (surface === 'browser' && !browserOpen) surface = 'editor'
    if (surface === 'git' && !gitOpen) surface = 'editor'
    if (surface === 'sidebar' && !sidebarOpen) surface = agentOpen ? 'agent' : 'editor'
    activeTabbedSurfaceRef.current = surface
    if (surface === 'browser') { setBrowserPreviousTabSignal((value) => value + 1); return }
    if (surface === 'git') { setGitPreviousTabSignal((value) => value + 1); return }
    if (surface === 'agent' || surface === 'terminal') {
      setAgentPreviousTabSignal((value) => value + 1)
      return
    }
    if (surface === 'sidebar') {
      switchSidebarTab('previous')
      return
    }
    if (tabs.length < 2 || !activePath) return
    const index = tabs.findIndex((tab) => tab.path === activePath)
    if (index < 0) return
    setActivePath(tabs[(index - 1 + tabs.length) % tabs.length].path, focusedPaneId)
  }, [activePath, agentOpen, terminalOpen, browserOpen, gitOpen, focusedPaneId, setActivePath, sidebarOpen, switchSidebarTab, tabs])

  // 터미널의 Ctrl+L이 우선 사용할 값 — 포커스된 칸의 활성 뷰(hotview/plain)에서 선택된 텍스트를
  // 읽는다. 선택이 없으면 각 패널이 activeFilePath(상대경로)로 폴백한다.
  const getSelectedText = useCallback(() => focusedEditor()?.getSelectedText() ?? null, [focusedEditor])

  // 터미널 버튼 줄의 명령어 버튼 — 목록은 프로젝트와 무관한 전역 설정이라 패널 바깥에서 주입한다
  const renderTermButtons = useCallback((run: (command: string) => void) => <TermButtonBar run={run} />, [])

  // 되돌리기는 md 문서의 hotview collab 문서를 직접 갈아끼우는 방식이라 그 경로만 지원한다.
  // 다른 세션이 지금 이 문서를 보고 있으면(나 혼자가 아니면) 충돌 가능성이 있어 막는다.
  const canRevertActiveTab =
    !!activeTab?.editable && !isExternalTabPath(activeTab.path) && activeTab.path.endsWith('.md') && (tabPresence[activeTab.path]?.length ?? 0) <= 1

  const handleRevertFile = useCallback(
    async (hash: string) => {
      if (!activeTab) return
      const { content } = await revertFileToCommit(activeTab.path, hash)
      // hotview(md)는 collab의 Y.XmlFragment가 진실 원천이라 에디터를 통해 갈아끼워야
      // 다른 세션·다음 자동저장에 정상 반영된다. 그 외(plain 등)는 탭 상태만 갱신하면 된다.
      if (activeTab.path.endsWith('.md') && activeTab.viewMode === 'hotview') focusedEditor()?.setRawContent(content)
      applyRevertedContent(activeTab.path, content)
    },
    [activeTab, applyRevertedContent, focusedEditor],
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    writeBrowserStorage(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    applyFontPreferences(fontPreferences)
    saveFontPreferences(fontPreferences)
  }, [fontPreferences])

  useEffect(() => {
    applyAccentColor(accentColor)
    saveAccentColor(accentColor)
  }, [accentColor])

  useEffect(() => {
    saveMewcatSkin(mewcatSkin)
  }, [mewcatSkin])

  useEffect(() => {
    if (!workspaceUiLoaded || chromeStateLoadedRootRef.current === rootProjectPath) return
    const value = workspaceUi.chrome
    // 계정 원장은 debounce 저장이라 새로고침 직전의 마지막 패널 조작보다 늦을 수 있다.
    // 모바일 전면 패널은 조작 순간 로컬에 동기 저장하므로, 그 패널만큼은 원장보다 우선해
    // 열림 상태까지 함께 복원한다.
    const savedMobileForeground = rootProjectPath && !isDesktop()
      ? loadMobileForegroundPanel(rootProjectPath)
      : null
    const restoredOpen: Record<WorkspacePanelId, boolean> = {
      sidebar: sidebarOpen,
      chat: chatOpen,
      agent: agentOpen,
    terminal: terminalOpen,
      browser: browserOpen,
      git: gitOpen,
      android: androidOpen,
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const chrome = value as Record<string, unknown>
      if (typeof chrome.tocOpen === 'boolean') setTocOpen(chrome.tocOpen)
      if (typeof chrome.sidebarOpen === 'boolean') {
        setSidebarOpen(chrome.sidebarOpen)
        restoredOpen.sidebar = chrome.sidebarOpen
      }
      if (chrome.sidebarView === 'files' || chrome.sidebarView === 'search' || chrome.sidebarView === 'content-search' || chrome.sidebarView === 'commands') setSidebarView(chrome.sidebarView)
      // 보조 패널은 모바일에서 화면 전체를 덮는 기기별 상태다. 계정 원장의 이전 값으로
      // 로컬의 방금 연 에이전트를 닫아 버리면 전면 순서를 복원할 수 없으므로, 서버 원장은
      // 데스크톱 배치에만 적용한다. 모바일은 각 패널의 로컬 열림 상태로 시작한다.
      if (isDesktop()) {
        if (caps.agent && typeof chrome.agentOpen === 'boolean') {
          setAgentOpen(chrome.agentOpen)
          restoredOpen.agent = chrome.agentOpen
        }
        const restoredTerminal = caps.terminal && (typeof chrome.terminalOpen === 'boolean' ? chrome.terminalOpen : chrome.tmuxOpen === true || chrome.agentOpen === true)
        setTerminalOpen(restoredTerminal)
        restoredOpen.terminal = restoredTerminal
        if (caps.browser && typeof chrome.browserOpen === 'boolean') {
          setBrowserOpen(chrome.browserOpen)
          restoredOpen.browser = chrome.browserOpen
        }
        setGitOpen(caps.git && chrome.gitOpen === true)
        restoredOpen.git = caps.git && chrome.gitOpen === true
        if (caps.android && typeof chrome.androidOpen === 'boolean') {
          setAndroidOpen(chrome.androidOpen)
          restoredOpen.android = chrome.androidOpen
        }
      }
    } else if (rootProjectPath && !isGuest) {
      // 계정 원장이 처음 비어 있을 때만 이 기기의 기존 화면 상태를 이관한다.
      setWorkspaceUi((previous) => ({
        ...previous,
        chrome: { tocOpen, sidebarOpen, sidebarView, agentOpen, terminalOpen, browserOpen, gitOpen, androidOpen },
      }))
    }
    if (savedMobileForeground && savedMobileForeground !== 'editor') {
      restoredOpen[savedMobileForeground] = true
      workspacePanelSetters[savedMobileForeground](true)
    }
    if (rootProjectPath && !isDesktop()) {
      setMobilePanelStack(restoreMobilePanelStack(restoredOpen, savedMobileForeground))
      // 다음 렌더에서 복원한 스택을 저장한다. 지금의 초기 스택으로 기존 기억을 덮지 않는다.
      mobilePanelStackRestorePendingRef.current = rootProjectPath
    }
    chromeStateLoadedRootRef.current = rootProjectPath
    chromeStateRestorePendingRef.current = rootProjectPath
  }, [agentOpen, terminalOpen, androidOpen, browserOpen, gitOpen, caps, chatOpen, isGuest, rootProjectPath, sidebarOpen, sidebarView, tocOpen, workspaceUi.chrome, workspaceUiLoaded, workspacePanelSetters])

  useEffect(() => {
    if (!rootProjectPath || !workspaceUiLoaded || isDesktop()) return
    if (mobilePanelStackRestorePendingRef.current === rootProjectPath) {
      mobilePanelStackRestorePendingRef.current = null
      mobilePanelStackRestoredRootRef.current = rootProjectPath
      return
    }
    if (mobilePanelStackRestoredRootRef.current !== rootProjectPath) return
    const foreground = mobilePanelStack.at(-1)
    saveMobileForegroundPanel(rootProjectPath, foreground ?? 'editor')
  }, [mobilePanelStack, rootProjectPath, workspaceUiLoaded])

  useEffect(() => {
    writeBrowserStorage(TOC_KEY, tocOpen ? '1' : '0')
  }, [tocOpen])

  // 모바일 키보드가 뜨면 visualViewport만 줄어들고 레이아웃 뷰포트(100dvh)는 그대로인 브라우저가 있어
  // (iOS Safari 등, interactive-widget 메타 태그 미지원) 실제 보이는 높이를 직접 재서 반영한다
  useEffect(() => {
    function updateAppHeight() {
      const height = window.visualViewport?.height ?? window.innerHeight
      document.documentElement.style.setProperty('--app-height', `${height}px`)
    }
    updateAppHeight()
    window.visualViewport?.addEventListener('resize', updateAppHeight)
    window.addEventListener('resize', updateAppHeight)
    return () => {
      window.visualViewport?.removeEventListener('resize', updateAppHeight)
      window.removeEventListener('resize', updateAppHeight)
    }
  }, [])

  useEffect(() => {
    if (isGuest) return
    fetchWorkspace()
      .then(applyWorkspace)
      .catch(console.error)
  }, [isGuest, applyWorkspace])

  // 프로젝트를 옮기면 사이드바 트리를 그 프로젝트 것으로 갈아끼운다. 옆 프로젝트의 트리가 잠깐
  // 남아 있지 않도록 먼저 비우고, 늦게 도착한 옛 응답이 새 트리를 덮지 않게 취소 플래그를 둔다.
  useEffect(() => {
    let alive = true
    setTree([])
    setSubprojectTrees({})
    setLoadingSubprojects(new Set())
    const workspace = fetchTreeEntries(WORKSPACE_PROJECT)
    const docs = fetchTreeEntries(DEFAULT_PROJECT)
    void workspace.then((next) => { if (alive) setRootTree(next) }).catch(console.error)
    void docs.then((next) => { if (alive) setDocsTree(next) }).catch(console.error)
    const active = project === WORKSPACE_PROJECT ? workspace : project === DEFAULT_PROJECT ? docs : fetchTreeEntries(project)
    void active.then((next) => { if (alive) setTree(next) }).catch(console.error)
    return () => {
      alive = false
    }
  // `.workspace`는 모든 루트에서 같은 API 식별자다. 따라서 루트 프로젝트를 바꿔도
  // project 값은 그대로일 수 있으며, 실제 루트 경로도 로딩 경계에 포함해야 한다.
  }, [project, rootProjectPath])

  // 옛 `/{프로젝트}` 주소로 들어왔으면 주소만 루트로 정리한다 — 프로젝트는 이미 그것으로 시작했다
  useEffect(() => {
    if (location.pathname !== '/') history.replaceState(null, '', '/')
  }, [])

  // 모바일 뒤로가기가 전체화면 종료로 해석되지 않게, 전체화면 진입 중에는 히스토리 한 칸을 지킨다.
  // 브라우저가 OS 차원에서 fullscreen을 먼저 해제하는 경우는 다시 요청할 사용자 제스처가 없어 막을 수 없지만,
  // SPA의 popstate·Android WebView 뒤로가기는 여기서 소비된다.
  useEffect(() => {
    const onFullscreenChange = () => {
      if (document.fullscreenElement && !fullscreenGuardRef.current) {
        history.pushState({ ...(history.state ?? {}), mewFullscreen: true }, '')
        fullscreenGuardRef.current = true
      }
      if (!document.fullscreenElement) fullscreenGuardRef.current = false
    }
    const onPopState = () => {
      if (!document.fullscreenElement || !fullscreenGuardRef.current) return
      history.pushState({ ...(history.state ?? {}), mewFullscreen: true }, '')
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    window.addEventListener('popstate', onPopState)
    return () => { document.removeEventListener('fullscreenchange', onFullscreenChange); window.removeEventListener('popstate', onPopState) }
  }, [])

  useEffect(() => {
    writeBrowserStorage(AGENT_OPEN_KEY, agentOpen ? '1' : '0')
  }, [agentOpen])

  useEffect(() => {
    writeBrowserStorage(BROWSER_OPEN_KEY, browserOpen ? '1' : '0')
  }, [browserOpen])

  useEffect(() => {
    writeBrowserStorage(ANDROID_OPEN_KEY, androidOpen ? '1' : '0')
  }, [androidOpen])

  useEffect(() => {
    if (!rootProjectPath || isGuest || !workspaceUiLoaded) return
    if (chromeStateRestorePendingRef.current === rootProjectPath) {
      chromeStateRestorePendingRef.current = null
      return
    }
    setWorkspaceUi((previous) => ({
      ...previous,
      chrome: { tocOpen, sidebarOpen, sidebarView, agentOpen, terminalOpen, browserOpen, gitOpen, androidOpen },
    }))
  }, [agentOpen, terminalOpen, androidOpen, browserOpen, gitOpen, isGuest, rootProjectPath, sidebarOpen, sidebarView, tocOpen, workspaceUiLoaded])

  const handleRenamed = useCallback(
    (oldPath: string, newPath: string, type: 'file' | 'dir') => {
      refreshTree()
      remapPaths(oldPath, newPath, type)
    },
    [refreshTree, remapPaths],
  )

  const handleDeleted = useCallback(
    (path: string, type: 'file' | 'dir') => {
      refreshTree()
      removePaths(path, type)
    },
    [refreshTree, removePaths],
  )

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Esc는 useOverlayDismiss 스택이 capture 단계에서 처리한다 (모달 → 터미널 → 사이드바 순)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
        if (!isOwner) return
        e.preventDefault()
        setOpenProjectDialog(true)
      } else if (matchesShortcut(e, getBinding('save'))) {
        e.preventDefault()
        saveCurrentTab(true)
      } else if (matchesShortcut(e, getBinding('quickOpen'))) {
        e.preventDefault()
        setSidebarView('search')
        openWorkspacePanel('sidebar')
        setProjectSearchFocus((s) => s + 1)
      } else if (matchesShortcut(e, getBinding('projectSearch'))) {
        // VSCode Ctrl+Shift+F — 사이드바를 검색 뷰로 열고 검색창에 포커스
        e.preventDefault()
        openWorkspacePanel('sidebar')
        setSidebarView('content-search')
        setProjectSearchFocus((s) => s + 1)
      } else if (matchesShortcut(e, getBinding('editorFind'))) {
        // 에디터에 포커스가 있으면 에디터가 먼저 처리한다 — tiptap은 stopPropagation(여기 안 옴),
        // CodeMirror의 searchKeymap은 preventDefault. 그 외(사이드바 등)에서 눌렀을 때 활성 문서의
        // 편집기로 찾기 바를 연다. md든 코드든 csv든 텍스트 편집기가 붙는 파일이면 전부 대상이다 —
        // 편집기가 없는 미디어 뷰어와 svg 이미지 미리보기만 빠진다.
        if (e.defaultPrevented) return
        if (e.target instanceof HTMLElement && e.target.closest('.xterm')) return
        const svgPreview = activeTab?.viewMode === 'hotview' && activeTab.path.endsWith('.svg')
        if (activeTab && !mediaKind(activeTab.path) && !svgPreview) {
          e.preventDefault()
          focusedEditor()?.openSearch()
        }
      } else if (matchesShortcut(e, getBinding('insertPathOrSelection'))) {
        // 에디터의 Ctrl+L — 커서가 있는 줄(선택이면 그 범위)의 `경로:줄` 참조를 **마지막으로 연 보조창**
        // 입력칸에 써 준다. md 핫뷰든 코드·텍스트든 편집기가 붙는 파일이면 전부 대상이다
        // (줄 번호는 각 편집기의 getSelectedLineRange가 낸다 — 핫뷰는 md 원본 줄로 환산한다).
        // 터미널 안에서 누른 Ctrl+L은 TmuxTerminal이 직접 처리한다(defaultPrevented).
        if (e.defaultPrevented) return
        if (!(e.target instanceof HTMLElement) || !e.target.closest('.ProseMirror, .cm-editor')) return
        const range = focusedEditor()?.getSelectedLineRange()
        if (!range || !activeRelativePath) return
        // 받을 창이 없어도 여기서 삼킨다 — 안 그러면 브라우저 기본 Ctrl+L(주소창)로 샌다
        e.preventDefault()
        // 열려 있는 보조창이 하나도 없으면 쓸 곳이 없으니 그대로 끝낸다
        const target = pickRefTarget(lastPanelRef.current, { agent: agentOpen, terminal: terminalOpen, chat: chatOpen })
        if (!target) return
        const lines = range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`
        // 화면에 쓸 글자(text)와 구조(project·path)를 함께 싣는다 — 터미널·에이전트는 text를 그대로
        // 타이핑하고, 채팅 창은 project·path로 파일 멘션 토큰을 만든다. target이 자기 것인 창만 받는다
        window.dispatchEvent(
          new CustomEvent('mew:insert-ref', {
            detail: { target, text: `${activeRelativePath}:${lines} `, project, path: activeRelativePath },
          }),
        )
      } else if (matchesShortcut(e, getBinding('toggleChat'))) {
        if (!caps.chat) return
        e.preventDefault()
        toggleWorkspacePanel('chat')
      } else if (matchesShortcut(e, getBinding('toggleAgent'))) {
        if (!caps.agent) return
        e.preventDefault()
        toggleWorkspacePanel('agent')
      } else if (matchesShortcut(e, getBinding('toggleBrowser'))) {
        if (!caps.browser) return
        e.preventDefault()
        toggleWorkspacePanel('browser')
      } else if (matchesShortcut(e, getBinding('openGit'))) {
        if (!caps.git) return
        e.preventDefault()
        toggleWorkspacePanel('git')
      } else if (matchesShortcut(e, getBinding('addComment'))) {
        // 지금 포커스된 칸의 선택(없으면 커서) 자리에 댓글 작성 팝업 — 텍스트 편집기가 아니면 아무 일도 없다
        if (!caps.collaboration) return
        e.preventDefault()
        focusedEditor()?.startComment()
      } else if (matchesShortcut(e, getBinding('toggleTerminal'))) {
        if (!canUseTerminal) return
        e.preventDefault()
        toggleWorkspacePanel('terminal')
      } else if (matchesShortcut(e, getBinding('toggleSidebar'))) {
        // 에디터의 Ctrl+B(굵게, defaultPrevented로 감지)와 터미널의 tmux prefix에는 양보한다
        if (e.defaultPrevented || (e.target instanceof HTMLElement && e.target.closest('.xterm'))) return
        e.preventDefault()
        toggleWorkspacePanel('sidebar')
      } else if (matchesShortcut(e, getBinding('closeTab'))) {
        // Ctrl+W를 실제로 닫을 탭이 있을 때만 가로챈다. 포커스된 보조 창에 닫을 탭이 없으면
        // 에디터로 새지 않고 브라우저 기본 탭 닫기를 양보한다.
        const result = dispatchFocusedShortcut('closeTab', e)
        if (result === 'handled') e.preventDefault()
        else if (result === 'no-scope' && activePath) {
          e.preventDefault()
          closeTab(activePath)
        }
      } else if (matchesShortcut(e, getBinding('newTab'))) {
        if (!caps.filesWrite || !caps.filesRead) return
        // Ctrl+N도 마찬가지로 브라우저 예약 단축키라 가로챌 수 없어 기본값은 Alt+N이다.
        // 빈 탭이 아니라 새 파일 흐름 — 사이드바에 포커스면 거기 선택된 항목 기준(FileTree가
        // 알고 있다), 에디터 등 다른 곳이면 활성 문서와 같은 폴더에 이름 입력을 연다
        e.preventDefault()
        const inSidebar = e.target instanceof HTMLElement && !!e.target.closest('[data-sidebar]')
        const parentPath = !inSidebar && activeTab?.path ? activeTab.path.split('/').slice(0, -1).join('/') : null
        setSidebarView('files')
        openWorkspacePanel('sidebar')
        setNewFileSignal((s) => ({ n: s.n + 1, parentPath }))
      } else if (matchesShortcut(e, getBinding('prevTab')) || matchesShortcut(e, getBinding('nextTab'))) {
        // Ctrl+Alt+←/→ 탭 이동 — 끝에 닿으면 반대편으로 감싼다. 터미널에 포커스가 있어도 동작한다
        // (TmuxTerminal이 이 조합을 PTY로 보내지 않고 통과시킨다)
        e.preventDefault()
        if (matchesShortcut(e, getBinding('nextTab'))) switchCurrentWindowTabRight()
        else switchCurrentWindowTabLeft()
      } else if (matchesShortcut(e, getBinding('toggleTerminalAlt'))) {
        if (!canUseTerminal) return
        e.preventDefault()
        toggleWorkspacePanel('terminal')
      } else if (matchesShortcut(e, getBinding('fullscreen'))) {
        e.preventDefault()
        toggleFullscreen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // 보조창 열림 상태는 Ctrl+L이 어디로 보낼지 고를 때 읽는다 — 닫힌 창으로 보내지 않게 최신 값이어야 한다
  }, [
    saveCurrentTab, closeTab, activePath, activeTab, activeRelativePath, tabs, setActivePath,
    caps, canUseTerminal, focusedEditor, isGuest, isOwner, project, sidebarOpen, chatOpen, agentOpen, terminalOpen,
    browserOpen, androidOpen, mobilePanelStack, openWorkspacePanel,
    toggleWorkspacePanel, switchCurrentWindowTabRight, switchCurrentWindowTabLeft,
  ])

  /** 채팅 멘션·에이전트 로컬 링크 — 같은 mew의 알맞은 프로젝트와 문서 탭으로 연다. */
  const openMentionedFile = useCallback(
    (target: string, path: string, line: number | null = null) => {
      // 에디터는 모바일 보조창 스택의 한 항목이 아니다. 파일을 여는 순간에는 패널을 닫지
      // 않고 전면 스택만 비워야, 뒤의 사이드바가 올라오지 않으면서 데스크톱 열림 상태도 남는다.
      showMobileEditor()
      setPendingOpen({ project: target, path, line })
      if (target !== project) switchProject(target)
    },
    [project, showMobileEditor, switchProject],
  )

  useEffect(() => {
    // 프로젝트를 바꾸며 열린 파일은 useTabs의 해당 프로젝트 탭 복원이 끝난 뒤에 붙인다.
    // 그렇지 않으면 첫 클릭이 만든 탭을 같은 렌더의 복원 초기화가 덮어, 에디터만 비고
    // 두 번째 클릭에서야 파일이 보이는 경합이 생긴다.
    if (!tabsHydrated || !pendingOpen || pendingOpen.project !== project) return
    if (pendingOpen.line !== null) setPendingReveal({ path: pendingOpen.path, line: pendingOpen.line })
    openFile(pendingOpen.path, { preview: false })
    // Hotview는 원본 줄과 렌더 블록 위치가 일대일이 아니다. 줄 링크는 Plain으로 열어 정확히 이동한다.
    if (pendingOpen.line !== null && pendingOpen.path.endsWith('.md')) setTabViewMode(pendingOpen.path, 'plain')
    setPendingOpen(null)
  }, [pendingOpen, project, tabsHydrated, openFile, setTabViewMode])

  // 프로젝트 검색 결과 클릭 — 파일을 열고, 위치 점프 정보를 대기시킨다 (내용 로드 후 아래 effect가 처리)
  const openSearchResult = useCallback(
    (path: string, match: SearchMatch, query: string, _opts?: unknown, resultProject?: string) => {
      if (resultProject && resultProject !== project) {
        setPendingOpen({ project: resultProject, path, line: match.line })
        switchProject(resultProject)
        showMobileEditor()
        return
      }
      setPendingReveal({ path, line: match.line, query })
      // 큰 파일은 검색 결과 줄 주변을 먼저 읽는다. Markdown은 줄 구조가 화면 구조와 달라 기존 Hotview
      // 검색 경로를 유지하며, plain만 preview가 안전하다.
      openFile(path, path.endsWith('.md') ? { preview: true } : { preview: true, viewMode: 'plain', anchorLine: match.line })
      showMobileEditor()
    },
    [openFile, project, showMobileEditor, switchProject],
  )

  // 대기 중인 점프 실행 — 대상 파일이 활성화되고 내용이 로드되면: 코드/plain은 해당 줄로 스크롤,
  // md(hotview)는 줄번호가 렌더 결과와 어긋나므로 대신 찾기 바를 그 검색어로 열어 강조한다.
  useEffect(() => {
    const pending = pendingReveal
    if (!pending || !activeTab || activeTab.path !== pending.path) return
    if (mediaKind(activeTab.path)) {
      setPendingReveal(null)
      return
    }
    if (!activeTab.content) return // 아직 로드 전 — 다음 content 갱신 때 다시 시도
    const { line, query } = pending
    if (activeTab.viewMode !== 'plain') {
      if (query) focusedEditor()?.openSearch(query)
      setPendingReveal((current) => (current === pending ? null : current))
      return
    }

    let raf = 0
    let tries = 0
    let consecutiveSuccesses = 0
    const attempt = () => {
      // 프로젝트 전환 중에는 같은 pane id의 옛 손잡이가 잠깐 남을 수 있다. 손잡이가 대상 파일을
      // 실제로 들고 있을 때만 성공이며, 다음 프레임에도 한 번 더 이동해 늦은 스크롤 복원을 확실히 끊는다.
      const moved = focusedEditor()?.revealLine(pending.path, line) === true
      consecutiveSuccesses = moved ? consecutiveSuccesses + 1 : 0
      tries += 1
      if (consecutiveSuccesses >= 2 || tries >= 120) {
        setPendingReveal((current) => (current === pending ? null : current))
        return
      }
      raf = requestAnimationFrame(attempt)
    }
    raf = requestAnimationFrame(attempt)
    return () => cancelAnimationFrame(raf)
  }, [pendingReveal, activeTab, focusedEditor])

  const canEditActiveTab = !!activeTab?.editable && !isArchivedPath(activeTab.path)

  // 사이드바 여는 버튼은 사이드바가 서는 자리와 붙은 맨 앞 칸(왼쪽·위)이 맡는다
  const sidebarPaneId = paneIds(layout)[0]

  const renderEditorPane = (pane: (typeof panes)[number]) => {
    return (
        <DockPanel key={pane.id} id={`editor:${pane.id}`} kind="editor" mobileSelected={pane.id === focusedPaneId}>
        {panes.length > 1 && <div className="flex h-8 shrink-0 items-center gap-1 border-b border-edge px-2 md:hidden">
          <select aria-label={t('panel.editorPane')} value={focusedPaneId} onChange={(event) => focusPane(event.target.value)} className="min-w-0 flex-1 bg-surface-deep text-xs text-ink">
            {panes.map((item, index) => <option key={item.id} value={item.id}>{index + 1} · {item.activePath?.split('/').at(-1) ?? t('panel.editorPane')}</option>)}
          </select>
        </div>}

        <EditorPane
          key={pane.id}
          pane={pane}
          role={role}
          authEmail={authEmail}
          project={project}
          tree={tree}
          presence={tabPresence}
          focused={pane.id === focusedPaneId}
          isGuest={isGuest}
          canCollaborate={caps.collaboration}
          showSidebarButton={!sidebarOpen && pane.id === sidebarPaneId}
          tocOpen={tocOpen}
          dropZone={dropTarget?.paneId === pane.id ? dropTarget.zone : null}
          registerHandle={registerPaneHandle}
          registerElement={registerPaneElement}
          registerTabBar={registerPaneTabBar}
          onFocus={() => {
            activeTabbedSurfaceRef.current = 'editor'
            focusPane(pane.id)
          }}
          onActivate={(path) => {
            setActivePath(path, pane.id)
            setRevealSignal((n) => n + 1)
          }}
          onPin={(path) => pinTab(path, pane.id)}
          onCloseTab={(path) => closeTab(path, pane.id)}
          onReorder={(from, to) => reorderTabs(from, to, pane.id)}
          onSetViewMode={(path, viewMode) => setTabViewMode(path, viewMode, pane.id)}
          onChangeContent={updateTabContent}
          onOpenLink={(linkPath) => openFile(linkPath, { preview: false, forceNewTab: true, paneId: pane.id })}
          onOpenHistory={() => setHistoryOpen(true)}
          onSetTocOpen={setTocOpen}
          onOpenSidebar={() => openWorkspacePanel('sidebar')}
          onTabDragMove={handleTabDragMove}
          onTabDrop={handleTabDrop}
        />
        </DockPanel>
    )
  }

  const rootSubprojects = useMemo(() => rootTree.filter((node) => node.project), [rootTree])
  const rootNodes = useMemo(() => rootTree.filter((node) => !node.project), [rootTree])
  const accountTreeStates = useMemo(() => accountTrees(workspaceUi.trees), [workspaceUi.trees])
  const saveAccountTreeState = useCallback((key: string, value: TreePersistenceState) => {
    if (isGuest) return
    setWorkspaceUi((previous) => {
      const trees = accountTrees(previous.trees)
      const existing = trees[key]
      if (
        existing?.scrollTop === value.scrollTop
        && JSON.stringify(existing.centerAnchor) === JSON.stringify(value.centerAnchor)
        && existing.openDirs.length === value.openDirs.length
        && existing.openDirs.every((path, index) => path === value.openDirs[index])
        && JSON.stringify(existing.directoryChildren) === JSON.stringify(value.directoryChildren)
      ) return previous
      return { ...previous, trees: { ...trees, [key]: value } }
    })
  }, [isGuest])
  const lastSidebarRevealRef = useRef({ rootProjectPath, activePath, project, revealSignal })
  useEffect(() => {
    const previous = lastSidebarRevealRef.current
    lastSidebarRevealRef.current = { rootProjectPath, activePath, project, revealSignal }
    if (previous.rootProjectPath !== rootProjectPath || !workspaceUiLoaded) return
    if (previous.activePath === activePath && previous.project === project && previous.revealSignal === revealSignal) return
    if (project !== WORKSPACE_PROJECT || !activePath) return
    const subproject = rootTree.find((node) => node.project && activePath.startsWith(`${node.path}/`))
    if (subproject) setExpandedSubprojects((current) => current.has(subproject.path) ? current : new Set(current).add(subproject.path))
  }, [activePath, project, revealSignal, rootProjectPath, rootTree, workspaceUiLoaded])
  const loadSubproject = useCallback((path: string) => {
    if (subprojectTrees[path] !== undefined || loadingSubprojects.has(path)) return
    setLoadingSubprojects((previous) => new Set(previous).add(path))
    void fetchTreeEntries(WORKSPACE_PROJECT, path)
      .then((children) => setSubprojectTrees((previous) => ({ ...previous, [path]: children })))
      .catch((err: unknown) => showToast(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoadingSubprojects((previous) => {
        const next = new Set(previous)
        next.delete(path)
        return next
      }))
  }, [loadingSubprojects, showToast, subprojectTrees])
  // 복원한 하위 프로젝트도 다시 접히지 않게, 루트 목록이 들어온 뒤 펼쳐 둔 항목의 한 단계 내용을 읽는다.
  useEffect(() => {
    for (const path of expandedSubprojects) {
      if (rootSubprojects.some((subproject) => subproject.path === path)) loadSubproject(path)
    }
  }, [expandedSubprojects, loadSubproject, rootSubprojects])
  const toggleSubproject = (path: string) => {
    const opening = !expandedSubprojects.has(path)
    setExpandedSubprojects((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    if (opening) loadSubproject(path)
  }

  // 헤더 오른쪽 도구 목록 — 권한별로 보이는 것이 다르다. 그리는 건 HeaderMenu(햄버거) 하나뿐이다
  const headerMenuItems: HeaderMenuItem[] = [
    ...(!isGuest || canEditActiveTab
      ? [
          {
            id: 'fullscreen',
            label: '전체화면',
            hint: 'Alt+Enter',
            onSelect: toggleFullscreen,
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
              </svg>
            ),
          },
          {
            id: 'commit',
            label: 'Commit',
            hint: 'Ctrl+S',
            onSelect: () => saveCurrentTab(true),
            disabled: !activeTab || !canEditActiveTab || activeTab.content === activeTab.committedContent,
            // git commit — 커밋 하나가 이력선 위에 찍힌 모양
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <line x1="1.5" y1="12" x2="8" y2="12" />
                <line x1="16" y1="12" x2="22.5" y2="12" />
              </svg>
            ),
          },
        ]
      : []),
    ...[
          {
            id: 'git',
            label: 'Git',
            hint: 'Alt+G',
            active: gitOpen,
            onSelect: () => toggleWorkspacePanel('git'),
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="5" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="7" cy="19" r="2" />
                <path d="M6 7v10M8 8.5c3.5 0 4.5-1.5 8-1.5" />
              </svg>
            ),
          },
          {
            id: 'remote-desktop',
            label: '원격 데스크톱',
            onSelect: () => setRemoteDesktopOpen(true),
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></svg>,
          },
          {
            id: 'file-explorer',
            label: t('header.fileExplorer'),
            onSelect: () => setServerFileExplorerOpen(true),
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h6l2 2h10v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                <path d="M3 10h18" />
              </svg>
            ),
          },
          {
            id: 'schedule',
            label: t('header.scheduledTasks'),
            onSelect: () => setScheduleOpen(true),
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            ),
          },
          {
            id: 'sysstats',
            label: t('header.systemResources'),
            onSelect: () => setSysStatsOpen(true),
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 14a8 8 0 0 1 8-8" />
                <path d="M4 14a8 8 0 0 1 3.5-6.6" />
                <path d="M12 14 8.5 9.5" />
                <path d="M4 14h16" />
                <path d="M3 18h18" />
              </svg>
            ),
          },
          {
            id: 'mew-update',
            label: mewUpdating
              ? 'Mew 업데이트 중…'
              : mewUpdate?.available
                ? (mewUpdate.canUpdate ? 'Mew 업데이트' : 'Mew 수동 업데이트 필요')
                : 'Mew 업데이트 확인',
            hint: mewUpdate?.available ? `${mewUpdate.behind}개` : undefined,
            onSelect: () => void startMewUpdate(),
            disabled: mewUpdating || mewUpdate === null,
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12" />
                <path d="m7 10 5 5 5-5" />
                <path d="M5 21h14" />
              </svg>
            ),
          },
          {
            id: 'agent',
            label: t('header.agent'),
            hint: 'Alt+L',
            onSelect: () => toggleWorkspacePanel('agent'),
            active: agentOpen,
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.2A8.5 8.5 0 0 1 4 11.5a8.38 8.38 0 0 1 8.5-8.4 8.38 8.38 0 0 1 8.5 8.4z" />
              </svg>
            ),
          },
          {
            id: 'terminal', label: t('header.terminal'), hint: 'Ctrl+`',
            onSelect: () => toggleWorkspacePanel('terminal'), active: terminalOpen,
            icon: <span className="font-mono text-xs">&gt;_</span>,
          },
          {
            id: 'browser',
            label: t('header.browser'),
            hint: 'Alt+B',
            onSelect: () => toggleWorkspacePanel('browser'),
            active: browserOpen,
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18" />
                <path d="M12 3a13.5 13.5 0 0 1 0 18" />
                <path d="M12 3a13.5 13.5 0 0 0 0 18" />
              </svg>
            ),
          },
          {
            id: 'android',
            label: 'Android',
            onSelect: () => toggleWorkspacePanel('android'),
            active: androidOpen,
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="4" width="12" height="16" rx="2" />
                <path d="M9 8h6" />
                <path d="M9 17h6" />
                <path d="M8 2 6.5 4.5" />
                <path d="m16 2 1.5 2.5" />
              </svg>
            ),
          },
        ],
    ...(isGuest
      ? []
      : [
          {
            id: 'chat',
            label: t('header.chat'),
            hint: 'Alt+C',
            onSelect: () => toggleWorkspacePanel('chat'),
            active: chatOpen,
            // 겹친 말풍선 둘 — 에이전트(말풍선 하나)·계정 관리(사람)와 구분된다
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 9a2 2 0 0 1-2 2H6l-4 3V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" />
                <path d="M18 8h2a2 2 0 0 1 2 2v11l-4-3h-6a2 2 0 0 1-2-2v-1" />
              </svg>
            ),
          },
          {
            id: 'database',
            label: t('header.database'),
            onSelect: () => setDbListOpen(true),
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="8" ry="3" />
                <path d="M20 5v6c0 1.66-3.58 3-8 3s-8-1.34-8-3V5" />
                <path d="M20 11v6c0 1.66-3.58 3-8 3s-8-1.34-8-3v-6" />
              </svg>
            ),
          },
        ]),
    ...(isOwner
      ? [
          {
            id: 'admin',
            label: t('header.accountManagement'),
            onSelect: () => setAdminOpen(true),
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            ),
          },
        ]
      : []),
    {
      id: 'settings',
      // 로그인해 있으면 이 항목이 곧 계정 자리다 — 누구 계정인지 이름을 붙여 준다
      label: t('settings.title'),
      onSelect: () => setSettingsOpen(true),
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
  ].filter(item => {
    const feature: Partial<Record<string, Feature>> = { git: 'git', 'remote-desktop': 'desktop', 'file-explorer': 'serverFiles', schedule: 'schedules', sysstats: 'system', 'mew-update': 'system', agent: 'agent', terminal: 'terminal', browser: 'browser', android: 'android', chat: 'chat', database: 'database' }
    const required = feature[item.id]
    return !required || caps[required]
  })

  return (
    <div className="flex flex-col overflow-hidden bg-surface text-ink" style={{ height: 'var(--app-height, 100dvh)' }}>
      {/* 화면 전폭을 쓰는 줄은 이 헤더 하나뿐이다 — 프로젝트 탭 + 도구 버튼. 문서 탭 줄은 각
          편집 칸 안에 있다(EditorPane). 탭이 줄 높이를 꽉 채워야 하므로 세로 여백은 두지 않는다. */}
      <div className="flex flex-col">
        <header className="flex h-10 items-stretch border-b border-edge pr-2 md:h-12 md:pr-4">
          <RootProjectTabs
            paths={rootProjectPath ? [...openProjectPaths, rootProjectPath] : openProjectPaths}
            activePath={rootProjectPath}
            fallbackLabel={projectLabel(rootProjectPath)}
            canOpen={isOwner}
            canChangeIcon={isOwner}
            icons={rootProjectIcons}
            onActivate={(projectPath) => void openRootProject(projectPath)}
            onClose={setCloseProjectPath}
            onIconChange={changeRootProjectIcon}
            onOpen={() => setOpenProjectDialog(true)}
          />
          {/* 도구는 햄버거 하나로 접고, 게스트의 로그인 진입점만 바로 옆에 둔다. */}
          <div className="flex shrink-0 items-center gap-1.5 pl-2 text-sm md:gap-3 md:pl-4">
            {switchingRootProject && <span className="text-xs text-ink-secondary">프로젝트 여는 중…</span>}
            {isGuest && (
              <button
                type="button"
                onClick={onRequestLogin}
                className="rounded bg-accent px-2.5 py-1 text-xs font-medium text-ink-on-accent hover:bg-accent-strong"
              >
                {t('common.login')}
              </button>
            )}
            {activeTab?.status === 'error' && (
              <span className="select-text hidden max-w-[12rem] truncate text-danger md:inline">{activeTab.statusMessage}</span>
            )}
            <HeaderMenu items={headerMenuItems} />
          </div>
        </header>
      </div>

      <div
        className="relative flex min-h-0 flex-1 overflow-hidden"
        onDragOverCapture={handlePathDragOver}
        onDropCapture={handlePathDrop}
        // 드래그를 취소하거나(Esc) 컨테이너 밖으로 나가면 분할 그림자를 지운다
        onDragEndCapture={() => setDropTarget(null)}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null)
        }}
      >
        {sidebarOpen && (
          <div
            data-sidebar
            onPointerDownCapture={() => {
              activeTabbedSurfaceRef.current = 'sidebar'
              bringWorkspacePanelToFront('sidebar')
            }}
            // 모바일은 프로젝트 탭 아래 작업 영역 전체를 덮는다. 파일 탭은 사이드바가 열린 동안 보이지 않는다.
            // 데스크톱은 기존 고정 칸이다.
            className={`absolute inset-x-0 top-0 bottom-0 flex bg-surface-deep md:static md:z-auto md:shrink-0 ${mobilePanelLayer('sidebar')}`}
            style={{ width: isDesktop() ? sidebarWidth : undefined }}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              {/* 탐색기 ↔ 검색(Ctrl+Shift+F) 전환 — 프로젝트 전환 버튼은 헤더 맨 왼쪽에 있다 */}
              <div className="flex h-9 shrink-0 items-center gap-1 border-b border-edge px-2">
                <button
                  type="button"
                  onClick={() => setSidebarView('files')}
                  className={`rounded p-1 ${sidebarView === 'files' ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:bg-surface-hover'}`}
                  title="탐색기"
                  aria-label="탐색기"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-7.9a1 1 0 0 1-.79-.38l-1.62-2.24A1 1 0 0 0 8.9 4H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSidebarView('search')
                    setProjectSearchFocus((s) => s + 1)
                  }}
                  className={`rounded p-1 ${sidebarView === 'search' ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:bg-surface-hover'}`}
                  title="파일명 검색 (Ctrl+P)"
                  aria-label="파일명 검색"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSidebarView('content-search')
                    setProjectSearchFocus((s) => s + 1)
                  }}
                  className={`rounded p-1 ${sidebarView === 'content-search' ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:bg-surface-hover'}`}
                  title="파일 내용 검색 (Ctrl+Shift+F)"
                  aria-label="파일 내용 검색"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6M8 13h8M8 17h5" />
                    <circle cx="17.5" cy="17.5" r="2.5" />
                    <path d="m19.4 19.4 1.6 1.6" />
                  </svg>
                </button>
                {canUseTerminal && <button
                  type="button"
                  onClick={() => setSidebarView('commands')}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink ${sidebarView === 'commands' ? 'bg-surface-raised text-ink' : ''}`}
                  title={`${projectLabel(rootProjectPath)} 명령어`}
                  aria-label={`${projectLabel(rootProjectPath)} 명령어 버튼`}
                  aria-pressed={sidebarView === 'commands'}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                </button>}
                {!isGuest && caps.filesRead && caps.filesWrite && <SidebarCreateButtons onCreate={sidebarCreate.create} disabled={!workspaceUiLoaded || sidebarStateLoadedRootRef.current !== rootProjectPath} />}
                <button
                  type="button"
                  onClick={() => closeWorkspacePanel('sidebar')}
                  className={`${isGuest ? 'ml-auto ' : ''}flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink`}
                  title="사이드바 닫기 (Ctrl+B)"
                  aria-label="사이드바 닫기"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <div className={sidebarView === 'files' ? 'h-full' : 'hidden'}>
                  {/* Documents와 직계 하위 프로젝트만 큰 접기 단위다. 나머지 루트 내용은 실제 깊이대로 바로 보인다. */}
                  {(isGuest || (workspaceUiLoaded && sidebarStateLoadedRootRef.current === rootProjectPath)) && <FileTree
                    key={`${isGuest ? DEFAULT_PROJECT : WORKSPACE_PROJECT}:${rootProjectPath ?? ''}:${workspaceUiRevision}`}
                    {...sidebarCreate.treeProps('root')}
                    tree={isGuest ? docsTree : rootNodes}
                    project={isGuest ? DEFAULT_PROJECT : WORKSPACE_PROJECT}
                    stateKey={rootProjectPath ? `sidebar-tree:${isGuest ? 'docs' : 'root'}:${rootProjectPath}` : undefined}
                    accountState={rootProjectPath ? accountTreeStates[`sidebar-tree:${isGuest ? 'docs' : 'root'}:${rootProjectPath}`] : undefined}
                    onAccountStateChange={rootProjectPath ? (state) => saveAccountTreeState(`sidebar-tree:${isGuest ? 'docs' : 'root'}:${rootProjectPath}`, state) : undefined}
                    workspacePath={rootProjectPath}
                    selectedPath={project === (isGuest ? DEFAULT_PROJECT : WORKSPACE_PROJECT) ? activePath : null}
                    readOnly={isGuest || !caps.filesRead || !caps.filesWrite}
                    canUseCommands={canUseTerminal && !isGuest}
                    canUseGit={caps.git}
                    loadChildren={isGuest ? loadDocsTreeChildren : loadWorkspaceTreeChildren}
                    treeInvalidation={treeInvalidation}
                    roots={!isGuest && <>
                      <div className="border-b border-edge pb-1">
                        <button
                          type="button"
                          data-path="@docs"
                          onClick={() => { sidebarCreate.selectDirectory('docs', ''); setDocsExpanded((expanded) => !expanded) }}
                          onContextMenu={(event) => {
                            if (!isOwner) return
                            event.preventDefault()
                            setDocsSettingsOpen(true)
                          }}
                          className={`sticky top-0 z-10 flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm font-medium hover:bg-surface-raised ${docsExpanded ? 'bg-surface-raised text-ink' : 'bg-surface-deep text-ink-secondary'}`}
                          title={isOwner ? 'Documents · 우클릭하여 폴더 설정' : 'Documents'}
                        >
                          <ProjectIcon icon="i:notes" size={16} />
                          <span>{t('project.documents')}</span>
                        </button>
                        {docsExpanded && (
                          <FileTree
                            key={`${DEFAULT_PROJECT}:${rootProjectPath ?? ''}:${workspaceUiRevision}`}
                            {...sidebarCreate.treeProps('docs')}
                            tree={docsTree}
                            project={DEFAULT_PROJECT}
                            stateKey={rootProjectPath ? `sidebar-tree:docs:${rootProjectPath}` : undefined}
                            accountState={rootProjectPath ? accountTreeStates[`sidebar-tree:docs:${rootProjectPath}`] : undefined}
                            onAccountStateChange={rootProjectPath ? (state) => saveAccountTreeState(`sidebar-tree:docs:${rootProjectPath}`, state) : undefined}
                            compact
                            selectedPath={project === DEFAULT_PROJECT ? activePath : null}
                            readOnly={isGuest || !caps.filesRead || !caps.filesWrite}
                            canUseCommands={canUseTerminal}
                            canUseGit={caps.git}
                            searchFocusSignal={0}
                            newFileSignal={{ n: 0, parentPath: null }}
                            revealSignal={revealSignal}
                            presence={project === DEFAULT_PROJECT ? tabPresence : {}}
                            onSelect={(path) => openMentionedFile(DEFAULT_PROJECT, path, null)}
                            onFileCreated={(relPath) => { void refreshTree(); openMentionedFile(DEFAULT_PROJECT, relPath, null) }}
                            onFolderCreated={refreshTree}
                            onRenamed={() => refreshTree()}
                            onDeleted={() => refreshTree()}
                            onNotice={showToast}
                            registerSearchCancel={() => {}}
                            loadChildren={loadDocsTreeChildren}
                            treeInvalidation={treeInvalidation}
                          />
                        )}
                      </div>
                      {rootSubprojects.map((subproject) => {
                        const expanded = expandedSubprojects.has(subproject.path)
                        return <div key={subproject.path} className="border-b border-edge pb-1">
                          <div className="sticky top-0 z-10 flex items-center gap-0.5 bg-surface-deep">
                            <button
                              type="button"
                              data-path={`@subproject:${subproject.path}`}
                              onClick={() => { sidebarCreate.selectDirectory(`subproject:${subproject.path}`, subproject.path); toggleSubproject(subproject.path) }}
                              className={`flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm font-semibold hover:bg-surface-raised ${expanded ? 'bg-surface-raised text-ink' : 'text-ink-secondary'}`}
                              title={subproject.name}
                            >
                              <ProjectIcon icon={subprojectIcons[subproject.name] ?? 'i:folder'} size={16} />
                              <span className="truncate">{subproject.name}</span>
                            </button>
                            {canUseTerminal && <CommandButtonMenu project={subproject.name} />}
                          </div>
                          {expanded && (
                            <>
                              {loadingSubprojects.has(subproject.path) && (
                                <div className="px-2 py-1 text-xs text-ink-muted">불러오는 중…</div>
                              )}
                              <div className="bg-surface-raised">
                                <FileTree
                                  key={`${WORKSPACE_PROJECT}:${rootProjectPath ?? ''}:${subproject.path}:${workspaceUiRevision}`}
                                  {...sidebarCreate.treeProps(`subproject:${subproject.path}`)}
                                  rootPath={subproject.path}
                                  tree={subprojectTrees[subproject.path] ?? []}
                                  project={WORKSPACE_PROJECT}
                                  stateKey={rootProjectPath ? `sidebar-tree:subproject:${rootProjectPath}:${subproject.path}` : undefined}
                                  accountState={rootProjectPath ? accountTreeStates[`sidebar-tree:subproject:${rootProjectPath}:${subproject.path}`] : undefined}
                                  onAccountStateChange={rootProjectPath ? (state) => saveAccountTreeState(`sidebar-tree:subproject:${rootProjectPath}:${subproject.path}`, state) : undefined}
                                  workspacePath={rootProjectPath}
                                  compact
                                  selectedPath={project === WORKSPACE_PROJECT ? activePath : null}
                                  readOnly={!caps.filesRead || !caps.filesWrite}
                                  canUseCommands={canUseTerminal}
                                  canUseGit={caps.git}
                                  searchFocusSignal={0}
                                  newFileSignal={{ n: 0, parentPath: null }}
                                  revealSignal={revealSignal}
                                  presence={project === WORKSPACE_PROJECT ? tabPresence : {}}
                                  onSelect={(path) => {
                                    openMentionedFile(WORKSPACE_PROJECT, path, null)
                                  }}
                                  onFileCreated={(relPath) => {
                                    refreshTree()
                                    openMentionedFile(WORKSPACE_PROJECT, relPath, null)
                                  }}
                                  onFolderCreated={refreshTree}
                                  onRenamed={handleRenamed}
                                  onDeleted={handleDeleted}
                                  onNotice={showToast}
                                  registerSearchCancel={() => {}}
                                  loadChildren={loadWorkspaceTreeChildren}
                                  treeInvalidation={treeInvalidation}
                                />
                              </div>
                            </>
                          )}
                        </div>
                      })}
                    </>}
                    searchFocusSignal={searchFocusSignal}
                    newFileSignal={newFileSignal}
                    revealSignal={revealSignal}
                    presence={tabPresence}
                    onSelect={(path) => {
                      // 루트 트리는 Documents 탭을 편집 중이어도 그대로 남아 있다. 선택한 파일의
                      // 실제 스코프로 먼저 전환한 뒤 탭을 연다.
                      openMentionedFile(WORKSPACE_PROJECT, path, null)
                    }}
                    onFileCreated={(relPath) => {
                      refreshTree()
                      openMentionedFile(WORKSPACE_PROJECT, relPath, null)
                    }}
                    onFolderCreated={refreshTree}
                    onRenamed={handleRenamed}
                    onDeleted={handleDeleted}
                    onNotice={showToast}
                    registerSearchCancel={registerSidebarSearchCancel}
                  />}
                </div>
                <div className={(sidebarView === 'search' || sidebarView === 'content-search') ? 'h-full' : 'hidden'}>
                  <SearchPanel
                    key={`${rootProjectPath}:${sidebarView}`}
                    focusSignal={projectSearchFocus}
                    readOnly={isGuest || !caps.filesRead || !caps.filesWrite}
                    project={isGuest ? DEFAULT_PROJECT : WORKSPACE_PROJECT}
                    scopes={!isGuest ? [
                      { id: 'docs', label: t('project.documents'), icon: 'i:notes' },
                      ...rootSubprojects.map((subproject) => ({ id: `subproject:${subproject.path}`, label: subproject.name, icon: subprojectIcons[subproject.name] ?? 'i:folder' })),
                    ] : []}
                    mode={sidebarView === 'search' ? 'files' : 'content'}
                    onOpenFileNameResult={!isGuest ? (result) => openMentionedFile(result.project, result.path, null) : undefined}
                    onOpenResult={openSearchResult}
                    onReplaced={refreshTree}
                  />
                </div>
                {canUseTerminal && sidebarView === 'commands' && (
                  <div className="h-full overflow-y-auto">
                    <CommandButtonMenu project={WORKSPACE_PROJECT} inline hideTrigger alwaysOpen />
                  </div>
                )}
              </div>
            </div>
            <div
              onPointerDown={startSidebarResize}
              className="hidden w-1.5 shrink-0 cursor-col-resize touch-none bg-transparent hover:bg-accent md:block"
              aria-hidden="true"
            />
          </div>
        )}

        {/* 편집 칸들 — 분할 배치 그대로다. 칸마다 자기 탭 줄·자기 문서·자기 협업 세션을 가진다 */}
        <DockWorkspace key={rootProjectPath ?? 'pending-workspace'} apiRef={dockRef} initialLayout={layout} value={workspaceUi.dock} onChange={saveDockLayout} onEditorDrop={handleDockEditorDrop} foreground={mobileForegroundPanel}>
        {panes.map(renderEditorPane)}

        {(caps.agent || caps.terminal) && <AgentPanel
          key={rootProjectPath ?? 'pending-workspace'} project={project} workspacePath={rootProjectPath} tree={tree}
          focusedFilePath={activeTab && !isExternalTabPath(activeTab.path) ? activeTab.path : null}
          getSelectedText={getSelectedText} renderCommandButtons={renderTermButtons} onOpenFile={openMentionedFile}
          allowAgent={caps.agent} allowTerminal={caps.terminal} agentOpen={caps.agent && agentOpen} terminalOpen={caps.terminal && terminalOpen} foregroundKind={mobileForegroundPanel}
          onPanelFocus={(kind) => { activeTabbedSurfaceRef.current = kind; lastPanelRef.current = kind; bringWorkspacePanelToFront(kind) }}
          onClose={() => closeWorkspacePanel('agent')} onCloseTerminal={() => closeWorkspacePanel('terminal')}
          nextTabSignal={agentNextTabSignal} previousTabSignal={agentPreviousTabSignal}
        />}
        {caps.browser && browserMounted.current && <BrowserPanel visible={browserOpen} onClose={() => closeWorkspacePanel('browser')}
          onPanelFocus={() => { activeTabbedSurfaceRef.current = 'browser'; bringWorkspacePanelToFront('browser') }}
          nextTabSignal={browserNextTabSignal} previousTabSignal={browserPreviousTabSignal} />}
        {caps.git && workspaceUiLoaded && gitMounted.current && <GitPanel visible={gitOpen} initialState={workspaceUi.git} onChange={saveGitPanelState}
          onNotice={showToast} onClose={() => closeWorkspacePanel('git')}
          onPanelFocus={() => { activeTabbedSurfaceRef.current = 'git'; bringWorkspacePanelToFront('git') }}
          nextTabSignal={gitNextTabSignal} previousTabSignal={gitPreviousTabSignal} />}
        </DockWorkspace>

        {/* 채팅 창 — 에이전트·터미널과 같은 오른쪽 붙임 칸. 모바일에서도 프로젝트 탭 아래에서만 열린다. */}
        {chatOpen && caps.chat && (
          <div
            onPointerDownCapture={() => bringWorkspacePanelToFront('chat')}
            className={`fixed inset-x-0 top-10 bottom-0 flex md:static md:z-auto md:w-[22rem] md:shrink-0 ${mobilePanelLayer('chat')}`}
          >
            <div className="hidden w-1.5 shrink-0 border-l border-edge md:block" aria-hidden="true" />
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <ChatPanel
                  authEmail={authEmail}
                  authDisplayName={auth.displayName}
                project={project}
                tree={tree}
                onOpenFile={openMentionedFile}
                onClose={() => closeWorkspacePanel('chat')}
              />
            </div>
          </div>
        )}

        {androidOpen && caps.android && (
          <div
            onPointerDownCapture={() => bringWorkspacePanelToFront('android')}
            className={`fixed inset-x-0 top-10 bottom-0 flex md:static md:z-auto md:shrink-0 ${mobilePanelLayer('android')}`}
            style={{ width: isDesktop() ? androidWidth : undefined }}
          >
            <div
              onPointerDown={startAndroidResize}
              className="hidden w-1.5 shrink-0 cursor-col-resize touch-none border-l border-edge bg-transparent hover:bg-accent md:block"
              aria-hidden="true"
            />
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <AndroidPanel onClose={() => closeWorkspacePanel('android')} />
            </div>
          </div>
        )}
      </div>

      <Mewcat skin={mewcatSkin} />

      <FabMenu
        onFullscreen={toggleFullscreen}
        onNextWindowTab={switchCurrentWindowTabRight}
        onToggleTerminal={() => { if (canUseTerminal) toggleWorkspacePanel('terminal') }}
        onPrevWindowTab={switchCurrentWindowTabLeft}
        onToggleAgent={() => { if (caps.agent) toggleWorkspacePanel('agent') }}
        onOpenEditor={closeAllWorkspacePanels}
        onToggleSidebar={() => toggleWorkspacePanel('sidebar')}
        onToggleBrowser={() => { if (caps.browser) toggleWorkspacePanel('browser') }}
      />

      {settingsOpen && (
        <SettingsModal
          email={authEmail}
          displayName={auth.displayName}
          avatarDataUrl={auth.avatarDataUrl}
          canEditIgnore={caps.system}
          theme={theme}
          fontPreferences={fontPreferences}
          accentColor={accentColor}
          mewcatSkin={mewcatSkin}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          onFontPreferencesChange={setFontPreferences}
          onAccentColorChange={setAccentColor}
          onMewcatSkinChange={setMewcatSkin}
          onClose={() => {
            setFontPreferences((fonts) => normalizeFontPreferences(fonts))
            setSettingsOpen(false)
          }}
          onLoggedOut={onLoggedOut}
          onProfileChanged={onProfileChanged}
        />
      )}

      {adminOpen && isOwner && <AdminSettingsModal onClose={() => setAdminOpen(false)} />}

      {docsSettingsOpen && isOwner && (
        <DocsSettingsModal
          onDone={(message) => {
            showToast(message)
            // 가져오기로 폴더가 통째로 바뀌었을 수 있다 — 보고 있는 트리를 다시 받는다
            void refreshTree()
          }}
          onClose={() => setDocsSettingsOpen(false)}
        />
      )}

      {openProjectDialog && isOwner && (
        <OpenProjectDialog
          basePath={rootProjectPath ?? ''}
          onOpen={openRootProject}
          onClose={() => setOpenProjectDialog(false)}
        />
      )}

      {closeProjectPath && (
        <ConfirmDialog
          message={`프로젝트 "${projectLabel(closeProjectPath)}" 탭을 닫을까요?`}
          detail="프로젝트 파일은 삭제되지 않으며, 나중에 + 탭에서 다시 열 수 있습니다."
          confirmLabel="닫기"
          onConfirm={() => void closeRootProject(closeProjectPath)}
          onCancel={() => setCloseProjectPath(null)}
        />
      )}

      {serverFileExplorerOpen && caps.serverFiles && (
        <ServerFileExplorer
          isOwner={isOwner}
          onOpenFile={(path) => {
            openExternalFile(path)
          }}
          onRenamed={(oldPath, newPath, type) => remapPaths(externalTabPath(oldPath), externalTabPath(newPath), type)}
          onDeleted={(path, type) => removePaths(externalTabPath(path), type)}
          onClose={() => setServerFileExplorerOpen(false)}
        />
      )}

      {dbListOpen && caps.database && <DatabaseListModal onClose={() => setDbListOpen(false)} />}

      {sysStatsOpen && caps.system && <SystemStatsModal onClose={() => setSysStatsOpen(false)} />}
      {remoteDesktopOpen && caps.desktop && <RemoteDesktop onClose={() => setRemoteDesktopOpen(false)} />}
      {scheduleOpen && caps.schedules && <ScheduleModal onClose={() => setScheduleOpen(false)} />}

      {historyOpen && activeTab && (
        <FileHistoryModal
          path={activeTab.path}
          canRevert={canRevertActiveTab}
          editorApi={editorApi}
          tree={tree}
          onRevert={handleRevertFile}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {toast}
    </div>
  )
}

const GUEST_AUTH: AuthStatus = { authenticated: false, email: null, role: 'guest', mustChangePassword: false, displayName: null, avatarDataUrl: null }

/** 인증은 선택 사항 — 로그인하지 않으면 게스트로 EditorApp이 바로 뜬다. 로그인 버튼은 EditorApp 안에서 이 모달을 연다. */
function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)

  // 본문 캐시 칸을 신원과 함께 옮긴다 — setState보다 **먼저** 불러야 한다. EditorApp의 탭 복원은
  // 자식 이펙트라 App의 이펙트보다 먼저 도는데, 그 시점에 칸이 안 바뀌어 있으면 캐시를 못 읽는다
  // (그리고 로그아웃 뒤 남의 본문을 읽어 버린다).
  const applyAuth = useCallback((status: AuthStatus) => {
    setContentIdentity(status.email)
    const permissionVersion = JSON.stringify([status.email, status.role, status.accessRevision, status.capabilities])
    try {
      if (localStorage.getItem('mew:access-version') !== permissionVersion) clearFileContentCache()
      localStorage.setItem('mew:access-version', permissionVersion)
    } catch { clearFileContentCache() }
    setAuth(status)
  }, [])

  useEffect(() => {
    fetchAuthStatus()
      .then(applyAuth)
      .catch((err) => {
        console.error(err)
        applyAuth(GUEST_AUTH)
      })
  }, [applyAuth])

  useEffect(() => {
    function onExpired() {
      applyAuth(GUEST_AUTH)
    }
    window.addEventListener('mew:auth-expired', onExpired)
    return () => window.removeEventListener('mew:auth-expired', onExpired)
  }, [applyAuth])

  useEffect(() => {
    const refresh = () => { clearFileContentCache(); void fetchAuthStatus().then(applyAuth).catch(() => {}) }
    window.addEventListener('mew:permissions-changed', refresh)
    return () => window.removeEventListener('mew:permissions-changed', refresh)
  }, [applyAuth])

  if (!auth) {
    return <div className="bg-surface" style={{ height: '100dvh' }} />
  }

  return (
    <>
      <EditorApp
        key={auth.email ?? 'guest'}
        auth={auth}
        onLoggedOut={() => applyAuth(GUEST_AUTH)}
        onRequestLogin={() => setLoginOpen(true)}
        onProfileChanged={(profile) => setAuth((current) => (current ? { ...current, ...profile } : current))}
      />
      {loginOpen && (
        <LoginPage
          onClose={() => setLoginOpen(false)}
          onSuccess={(status) => {
            applyAuth(status)
            setLoginOpen(false)
          }}
        />
      )}
    </>
  )
}

export default App
