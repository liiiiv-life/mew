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
import { LoginPage } from './components/LoginPage'
import { SettingsModal } from './components/SettingsModal'
import { AdminSettingsModal } from './components/AdminSettingsModal'
import { DatabaseListModal } from './components/DatabaseListModal'
import { SystemStatsModal } from './components/SystemStatsModal'
import { CrontabModal } from './components/CrontabModal'
import { FileTree } from './components/FileTree'
import { SearchPanel } from './components/SearchPanel'
import type { SearchMatch } from './api/client'
import { TmuxTerminalPanel } from '@mew/tmux-term'
import { AgentPanel } from './components/AgentPanel'
import { FileHistoryModal } from './components/FileHistoryModal'
import { getBinding, matchesShortcut } from '@mew/shortcuts'
import { useOverlayDismiss, useToast } from '@mew/ui'
import { useSwipeGesture } from '@mew/mobile-keys'
import { EditorPane, type PaneHandle } from './components/EditorPane'
import { TermButtonBar } from './components/TermButtonBar'
import { mediaKind } from './utils/media'
import { openTabsKey, useTabs } from './hooks/useTabs'
import { applyLayout, bySlot, reorderedLayout } from './utils/projectLayout'
import { dropZoneAt, paneIds, type DropZone, type PaneNode } from './utils/paneTree'
import { usePresence } from './hooks/usePresence'
import { usePanelWidth } from './hooks/usePanelWidth'
import { outsideTerminal } from './utils/terminalFocus'

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen().catch(() => {})
}

const isDesktop = () => window.matchMedia('(min-width: 768px)').matches

