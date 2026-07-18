import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchFile, fetchRules, saveFile, type DocRules } from '../api/client'

export type Tab = {
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

// 열린 탭 목록과 탭별 저장 상태 머신(자동저장·커밋) 전부 — App은 여기서 받은 상태와
// 액션만 배선한다. onCommitted는 커밋 성공 시 트리 갱신 등 바깥 후처리용.
export function useTabs(readOnly: boolean, onCommitted: () => void) {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tabsRef = useRef<Tab[]>([])

  const activeTab = tabs.find((t) => t.path === activePath) ?? null

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  const openFile = useCallback(
    // forceNewTab: 이미 열려 있지 않은 문서라도 미리보기 탭 자리를 재사용하지 않고 항상 새 탭으로 연다
    // (에디터 안에서 Ctrl+클릭으로 내부 링크를 열 때 — 사이드바 클릭의 미리보기 재사용 동작과는 별개)
    (path: string, opts?: { preview?: boolean; forceNewTab?: boolean }) => {
      const preview = opts?.preview ?? true
      const existing = tabsRef.current.find((t) => t.path === path)
      if (existing) {
        if (!preview && existing.preview) {
          setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, preview: false } : t)))
        }
        setActivePath(path)
        return
      }
      const newTab: Tab = { ...blankTab(), path, preview }
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
    [],
  )

  const openBlankTab = useCallback(() => {
    setTabs((prev) => {
      const newTab = blankTab()
      setActivePath(newTab.path)
      return [...prev, newTab]
    })
  }, [])

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
        setActivePath((p) => {
          if (p !== path) return p
          const idx = prev.findIndex((t) => t.path === path)
          return next[Math.min(idx, next.length - 1)]?.path ?? null
        })
        return next
      })
    },
    [autosave],
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
      const tab = tabsRef.current.find((t) => t.path === activePath) ?? null
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
          onCommitted()
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
    [activePath, readOnly, onCommitted],
  )

  // 파일/폴더 이름 변경을 열린 탭 경로에 반영
  const remapPaths = useCallback((oldPath: string, newPath: string, type: 'file' | 'dir') => {
    const remap = (p: string) => {
      if (type === 'file') return p === oldPath ? newPath : p
      return p === oldPath || p.startsWith(oldPath + '/') ? newPath + p.slice(oldPath.length) : p
    }
    setTabs((prev) => prev.map((t) => ({ ...t, path: remap(t.path) })))
    setActivePath((p) => (p ? remap(p) : p))
  }, [])

  // 파일/폴더 삭제 시 해당 탭 닫기
  const removePaths = useCallback((path: string, type: 'file' | 'dir') => {
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

  return {
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
  }
}
