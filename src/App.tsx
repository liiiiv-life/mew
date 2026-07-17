import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchFile, fetchMode, fetchRules, fetchTree, saveFile, type TreeNode, type DocRules } from './api/client'
import { FileTree } from './components/FileTree'
import { Editor, type EditorHandle } from './components/Editor'
import { AgentSidebar } from './components/AgentSidebar'
import { TmuxTerminalPanel } from './components/TmuxTerminalPanel'
import { TableOfContents } from './components/TableOfContents'

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen().catch(() => {})
}

function blankTab(): Tab {
  return {
    path: '',
    content: '',
    savedContent: '',
    committedContent: '',
    rules: null,
    status: 'idle',
    preview: false,
    viewMode: 'hotview',
  }
}

type Tab = {
  path: string
  content: string
  savedContent: string // 디스크에 마지막으로 저장된 내용 (자동저장 기준)
  committedContent: string // 마지막 커밋 시점의 내용 (Commit 버튼 활성화 기준)
  rules: DocRules | null
  status: 'idle' | 'saving' | 'saved' | 'error'
  statusMessage?: string
  preview: boolean
  viewMode: 'hotview' | 'plain'
}

const isDesktop = () => window.matchMedia('(min-width: 768px)').matches

const TMUX_WIDTH_KEY = 'docs-editor:tmux-panel-width'
const TMUX_WIDTH_MIN = 320
const TMUX_WIDTH_MAX = 1000
const TMUX_WIDTH_DEFAULT = 640

function clampTmuxWidth(w: number): number {
  return Math.min(TMUX_WIDTH_MAX, Math.max(TMUX_WIDTH_MIN, w))
}

function loadTmuxWidth(): number {
  const stored = Number(localStorage.getItem(TMUX_WIDTH_KEY))
  return Number.isFinite(stored) && stored > 0 ? clampTmuxWidth(stored) : TMUX_WIDTH_DEFAULT
}

const OPEN_TABS_KEY = 'docs-editor:open-tabs'

type StoredTabs = {
  tabs: { path: string; preview: boolean; viewMode: Tab['viewMode'] }[]
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

function loadTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
}

