import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  editorApi,
  fetchAuthStatus,
  fetchProjects,
  fetchTree,
  getProject,
  isArchivedPath,
  revertFileToCommit,
  setProject,
  setProjectLayout,
  tmuxApi,
  type AuthStatus,
  type ProjectInfo,
  type TreeNode,
} from './api/client'
import { ProjectPicker } from './components/ProjectPicker'
import { ProjectTabs } from './components/ProjectTabs'
import { DocsTab } from './components/DocsTab'
import { DocsSettingsModal } from './components/DocsSettingsModal'
import { HomeTab } from './components/HomeTab'
import { HeaderMenu, type HeaderMenuItem } from './components/HeaderMenu'
import { HomePanel } from './components/home/HomePanel'
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher'
import { LoginPage } from './components/LoginPage'
import { SettingsModal } from './components/SettingsModal'
import { AdminSettingsModal } from './components/AdminSettingsModal'
import { DatabaseListModal } from './components/DatabaseListModal'
import { SystemStatsModal } from './components/SystemStatsModal'
import { ScheduleModal } from './components/ScheduleModal'
import { FileTree } from './components/FileTree'
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
import { hasDirPathDrag, hasPathDrag, pathFromDrag, useOverlayDismiss, useToast } from '@mew/ui'
import { useSwipeGesture } from '@mew/mobile-keys'
import { EditorPane, type PaneHandle } from './components/EditorPane'
import { TermButtonBar } from './components/TermButtonBar'
import { mediaKind } from './utils/media'
import { setContentIdentity } from './utils/contentCache'
import { openTabsKey, useTabs } from './hooks/useTabs'
import { applyLayout, bySlot, reorderedLayout } from './utils/projectLayout'
import { dropZoneAt, paneIds, type DropSide, type DropZone, type PaneNode } from './utils/paneTree'
import { usePresence } from './hooks/usePresence'
import { usePanelWidth } from './hooks/usePanelWidth'
import { outsideTerminal } from './utils/terminalFocus'
import { pickRefTarget, type RefPanel } from './utils/refTarget'

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
/** 지울 수 없는 기본 프로젝트 — 보고 있던 프로젝트가 사라지면 여기로 빠진다 */
const DEFAULT_PROJECT = 'docs'
/** 홈 탭의 스코프 — 워크스페이스 폴더 자신을 프로젝트처럼 본다(server/paths.ts의 WORKSPACE_PROJECT).
 *  사이드바는 여기서 워크스페이스 루트를 그린다(프로젝트 폴더·.mew는 서버가 걷어낸다). */
const WORKSPACE_PROJECT = '.workspace'

function loadTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
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
  const { role, email: authEmail } = auth
  const isGuest = role === 'guest'
  const isOwner = role === 'owner'
  const canUseTerminal = role === 'owner' || role === 'manager'

  // 지금 보고 있는 프로젝트. 라우트가 아니라 앱 상태다 — client.ts의 모듈 값과 항상 함께 움직인다.
  const [project, setActiveProject] = useState(getProject)

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
  // 목록이 오기 전의 자리표시자 — 이걸 진짜 목록으로 착각하면 보고 있던 프로젝트가 애먼 것으로 밀린다
  const [projects, setProjects] = useState<ProjectInfo[]>([{ name: project, icon: null, slot: null }])
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  // docs 탭을 꾹 누르면 뜨는 폴더 가져오기/내보내기 창 — owner 전용
  const [docsSettingsOpen, setDocsSettingsOpen] = useState(false)
  // 홈 화면(워크스페이스 전체 — 할 일·달력)이 편집 칸 자리를 차지하고 있는지. 게스트에게는 없다.
  // 홈 탭도 마지막으로 본 화면이면 `mew:project=.workspace`로 남기므로 새로 열 때 그대로 복원한다.
  const [homeOpen, setHomeOpen] = useState(() => !isGuest && getProject() === WORKSPACE_PROJECT)
  // 채팅의 파일 멘션을 누른 것 — 할 일과 같은 이유로 프로젝트를 옮긴 다음 렌더에서 연다
  const [pendingOpen, setPendingOpen] = useState<{ project: string; path: string } | null>(null)
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false)
  const [tocOpen, setTocOpen] = useState(() => localStorage.getItem(TOC_KEY) !== '0')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(loadTheme)
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
  // 프로젝트 검색 결과를 클릭해 파일을 연 뒤, 그 파일 내용이 로드되면 해당 위치로 점프시키기 위한 대기 정보
  const pendingRevealRef = useRef<{ path: string; line: number; query: string } | null>(null)

  // 흐름을 끊지 않는 짧은 안내 — 사이드바 작업 결과가 내 트리에 안 뜨거나, 파일을 못 열었을 때
  const { toast, showToast } = useToast()

  const refreshTree = useCallback(() => fetchTree().then(setTree).catch(console.error), [])

  const refreshProjects = useCallback(
    () =>
      fetchProjects()
        .then((list) => {
          setProjects(list.length > 0 ? list : [{ name: getProject(), icon: null, slot: null }])
          setProjectsLoaded(true)
        })
        .catch(console.error),
    [],
  )

  /**
   * 프로젝트 전환 — 페이지 이동이 아니다. client.ts의 모듈 값을 **먼저 동기로** 바꾼 뒤 리렌더를
   * 걸어야, 이번 렌더에서 나가는 요청들이 전부 새 프로젝트로 간다.
   */
  const switchProject = useCallback((name: string) => {
    setProject(name)
    setActiveProject(name)
    // 탭을 눌렀다는 것은 홈에서 나온다는 뜻이다 — 홈은 프로젝트 위가 아니라 옆에 있는 화면이다
    setHomeOpen(false)
  }, [])

  const {
    panes,
    layout,
    focusedPaneId,
    focusPane,
    tabs,
    activePath,
    activeTab,
    setActivePath,
    openFile,
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
    forgetProject,
  } = useTabs(project, refreshTree, showToast)

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
  const tabPresence = usePresence(project, activePath || null, authEmail, refreshTree)

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
  const homeSwipe = useSwipeGesture({
    onBottomRight: () => setSidebarOpen(true),
    onBottomLeft: () => {
      if (canUseTerminal) setAgentOpen(true)
    },
  })

  // Esc·안드로이드 뒤로가기로 열린 것을 한 겹씩 닫는다 — 모달·팝업도 같은 스택에 등록돼 있어
  // (useOverlayDismiss) 그쪽이 떠 있으면 언제나 먼저 닫히고, 패널은 마지막에 닫힌다.
  // 패널은 bubble 단계라야 안쪽(에디터 슬래시 메뉴, 파일 이름 바꾸기, 터미널의 vim)이 Esc를 먼저 쓴다.
  useOverlayDismiss(tmuxOpen && (() => setTmuxOpen(false)), { escapePhase: 'bubble', closeOnEscape: outsideTerminal })
  useOverlayDismiss(sidebarOpen && (() => setSidebarOpen(false)), { escapePhase: 'bubble' })
  // 채팅도 패널이라 bubble — 안쪽 멘션 목록이 Esc를 먼저 쓰고 stopPropagation 하면 창은 남는다
  useOverlayDismiss(chatOpen && (() => setChatOpen(false)), { escapePhase: 'bubble' })

  const activeRelativePath = activeTab?.path ?? null

  // Ctrl+L 참조는 **마지막으로 연 보조창 하나**에만 간다(예전엔 열려 있는 창 전부가 받아 적었다).
  // 여는 순간을 기억해 두고, 그 창이 닫혀 있으면 지금 열려 있는 다른 창으로 흘려보낸다.
  const lastPanelRef = useRef<RefPanel | null>(null)
  useEffect(() => {
    if (agentOpen) lastPanelRef.current = 'agent'
  }, [agentOpen])
  useEffect(() => {
    if (tmuxOpen) lastPanelRef.current = 'tmux'
  }, [tmuxOpen])
  useEffect(() => {
    if (chatOpen) lastPanelRef.current = 'chat'
  }, [chatOpen])

  // 볼 수 있는 프로젝트는 전부 탭으로 세운다 — 순서는 팝업 격자에서 끌어 정한 자리.
  // docs는 프로젝트가 아니라 따로 선 고정 탭이라 여기서 뺀다(자리표시자로 들어올 수 있다)
  const projectTabs = useMemo(
    () => projects.filter((p) => p.name !== DEFAULT_PROJECT).sort(bySlot),
    [projects],
  )

  // 탭을 끄는 동안엔 화면의 순서만 바꾸고(자리 번호는 팝업 격자와 공유하는 값이다), 손을 뗄 때
  // 한 번만 저장한다 — 탭 하나 지날 때마다 PUT을 날리면 요청들이 서로를 덮어쓴다.
  const reorderProjectTabs = useCallback((from: number, to: number) => {
    setProjects((prev) => {
      const layout = reorderedLayout(prev, from, to)
      return layout ? applyLayout(prev, layout) : prev
    })
  }, [])

  const commitProjectOrder = useCallback(() => {
    const layout: Record<string, number> = {}
    for (const p of projects) if (p.slot != null) layout[p.name] = p.slot
    // 실패하면 서버에 있는 배치를 다시 받아 화면을 되돌린다 — 끌어놓은 자리가 남아 있으면 거짓말이 된다
    setProjectLayout(layout).catch(() => void refreshProjects())
  }, [projects, refreshProjects])

  /** 팝업에서 프로젝트를 고르면 그 프로젝트를 연다 — 페이지 이동이 아니라 탭 전환이다 */
  const chooseProject = useCallback(
    (name: string) => {
      switchProject(name)
      setProjectPickerOpen(false)
    },
    [switchProject],
  )

  const handleProjectRenamed = useCallback(
    (oldName: string, newName: string) => {
      forgetProject(oldName)
      localStorage.removeItem(openTabsKey(oldName))
      if (oldName === project) switchProject(newName)
    },
    [project, forgetProject, switchProject],
  )

  const handleProjectDeleted = useCallback(
    (name: string) => {
      forgetProject(name)
      localStorage.removeItem(openTabsKey(name))
      // 보고 있던 프로젝트가 사라졌으면 지울 수 없는 기본 프로젝트로 빠진다
      if (name === project) switchProject(DEFAULT_PROJECT)
    },
    [project, forgetProject, switchProject],
  )

  // 터미널의 Ctrl+L이 우선 사용할 값 — 포커스된 칸의 활성 뷰(hotview/plain)에서 선택된 텍스트를
  // 읽는다. 선택이 없으면 각 패널이 activeFilePath(상대경로)로 폴백한다.
  const getSelectedText = useCallback(() => focusedEditor()?.getSelectedText() ?? null, [focusedEditor])

  // 터미널 버튼 줄의 명령어 버튼 — 목록은 프로젝트와 무관한 전역 설정이라 패널 바깥에서 주입한다
  const renderTermButtons = useCallback((run: (command: string) => void) => <TermButtonBar run={run} />, [])

  // 되돌리기는 md 문서의 hotview collab 문서를 직접 갈아끼우는 방식이라 그 경로만 지원한다.
  // 다른 세션이 지금 이 문서를 보고 있으면(나 혼자가 아니면) 충돌 가능성이 있어 막는다.
  const canRevertActiveTab =
    !!activeTab?.editable && activeTab.path.endsWith('.md') && (tabPresence[activeTab.path]?.length ?? 0) <= 1

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
    refreshProjects()
  }, [refreshProjects])

  // 기억해 둔 프로젝트가 목록에 없을 수 있다 — 폴더가 사라졌거나, 로그아웃해서 권한을 잃었거나.
  // 그럴 땐 열 수 있는 첫 프로젝트로 물러난다(안 그러면 없는 폴더를 가리킨 채 굳는다).
  useEffect(() => {
    // docs·홈은 프로젝트 목록에 없는 특별 스코프다 — 목록에 없다고 밀어내면 안 된다
    if (project === DEFAULT_PROJECT || project === WORKSPACE_PROJECT) return
    if (!projectsLoaded || projectTabs.length === 0) return
    if (projectTabs.some((p) => p.name === project)) return
    switchProject(projectTabs[0].name)
  }, [projectsLoaded, projectTabs, project, switchProject])

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
      if (matchesShortcut(e, getBinding('save'))) {
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
  }, [saveCurrentTab, closeTab, activePath, activeTab, activeRelativePath, tabs, setActivePath, canUseTerminal, focusedEditor, isGuest, project, agentOpen, tmuxOpen, chatOpen])

  /**
   * 채팅 메시지의 파일 멘션 클릭 — 새 창이 아니라 **같은 창의 에디터 탭**으로 연다.
   * 다른 프로젝트일 수 있으므로 프로젝트를 옮긴 다음 렌더에서 연다.
   */
  const openMentionedFile = useCallback(
    (target: string, path: string) => {
      setHomeOpen(false)
      setPendingOpen({ project: target, path })
      if (target !== project) switchProject(target)
    },
    [project, switchProject],
  )

  useEffect(() => {
    if (!pendingOpen || pendingOpen.project !== project) return
    openFile(pendingOpen.path, { preview: false })
    setPendingOpen(null)
  }, [pendingOpen, project, openFile])

  // 프로젝트 검색 결과 클릭 — 파일을 열고, 위치 점프 정보를 대기시킨다 (내용 로드 후 아래 effect가 처리)
  const openSearchResult = useCallback(
    (path: string, match: SearchMatch, query: string) => {
      pendingRevealRef.current = { path, line: match.line, query }
      openFile(path, { preview: true })
      if (!isDesktop()) setSidebarOpen(false)
    },
    [openFile],
  )

  // 대기 중인 점프 실행 — 대상 파일이 활성화되고 내용이 로드되면: 코드/plain은 해당 줄로 스크롤,
  // md(hotview)는 줄번호가 렌더 결과와 어긋나므로 대신 찾기 바를 그 검색어로 열어 강조한다.
  useEffect(() => {
    const pending = pendingRevealRef.current
    if (!pending || !activeTab || activeTab.path !== pending.path) return
    if (mediaKind(activeTab.path)) {
      pendingRevealRef.current = null
      return
    }
    if (!activeTab.content) return // 아직 로드 전 — 다음 content 갱신 때 다시 시도
    const { line, query } = pending
    pendingRevealRef.current = null
    const timer = setTimeout(() => {
      if (activeTab.viewMode === 'plain') focusedEditor()?.revealLine(line)
      else focusedEditor()?.openSearch(query)
    }, 90)
    return () => clearTimeout(timer)
  }, [activeTab, focusedEditor])

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
          onFocus={() => focusPane(pane.id)}
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
            id: 'schedule',
            label: '예약 작업',
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
            label: '터미널',
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
            label: '시스템 자원',
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
            label: '에이전트',
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
            label: '에이전트셋',
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
            label: '브라우저',
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
            label: '채팅',
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
            label: '데이터베이스',
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
            label: '계정 관리',
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
      label: isGuest ? '설정' : (authEmail ?? '설정'),
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
            label: '로그인',
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
          {/* 홈은 프로젝트도 레포도 아니다 — 워크스페이스 전체를 보는 화면이라 맨 앞에 선다 */}
          {!isGuest && (
            <HomeTab
              // 홈 화면을 닫고 워크스페이스 루트의 파일을 열어 둔 동안에도 홈은 활성이다 — 스코프가 홈이다
              active={project === WORKSPACE_PROJECT}
              canSwitchWorkspace={isOwner}
              onActivate={() => {
                // 사이드바까지 워크스페이스 루트로 옮긴다 — switchProject가 homeOpen을 끄므로 뒤에 켠다
                switchProject(WORKSPACE_PROJECT)
                setHomeOpen(true)
              }}
              onOpenSwitcher={() => setWorkspaceSwitcherOpen(true)}
            />
          )}
          {/* docs는 프로젝트가 아니라 워크스페이스에 하나뿐인 특별 레포 — 그 다음 고정 탭이다 */}
          <DocsTab
            active={!homeOpen && project === DEFAULT_PROJECT}
            canManage={isOwner}
            onActivate={() => switchProject(DEFAULT_PROJECT)}
            onOpenSettings={() => setDocsSettingsOpen(true)}
          />
          <ProjectTabs
            projects={projectTabs}
            // 홈이 떠 있으면 어느 프로젝트도 활성이 아니다 — 돌아갈 곳(project)은 그대로 기억한다
            activeProject={homeOpen ? '' : project}
            canUseTerminal={canUseTerminal}
            canReorder={!isGuest}
            onActivate={switchProject}
            onOpenPicker={() => setProjectPickerOpen(true)}
            onReorder={reorderProjectTabs}
            onReorderEnd={commitProjectOrder}
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
            className="fixed inset-0 z-30 flex bg-surface-deep md:static md:z-auto md:shrink-0"
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
                    searchFocusSignal={searchFocusSignal}
                    newFileSignal={newFileSignal}
                    revealSignal={revealSignal}
                    presence={tabPresence}
                    onSelect={(path, opts) => {
                      openFile(path, opts)
                      // 홈 화면이 편집 칸을 덮고 있으면 방금 연 파일이 안 보인다 — 비켜 준다
                      setHomeOpen(false)
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

        {/* 홈이 떠 있으면 편집 칸 자리를 홈 화면이 대신 쓴다 — 사이드바·터미널·에이전트 패널은 그대로다.
            열어 둔 탭 목록은 App(useTabs)에 있으므로 홈에서 나오면 보던 문서로 그대로 돌아온다. */}
        {homeOpen && !isGuest ? (
          <div className="flex min-h-0 min-w-0 flex-1" {...homeSwipe}>
            <HomePanel projects={projects} />
          </div>
        ) : (
          /* 편집 칸들 — 분할 배치 그대로다. 칸마다 자기 탭 줄·자기 문서·자기 협업 세션을 가진다 */
          renderLayout(layout, 'root')
        )}

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
          <div className="fixed inset-0 z-30 flex md:static md:z-auto md:w-[26rem] md:shrink-0">
            <div className="hidden w-1.5 shrink-0 border-l border-edge md:block" aria-hidden="true" />
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <AgentPanel project={project} tree={tree} onClose={() => setAgentOpen(false)} />
            </div>
          </div>
        )}

        {agentSetOpen && canUseTerminal && (
          <div className="fixed inset-0 z-30 flex md:static md:z-auto md:w-[30rem] md:shrink-0">
            <div className="hidden w-1.5 shrink-0 border-l border-edge md:block" aria-hidden="true" />
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <AgentSetPanel onClose={() => setAgentSetOpen(false)} />
            </div>
          </div>
        )}

        {tmuxOpen && canUseTerminal && (
          <div
            {...tmuxSwipe}
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



      {projectPickerOpen && (
        <ProjectPicker
          // docs는 여기서 관리하지 않는다 — 이름도 자리도 없는 고정 탭이다
          projects={projectTabs}
          currentProject={project}
          readOnly={isGuest}
          isOwner={isOwner}
          onClose={() => setProjectPickerOpen(false)}
          onSelect={chooseProject}
          onProjectRenamed={handleProjectRenamed}
          onProjectDeleted={handleProjectDeleted}
          onIconChanged={(name, icon) => setProjects((prev) => prev.map((p) => (p.name === name ? { ...p, icon } : p)))}
          onLayoutChanged={(layout) => setProjects((prev) => applyLayout(prev, layout))}
          onProjectsChanged={refreshProjects}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          email={authEmail}
          canEditIgnore={canUseTerminal}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          onClose={() => setSettingsOpen(false)}
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

      {workspaceSwitcherOpen && isOwner && <WorkspaceSwitcher onClose={() => setWorkspaceSwitcherOpen(false)} />}

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
