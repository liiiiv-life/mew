import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchFile, fetchMode, fetchRules, fetchTree, saveFile, type TreeNode, type DocRules } from './api/client'
import { FileTree } from './components/FileTree'
import { Editor, type EditorHandle } from './components/Editor'
import { AgentSidebar } from './components/AgentSidebar'
import { TableOfContents } from './components/TableOfContents'

type Tab = {
  path: string
  content: string
  savedContent: string // 디스크에 마지막으로 저장된 내용 (자동저장 기준)
  committedContent: string // 마지막 커밋 시점의 내용 (Commit 버튼 활성화 기준)
  rules: DocRules | null
  status: 'idle' | 'saving' | 'saved' | 'error'
  statusMessage?: string
  preview: boolean
}

const isDesktop = () => window.matchMedia('(min-width: 768px)').matches

function App() {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop)
  const [agentOpen, setAgentOpen] = useState(false)
  const [searchFocusSignal, setSearchFocusSignal] = useState(0)
  // 서버 모드를 확인하기 전까지는 편집 UI를 숨긴다 (뷰어에서 깜빡임 방지)
  const [readOnly, setReadOnly] = useState(true)
  const editorRef = useRef<EditorHandle>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tabsRef = useRef<Tab[]>([])

  const activeTab = tabs.find((t) => t.path === activePath) ?? null

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  const refreshTree = () => fetchTree().then(setTree).catch(console.error)

  useEffect(() => {
    refreshTree()
    fetchMode()
      .then(({ readOnly }) => setReadOnly(readOnly))
      .catch(console.error)
  }, [])

  const openFile = useCallback(
    (path: string, opts?: { preview?: boolean }) => {
      const preview = opts?.preview ?? true
      const existing = tabs.find((t) => t.path === path)
      if (existing) {
        if (!preview && existing.preview) {
          setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, preview: false } : t)))
        }
        setActivePath(path)
        return
      }
      const newTab: Tab = { path, content: '', savedContent: '', committedContent: '', rules: null, status: 'idle', preview }
      setTabs((prev) => {
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

  const pinTab = useCallback((path: string) => {
    setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, preview: false } : t)))
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
      } else if (mod && e.key === 'w') {
        e.preventDefault()
        if (activePath) {
          // 현재 탭 닫기
          setTabs((prev) => {
            const next = prev.filter((t) => t.path !== activePath)
            // 가장 마지막에 새 탭 열기
            const newTab: Tab = {
              path: '',
              content: '',
              savedContent: '',
              committedContent: '',
              rules: null,
              status: 'idle',
              preview: false,
            }
            const result = [...next, newTab]
            // 새 탭이 열렸으므로 그 탭을 활성화
            setActivePath(newTab.path)
            return result
          })
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [saveCurrentTab, closeTab, activePath])

  return (
    <div className="flex h-dvh flex-col bg-surface text-ink">
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
            <div className="min-w-0 flex-1">
              <Editor
                ref={editorRef}
                value={activeTab.content}
                onChange={(content) => updateTabContent(activeTab.path, content)}
                readOnly={readOnly || activeTab.path.startsWith('archives/')}
                path={activeTab.path}
                tree={tree}
              />
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
            <AgentSidebar onClose={() => setAgentOpen(false)} />
          </div>
        )}
      </div>

      {!readOnly && !agentOpen && (
        <button
          type="button"
          onClick={() => setAgentOpen(true)}
          className="fixed right-4 bottom-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-accent-strong text-ink-on-accent shadow-lg hover:bg-accent"
          title="에이전트 채팅"
          aria-label="에이전트 채팅 열기"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}
    </div>
  )
}

export default App