type Theme = 'dark' | 'light'
const THEME_KEY = 'mew:theme'
const TOC_KEY = 'mew:toc-open'
const TMUX_OPEN_KEY = 'mew:tmux-open'
/** 지울 수 없는 기본 프로젝트 — 보고 있던 프로젝트가 사라지면 여기로 빠진다 */
const DEFAULT_PROJECT = 'docs'

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
  // 에이전트 창은 터미널과 같은 게이트(owner/manager) — 셸을 쓸 수 있기 때문(ADR 0034)
  const [agentOpen, setAgentOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [dbListOpen, setDbListOpen] = useState(false)
  const [sysStatsOpen, setSysStatsOpen] = useState(false)
  const [crontabOpen, setCrontabOpen] = useState(false)
  // 목록이 오기 전의 자리표시자 — 이걸 진짜 목록으로 착각하면 보고 있던 프로젝트가 애먼 것으로 밀린다
  const [projects, setProjects] = useState<ProjectInfo[]>([{ name: project, icon: null, slot: null }])
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [tocOpen, setTocOpen] = useState(() => localStorage.getItem(TOC_KEY) !== '0')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [searchFocusSignal, setSearchFocusSignal] = useState(0)
  // 사이드바 뷰: 파일 탐색기 vs 프로젝트 전체 검색(Ctrl+Shift+F). projectSearchFocus는 검색창 포커스 신호
  const [sidebarView, setSidebarView] = useState<'files' | 'search'>('files')
  const [projectSearchFocus, setProjectSearchFocus] = useState(0)
  // 탭을 끌고 있는 동안 그림자가 뜰 칸과 자리 — 손을 떼면 그 자리가 실제 분할·이동이 된다
  const [dropTarget, setDropTarget] = useState<{ paneId: string; zone: DropZone } | null>(null)
  // 칸별 에디터 손잡이(선택 영역·찾기·되돌리기)와 본문 영역 DOM(드롭 자리 판정)
  const paneHandles = useRef(new Map<string, PaneHandle>())
  const paneEls = useRef(new Map<string, HTMLElement>())
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
    openBlankTab,
    pinTab,
    reorderTabs,
    setTabViewMode,
    updateTabContent,
    saveCurrentTab,
    applyRevertedContent,
    closeTab,
    moveTabToPane,
    splitWithTab,
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

  /** 지금 포커스된 칸의 에디터 — 커밋·찾기·되돌리기·터미널 붙여넣기가 가리키는 곳 */
  const focusedEditor = useCallback(() => paneHandles.current.get(focusedPaneId) ?? null, [focusedPaneId])

  /** 그 좌표에 있는 편집 칸의 **본문** 영역 — 탭 줄은 빠져 있다(줄 안에서 끄는 건 순서 바꾸기다) */
  const paneAt = (x: number, y: number) => {
    for (const [id, el] of paneEls.current) {
      const rect = el.getBoundingClientRect()
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return { id, rect }
    }
    return null
  }

  const handleTabDragMove = useCallback((_paneId: string, _path: string, x: number, y: number) => {
    const hit = paneAt(x, y)
    setDropTarget(hit ? { paneId: hit.id, zone: dropZoneAt(hit.rect, x, y) } : null)
  }, [])

  const handleTabDrop = useCallback(
    (paneId: string, path: string, x: number, y: number) => {
      setDropTarget(null)
      const hit = paneAt(x, y)
      if (!hit) return
      const zone = dropZoneAt(hit.rect, x, y)
      if (zone === 'center') moveTabToPane(path, paneId, hit.id)
      else splitWithTab(path, paneId, hit.id, zone)
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

  // 탭 전환·창 전환 스와이프는 편집 칸이 각자 처리한다 (EditorPane) — 칸마다 탭 줄이 따로다
  const sidebarSwipe = useSwipeGesture({ onBottomLeft: () => setSidebarOpen(false) })
  const tmuxSwipe = useSwipeGesture({ onBottomRight: () => setTmuxOpen(false) })

  // Esc·안드로이드 뒤로가기로 열린 것을 한 겹씩 닫는다 — 모달·팝업도 같은 스택에 등록돼 있어
  // (useOverlayDismiss) 그쪽이 떠 있으면 언제나 먼저 닫히고, 패널은 마지막에 닫힌다.
  // 패널은 bubble 단계라야 안쪽(에디터 슬래시 메뉴, 파일 이름 바꾸기, 터미널의 vim)이 Esc를 먼저 쓴다.
  useOverlayDismiss(tmuxOpen && (() => setTmuxOpen(false)), { escapePhase: 'bubble', closeOnEscape: outsideTerminal })
  useOverlayDismiss(sidebarOpen && (() => setSidebarOpen(false)), { escapePhase: 'bubble' })

  const activeRelativePath = activeTab?.path ?? null

  // 볼 수 있는 프로젝트는 전부 탭으로 세운다 — 순서는 팝업 격자에서 끌어 정한 자리
  const projectTabs = useMemo(() => [...projects].sort(bySlot), [projects])

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
    if (!projectsLoaded || projects.length === 0) return
    if (projects.some((p) => p.name === project)) return
    switchProject([...projects].sort(bySlot)[0].name)
  }, [projectsLoaded, projects, project, switchProject])

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
        // 에디터에 포커스가 있으면 에디터 자체 핸들러가 먼저 가로채(stopPropagation) 여기 안 온다.
        // 그 외(사이드바 등)에서 눌렀을 때 활성 문서가 tiptap 에디터면 찾기 바를 연다.
        if (e.target instanceof HTMLElement && e.target.closest('.xterm')) return
        if (activeTab && !mediaKind(activeTab.path) && activeTab.viewMode === 'hotview' && !activeTab.path.endsWith('.svg')) {
          e.preventDefault()
          focusedEditor()?.openSearch()
        }
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
        // Ctrl+N도 마찬가지로 브라우저 예약 단축키라 가로챌 수 없어 기본값은 Alt+N이다
        e.preventDefault()
        openBlankTab()
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
  }, [saveCurrentTab, closeTab, activePath, activeTab, tabs, setActivePath, openBlankTab, canUseTerminal, focusedEditor])

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

  // 터미널·시스템 자원 버튼은 화면에 하나뿐이다 — 맨 끝 칸(오른쪽·아래)이 맡는다
  const toolPaneId = paneIds(layout).at(-1)

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
          tmuxOpen={tmuxOpen}
          showGlobalTools={pane.id === toolPaneId}
          tocOpen={tocOpen}
          dropZone={dropTarget?.paneId === pane.id ? dropTarget.zone : null}
          registerHandle={registerPaneHandle}
          registerElement={registerPaneElement}
          onFocus={() => focusPane(pane.id)}
          onActivate={(path) => setActivePath(path, pane.id)}
          onPin={(path) => pinTab(path, pane.id)}
          onCloseTab={(path) => closeTab(path, pane.id)}
          onReorder={(from, to) => reorderTabs(from, to, pane.id)}
          onSetViewMode={(path, viewMode) => setTabViewMode(path, viewMode, pane.id)}
          onChangeContent={updateTabContent}
          onOpenLink={(linkPath) => openFile(linkPath, { preview: false, forceNewTab: true, paneId: pane.id })}
          onOpenHistory={() => setHistoryOpen(true)}
          onOpenTerminal={() => setTmuxOpen(true)}
          onOpenSysStats={() => setSysStatsOpen(true)}
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

  return (
    <div className="flex flex-col bg-surface text-ink" style={{ height: 'var(--app-height, 100dvh)' }}>
      {/* 화면 전폭을 쓰는 줄은 이 헤더 하나뿐이다 — 프로젝트 탭 + 도구 버튼. 문서 탭 줄은 각
          편집 칸 안에 있다(EditorPane). 탭이 줄 높이를 꽉 채워야 하므로 세로 여백은 두지 않는다. */}
      <div className="flex flex-col">
        <header className="flex h-10 items-stretch border-b border-edge pr-2">
          {/* 사이드바가 닫혀 있을 때만 뜨는 여는 버튼 — 프로젝트 탭 왼쪽, 사이드바가 서는 자리 위 */}
          {!sidebarOpen && (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="shrink-0 px-2 text-ink-muted hover:bg-surface-raised hover:text-ink"
              title="사이드바 열기 (Ctrl+B)"
              aria-label="사이드바 열기"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
                <path d="m14 9 3 3-3 3" />
              </svg>
            </button>
          )}
          <ProjectTabs
            projects={projectTabs}
            activeProject={project}
            canUseTerminal={canUseTerminal}
            canReorder={!isGuest}
            onActivate={switchProject}
            onOpenPicker={() => setProjectPickerOpen(true)}
            onReorder={reorderProjectTabs}
            onReorderEnd={commitProjectOrder}
          />
          <div className="flex shrink-0 items-center gap-1.5 pl-2 text-sm">
            {isGuest && <span className="rounded bg-surface-raised px-2 py-0.5 text-xs text-ink-secondary">게스트</span>}
            {(!isGuest || canEditActiveTab) && (
              <>
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="rounded border border-edge-strong p-1.5 hover:bg-surface-raised"
                  title="전체화면 (Alt+Enter)"
                  aria-label="전체화면 토글"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => saveCurrentTab(true)}
                  disabled={!activeTab || !canEditActiveTab || activeTab.content === activeTab.committedContent}
                  className="rounded bg-accent p-1.5 text-ink-on-accent disabled:opacity-40"
                  title="Commit (Ctrl+S)"
                  aria-label="Commit"
                >
                  {/* git commit — 커밋 하나가 이력선 위에 찍힌 모양 */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="4" />
                    <line x1="1.5" y1="12" x2="8" y2="12" />
                    <line x1="16" y1="12" x2="22.5" y2="12" />
                  </svg>
                </button>
                {activeTab?.status === 'error' && (
                  <span className="hidden max-w-[12rem] truncate text-danger md:inline">{activeTab.statusMessage}</span>
                )}
              </>
            )}
            {canUseTerminal && (
              <button
                type="button"
                onClick={() => setCrontabOpen(true)}
                className="rounded border border-edge-strong p-1.5 hover:bg-surface-raised"
                title="crontab"
                aria-label="crontab"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </button>
            )}
            {canUseTerminal && (
              <button
                type="button"
                onClick={() => setAgentOpen((open) => !open)}
                className={`rounded border border-edge-strong p-1.5 hover:bg-surface-raised ${agentOpen ? 'bg-surface-raised text-ink' : ''}`}
                title="에이전트"
                aria-label="에이전트"
              >
                {/* 말풍선 — 채팅 창이지 터미널이 아니다 */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.2A8.5 8.5 0 0 1 4 11.5a8.38 8.38 0 0 1 8.5-8.4 8.38 8.38 0 0 1 8.5 8.4z" />
                </svg>
              </button>
            )}
            {isOwner && (
              <button
                type="button"
                onClick={() => setAdminOpen(true)}
                className="rounded border border-edge-strong p-1.5 hover:bg-surface-raised"
                title="계정 관리"
                aria-label="계정 관리"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            )}
            {!isGuest && (
              <button
                type="button"
                onClick={() => setDbListOpen(true)}
                className="rounded border border-edge-strong p-1.5 hover:bg-surface-raised"
                title="데이터베이스"
                aria-label="데이터베이스"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="12" cy="5" rx="8" ry="3" />
                  <path d="M20 5v6c0 1.66-3.58 3-8 3s-8-1.34-8-3V5" />
                  <path d="M20 11v6c0 1.66-3.58 3-8 3s-8-1.34-8-3v-6" />
                </svg>
              </button>
            )}
            {isGuest ? (
              <>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="rounded border border-edge-strong p-1.5 hover:bg-surface-raised"
                  title="설정"
                  aria-label="설정"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={onRequestLogin}
                  className="rounded border border-edge-strong px-3 py-1 text-sm font-medium text-ink hover:bg-surface-raised"
                >
                  로그인
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-edge-strong bg-surface-raised text-xs font-semibold uppercase text-ink-secondary hover:bg-surface-hover hover:text-ink"
                title={`${authEmail} — 설정`}
                aria-label="설정"
              >
                {authEmail?.[0]}
              </button>
            )}
          </div>
        </header>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen && (
          <div
            {...sidebarSwipe}
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
              </div>
              <div className="min-h-0 flex-1">
                <div className={sidebarView === 'files' ? 'h-full' : 'hidden'}>
                  {/* key=project — 프로젝트를 옮기면 펼쳐둔 폴더·선택 상태를 옆 프로젝트로 끌고 가지 않는다 */}
                  <FileTree
                    key={project}
                    tree={tree}
                    selectedPath={activePath}
                    readOnly={isGuest}
                    searchFocusSignal={searchFocusSignal}
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
                    onCloseSidebar={() => setSidebarOpen(false)}
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

        {/* 편집 칸들 — 분할 배치 그대로다. 칸마다 자기 탭 줄·자기 문서·자기 협업 세션을 가진다 */}
        {renderLayout(layout, 'root')}

        {agentOpen && canUseTerminal && (
          <div className="fixed inset-0 z-30 flex md:static md:z-auto md:w-[26rem] md:shrink-0">
            <div className="hidden w-1.5 shrink-0 border-l border-edge md:block" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <AgentPanel project={project} onClose={() => setAgentOpen(false)} />
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
            <div className="min-w-0 flex-1">
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
      </div>



      {projectPickerOpen && (
        <ProjectPicker
          projects={projects}
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

      {dbListOpen && !isGuest && <DatabaseListModal onClose={() => setDbListOpen(false)} />}

      {sysStatsOpen && canUseTerminal && <SystemStatsModal onClose={() => setSysStatsOpen(false)} />}
      {crontabOpen && canUseTerminal && <CrontabModal onClose={() => setCrontabOpen(false)} />}

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

  useEffect(() => {
    fetchAuthStatus()
      .then(setAuth)
      .catch((err) => {
        console.error(err)
        setAuth(GUEST_AUTH)
      })
  }, [])

  useEffect(() => {
    function onExpired() {
      setAuth(GUEST_AUTH)
    }
    window.addEventListener('mew:auth-expired', onExpired)
    return () => window.removeEventListener('mew:auth-expired', onExpired)
  }, [])

  if (!auth) {
    return <div className="bg-surface" style={{ height: '100dvh' }} />
  }

  return (
    <>
      <EditorApp
        key={auth.email ?? 'guest'}
        auth={auth}
        onLoggedOut={() => setAuth(GUEST_AUTH)}
        onRequestLogin={() => setLoginOpen(true)}
      />
      {loginOpen && (
        <LoginPage
          onClose={() => setLoginOpen(false)}
          onSuccess={(status) => {
            setAuth(status)
            setLoginOpen(false)
          }}
        />
      )}
    </>
  )
}

export default App
