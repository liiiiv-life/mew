import { useCallback, useEffect, useRef, useState } from 'react'
import {
  editorApi,
  fetchAuthStatus,
  fetchWorkspace,
  fetchTree,
  getProject,
  isArchivedPath,
  revertFileToCommit,
  setProject,
  switchWorkspace,
  tmuxApi,
  type AuthStatus,
  type TreeNode,
} from './api/client'
import { RootProjectTabs } from './components/RootProjectTabs'
import { OpenProjectDialog } from './components/OpenProjectDialog'
import { DocsSettingsModal } from './components/DocsSettingsModal'
import { HeaderMenu, type HeaderMenuItem } from './components/HeaderMenu'
import { FabMenu } from './components/FabMenu'
import { ServerFileExplorer } from './components/ServerFileExplorer'
import { LoginPage } from './components/LoginPage'
import { SettingsModal } from './components/SettingsModal'
import { AdminSettingsModal } from './components/AdminSettingsModal'
import { DatabaseListModal } from './components/DatabaseListModal'
import { SystemStatsModal } from './components/SystemStatsModal'
import { ScheduleModal } from './components/ScheduleModal'
import { FileTree } from './components/FileTree'
import { CommandButtonMenu } from './components/CommandButtonMenu'
import { SearchPanel } from './components/SearchPanel'
import type { SearchMatch } from './api/client'
import { TmuxTerminalPanel } from '@mew/tmux-term'
import { AgentPanel } from './components/AgentPanel'
import { AgentSetPanel } from './components/AgentSetPanel'
import { BrowserPanel } from './components/BrowserPanel'
import { AndroidPanel } from './components/AndroidPanel'
import { ChatPanel } from './components/ChatPanel'
import { FileHistoryModal } from './components/FileHistoryModal'
import { getBinding, matchesShortcut } from '@mew/shortcuts'
import { hasDirPathDrag, hasPathDrag, pathFromDrag, useToast } from '@mew/ui'
import { useSwipeGesture } from '@mew/mobile-keys'
import { EditorPane, type PaneHandle } from './components/EditorPane'
import { TermButtonBar } from './components/TermButtonBar'
import { mediaKind } from './utils/media'
import { setContentIdentity } from './utils/contentCache'
import { openTabsKey, useTabs } from './hooks/useTabs'
import { dropZoneAt, paneIds, type DropSide, type DropZone, type PaneNode } from './utils/paneTree'
import { usePresence } from './hooks/usePresence'
import { usePanelWidth } from './hooks/usePanelWidth'
import { outsideTerminal } from './utils/terminalFocus'
import { pickRefTarget, type RefPanel } from './utils/refTarget'
import { WORKSPACE_PROJECT } from './utils/active-project'
import { useWorkspacePanelDismissals } from './hooks/use-panel-dismissals'
import { useI18n } from './i18n'
import { applyFontPreferences, loadFontPreferences, normalizeFontPreferences, saveFontPreferences } from './utils/fontPreferences'
import { externalTabPath, isExternalTabPath } from './utils/externalFiles'

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen().catch(() => {})
}

const isDesktop = () => window.matchMedia('(min-width: 768px)').matches

type Theme = 'dark' | 'light'
const THEME_KEY = 'mew:theme'
const TOC_KEY = 'mew:toc-open'
const TMUX_OPEN_KEY = 'mew:tmux-open'
/** 에이전트 창이 열려 있었는지 — 터미널과 같이 프로젝트와 무관한 화면 상태다(세션 스코프가 워크스페이스다) */
const AGENT_OPEN_KEY = 'mew:agent-open'
const AGENT_SET_OPEN_KEY = 'mew:agent-set-open'
const BROWSER_OPEN_KEY = 'mew:browser-open'
const ANDROID_OPEN_KEY = 'mew:android-open'
const OPEN_PROJECTS_KEY = 'mew:open-project-paths'
/** 지울 수 없는 기본 프로젝트 — 보고 있던 프로젝트가 사라지면 여기로 빠진다 */
const DEFAULT_PROJECT = 'docs'
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

function projectLabel(projectPath: string | null): string {
  if (!projectPath) return 'Project'
  return projectPath.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || projectPath
}

// 터미널이 열려 있었는지는 프로젝트와 무관한 화면 상태다(tmux 세션은 워크스페이스 하나뿐).
// 예전에는 프로젝트별 탭 저장분 안에 함께 들어 있었으므로 그쪽도 한 번 봐준다.
function loadTmuxOpen(project: string): boolean {
  const own = localStorage.getItem(TMUX_OPEN_KEY)
  if (own !== null) return own === '1'
  try {
    const raw = localStorage.getItem(openTabsKey(project))
    return raw ? (JSON.parse(raw) as { tmuxOpen?: boolean }).tmuxOpen === true : false
  } catch {
    return false
  }
}

interface EditorAppProps {
  /** 로그인 상태 — 로그인하지 않았으면 role: 'guest', email: null */
  auth: AuthStatus
  onLoggedOut: () => void
  onRequestLogin: () => void
}

