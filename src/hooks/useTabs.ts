import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchFile, fetchRules, isArchivedPath, saveFile, type DocRules } from '../api/client'
import { mediaKind } from '../utils/media'
import { dropCachedFile, getCachedFile, putCachedFile } from '../utils/contentCache'

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
  editable: boolean // 서버가 /api/file에서 계산해 내려주는 값 — 게스트의 부분 편집 승인을 반영
}

/** 한 프로젝트의 탭 묶음 — 프로젝트 탭을 옮겨도 각자 열어둔 문서와 활성 탭이 그대로 남는다 */
type ProjectTabs = { tabs: Tab[]; activePath: string | null }

const EMPTY: ProjectTabs = { tabs: [], activePath: null }

// 탭 복원은 프로젝트별로 — docs는 예전 키를 그대로 써서 기존에 열려 있던 탭을 잃지 않는다
export function openTabsKey(project: string): string {
  return project === 'docs' ? 'mew:open-tabs' : `mew:open-tabs:${project}`
}

type StoredTabs = {
  tabs: { path: string; preview: boolean; viewMode: 'hotview' | 'plain' }[]
  activePath: string | null
}

function loadStoredTabs(project: string): StoredTabs | null {
  const raw = localStorage.getItem(openTabsKey(project))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredTabs>
    return Array.isArray(parsed?.tabs) ? { tabs: parsed.tabs, activePath: parsed.activePath ?? null } : null
  } catch {
    return null
  }
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
    editable: true,
  }
}