function App() {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop)
  const [agentOpen, setAgentOpen] = useState(false)
  const [tmuxOpen, setTmuxOpen] = useState(false)
  const [tmuxWidth, setTmuxWidth] = useState(loadTmuxWidth)
  const [fabMenuOpen, setFabMenuOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [searchFocusSignal, setSearchFocusSignal] = useState(0)
  // 서버 모드를 확인하기 전까지는 편집 UI를 숨긴다 (뷰어에서 깜빡임 방지)
  const [readOnly, setReadOnly] = useState(true)
  const [docsRoot, setDocsRoot] = useState<string | null>(null)
  // 경로별로 지금 몇 개의 브라우저 세션이 이 문서를 탭으로 열어두고 있는지 (협업 충돌 방지용)
  const [tabPresence, setTabPresence] = useState<Record<string, number>>({})
  const editorRef = useRef<EditorHandle>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tabsRef = useRef<Tab[]>([])
  const hasRestoredTabsRef = useRef(false)
  const isFirstPersistRef = useRef(true)
  const presenceWsRef = useRef<WebSocket | null>(null)
  const tabPathsRef = useRef<string[]>([])

  const activeTab = tabs.find((t) => t.path === activePath) ?? null
  const activeAbsolutePath = docsRoot && activeTab ? `${docsRoot}/${activeTab.path}` : null

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  // 열려 있는 문서 탭 목록이 바뀔 때마다 서버에 알려서, 같은 문서를 열고 있는
  // 다른 세션 수를 집계하게 한다 (협업 중 겹치는 편집 방지용 배지)
  useEffect(() => {
    tabPathsRef.current = tabs.map((t) => t.path).filter(Boolean)
    const ws = presenceWsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'open', paths: tabPathsRef.current }))
    }
  }, [tabs])

  useEffect(() => {
    let cancelled = false
    let ws: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    function connect() {
      if (cancelled) return
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      ws = new WebSocket(`${protocol}//${location.host}/api/presence`)
      presenceWsRef.current = ws
      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: 'open', paths: tabPathsRef.current }))
      }
      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        try {
          const msg = JSON.parse(event.data) as { type?: string; counts?: Record<string, number> }
          if (msg.type === 'counts' && msg.counts) setTabPresence(msg.counts)
        } catch {
          // 잘못된 메시지는 무시
        }
      }
      ws.onclose = () => {
        if (!cancelled) retryTimer = setTimeout(connect, 3000)
      }
    }
    connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      ws?.close()
    }
  }, [])

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

  const refreshTree = () => fetchTree().then(setTree).catch(console.error)

  useEffect(() => {
    refreshTree()
    fetchMode()
      .then(({ readOnly, docsRoot }) => {
        setReadOnly(readOnly)
        setDocsRoot(docsRoot)
      })
      .catch(console.error)
  }, [])

  const openFile = useCallback(
    // forceNewTab: 이미 열려 있지 않은 문서라도 미리보기 탭 자리를 재사용하지 않고 항상 새 탭으로 연다
    // (에디터 안에서 Ctrl+클릭으로 내부 링크를 열 때 — 사이드바 클릭의 미리보기 재사용 동작과는 별개)
    (path: string, opts?: { preview?: boolean; forceNewTab?: boolean }) => {
      const preview = opts?.preview ?? true
      const existing = tabs.find((t) => t.path === path)
      if (existing) {
        if (!preview && existing.preview) {
          setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, preview: false } : t)))
        }
        setActivePath(path)
        return
      }
      const newTab: Tab = { path, content: '', savedContent: '', committedContent: '', rules: null, status: 'idle', preview, viewMode: 'hotview' }
      setTabs((prev) => {
        if (opts?.forceNewTab) return [...prev, newTab]
        // 미리보기 탭은 하나만 유지 — 새로 여는 문서가 그 자리를 재사용
        const previewIdx = prev.findIndex((t) => t.preview)
        if (previewIdx === -1) return [...prev, newTab]
        const next = [...prev]
        next[previewIdx] = newTab
        return next
      })
      setActivePath(path)
      fetchFile(path)
        .then(({ content }) => {
          setTabs((curr) =>
            curr.map((t) =>
              t.path === path ? { ...t, content, savedContent: content, committedContent: content, status: 'idle' } : t,
            ),
          )
        })
        .catch(console.error)
      fetchRules(path)
        .then((rules) => setTabs((curr) => curr.map((t) => (t.path === path ? { ...t, rules } : t))))
        .catch(console.error)
    },
    [tabs],
  )

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

  const pinTab = useCallback((path: string) => {
    setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, preview: false } : t)))
  }, [])

  const setTabViewMode = useCallback((path: string, viewMode: Tab['viewMode']) => {
    setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, viewMode } : t)))
  }, [])

  // 경로 기준으로 디스크에 저장 (git 커밋 없음)
  // tabsRef로 최신 content를 읽어 디바운스 스테일 문제를 피하고, setState 업데이터 안에서 부수효과(fetch)를
  // 실행하지 않는다 — StrictMode가 업데이터 함수를 두 번 호출해 fetch가 중복 발생하는 것을 방지
  const autosave = useCallback(
    (path: string) => {
      if (readOnly) return
      const tab = tabsRef.current.find((t) => t.path === path)
      if (!tab || tab.content === tab.savedContent || tab.path.startsWith('archives/')) return
      const content = tab.content
      setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, status: 'saving' } : t)))
      saveFile(path, content, false)
        .then(() => {
          setTabs((curr) =>
            curr.map((t) => (t.path === path && t.content === content ? { ...t, savedContent: content, status: 'saved', statusMessage: 'Saved' } : t)),
          )
        })
        .catch((err) => {
          setTabs((curr) =>
            curr.map((t) =>
              t.path === path ? { ...t, status: 'error', statusMessage: err instanceof Error ? err.message : String(err) } : t,
            ),
          )
        })
    },
    [readOnly],
  )

  const scheduleAutosave = useCallback(
    (path: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null
        autosave(path)
      }, 500)
    },
    [autosave],
  )

  const closeTab = useCallback(
    (path: string) => {
      // 디바운스를 기다리지 않고 닫히는 탭의 변경 내용을 즉시 디스크에 반영
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      autosave(path)
      setTabs((prev) => {
        const next = prev.filter((t) => t.path !== path)
        if (path === activePath) {
          const idx = prev.findIndex((t) => t.path === path)
          setActivePath(next[Math.min(idx, next.length - 1)]?.path ?? null)
        }
        return next
      })
    },
    [activePath, autosave],
  )

  const updateTabContent = useCallback(
    (path: string, content: string) => {
      // 편집이 시작되면 미리보기 탭을 고정 탭으로 승격 (VSCode와 동일)
      setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, content, preview: false } : t)))
      scheduleAutosave(path)
    },
    [scheduleAutosave],
  )

  const saveCurrentTab = useCallback(
    async (commit = false) => {
      const tab = activeTab
      if (!tab || readOnly) return
      const dirty = commit ? tab.content !== tab.committedContent : tab.content !== tab.savedContent
      const isArchived = tab.path.startsWith('archives/')
      if (!dirty || isArchived) return

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      setTabs((prev) => prev.map((t) => (t.path === tab.path ? { ...t, status: 'saving' } : t)))
      try {
        const result = await saveFile(tab.path, tab.content, commit)
        const message = commit
          ? `Committed${result.commit?.hash ? ' ' + result.commit.hash.slice(0, 7) : ''}`
          : 'Saved'
        setTabs((prev) =>
          prev.map((t) =>
            t.path === tab.path
              ? {
                  ...t,
                  savedContent: tab.content,
                  committedContent: commit ? tab.content : t.committedContent,
                  status: 'saved',
                  statusMessage: message,
                }
              : t,
          ),
        )
        if (commit) {
          refreshTree()
          fetchRules(tab.path)
            .then((rules) => setTabs((curr) => curr.map((t) => (t.path === tab.path ? { ...t, rules } : t))))
            .catch(console.error)
        }
      } catch (err) {
        setTabs((prev) =>
          prev.map((t) =>
            t.path === tab.path
              ? { ...t, status: 'error', statusMessage: err instanceof Error ? err.message : String(err) }
              : t,
          ),
        )
      }
    },
    [activeTab, readOnly],
  )

  const handleFileCreated = useCallback(
    (relPath: string) => {
      refreshTree()
      openFile(relPath, { preview: false })
    },
    [openFile],
  )

  const handleFolderCreated = useCallback(() => {
    refreshTree()
  }, [])

  const handleRenamed = useCallback((oldPath: string, newPath: string, type: 'file' | 'dir') => {
    refreshTree()
    const remap = (p: string) => {
      if (type === 'file') return p === oldPath ? newPath : p
      return p === oldPath || p.startsWith(oldPath + '/') ? newPath + p.slice(oldPath.length) : p
    }
    setTabs((prev) => prev.map((t) => ({ ...t, path: remap(t.path) })))
    setActivePath((p) => (p ? remap(p) : p))
  }, [])

  const handleDeleted = useCallback((path: string, type: 'file' | 'dir') => {
    refreshTree()
    setTabs((prev) => {
      const removed = new Set(
        prev
          .filter((t) => (type === 'file' ? t.path === path : t.path === path || t.path.startsWith(path + '/')))
          .map((t) => t.path),
      )
      if (removed.size === 0) return prev
      const next = prev.filter((t) => !removed.has(t.path))
      setActivePath((p) => (p && removed.has(p) ? (next[0]?.path ?? null) : p))
      return next
    })
  }, [])

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
      } else if (e.altKey && e.code === 'KeyW') {
        // Ctrl+W는 Chromium이 예약한 브라우저 단축키라 preventDefault로 막을 수 없어 Alt+W를 대신 쓴다
        // (e.code로 비교 — macOS에서 Option+문자는 e.key가 특수문자로 바뀌어 레이아웃에 취약함)
        e.preventDefault()
        if (activePath) closeTab(activePath)
      } else if (e.altKey && e.code === 'KeyN') {
        // Ctrl+N도 마찬가지로 브라우저 예약 단축키라 가로챌 수 없어 Alt+N을 쓴다
        e.preventDefault()
        setTabs((prev) => {
          const newTab = blankTab()
          setActivePath(newTab.path)
          return [...prev, newTab]
        })
      } else if (e.altKey && e.code === 'Enter') {
        e.preventDefault()
        toggleFullscreen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [saveCurrentTab, closeTab, activePath])

  function startTmuxResize(e: React.PointerEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = tmuxWidth
    function onMove(ev: PointerEvent) {
      // 패널이 화면 오른쪽에 붙어 있으므로 왼쪽으로 끌수록(dx 음수) 넓어진다
      setTmuxWidth(clampTmuxWidth(startWidth - (ev.clientX - startX)))
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setTmuxWidth((w) => {
        localStorage.setItem(TMUX_WIDTH_KEY, String(w))
        return w
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="flex flex-col bg-surface text-ink" style={{ height: 'var(--app-height, 100dvh)' }}>
      <header className="flex items-center justify-between border-b border-edge px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded border border-edge-strong p-1.5 hover:bg-surface-raised"
            title="사이드바 열기/닫기"
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

      {/* Tab bar */}
      <div className="flex h-9 items-center overflow-x-auto border-b border-edge bg-surface-deep">
        {tabs.map((tab) => {
          const isActive = tab.path === activePath
          const fileName = tab.path.split('/').pop() ?? tab.path
          const sessionCount = tabPresence[tab.path] ?? 0
          return (
            <div
              key={tab.path}
              className={`group flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-r border-edge px-3 text-xs select-none ${
                isActive ? 'bg-surface-raised text-ink' : 'bg-surface text-ink-secondary hover:bg-surface-raised'
              }`}
              onClick={() => setActivePath(tab.path)}
              onDoubleClick={() => pinTab(tab.path)}
            >
              <span className={`max-w-[150px] truncate ${tab.preview ? 'italic' : ''}`}>{fileName}</span>
              {sessionCount > 1 && (
                <span
                  className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-medium text-ink-inverse"
                  title={`이 문서를 ${sessionCount}개 세션에서 열어두고 있습니다`}
                >
                  {sessionCount}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.path)
                }}
                className="ml-0.5 flex h-4 w-4 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <div className="fixed inset-0 z-30 flex flex-col bg-surface-deep md:static md:z-auto md:w-64 md:shrink-0">
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
                onSelect={(path, opts) => {
                  openFile(path, opts)
                  if (!isDesktop()) setSidebarOpen(false)
                }}
                onFileCreated={(relPath) => {
                  handleFileCreated(relPath)
                  if (!isDesktop()) setSidebarOpen(false)
                }}
                onFolderCreated={handleFolderCreated}
                onRenamed={handleRenamed}
                onDeleted={handleDeleted}
              />
            </div>
          </div>
        )}

        {activeTab ? (
          <>
            {!readOnly && activeTab.path.startsWith('archives/') && (
              <div className="absolute inset-x-0 top-11 z-10 bg-warning-surface px-4 py-1 text-center text-sm text-warning-ink">
                archives/ 문서는 불변입니다 — 편집이 차단되었습니다
              </div>
            )}
            <div className="relative min-w-0 flex-1">
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
            <TableOfContents content={activeTab.content} onJump={(i) => editorRef.current?.scrollToHeading(i)} />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-ink-secondary">
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
          <div className="fixed inset-0 z-30 md:static md:z-auto md:w-96 md:shrink-0 md:border-l md:border-edge">
            <AgentSidebar onClose={() => setAgentOpen(false)} activeFilePath={activeAbsolutePath} />
          </div>
        )}

        {tmuxOpen && (
          <div className="fixed inset-0 z-30 flex md:static md:z-auto md:shrink-0" style={{ width: isDesktop() ? tmuxWidth : undefined }}>
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
        <>
          {fabMenuOpen && <div className="fixed inset-0 z-30" onClick={() => setFabMenuOpen(false)} />}
          <div className="fixed right-4 bottom-4 z-40 flex flex-col items-center gap-3">
            {fabMenuOpen && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    toggleFullscreen()
                    setFabMenuOpen(false)
                  }}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-raised text-ink-bright shadow-lg hover:bg-surface-hover"
                  title="전체화면 (Alt+Enter)"
                  aria-label="전체화면 토글"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAgentOpen(true)
                    setFabMenuOpen(false)
                  }}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-raised text-ink-bright shadow-lg hover:bg-surface-hover"
                  title="에이전트 채팅"
                  aria-label="에이전트 채팅 열기"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTmuxOpen(true)
                    setFabMenuOpen(false)
                  }}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-raised text-ink-bright shadow-lg hover:bg-surface-hover"
                  title="터미널"
                  aria-label="터미널 열기"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="m7 9 3 3-3 3" />
                    <line x1="13" y1="15" x2="17" y2="15" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
                    setFabMenuOpen(false)
                  }}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-raised text-ink-bright shadow-lg hover:bg-surface-hover"
                  title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
                  aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
                >
                  {theme === 'dark' ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                  )}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setFabMenuOpen((v) => !v)}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-raised text-ink-bright shadow-lg hover:bg-surface-hover"
              title={fabMenuOpen ? '닫기' : '메뉴'}
              aria-label={fabMenuOpen ? '메뉴 닫기' : '메뉴 열기'}
            >
              {fabMenuOpen ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="19" cy="12" r="2" />
                </svg>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default App