function EditorApp({ auth, onLoggedOut, onRequestLogin }: EditorAppProps) {
  const { t } = useI18n()
  const { role, email: authEmail } = auth
  const isGuest = role === 'guest'
  const isOwner = role === 'owner'
  const canUseTerminal = role === 'owner' || role === 'manager'

  // 사용자에게 보이는 프로젝트는 서버가 현재 연 루트 폴더다. 내부 API 식별자는 호환을 위해
  // `.workspace`를 유지하고 Documents를 열 때만 `docs`로 전환한다.
  const [project, setActiveProject] = useState(() => {
    const initial = isGuest ? DEFAULT_PROJECT : WORKSPACE_PROJECT
    setProject(initial)
    return initial
  })
  const [rootProjectPath, setRootProjectPath] = useState<string | null>(null)
  // 절대경로 탭 목록은 owner UI에만 노출한다. manager는 셸 권한상 현재 경로를 볼 수 있지만 다른
  // 브라우저 사용자가 남긴 owner 전용 목록까지 물려받지는 않는다.
  const [openProjectPaths, setOpenProjectPaths] = useState<string[]>(() => (isOwner ? loadOpenProjectPaths() : []))
  const [openProjectDialog, setOpenProjectDialog] = useState(false)

  const [tree, setTree] = useState<TreeNode[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop)
  const [tmuxOpen, setTmuxOpen] = useState(() => canUseTerminal && loadTmuxOpen(getProject()))
  // 에이전트 창은 터미널과 같은 게이트(owner/manager) — 셸을 쓸 수 있기 때문(ADR 0034).
  // 열려 있었는지도 터미널과 같이 기억한다 — 열린 채로 껐으면 다시 켤 때 그 탭에서 이어 한다
  const [agentOpen, setAgentOpen] = useState(() => canUseTerminal && localStorage.getItem(AGENT_OPEN_KEY) === '1')
  // 에이전트셋 창 — 에이전트 창과 별개다(여러 셋에게 시켜 두고 구경하는 자리). 같은 게이트를 쓴다
  const [agentSetOpen, setAgentSetOpen] = useState(() => canUseTerminal && localStorage.getItem(AGENT_SET_OPEN_KEY) === '1')
  // 브라우저 창 — 서버 localhost를 프록시로 보는 도구라 터미널과 같은 게이트(owner/manager)를 쓴다
  const [browserOpen, setBrowserOpen] = useState(() => canUseTerminal && localStorage.getItem(BROWSER_OPEN_KEY) === '1')
  // Android 패널 — emulator는 외부 도구라 여기서는 상태 점검과 loopback gateway 표시만 한다
  const [androidOpen, setAndroidOpen] = useState(() => canUseTerminal && localStorage.getItem(ANDROID_OPEN_KEY) === '1')
  // 멤버 채팅 창(Alt+C) — 사람끼리 쓰는 창이라 로그인만 하면 열린다(게스트 제외)
  const [chatOpen, setChatOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [dbListOpen, setDbListOpen] = useState(false)
  const [sysStatsOpen, setSysStatsOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  // docs 탭을 꾹 누르면 뜨는 폴더 가져오기/내보내기 창 — owner 전용
  const [docsSettingsOpen, setDocsSettingsOpen] = useState(false)
  // 채팅 멘션·에이전트 답변의 파일 링크 — 다른 프로젝트면 옮긴 다음 렌더에서 파일과 줄을 연다
  const [pendingOpen, setPendingOpen] = useState<{ project: string; path: string; line: number | null } | null>(null)
  const [serverFileExplorerOpen, setServerFileExplorerOpen] = useState(false)
  const [tocOpen, setTocOpen] = useState(() => localStorage.getItem(TOC_KEY) !== '0')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [fontPreferences, setFontPreferences] = useState(loadFontPreferences)
  const [searchFocusSignal, setSearchFocusSignal] = useState(0)
  // 사이드바 뷰: 파일 탐색기 vs 프로젝트 전체 검색(Ctrl+Shift+F). projectSearchFocus는 검색창 포커스 신호
  const [sidebarView, setSidebarView] = useState<'files' | 'search'>('files')
  const [projectSearchFocus, setProjectSearchFocus] = useState(0)
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

  const refreshTree = useCallback(() => fetchTree().then(setTree).catch(console.error), [])

  const rememberProjectPath = useCallback((projectPath: string) => {
    setOpenProjectPaths((previous) => {
      const next = [...new Set([...previous, projectPath])]
      localStorage.setItem(OPEN_PROJECTS_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const openRootProject = useCallback(async (projectPath: string) => {
    rememberProjectPath(projectPath)
    setProject(WORKSPACE_PROJECT)
    if (projectPath === rootProjectPath) {
      setActiveProject(WORKSPACE_PROJECT)
      setOpenProjectDialog(false)
      return
    }
    await switchWorkspace(projectPath)
    location.reload()
  }, [rememberProjectPath, rootProjectPath])

  /**
   * 프로젝트 전환 — 페이지 이동이 아니다. client.ts의 모듈 값을 **먼저 동기로** 바꾼 뒤 리렌더를
   * 걸어야, 이번 렌더에서 나가는 요청들이 전부 새 프로젝트로 간다.
   */
  const switchProject = useCallback((name: string) => {
    setProject(name)
    setActiveProject(name)
  }, [])

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
    splitWithTab,
    splitEmptyPane,
    remapPaths,
    removePaths,
  } = useTabs(project, refreshTree, showToast)

  const hasOpenFiles = panes.some((pane) => pane.tabs.length > 0)
  useEffect(() => {
    // 복원 전에는 항상 빈 칸으로 한 번 렌더된다. 저장된 파일 탭이 실제로 복원된 뒤 판정해야
    // 파일이 있는 프로젝트에서 사이드바가 잘못 열리지 않는다.
    if (tabsHydrated && !hasOpenFiles) setSidebarOpen(true)
  }, [project, tabsHydrated, hasOpenFiles])

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
  const dropTargetAt = (fromPaneId: string, x: number, y: number): { paneId: string; zone: DropZone } | null => {
    const bar = hitAt(paneBarEls.current, x, y)
    if (bar) return bar.id === fromPaneId ? null : { paneId: bar.id, zone: 'center' }
    const hit = hitAt(paneEls.current, x, y)
    if (!hit) return null
    const zone = dropZoneAt(hit.rect, x, y)
    // 제 칸 가운데로 놓기 = 아무 일도 없음 — 그림자도 띄우지 않는다
    if (zone === 'center' && hit.id === fromPaneId) return null
    return { paneId: hit.id, zone }
  }

  const handleTabDragMove = useCallback((paneId: string, _path: string, x: number, y: number) => {
    setDropTarget(dropTargetAt(paneId, x, y))
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
    openFile(path, { paneId, preview: false, forceNewTab: true })
  }

  const handleTabDrop = useCallback(
    (paneId: string, path: string, x: number, y: number) => {
      setDropTarget(null)
      const target = dropTargetAt(paneId, x, y)
      if (!target) return
      if (target.zone === 'center') moveTabToPane(path, paneId, target.paneId)
      else splitWithTab(path, paneId, target.paneId, target.zone)
    },
    [moveTabToPane, splitWithTab],
  )

  // 경로별로 지금 몇 개의 세션이 이 문서를 "포커스"하고 있는지 (열어만 둔 탭은 안 셈)
  // + 서버 watcher의 트리 변경 알림 — 다른 세션·에이전트가 만든 파일도 사이드바에 바로 반영
  const tabPresence = usePresence(project, activePath && !isExternalTabPath(activePath) ? activePath : null, authEmail, refreshTree)

  const { width: sidebarWidth, startResize: startSidebarResize } = usePanelWidth('mew:sidebar-width', {
    min: 180,
    max: 480,
    initial: 256,
  })
  const { width: tmuxWidth, startResize: startTmuxResize } = usePanelWidth('mew:tmux-panel-width', {
    min: 320,
    max: 1000,
    initial: 640,
    invert: true, // 패널이 화면 오른쪽에 붙어 있으므로 왼쪽으로 끌수록 넓어진다
  })
  const { width: agentWidth, startResize: startAgentResize } = usePanelWidth('mew:agent-panel-width', {
    min: 320,
    max: 1000,
    initial: 416,
    invert: true,
  })
  const { width: browserWidth, startResize: startBrowserResize } = usePanelWidth('mew:browser-panel-width', {
    min: 360,
    max: 1200,
    initial: 720,
    invert: true,
  })
  const { width: androidWidth, startResize: startAndroidResize } = usePanelWidth('mew:android-panel-width', {
    min: 380,
    max: 1200,
    initial: 760,
    invert: true,
  })

  // 탭 전환·창 전환 스와이프는 편집 칸이 각자 처리한다 (EditorPane) — 칸마다 탭 줄이 따로다
  const sidebarSwipe = useSwipeGesture({ onBottomLeft: () => setSidebarOpen(false) })
  const tmuxSwipe = useSwipeGesture({ onBottomRight: () => setTmuxOpen(false) })

  // Esc·안드로이드 뒤로가기로 열린 것을 한 겹씩 닫는다 — 모달·팝업도 같은 스택에 등록돼 있어
  // (useOverlayDismiss) 그쪽이 떠 있으면 언제나 먼저 닫히고, 패널은 마지막에 닫힌다.
  // App이 직접 소유하는 보조 패널은 여기 한 번에 등록한다. 모달·드롭다운은 각 컴포넌트가 같은 전역
  // 오버레이 스택에 등록하므로, Esc·모바일 뒤로가기는 가장 나중에 연 창 하나만 닫는다.
  useWorkspacePanelDismissals({
    sidebar: {
      open: sidebarOpen,
      close: () => setSidebarOpen(false),
      // 검색 중이면 첫 Esc는 FileTree가 소비한다. 검색이 비어 있을 때 다음 Esc가 패널을 닫는다.
      closeOnEscape: () => !(sidebarSearchCancelRef.current?.() ?? false),
    },
    chat: { open: chatOpen, close: () => setChatOpen(false) },
    agent: { open: agentOpen, close: () => setAgentOpen(false) },
    agentSet: { open: agentSetOpen, close: () => setAgentSetOpen(false) },
    terminal: { open: tmuxOpen, close: () => setTmuxOpen(false), closeOnEscape: outsideTerminal },
    browser: { open: browserOpen, close: () => setBrowserOpen(false) },
    android: { open: androidOpen, close: () => setAndroidOpen(false) },
  })

  const activeRelativePath = activeTab?.path ?? null

  // Ctrl+L 참조는 **마지막으로 연 보조창 하나**에만 간다(예전엔 열려 있는 창 전부가 받아 적었다).
  // 여는 순간을 기억해 두고, 그 창이 닫혀 있으면 지금 열려 있는 다른 창으로 흘려보낸다.
  const lastPanelRef = useRef<RefPanel | null>(null)
  // 플로팅 핸들의 "현재 창 탭" 명령이 가리키는 마지막 탭형 창.
  // 핸들을 누르면 DOM 포커스가 옮겨가므로 포커스 대신 포인터 사용 기록을 따로 둔다.
  const activeTabbedSurfaceRef = useRef<'editor' | 'agent' | 'tmux'>('editor')
  const [agentNextTabSignal, setAgentNextTabSignal] = useState(0)
  const [tmuxNextTabSignal, setTmuxNextTabSignal] = useState(0)
  useEffect(() => {
    if (agentOpen) {
      lastPanelRef.current = 'agent'
      activeTabbedSurfaceRef.current = 'agent'
    }
  }, [agentOpen])
  useEffect(() => {
    if (tmuxOpen) {
      lastPanelRef.current = 'tmux'
      activeTabbedSurfaceRef.current = 'tmux'
    }
  }, [tmuxOpen])
  useEffect(() => {
    if (chatOpen) lastPanelRef.current = 'chat'
  }, [chatOpen])

  const switchProjectRight = useCallback(() => {
    const destinations = [...new Set(rootProjectPath ? [...openProjectPaths, rootProjectPath] : openProjectPaths)]
    if (destinations.length === 0) return
    const index = rootProjectPath ? destinations.indexOf(rootProjectPath) : -1
    void openRootProject(destinations[index < 0 ? 0 : (index + 1) % destinations.length])
  }, [openProjectPaths, openRootProject, rootProjectPath])

  const switchCurrentWindowTabRight = useCallback(() => {
    let surface = activeTabbedSurfaceRef.current
    if (surface === 'agent' && !agentOpen) surface = tmuxOpen ? 'tmux' : 'editor'
    if (surface === 'tmux' && !tmuxOpen) surface = agentOpen ? 'agent' : 'editor'
    activeTabbedSurfaceRef.current = surface
    if (surface === 'agent') {
      setAgentNextTabSignal((value) => value + 1)
      return
    }
    if (surface === 'tmux') {
      setTmuxNextTabSignal((value) => value + 1)
      return
    }
    if (tabs.length < 2 || !activePath) return
    const index = tabs.findIndex((tab) => tab.path === activePath)
    if (index < 0) return
    setActivePath(tabs[(index + 1) % tabs.length].path, focusedPaneId)
  }, [activePath, agentOpen, focusedPaneId, setActivePath, tabs, tmuxOpen])


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
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    applyFontPreferences(fontPreferences)
    saveFontPreferences(fontPreferences)
  }, [fontPreferences])

  useEffect(() => {
    localStorage.setItem(TOC_KEY, tocOpen ? '1' : '0')
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
    if (!canUseTerminal) return
    fetchWorkspace()
      .then((info) => {
        setRootProjectPath(info.path)
        rememberProjectPath(info.path)
      })
      .catch(console.error)
  }, [canUseTerminal, rememberProjectPath])

  // 프로젝트를 옮기면 사이드바 트리를 그 프로젝트 것으로 갈아끼운다. 옆 프로젝트의 트리가 잠깐
  // 남아 있지 않도록 먼저 비우고, 늦게 도착한 옛 응답이 새 트리를 덮지 않게 취소 플래그를 둔다.
  useEffect(() => {
    let alive = true
    setTree([])
    fetchTree()
      .then((next) => {
        if (alive) setTree(next)
      })
      .catch(console.error)
    return () => {
      alive = false
    }
  }, [project])

  // 옛 `/{프로젝트}` 주소로 들어왔으면 주소만 루트로 정리한다 — 프로젝트는 이미 그것으로 시작했다
  useEffect(() => {
    if (location.pathname !== '/') history.replaceState(null, '', '/')
  }, [])

  useEffect(() => {
    localStorage.setItem(TMUX_OPEN_KEY, tmuxOpen ? '1' : '0')
  }, [tmuxOpen])

  useEffect(() => {
    localStorage.setItem(AGENT_OPEN_KEY, agentOpen ? '1' : '0')
  }, [agentOpen])

  useEffect(() => {
    localStorage.setItem(AGENT_SET_OPEN_KEY, agentSetOpen ? '1' : '0')
  }, [agentSetOpen])

  useEffect(() => {
    localStorage.setItem(BROWSER_OPEN_KEY, browserOpen ? '1' : '0')
  }, [browserOpen])

  useEffect(() => {
    localStorage.setItem(ANDROID_OPEN_KEY, androidOpen ? '1' : '0')
  }, [androidOpen])

  const handleFileCreated = useCallback(
    (relPath: string) => {
      refreshTree()
      openFile(relPath, { preview: false })
    },
    [refreshTree, openFile],
  )

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
        setSidebarView('files')
        setSidebarOpen(true)
        setSearchFocusSignal((s) => s + 1)
      } else if (matchesShortcut(e, getBinding('projectSearch'))) {
        // VSCode Ctrl+Shift+F — 사이드바를 검색 뷰로 열고 검색창에 포커스
        e.preventDefault()
        setSidebarOpen(true)
        setSidebarView('search')
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
        const target = pickRefTarget(lastPanelRef.current, { agent: agentOpen, tmux: tmuxOpen, chat: chatOpen })
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
        if (isGuest) return
        e.preventDefault()
        setChatOpen((v) => !v)
      } else if (matchesShortcut(e, getBinding('toggleBrowser'))) {
        if (!canUseTerminal) return
        e.preventDefault()
        setBrowserOpen((v) => !v)
      } else if (matchesShortcut(e, getBinding('addComment'))) {
        // 지금 포커스된 칸의 선택(없으면 커서) 자리에 댓글 작성 팝업 — 텍스트 편집기가 아니면 아무 일도 없다
        if (isGuest) return
        e.preventDefault()
        focusedEditor()?.startComment()
      } else if (matchesShortcut(e, getBinding('toggleTerminal'))) {
        // VSCode처럼 어디에 포커스가 있어도 터미널을 토글한다 (Shift 조합 ~ 포함)
        if (!canUseTerminal) return
        e.preventDefault()
        setTmuxOpen((v) => !v)
      } else if (matchesShortcut(e, getBinding('toggleSidebar'))) {
        // 에디터의 Ctrl+B(굵게, defaultPrevented로 감지)와 터미널의 tmux prefix에는 양보한다
        if (e.defaultPrevented || (e.target instanceof HTMLElement && e.target.closest('.xterm'))) return
        e.preventDefault()
        setSidebarOpen((v) => !v)
      } else if (matchesShortcut(e, getBinding('closeTab'))) {
        // Ctrl+W는 Chromium이 예약한 브라우저 단축키라 preventDefault로 막을 수 없어 기본값은 Alt+W다
        e.preventDefault()
        if (activePath) closeTab(activePath)
      } else if (matchesShortcut(e, getBinding('newTab'))) {
        // Ctrl+N도 마찬가지로 브라우저 예약 단축키라 가로챌 수 없어 기본값은 Alt+N이다.
        // 빈 탭이 아니라 새 파일 흐름 — 사이드바에 포커스면 거기 선택된 항목 기준(FileTree가
        // 알고 있다), 에디터 등 다른 곳이면 활성 문서와 같은 폴더에 이름 입력을 연다
        e.preventDefault()
        const inSidebar = e.target instanceof HTMLElement && !!e.target.closest('[data-sidebar]')
        const parentPath = !inSidebar && activeTab?.path ? activeTab.path.split('/').slice(0, -1).join('/') : null
        setSidebarView('files')
        setSidebarOpen(true)
        setNewFileSignal((s) => ({ n: s.n + 1, parentPath }))
      } else if (matchesShortcut(e, getBinding('prevTab')) || matchesShortcut(e, getBinding('nextTab'))) {
        // Ctrl+Alt+←/→ 탭 이동 — 끝에 닿으면 반대편으로 감싼다. 터미널에 포커스가 있어도 동작한다
        // (TmuxTerminal이 이 조합을 PTY로 보내지 않고 통과시킨다)
        if (tabs.length < 2) return
        e.preventDefault()
        const dir = matchesShortcut(e, getBinding('nextTab')) ? 1 : -1
        const current = Math.max(0, tabs.findIndex((t) => t.path === activePath))
        setActivePath(tabs[(current + dir + tabs.length) % tabs.length].path)
      } else if (matchesShortcut(e, getBinding('toggleTerminalAlt'))) {
        if (!canUseTerminal) return
        e.preventDefault()
        setTmuxOpen((v) => !v)
      } else if (matchesShortcut(e, getBinding('fullscreen'))) {
        e.preventDefault()
        toggleFullscreen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // 보조창 열림 상태는 Ctrl+L이 어디로 보낼지 고를 때 읽는다 — 닫힌 창으로 보내지 않게 최신 값이어야 한다
  }, [saveCurrentTab, closeTab, activePath, activeTab, activeRelativePath, tabs, setActivePath, canUseTerminal, focusedEditor, isGuest, isOwner, project, agentOpen, tmuxOpen, chatOpen])

  /** 채팅 멘션·에이전트 로컬 링크 — 같은 mew의 알맞은 프로젝트와 문서 탭으로 연다. */
  const openMentionedFile = useCallback(
    (target: string, path: string, line: number | null = null) => {
      setPendingOpen({ project: target, path, line })
      if (target !== project) switchProject(target)
    },
    [project, switchProject],
  )

  useEffect(() => {
    if (!pendingOpen || pendingOpen.project !== project) return
    if (pendingOpen.line !== null) setPendingReveal({ path: pendingOpen.path, line: pendingOpen.line })
    openFile(pendingOpen.path, { preview: false })
    // Hotview는 원본 줄과 렌더 블록 위치가 일대일이 아니다. 줄 링크는 Plain으로 열어 정확히 이동한다.
    if (pendingOpen.line !== null && pendingOpen.path.endsWith('.md')) setTabViewMode(pendingOpen.path, 'plain')
    setPendingOpen(null)
  }, [pendingOpen, project, openFile, setTabViewMode])

  // 프로젝트 검색 결과 클릭 — 파일을 열고, 위치 점프 정보를 대기시킨다 (내용 로드 후 아래 effect가 처리)
  const openSearchResult = useCallback(
    (path: string, match: SearchMatch, query: string) => {
      setPendingReveal({ path, line: match.line, query })
      // 큰 파일은 검색 결과 줄 주변을 먼저 읽는다. Markdown은 줄 구조가 화면 구조와 달라 기존 Hotview
      // 검색 경로를 유지하며, plain만 preview가 안전하다.
      openFile(path, path.endsWith('.md') ? { preview: true } : { preview: true, viewMode: 'plain', anchorLine: match.line })
      if (!isDesktop()) setSidebarOpen(false)
    },
    [openFile],
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

  /** 배치 나무를 그대로 화면으로 — 잎이 편집 칸, 가지가 가로(row)·세로(col) 분할이다 */
  const renderLayout = (node: PaneNode, key: string) => {
    if (node.kind === 'leaf') {
      const pane = panes.find((p) => p.id === node.pane)
      if (!pane) return null
      return (
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
          canUseTerminal={canUseTerminal}
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
          onOpenAgent={() => setAgentOpen(true)}
          onSetTocOpen={setTocOpen}
          onOpenSidebar={() => setSidebarOpen(true)}
          onTabDragMove={handleTabDragMove}
          onTabDrop={handleTabDrop}
        />
      )
    }
    return (
      <div
        key={key}
        className={`flex min-h-0 min-w-0 flex-1 divide-edge ${node.dir === 'col' ? 'flex-col divide-y' : 'divide-x'}`}
      >
        {node.kids.map((kid, i) => renderLayout(kid, `${key}.${i}`))}
      </div>
    )
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
    ...(canUseTerminal
      ? [
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
            id: 'terminal',
            label: t('header.terminal'),
            hint: 'Ctrl+`',
            onSelect: () => setTmuxOpen((v) => !v),
            active: tmuxOpen,
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="m7 9 3 3-3 3" />
                <line x1="13" y1="15" x2="17" y2="15" />
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
            id: 'agent',
            label: t('header.agent'),
            onSelect: () => setAgentOpen((open) => !open),
            active: agentOpen,
            // 말풍선 — 채팅 창이지 터미널이 아니다
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.2A8.5 8.5 0 0 1 4 11.5a8.38 8.38 0 0 1 8.5-8.4 8.38 8.38 0 0 1 8.5 8.4z" />
              </svg>
            ),
          },
          {
            id: 'agent-sets',
            label: t('header.agentSets'),
            onSelect: () => setAgentSetOpen((open) => !open),
            active: agentSetOpen,
            // 칸 넷 — 여러 셋이 한 판에 놓인 그리드
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
                <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
                <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
                <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
              </svg>
            ),
          },
          {
            id: 'browser',
            label: t('header.browser'),
            hint: 'Alt+B',
            onSelect: () => setBrowserOpen((open) => !open),
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
            onSelect: () => setAndroidOpen((open) => !open),
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
        ]
      : []),
    ...(isGuest
      ? []
      : [
          {
            id: 'chat',
            label: t('header.chat'),
            hint: 'Alt+C',
            onSelect: () => setChatOpen((open) => !open),
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
      label: isGuest ? t('settings.title') : (authEmail ?? t('settings.title')),
      onSelect: () => setSettingsOpen(true),
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
    ...(isGuest
      ? [
          {
            id: 'login',
            label: t('common.login'),
            onSelect: onRequestLogin,
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <path d="M10 17l5-5-5-5" />
                <path d="M15 12H3" />
              </svg>
            ),
          },
        ]
      : []),
  ]

  return (
    <div className="flex flex-col overflow-hidden bg-surface text-ink" style={{ height: 'var(--app-height, 100dvh)' }}>
      {/* 화면 전폭을 쓰는 줄은 이 헤더 하나뿐이다 — 프로젝트 탭 + 도구 버튼. 문서 탭 줄은 각
          편집 칸 안에 있다(EditorPane). 탭이 줄 높이를 꽉 채워야 하므로 세로 여백은 두지 않는다. */}
      <div className="flex flex-col">
        <header className="flex h-10 items-stretch border-b border-edge pr-2">
          <RootProjectTabs
            paths={rootProjectPath ? [...openProjectPaths, rootProjectPath] : openProjectPaths}
            activePath={rootProjectPath}
            fallbackLabel={projectLabel(rootProjectPath)}
            canOpen={isOwner}
            onActivate={(projectPath) => void openRootProject(projectPath)}
            onOpen={() => setOpenProjectDialog(true)}
          />
          {/* 도구는 전부 햄버거 하나로 접는다 — 아이콘을 늘어놓으면 좁은 화면에서 프로젝트 탭이 밀린다.
              버튼이 아닌 것(게스트 표시·저장 실패 문구)만 헤더에 남는다 */}
          <div className="flex shrink-0 items-center gap-1.5 pl-2 text-sm">
            {isGuest && <span className="rounded bg-surface-raised px-2 py-0.5 text-xs text-ink-secondary">게스트</span>}
            {activeTab?.status === 'error' && (
              <span className="hidden max-w-[12rem] truncate text-danger md:inline">{activeTab.statusMessage}</span>
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
            {...sidebarSwipe}
            data-sidebar
            // 모바일은 프로젝트 헤더 아래의 작업 영역만 덮고, 문서 탭(h-9)도 눌러 전환할 수 있게 남긴다.
            // 홈에는 문서 탭이 없으므로 그때만 작업 영역 맨 위부터 채운다. 데스크톱은 기존 고정 칸이다.
            className="absolute inset-x-0 top-9 bottom-0 z-30 flex bg-surface-deep md:static md:z-auto md:shrink-0"
            style={{ width: isDesktop() ? sidebarWidth : undefined }}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              {/* 탐색기 ↔ 검색(Ctrl+Shift+F) 전환 — 프로젝트 전환 버튼은 헤더 맨 왼쪽에 있다 */}
              <div className="flex items-center gap-1 border-b border-edge px-2 py-1">
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
                  title="프로젝트 전체 검색 (Ctrl+Shift+F)"
                  aria-label="검색"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                </button>
                {canUseTerminal && <CommandButtonMenu project={WORKSPACE_PROJECT} title={`${projectLabel(rootProjectPath)} 명령어`} />}
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="ml-auto rounded p-1 text-ink-muted hover:bg-surface-hover hover:text-ink"
                  title="사이드바 닫기 (Ctrl+B)"
                  aria-label="사이드바 닫기"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <div className={sidebarView === 'files' ? 'h-full' : 'hidden'}>
                  {/* key=project — 프로젝트를 옮기면 펼쳐둔 폴더·선택 상태를 옆 프로젝트로 끌고 가지 않는다 */}
                  <FileTree
                    key={project}
                    tree={tree}
                    project={project}
                    selectedPath={activePath}
                    readOnly={isGuest}
                    canUseCommands={canUseTerminal && project === WORKSPACE_PROJECT}
                    roots={
                      <div className="border-b border-edge py-1">
                        <button
                          type="button"
                          onClick={() => switchProject(DEFAULT_PROJECT)}
                          onContextMenu={(event) => {
                            if (!isOwner) return
                            event.preventDefault()
                            setDocsSettingsOpen(true)
                          }}
                          className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm font-medium hover:bg-surface-raised ${project === DEFAULT_PROJECT ? 'bg-surface-raised text-ink' : 'text-ink-secondary'}`}
                          title={isOwner ? 'Documents · 우클릭하여 폴더 설정' : 'Documents'}
                        >
                          <span aria-hidden="true">{project === DEFAULT_PROJECT ? '▾' : '▸'}</span>
                          <span>{t('project.documents')}</span>
                        </button>
                        {!isGuest && (
                          <button
                            type="button"
                            onClick={() => switchProject(WORKSPACE_PROJECT)}
                            className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm font-semibold hover:bg-surface-raised ${project === WORKSPACE_PROJECT ? 'bg-surface-raised text-ink' : 'text-ink-secondary'}`}
                            title={rootProjectPath ?? undefined}
                          >
                            <span aria-hidden="true">{project === WORKSPACE_PROJECT ? '▾' : '▸'}</span>
                            <span className="truncate">{projectLabel(rootProjectPath)}</span>
                          </button>
                        )}
                      </div>
                    }
                    searchFocusSignal={searchFocusSignal}
                    newFileSignal={newFileSignal}
                    revealSignal={revealSignal}
                    presence={tabPresence}
                    onSelect={(path, opts) => {
                      openFile(path, opts)
                      if (!isDesktop()) setSidebarOpen(false)
                    }}
                    onFileCreated={(relPath) => {
                      handleFileCreated(relPath)
                      if (!isDesktop()) setSidebarOpen(false)
                    }}
                    onFolderCreated={refreshTree}
                    onRenamed={handleRenamed}
                    onDeleted={handleDeleted}
                    onGuestAccessChanged={refreshTree}
                    onNotice={showToast}
                    registerSearchCancel={registerSidebarSearchCancel}
                  />
                </div>
                <div className={sidebarView === 'search' ? 'h-full' : 'hidden'}>
                  <SearchPanel
                    key={project}
                    focusSignal={projectSearchFocus}
                    readOnly={isGuest}
                    onOpenResult={openSearchResult}
                    onReplaced={refreshTree}
                  />
                </div>
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
        {renderLayout(layout, 'root')}

        {/* 채팅 창 — 에이전트·터미널과 같은 오른쪽 붙임 칸. 좁은 화면에서는 전체를 덮는다 */}
        {chatOpen && !isGuest && (
          <div className="fixed inset-0 z-30 flex md:static md:z-auto md:w-[22rem] md:shrink-0">
            <div className="hidden w-1.5 shrink-0 border-l border-edge md:block" aria-hidden="true" />
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <ChatPanel
                authEmail={authEmail}
                project={project}
                tree={tree}
                onOpenFile={openMentionedFile}
                onClose={() => setChatOpen(false)}
              />
            </div>
          </div>
        )}

        {agentOpen && canUseTerminal && (
          <div
            onPointerDownCapture={() => { activeTabbedSurfaceRef.current = 'agent' }}
            className="fixed inset-0 z-30 flex md:static md:z-auto md:shrink-0"
            style={{ width: isDesktop() ? agentWidth : undefined }}
          >
            <div
              onPointerDown={startAgentResize}
              className="hidden w-1.5 shrink-0 cursor-col-resize touch-none border-l border-edge bg-transparent hover:bg-accent md:block"
              aria-hidden="true"
            />
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <AgentPanel project={project} tree={tree} onOpenFile={openMentionedFile} onClose={() => setAgentOpen(false)} nextTabSignal={agentNextTabSignal} />
            </div>
          </div>
        )}

        {agentSetOpen && canUseTerminal && (
          <div className="fixed inset-0 z-30 flex md:static md:z-auto md:w-[30rem] md:shrink-0">
            <div className="hidden w-1.5 shrink-0 border-l border-edge md:block" aria-hidden="true" />
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <AgentSetPanel onOpenFile={openMentionedFile} onClose={() => setAgentSetOpen(false)} />
            </div>
          </div>
        )}

        {tmuxOpen && canUseTerminal && (
          <div
            {...tmuxSwipe}
            onPointerDownCapture={() => { activeTabbedSurfaceRef.current = 'tmux' }}
            className="fixed inset-0 z-30 flex md:static md:z-auto md:shrink-0"
            style={{ width: isDesktop() ? tmuxWidth : undefined }}
          >
            <div
              onPointerDown={startTmuxResize}
              className="hidden w-1.5 shrink-0 cursor-col-resize touch-none border-l border-edge bg-transparent hover:bg-accent md:block"
              aria-hidden="true"
            />
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <TmuxTerminalPanel
                api={tmuxApi}
                onClose={() => setTmuxOpen(false)}
                activeFilePath={activeRelativePath}
                getSelectedText={getSelectedText}
                renderCommandButtons={renderTermButtons}
                nextTabSignal={tmuxNextTabSignal}
              />
            </div>
          </div>
        )}

        {browserOpen && canUseTerminal && (
          <div
            className="fixed inset-0 z-30 flex md:static md:z-auto md:shrink-0"
            style={{ width: isDesktop() ? browserWidth : undefined }}
          >
            <div
              onPointerDown={startBrowserResize}
              className="hidden w-1.5 shrink-0 cursor-col-resize touch-none border-l border-edge bg-transparent hover:bg-accent md:block"
              aria-hidden="true"
            />
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <BrowserPanel onClose={() => setBrowserOpen(false)} />
            </div>
          </div>
        )}

        {androidOpen && canUseTerminal && (
          <div
            className="fixed inset-0 z-30 flex md:static md:z-auto md:shrink-0"
            style={{ width: isDesktop() ? androidWidth : undefined }}
          >
            <div
              onPointerDown={startAndroidResize}
              className="hidden w-1.5 shrink-0 cursor-col-resize touch-none border-l border-edge bg-transparent hover:bg-accent md:block"
              aria-hidden="true"
            />
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <AndroidPanel onClose={() => setAndroidOpen(false)} />
            </div>
          </div>
        )}
      </div>

      <FabMenu
        onFullscreen={toggleFullscreen}
        onNextProject={switchProjectRight}
        onNextWindowTab={switchCurrentWindowTabRight}
      />

      {settingsOpen && (
        <SettingsModal
          email={authEmail}
          canEditIgnore={canUseTerminal}
          theme={theme}
          fontPreferences={fontPreferences}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          onFontPreferencesChange={setFontPreferences}
          onClose={() => {
            setFontPreferences((fonts) => normalizeFontPreferences(fonts))
            setSettingsOpen(false)
          }}
          onLoggedOut={onLoggedOut}
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

      {serverFileExplorerOpen && canUseTerminal && (
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

      {dbListOpen && !isGuest && <DatabaseListModal onClose={() => setDbListOpen(false)} />}

      {sysStatsOpen && canUseTerminal && <SystemStatsModal onClose={() => setSysStatsOpen(false)} />}
      {scheduleOpen && canUseTerminal && <ScheduleModal onClose={() => setScheduleOpen(false)} />}

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

const GUEST_AUTH: AuthStatus = { authenticated: false, email: null, role: 'guest', mustChangePassword: false }

/** 인증은 선택 사항 — 로그인하지 않으면 게스트로 EditorApp이 바로 뜬다. 로그인 버튼은 EditorApp 안에서 이 모달을 연다. */
function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)

  // 본문 캐시 칸을 신원과 함께 옮긴다 — setState보다 **먼저** 불러야 한다. EditorApp의 탭 복원은
  // 자식 이펙트라 App의 이펙트보다 먼저 도는데, 그 시점에 칸이 안 바뀌어 있으면 캐시를 못 읽는다
  // (그리고 로그아웃 뒤 남의 본문을 읽어 버린다).
  const applyAuth = useCallback((status: AuthStatus) => {
    setContentIdentity(status.email)
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
