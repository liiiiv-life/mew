import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchMode, fetchTree, type TreeNode } from './api/client'
import { FileTree } from './components/FileTree'
import { Editor, type EditorHandle } from './components/Editor'
import { AgentSidebar } from './components/AgentSidebar'
import { TmuxTerminalPanel } from './components/TmuxTerminalPanel'
import { TableOfContents } from './components/TableOfContents'
import { TabBar } from './components/TabBar'
import { FabMenu } from './components/FabMenu'
import { useTabs } from './hooks/useTabs'
import { usePresence } from './hooks/usePresence'
import { usePanelWidth } from './hooks/usePanelWidth'
import { useSwipe } from './hooks/useSwipe'

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen().catch(() => {})
}

const isDesktop = () => window.matchMedia('(min-width: 768px)').matches

const OPEN_TABS_KEY = 'docs-editor:open-tabs'

type StoredTabs = {
  tabs: { path: string; preview: boolean; viewMode: 'hotview' | 'plain' }[]
  activePath: string | null
  agentOpen: boolean
  tmuxOpen: boolean
}

function loadStoredTabs(): StoredTabs | null {
  const raw = localStorage.getItem(OPEN_TABS_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredTabs
  } catch {
    return null
  }
}

type Theme = 'dark' | 'light'
const THEME_KEY = 'docs-editor:theme'
const TOC_KEY = 'docs-editor:toc-open'

function loadTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
}