// 열린 탭 목록과 탭별 저장 상태 머신(자동저장·커밋) 전부 — App은 여기서 받은 상태와
// 액션만 배선한다. onCommitted는 커밋 성공 시 트리 갱신 등 바깥 후처리용.
//
// 상태는 **프로젝트별**로 들고 있고, 밖으로는 지금 활성 프로젝트(project 인자)의 것만 내보낸다.
// 액션도 특별히 명시하지 않는 한 활성 프로젝트에 대해 동작한다 — 화면에서 만질 수 있는 게
// 그것뿐이기 때문이다. 예외는 자동저장·커밋으로, 이들은 예약된 시점의 프로젝트를 붙들고 있어야
// 전환 뒤에 엉뚱한 프로젝트의 같은 이름 파일을 덮어쓰지 않는다.
export function useTabs(project: string, onCommitted: () => void, onNotice: (message: string) => void) {
  const [states, setStates] = useState<Record<string, ProjectTabs>>({})
  // 콜백 identity가 바뀌어도 openFileIn 등의 useCallback을 다시 만들지 않도록 ref로 든다
  const onNoticeRef = useRef(onNotice)
  onNoticeRef.current = onNotice
  const statesRef = useRef<Record<string, ProjectTabs>>({})
  // 디바운스가 걸려 있는 저장 — 예약할 때의 프로젝트를 함께 붙들어 둔다
  const saveTimerRef = useRef<{ timer: ReturnType<typeof setTimeout>; project: string; path: string } | null>(null)
  const projectRef = useRef(project)
  projectRef.current = project
  const hydratedRef = useRef(new Set<string>())

  const state = states[project] ?? EMPTY
  const { tabs, activePath } = state
  const activeTab = tabs.find((t) => t.path === activePath) ?? null

  useEffect(() => {
    statesRef.current = states
  }, [states])

  const tabsOf = (p: string) => statesRef.current[p]?.tabs ?? []

  /** 한 프로젝트의 탭 묶음만 바꾼다 — 다른 프로젝트 상태는 그대로 둔다 */
  const patch = useCallback((p: string, fn: (prev: ProjectTabs) => ProjectTabs) => {
    setStates((all) => ({ ...all, [p]: fn(all[p] ?? EMPTY) }))
  }, [])

  /** 그 프로젝트의 탭들을 한 번에 매핑 */
  const mapTabs = useCallback(
    (p: string, fn: (t: Tab) => Tab) => {
      patch(p, (s) => ({ ...s, tabs: s.tabs.map(fn) }))
    },
    [patch],
  )

  const setActivePath = useCallback(
    (path: string | null) => {
      patch(projectRef.current, (s) => ({ ...s, activePath: path }))
    },
    [patch],
  )

  const openFileIn = useCallback(
    // forceNewTab: 이미 열려 있지 않은 문서라도 미리보기 탭 자리를 재사용하지 않고 항상 새 탭으로 연다
    // (에디터 안에서 Ctrl+클릭으로 내부 링크를 열 때 — 사이드바 클릭의 미리보기 재사용 동작과는 별개)
    (p: string, path: string, opts?: { preview?: boolean; forceNewTab?: boolean }) => {
      const preview = opts?.preview ?? true
      const existing = tabsOf(p).find((t) => t.path === path)
      if (existing) {
        patch(p, (s) => ({
          tabs: !preview && existing.preview ? s.tabs.map((t) => (t.path === path ? { ...t, preview: false } : t)) : s.tabs,
          activePath: path,
        }))
        return
      }
      // 마크다운이 아닌 파일(코드·설정 등)은 tiptap이 본문을 훼손하므로 plain 편집이 기본
      // svg는 md처럼 이미지 미리보기(hotview)로 먼저 연다
      const previewFirst = path.endsWith('.md') || path.endsWith('.svg')
      // 최근 연 파일이면 캐시된 본문으로 탭을 즉시 채운다 — 아래 fetch가 백그라운드에서
      // 최신본으로 재조정하지만 그 사이 빈 화면·"처음부터 로딩" 깜빡임을 없앤다
      const cached = getCachedFile(p, path)
      const newTab: Tab = {
        ...blankTab(),
        path,
        preview,
        viewMode: previewFirst ? 'hotview' : 'plain',
        ...(cached
          ? { content: cached.content, savedContent: cached.content, committedContent: cached.content, editable: cached.editable }
          : {}),
      }
      patch(p, (s) => {
        if (opts?.forceNewTab) return { tabs: [...s.tabs, newTab], activePath: path }
        // 미리보기 탭은 하나만 유지 — 새로 여는 문서가 그 자리를 재사용
        const previewIdx = s.tabs.findIndex((t) => t.preview)
        if (previewIdx === -1) return { tabs: [...s.tabs, newTab], activePath: path }
        const next = [...s.tabs]
        next[previewIdx] = newTab
        return { tabs: next, activePath: path }
      })
      // 바이너리 미디어는 뷰어가 /api/raw로 직접 스트리밍한다 — utf-8 fetch도 규칙 검사도 없음
      if (mediaKind(path)) return
      fetchFile(path, p)
        .then(({ content, editable }) => {
          putCachedFile(p, path, { content, editable })
          mapTabs(p, (t) =>
            t.path === path ? { ...t, content, savedContent: content, committedContent: content, status: 'idle', editable } : t,
          )
        })
        // 열 수 없는 파일(게스트 권한 밖 등)은 빈 탭만 남아 "아무 일도 안 일어난" 것처럼 보인다 — 이유를 띄운다
        .catch((err) => {
          console.error(err)
          onNoticeRef.current(err instanceof Error ? err.message : String(err))
        })
      fetchRules(path, p)
        .then((rules) => mapTabs(p, (t) => (t.path === path ? { ...t, rules } : t)))
        .catch(console.error)
    },
    [patch, mapTabs],
  )

  const openFile = useCallback(
    (path: string, opts?: { preview?: boolean; forceNewTab?: boolean }) => openFileIn(projectRef.current, path, opts),
    [openFileIn],
  )

  // 브라우저를 껐다 켜거나 F5로 새로고침해도 열려 있던 탭들을 복원한다. 프로젝트를 처음 열 때
  // (전환 포함) 한 번만 — StrictMode의 이펙트 2회 실행도 hydratedRef가 막는다.
  useEffect(() => {
    if (hydratedRef.current.has(project)) return
    hydratedRef.current.add(project)
    const stored = loadStoredTabs(project)
    if (!stored) {
      patch(project, (s) => s) // 빈 상태라도 만들어 둬야 이후 저장이 이 프로젝트를 기록한다
      return
    }
    for (const t of stored.tabs) openFileIn(project, t.path, { preview: t.preview, forceNewTab: true })
    if (stored.activePath) patch(project, (s) => ({ ...s, activePath: stored.activePath }))
  }, [project, openFileIn, patch])

  // 복원이 끝난(=상태가 만들어진) 프로젝트만 저장한다 — 아직 열어보지 않은 프로젝트의 저장분을
  // 빈 목록으로 덮어쓰지 않는다.
  useEffect(() => {
    for (const [p, s] of Object.entries(states)) {
      const payload: StoredTabs = {
        tabs: s.tabs.map((t) => ({ path: t.path, preview: t.preview, viewMode: t.viewMode })),
        activePath: s.activePath,
      }
      localStorage.setItem(openTabsKey(p), JSON.stringify(payload))
    }
  }, [states])

  const openBlankTab = useCallback(() => {
    const newTab = blankTab()
    patch(projectRef.current, (s) => ({ tabs: [...s.tabs, newTab], activePath: newTab.path }))
  }, [patch])

  const pinTab = useCallback(
    (path: string) => {
      mapTabs(projectRef.current, (t) => (t.path === path ? { ...t, preview: false } : t))
    },
    [mapTabs],
  )

  const reorderTabs = useCallback(
    (from: number, to: number) => {
      patch(projectRef.current, (s) => {
        if (from === to || from < 0 || to < 0 || from >= s.tabs.length || to >= s.tabs.length) return s
        const next = [...s.tabs]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        return { ...s, tabs: next }
      })
    },
    [patch],
  )

  const setTabViewMode = useCallback(
    (path: string, viewMode: Tab['viewMode']) => {
      mapTabs(projectRef.current, (t) => (t.path === path ? { ...t, viewMode } : t))
    },
    [mapTabs],
  )

  // 경로 기준으로 디스크에 저장 (git 커밋 없음)
  // statesRef로 최신 content를 읽어 디바운스 스테일 문제를 피하고, setState 업데이터 안에서 부수효과(fetch)를
  // 실행하지 않는다 — StrictMode가 업데이터 함수를 두 번 호출해 fetch가 중복 발생하는 것을 방지
  const autosave = useCallback(
    (p: string, path: string) => {
      const tab = tabsOf(p).find((t) => t.path === path)
      if (!tab || tab.content === tab.savedContent || isArchivedPath(tab.path, p) || !tab.editable) return
      const content = tab.content
      mapTabs(p, (t) => (t.path === path ? { ...t, status: 'saving' } : t))
      saveFile(path, content, false, p)
        .then(() => {
          putCachedFile(p, path, { content, editable: tab.editable })
          mapTabs(p, (t) =>
            t.path === path && t.content === content ? { ...t, savedContent: content, status: 'saved', statusMessage: 'Saved' } : t,
          )
        })
        .catch((err) => {
          mapTabs(p, (t) =>
            t.path === path ? { ...t, status: 'error', statusMessage: err instanceof Error ? err.message : String(err) } : t,
          )
        })
    },
    [mapTabs],
  )

  /**
   * 예약돼 있던 저장을 정리한다 — 지금 다루려는 탭(p/path) 것이면 취소만 하고(호출부가 곧
   * 직접 저장한다), 다른 탭 것이면 흘려버리지 않고 그 자리에서 저장해 준다. 디바운스는 하나뿐이라
   * 다른 탭·다른 프로젝트로 옮겨 가며 편집해도 앞의 편집이 사라지지 않게 하는 장치다.
   */
  const settlePendingSave = useCallback(
    (p: string, path: string) => {
      const pending = saveTimerRef.current
      if (!pending) return
      clearTimeout(pending.timer)
      saveTimerRef.current = null
      if (pending.project !== p || pending.path !== path) autosave(pending.project, pending.path)
    },
    [autosave],
  )

  const scheduleAutosave = useCallback(
    (p: string, path: string) => {
      settlePendingSave(p, path)
      const timer = setTimeout(() => {
        saveTimerRef.current = null
        autosave(p, path)
      }, 500)
      saveTimerRef.current = { timer, project: p, path }
    },
    [autosave, settlePendingSave],
  )

  const closeTab = useCallback(
    (path: string) => {
      const p = projectRef.current
      // 디바운스를 기다리지 않고 닫히는 탭의 변경 내용을 즉시 디스크에 반영
      settlePendingSave(p, path)
      autosave(p, path)
      patch(p, (s) => {
        const next = s.tabs.filter((t) => t.path !== path)
        if (s.activePath !== path) return { ...s, tabs: next }
        const idx = s.tabs.findIndex((t) => t.path === path)
        return { tabs: next, activePath: next[Math.min(idx, next.length - 1)]?.path ?? null }
      })
    },
    [autosave, settlePendingSave, patch],
  )

  const updateTabContent = useCallback(
    (path: string, content: string) => {
      const p = projectRef.current
      // 편집이 시작되면 미리보기 탭을 고정 탭으로 승격 (VSCode와 동일)
      mapTabs(p, (t) => (t.path === path ? { ...t, content, preview: false } : t))
      scheduleAutosave(p, path)
    },
    [mapTabs, scheduleAutosave],
  )

  const saveCurrentTab = useCallback(
    async (commit = false) => {
      const p = projectRef.current
      const current = statesRef.current[p] ?? EMPTY
      const tab = current.tabs.find((t) => t.path === current.activePath) ?? null
      if (!tab || !tab.editable) return
      const dirty = commit ? tab.content !== tab.committedContent : tab.content !== tab.savedContent
      if (!dirty || isArchivedPath(tab.path, p)) return

      settlePendingSave(p, tab.path)
      mapTabs(p, (t) => (t.path === tab.path ? { ...t, status: 'saving' } : t))
      try {
        const result = await saveFile(tab.path, tab.content, commit, p)
        putCachedFile(p, tab.path, { content: tab.content, editable: tab.editable })
        const message = commit
          ? `Committed${result.commit?.hash ? ' ' + result.commit.hash.slice(0, 7) : ''}`
          : 'Saved'
        mapTabs(p, (t) =>
          t.path === tab.path
            ? {
                ...t,
                savedContent: tab.content,
                committedContent: commit ? tab.content : t.committedContent,
                status: 'saved',
                statusMessage: message,
              }
            : t,
        )
        if (commit) {
          onCommitted()
          fetchRules(tab.path, p)
            .then((rules) => mapTabs(p, (t) => (t.path === tab.path ? { ...t, rules } : t)))
            .catch(console.error)
        }
      } catch (err) {
        mapTabs(p, (t) =>
          t.path === tab.path ? { ...t, status: 'error', statusMessage: err instanceof Error ? err.message : String(err) } : t,
        )
      }
    },
    [settlePendingSave, mapTabs, onCommitted],
  )

  // 서버에서 이미 쓰기+커밋까지 끝낸 내용(히스토리 되돌리기)을 탭 상태에 반영 — saveFile을 다시
  // 부르지 않고 saveCurrentTab(true) 성공 시와 동일하게 savedContent/committedContent를 맞춘다
  const applyRevertedContent = useCallback(
    (path: string, content: string) => {
      const p = projectRef.current
      // 되돌리기는 지금 버퍼를 통째로 대체하므로 이 탭에 예약된 저장은 취소한다
      settlePendingSave(p, path)
      putCachedFile(p, path, { content, editable: tabsOf(p).find((t) => t.path === path)?.editable ?? true })
      mapTabs(p, (t) =>
        t.path === path
          ? { ...t, content, savedContent: content, committedContent: content, status: 'saved', statusMessage: 'Reverted' }
          : t,
      )
      onCommitted()
      fetchRules(path, p)
        .then((rules) => mapTabs(p, (t) => (t.path === path ? { ...t, rules } : t)))
        .catch(console.error)
    },
    [settlePendingSave, mapTabs, onCommitted],
  )

  // 파일/폴더 이름 변경을 열린 탭 경로에 반영
  const remapPaths = useCallback(
    (oldPath: string, newPath: string, type: 'file' | 'dir') => {
      const p = projectRef.current
      // 이름이 바뀐 경로의 캐시는 버린다 — 새 경로로 다시 열면 fetch가 채운다
      if (type === 'file') dropCachedFile(p, oldPath)
      const remap = (path: string) => {
        if (type === 'file') return path === oldPath ? newPath : path
        return path === oldPath || path.startsWith(oldPath + '/') ? newPath + path.slice(oldPath.length) : path
      }
      patch(p, (s) => ({
        tabs: s.tabs.map((t) => ({ ...t, path: remap(t.path) })),
        activePath: s.activePath ? remap(s.activePath) : s.activePath,
      }))
    },
    [patch],
  )

  // 파일/폴더 삭제 시 해당 탭 닫기
  const removePaths = useCallback(
    (path: string, type: 'file' | 'dir') => {
      const p = projectRef.current
      patch(p, (s) => {
        const removed = new Set(
          s.tabs
            .filter((t) => (type === 'file' ? t.path === path : t.path === path || t.path.startsWith(path + '/')))
            .map((t) => t.path),
        )
        if (removed.size === 0) return s
        removed.forEach((gone) => dropCachedFile(p, gone))
        const next = s.tabs.filter((t) => !removed.has(t.path))
        return { tabs: next, activePath: s.activePath && removed.has(s.activePath) ? (next[0]?.path ?? null) : s.activePath }
      })
    },
    [patch],
  )

  /**
   * 프로젝트 탭을 닫을 때 — 그 프로젝트의 탭 상태를 메모리에서 버린다. localStorage에 저장된
   * 목록은 그대로 두므로 다시 열면 열려 있던 문서들이 복원된다.
   */
  const forgetProject = useCallback((p: string) => {
    hydratedRef.current.delete(p)
    setStates((all) => {
      if (!(p in all)) return all
      const next = { ...all }
      delete next[p]
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
    reorderTabs,
    setTabViewMode,
    updateTabContent,
    saveCurrentTab,
    applyRevertedContent,
    closeTab,
    remapPaths,
    removePaths,
    forgetProject,
  }
}