function App() {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop)
  const [agentOpen, setAgentOpen] = useState(false)
  const [tmuxOpen, setTmuxOpen] = useState(false)
  const [tocOpen, setTocOpen] = useState(() => localStorage.getItem(TOC_KEY) !== '0')
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [searchFocusSignal, setSearchFocusSignal] = useState(0)
  // 서버 모드를 확인하기 전까지는 편집 UI를 숨긴다 (뷰어에서 깜빡임 방지)
  const [readOnly, setReadOnly] = useState(true)
  const [docsRoot, setDocsRoot] = useState<string | null>(null)
  const editorRef = useRef<EditorHandle>(null)
  const hasRestoredTabsRef = useRef(false)
  const isFirstPersistRef = useRef(true)

  const refreshTree = useCallback(() => fetchTree().then(setTree).catch(console.error), [])

  const {
    tabs,
    activePath,
    activeTab,
    setActivePath,
    openFile,
    openBlankTab,
    pinTab,
    setTabViewMode,
    updateTabContent,
    saveCurrentTab,
    closeTab,
    remapPaths,
    removePaths,
  } = useTabs(readOnly, refreshTree)

  // 경로별로 지금 몇 개의 브라우저 세션이 이 문서를 탭으로 열어두고 있는지 (협업 충돌 방지용)
  // + 서버 watcher의 트리 변경 알림 — 다른 세션·에이전트가 만든 파일도 사이드바에 바로 반영
  const openPaths = useMemo(() => tabs.map((t) => t.path).filter(Boolean), [tabs])
  const tabPresence = usePresence(openPaths, refreshTree)

  const { width: sidebarWidth, startResize: startSidebarResize } = usePanelWidth('docs-editor:sidebar-width', {
    min: 180,
    max: 480,
    initial: 256,
  })
  const { width: tmuxWidth, startResize: startTmuxResize } = usePanelWidth('docs-editor:tmux-panel-width', {
    min: 320,
    max: 1000,
    initial: 640,
    invert: true, // 패널이 화면 오른쪽에 붙어 있으므로 왼쪽으로 끌수록 넓어진다
  })

  const sidebarSwipe = useSwipe({ onLeft: () => setSidebarOpen(false) })
  const editorSwipe = useSwipe({
    onRight: () => setSidebarOpen(true),
    onLeft: () => setTmuxOpen(true),
  })
  const agentSwipe = useSwipe({ onRight: () => setAgentOpen(false) })
  const tmuxSwipe = useSwipe({ onRight: () => setTmuxOpen(false) })

  const activeAbsolutePath = docsRoot && activeTab ? `${docsRoot}/${activeTab.path}` : null

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
    refreshTree()
    fetchMode()
      .then(({ readOnly, docsRoot }) => {
        setReadOnly(readOnly)
        setDocsRoot(docsRoot)
      })
      .catch(console.error)
  }, [refreshTree])

  // 브라우저를 껐다 켜거나 F5로 새로고침해도 열려 있던 탭들을 복원한다.
  // StrictMode는 마운트 이펙트를 두 번 실행하므로 ref로 한 번만 동작하게 막는다.
  useEffect(() => {
    if (hasRestoredTabsRef.current) return
    hasRestoredTabsRef.current = true
    const stored = loadStoredTabs()
    if (!stored) return
    for (const t of stored.tabs) {
      openFile(t.path, { preview: t.preview, forceNewTab: true })
    }
    if (stored.activePath) setActivePath(stored.activePath)
    if (stored.agentOpen) setAgentOpen(true)
    if (stored.tmuxOpen) setTmuxOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // 복원 전(초기 마운트, tabs=[]) 값으로 저장을 덮어쓰지 않도록 첫 실행은 건너뛴다
    if (isFirstPersistRef.current) {
      isFirstPersistRef.current = false
      return
    }
    const payload: StoredTabs = {
      tabs: tabs.map((t) => ({ path: t.path, preview: t.preview, viewMode: t.viewMode })),
      activePath,
      agentOpen,
      tmuxOpen,
    }
    localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(payload))
  }, [tabs, activePath, agentOpen, tmuxOpen])

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
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveCurrentTab(true)
      } else if (mod && e.key === 'p') {
        e.preventDefault()
        setSidebarOpen(true)
        setSearchFocusSignal((s) => s + 1)
      } else if (mod && e.code === 'Backquote') {
        // VSCode처럼 어디에 포커스가 있어도 터미널을 토글한다 (Shift 조합 ~ 포함)
        e.preventDefault()
        setTmuxOpen((v) => !v)
      } else if (mod && !e.shiftKey && !e.altKey && e.code === 'KeyB') {
        // 에디터의 Ctrl+B(굵게, defaultPrevented로 감지)와 터미널의 tmux prefix에는 양보한다
        if (e.defaultPrevented || (e.target instanceof HTMLElement && e.target.closest('.xterm'))) return
        e.preventDefault()
        setSidebarOpen((v) => !v)
      } else if (e.altKey && e.code === 'KeyW') {
        // Ctrl+W는 Chromium이 예약한 브라우저 단축키라 preventDefault로 막을 수 없어 Alt+W를 대신 쓴다
        // (e.code로 비교 — macOS에서 Option+문자는 e.key가 특수문자로 바뀌어 레이아웃에 취약함)
        e.preventDefault()
        if (activePath) closeTab(activePath)
      } else if (e.altKey && e.code === 'KeyN') {
        // Ctrl+N도 마찬가지로 브라우저 예약 단축키라 가로챌 수 없어 Alt+N을 쓴다
        e.preventDefault()
        openBlankTab()
      } else if (e.altKey && e.code === 'Enter') {
        e.preventDefault()
        toggleFullscreen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [saveCurrentTab, closeTab, activePath, openBlankTab])

  return (
    <div className="flex flex-col bg-surface text-ink" style={{ height: 'var(--app-height, 100dvh)' }}>
      <header className="flex items-center justify-between border-b border-edge px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded border border-edge-strong p-1.5 hover:bg-surface-raised"
            title="사이드바 열기/닫기 (Ctrl+B)"
            aria-label="사이드바 열기/닫기"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <div className="text-sm font-semibold">docs-editor</div>
          {readOnly && (
            <span className="rounded bg-surface-raised px-2 py-0.5 text-xs text-ink-secondary">읽기 전용</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          {activeTab && <span className="hidden max-w-xs truncate text-ink-muted md:inline-block">{activePath}</span>}
          <button
            type="button"
            onClick={() => setTocOpen((v) => !v)}
            className={`hidden rounded border border-edge-strong p-1.5 hover:bg-surface-raised lg:block ${
              tocOpen ? 'text-ink' : 'text-ink-muted'
            }`}
            title="목차 열기/닫기"
            aria-label="목차 열기/닫기"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 6h12M9 12h12M9 18h12" />
              <circle cx="4" cy="6" r="1" fill="currentColor" />
              <circle cx="4" cy="12" r="1" fill="currentColor" />
              <circle cx="4" cy="18" r="1" fill="currentColor" />
            </svg>
          </button>
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => saveCurrentTab(true)}
                disabled={!activeTab || activeTab.content === activeTab.committedContent || activeTab.path.startsWith('archives/')}
                className="rounded bg-accent px-3 py-1 text-ink-on-accent disabled:opacity-40"
                title="Ctrl+S"
              >
                Commit
              </button>
              {activeTab?.status === 'saving' && <span className="text-ink-muted">Saving…</span>}
              {activeTab?.status === 'saved' && (
                <span className={activeTab.statusMessage?.startsWith('Committed') ? 'text-success' : 'text-ink-secondary'}>
                  {activeTab.statusMessage}
                </span>
              )}
              {activeTab?.status === 'error' && <span className="text-danger">{activeTab.statusMessage}</span>}
            </>
          )}
        </div>
      </header>

      <TabBar
        tabs={tabs}
        activePath={activePath}
        presence={tabPresence}
        onActivate={setActivePath}
        onPin={pinTab}
        onClose={closeTab}
      />

      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <div
            {...sidebarSwipe}
            className="fixed inset-0 z-30 flex bg-surface-deep md:static md:z-auto md:shrink-0"
            style={{ width: isDesktop() ? sidebarWidth : undefined }}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center justify-between border-b border-edge px-3 py-2 md:hidden">
                <span className="text-sm font-semibold">문서</span>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
                  aria-label="사이드바 닫기"
                >
                  ×
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <FileTree
                  tree={tree}
                  selectedPath={activePath}
                  readOnly={readOnly}
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
                />
              </div>
            </div>
            <div
              onPointerDown={startSidebarResize}
              className="hidden w-1.5 shrink-0 cursor-col-resize touch-none bg-transparent hover:bg-accent md:block"
              aria-hidden="true"
            />
          </div>
        )}

        {activeTab ? (
          <>
            {!readOnly && activeTab.path.startsWith('archives/') && (
              <div className="absolute inset-x-0 top-11 z-10 bg-warning-surface px-4 py-1 text-center text-sm text-warning-ink">
                archives/ 문서는 불변입니다 — 편집이 차단되었습니다
              </div>
            )}
            <div className="relative min-w-0 flex-1" {...editorSwipe}>
              {activeTab.path.endsWith('.md') && (
                <div className="absolute right-3 top-3 z-20 flex overflow-hidden rounded border border-edge-strong text-xs shadow-sm">
                  <button
                    type="button"
                    onClick={() => setTabViewMode(activeTab.path, 'hotview')}
                    className={`px-2 py-1 ${
                      activeTab.viewMode === 'hotview'
                        ? 'bg-accent text-ink-on-accent'
                        : 'bg-surface-raised text-ink-secondary hover:bg-surface-hover'
                    }`}
                  >
                    Hotview
                  </button>
                  <button
                    type="button"
                    onClick={() => setTabViewMode(activeTab.path, 'plain')}
                    className={`px-2 py-1 ${
                      activeTab.viewMode === 'plain'
                        ? 'bg-accent text-ink-on-accent'
                        : 'bg-surface-raised text-ink-secondary hover:bg-surface-hover'
                    }`}
                  >
                    Plain
                  </button>
                </div>
              )}
              {activeTab.viewMode === 'plain' ? (
                <textarea
                  value={activeTab.content}
                  onChange={(e) => updateTabContent(activeTab.path, e.target.value)}
                  readOnly={readOnly || activeTab.path.startsWith('archives/')}
                  spellCheck={false}
                  className="h-full w-full resize-none bg-surface-deep p-8 font-mono text-sm text-ink outline-none"
                />
              ) : (
                <Editor
                  ref={editorRef}
                  value={activeTab.content}
                  onChange={(content) => updateTabContent(activeTab.path, content)}
                  readOnly={readOnly || activeTab.path.startsWith('archives/')}
                  path={activeTab.path}
                  tree={tree}
                  onOpenLink={(linkPath) => openFile(linkPath, { preview: false, forceNewTab: true })}
                />
              )}
            </div>
            {tocOpen && (
              <TableOfContents content={activeTab.content} onJump={(i) => editorRef.current?.scrollToHeading(i)} />
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-ink-secondary" {...editorSwipe}>
            <div className="text-center">
              <div className="mb-2">왼쪽에서 문서를 선택하세요</div>
              {readOnly ? (
                <div className="text-xs text-ink-muted">Ctrl+P 검색</div>
              ) : (
                <>
                  <div className="text-xs text-ink-muted">Ctrl+P 검색 · 사이드바에서 Insert로 새 파일</div>
                  <div className="mt-2 text-xs text-ink-faint">자동 저장 · Ctrl+S 커밋</div>
                </>
              )}
            </div>
          </div>
        )}

        {agentOpen && (
          <div {...agentSwipe} className="fixed inset-0 z-30 md:static md:z-auto md:w-96 md:shrink-0 md:border-l md:border-edge">
            <AgentSidebar onClose={() => setAgentOpen(false)} activeFilePath={activeAbsolutePath} />
          </div>
        )}

        {tmuxOpen && (
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
              <TmuxTerminalPanel onClose={() => setTmuxOpen(false)} activeFilePath={activeAbsolutePath} />
            </div>
          </div>
        )}
      </div>

      {!readOnly && !agentOpen && !tmuxOpen && (
        <FabMenu
          theme={theme}
          onFullscreen={toggleFullscreen}
          onOpenAgent={() => setAgentOpen(true)}
          onOpenTerminal={() => setTmuxOpen(true)}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        />
      )}
    </div>
  )
}

export default App
