import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchExternalFile, fetchFile, fetchRules, isArchivedPath, saveExternalFile, saveFile, type DocRules } from '../api/client'
import { mediaKind } from '../utils/media'
import { dropCachedFile, getCachedFile, putCachedFile } from '../utils/contentCache'
import { leaf, normalizeLayout, removeLeaf, splitLeaf, type DropSide, type PaneNode } from '../utils/paneTree'
import { externalAbsolutePath, externalTabPath, isExternalTabPath } from '../utils/externalFiles'

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
  /** 세션 복원 때는 탭 껍데기만 먼저 세운다. 선택되는 순간 기존 파일 로드 경로로 본문을 받는다. */
  deferredLoad?: boolean
}

/** 화면 분할의 칸 하나 — 자기 탭 줄과 자기 활성 탭을 가진다 */
export type Pane = { id: string; tabs: Tab[]; activePath: string | null }

/** 한 프로젝트의 편집 화면 — 칸들 + 그 칸들의 배치 + 지금 포커스된 칸 */
type ProjectTabs = { panes: Pane[]; layout: PaneNode; focusedPaneId: string }

/** 분할하지 않은 상태의 칸 id — 저장분과 옛 형식 이관이 이 이름 하나만 알면 되게 고정값이다 */
const MAIN_PANE = 'main'

const EMPTY: ProjectTabs = { panes: [{ id: MAIN_PANE, tabs: [], activePath: null }], layout: leaf(MAIN_PANE), focusedPaneId: MAIN_PANE }

let paneSeq = 0
function newPaneId(): string {
  paneSeq += 1
  return `pane-${Date.now().toString(36)}-${paneSeq}`
}

// 탭 복원은 프로젝트별로 — docs는 예전 키를 그대로 써서 기존에 열려 있던 탭을 잃지 않는다
export function openTabsKey(project: string): string {
  return project === 'docs' ? 'mew:open-tabs' : `mew:open-tabs:${project}`
}

type StoredTab = { path: string; preview: boolean; viewMode: 'hotview' | 'plain' }
type StoredTabs = {
  panes: { id: string; tabs: StoredTab[]; activePath: string | null }[]
  layout: PaneNode
  focusedPaneId: string
}

/** 저장분 읽기 — 분할 이전 형식(`{tabs, activePath}`)은 칸 하나짜리로 읽는다 */
function loadStoredTabs(project: string): StoredTabs | null {
  const raw = localStorage.getItem(openTabsKey(project))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredTabs> & { tabs?: StoredTab[]; activePath?: string | null }
    const panes = Array.isArray(parsed?.panes)
      ? parsed.panes.filter((p) => p && typeof p.id === 'string' && Array.isArray(p.tabs))
      : Array.isArray(parsed?.tabs)
        ? [{ id: MAIN_PANE, tabs: parsed.tabs, activePath: parsed.activePath ?? null }]
        : []
    if (panes.length === 0) return null
    return {
      panes: panes.map((p) => ({ id: p.id, tabs: p.tabs, activePath: p.activePath ?? null })),
      layout: normalizeLayout(parsed.layout, panes.map((p) => p.id)),
      focusedPaneId: panes.some((p) => p.id === parsed.focusedPaneId) ? parsed.focusedPaneId! : panes[0].id,
    }
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

/**
 * 탭이 하나도 남지 않은 칸은 접는다 — 배치에서 빼고, 그 칸을 보고 있었으면 포커스를 옮긴다.
 * 칸이 하나뿐이면 접지 않는다(빈 화면 안내가 그 자리에 뜬다).
 */
function prunePanes(s: ProjectTabs): ProjectTabs {
  if (s.panes.length < 2) return s
  const kept = s.panes.filter((p) => p.tabs.length > 0)
  if (kept.length === s.panes.length) return s
  if (kept.length === 0) return { panes: [s.panes[0]], layout: leaf(s.panes[0].id), focusedPaneId: s.panes[0].id }
  let layout = s.layout
  for (const p of s.panes) if (!kept.includes(p)) layout = removeLeaf(layout, p.id) ?? layout
  return {
    panes: kept,
    layout: normalizeLayout(layout, kept.map((p) => p.id)),
    focusedPaneId: kept.some((p) => p.id === s.focusedPaneId) ? s.focusedPaneId : kept[0].id,
  }
}

// 열린 탭 목록과 탭별 저장 상태 머신(자동저장·커밋) 전부 — App은 여기서 받은 상태와
// 액션만 배선한다. onCommitted는 커밋 성공 시 트리 갱신 등 바깥 후처리용.
//
// 상태는 **프로젝트별**로 들고 있고, 밖으로는 지금 활성 프로젝트(project 인자)의 것만 내보낸다.
// 한 프로젝트 안은 다시 **칸(pane)별**로 나뉜다 — 칸마다 자기 탭 줄과 활성 탭이 있고, paneId를
// 넘기지 않는 액션은 지금 포커스된 칸에 대해 동작한다.
// 예외는 자동저장·커밋으로, 이들은 예약된 시점의 프로젝트를 붙들고 있어야 전환 뒤에 엉뚱한
// 프로젝트의 같은 이름 파일을 덮어쓰지 않는다.
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
  // 탭 껍데기를 setState로 세운 직후에는 statesRef가 아직 옛 상태다. 활성 탭의 실제 로드는
  // 다음 렌더 effect로 넘겨야 existing 탭을 다시 만들지 않고 deferredLoad만 해제할 수 있다.
  const pendingRestoreLoadsRef = useRef(new Map<string, { paneId: string; path: string; preview: boolean; viewMode: Tab['viewMode'] }[]>())

  const state = states[project] ?? EMPTY
  const { panes, layout, focusedPaneId } = state
  const focusedPane = panes.find((p) => p.id === focusedPaneId) ?? panes[0]
  const { tabs, activePath } = focusedPane
  const activeTab = tabs.find((t) => t.path === activePath) ?? null

  useEffect(() => {
    statesRef.current = states
  }, [states])

  const stateOf = (p: string) => statesRef.current[p] ?? EMPTY
  const paneOf = (p: string, paneId?: string) => {
    const s = stateOf(p)
    const id = paneId ?? s.focusedPaneId
    return s.panes.find((x) => x.id === id) ?? s.panes[0]
  }
  /** 그 프로젝트에서 이 경로로 열린 탭 아무거나 — 내용·저장 상태는 칸이 달라도 같은 것을 본다 */
  const findTab = (p: string, path: string) => stateOf(p).panes.flatMap((x) => x.tabs).find((t) => t.path === path)

  /** 한 프로젝트의 화면 상태만 바꾼다 — 다른 프로젝트 상태는 그대로 둔다 */
  const patch = useCallback((p: string, fn: (prev: ProjectTabs) => ProjectTabs) => {
    setStates((all) => ({ ...all, [p]: fn(all[p] ?? EMPTY) }))
  }, [])

  /** 칸 하나만 바꾼다 */
  const patchPane = useCallback(
    (p: string, paneId: string, fn: (pane: Pane) => Pane) => {
      patch(p, (s) => ({ ...s, panes: s.panes.map((x) => (x.id === paneId ? fn(x) : x)) }))
    },
    [patch],
  )

  /** 그 프로젝트의 **모든 칸**의 탭을 한 번에 매핑 — 내용·저장 상태는 경로 단위라 칸을 가리지 않는다 */
  const mapTabs = useCallback(
    (p: string, fn: (t: Tab) => Tab) => {
      patch(p, (s) => ({ ...s, panes: s.panes.map((pane) => ({ ...pane, tabs: pane.tabs.map(fn) })) }))
    },
    [patch],
  )

  const setActivePath = useCallback(
    (path: string | null, paneId?: string) => {
      const p = projectRef.current
      patchPane(p, paneId ?? stateOf(p).focusedPaneId, (pane) => ({ ...pane, activePath: path }))
    },
    [patchPane],
  )

  /** 포커스 칸 옮기기 — 커밋·단축키·터미널 붙여넣기가 어느 칸을 가리키는지가 이걸로 정해진다 */
  const focusPane = useCallback(
    (paneId: string) => {
      patch(projectRef.current, (s) => (s.focusedPaneId === paneId ? s : { ...s, focusedPaneId: paneId }))
    },
    [patch],
  )

  const openFileIn = useCallback(
    // forceNewTab: 이미 열려 있지 않은 문서라도 미리보기 탭 자리를 재사용하지 않고 항상 새 탭으로 연다
    // (에디터 안에서 Ctrl+클릭으로 내부 링크를 열 때 — 사이드바 클릭의 미리보기 재사용 동작과는 별개)
    (p: string, paneId: string, path: string, opts?: { preview?: boolean; forceNewTab?: boolean; deferLoad?: boolean; viewMode?: Tab['viewMode'] }) => {
      const preview = opts?.preview ?? true
      const existing = paneOf(p, paneId).tabs.find((t) => t.path === path)
      if (existing) {
        // 복원 때 뒤로 미뤘던 탭은 사용자가 고르는 바로 그때만 기존 전체 본문 요청을 시작한다.
        // 캐시된 본문이 있으면 이미 즉시 보이고, fetch는 최신본 확인 역할만 한다.
        const loadDeferred = existing.deferredLoad === true && !opts?.deferLoad
        patchPane(p, paneId, (pane) => ({
          ...pane,
          tabs: pane.tabs.map((t) =>
            t.path !== path ? t : { ...t, preview: !preview && t.preview ? false : t.preview, deferredLoad: loadDeferred ? false : t.deferredLoad },
          ),
          activePath: path,
        }))
        if (!loadDeferred) return
      }
      // 마크다운이 아닌 파일(코드·설정 등)은 tiptap이 본문을 훼손하므로 plain 편집이 기본
      // svg는 md처럼 이미지 미리보기(hotview)로 먼저 연다
      const external = isExternalTabPath(path)
      const previewFirst = !external && (path.endsWith('.md') || path.endsWith('.svg'))
      // 최근 연 파일이면 캐시된 본문으로 탭을 즉시 채운다 — 아래 fetch가 백그라운드에서
      // 최신본으로 재조정하지만 그 사이 빈 화면·"처음부터 로딩" 깜빡임을 없앤다
      const cached = external ? undefined : getCachedFile(p, path)
      const newTab: Tab = {
        ...blankTab(),
        path,
        preview,
        viewMode: opts?.viewMode ?? (previewFirst ? 'hotview' : 'plain'),
        deferredLoad: opts?.deferLoad === true,
        ...(cached
          ? { content: cached.content, savedContent: cached.content, committedContent: cached.content, editable: cached.editable }
          : {}),
      }
      if (!existing) {
        patchPane(p, paneId, (pane) => {
          if (opts?.forceNewTab) return { ...pane, tabs: [...pane.tabs, newTab], activePath: path }
          // 미리보기 탭은 칸마다 하나만 유지 — 새로 여는 문서가 그 자리를 재사용
          const previewIdx = pane.tabs.findIndex((t) => t.preview)
          if (previewIdx === -1) return { ...pane, tabs: [...pane.tabs, newTab], activePath: path }
          const next = [...pane.tabs]
          next[previewIdx] = newTab
          return { ...pane, tabs: next, activePath: path }
        })
      }
      // 세션 복원은 활성 탭 외에는 본문·규칙 요청을 만들지 않는다. 탭 순서·배치·캐시 본문은
      // 위에서 이미 복원됐고, 비활성 탭을 고르면 existing 분기의 deferredLoad가 여기로 이어진다.
      if (opts?.deferLoad) return
      // 바이너리 미디어는 뷰어가 /api/raw로 직접 스트리밍한다 — utf-8 fetch도 규칙 검사도 없음
      if (mediaKind(path)) return
      const fileRequest = external ? fetchExternalFile(externalAbsolutePath(path)) : fetchFile(path, p)
      fileRequest
        .then(({ content, editable }) => {
          if (!external) putCachedFile(p, path, { content, editable })
          mapTabs(p, (t) => {
            if (t.path !== path) return t
            // 캐시 본문으로 이미 그려 둔 사이에 손을 댔으면(타이핑·협업 방 내용) 그 버퍼를 덮지 않는다.
            // 서버 본문은 savedContent로만 들어가므로, 다르면 dirty가 되어 자동저장이 내 것을 올린다.
            const edited = cached !== undefined && t.content !== cached.content
            return {
              ...t,
              content: edited ? t.content : content,
              savedContent: content,
              committedContent: content,
              status: 'idle',
              editable,
            }
          })
        })
        // 열 수 없는 파일(게스트 권한 밖 등)은 빈 탭만 남아 "아무 일도 안 일어난" 것처럼 보인다 — 이유를 띄운다
        .catch((err) => {
          console.error(err)
          onNoticeRef.current(err instanceof Error ? err.message : String(err))
        })
      if (!external) {
        fetchRules(path, p)
          .then((rules) => mapTabs(p, (t) => (t.path === path ? { ...t, rules } : t)))
          .catch(console.error)
      }
    },
    [patchPane, mapTabs],
  )

  const openFile = useCallback(
    (path: string, opts?: { preview?: boolean; forceNewTab?: boolean; paneId?: string }) => {
      const p = projectRef.current
      openFileIn(p, opts?.paneId ?? stateOf(p).focusedPaneId, path, opts)
    },
    [openFileIn],
  )

  const openExternalFile = useCallback(
    (absolutePath: string, opts?: { paneId?: string }) => {
      const p = projectRef.current
      openFileIn(p, opts?.paneId ?? stateOf(p).focusedPaneId, externalTabPath(absolutePath), { preview: true })
    },
    [openFileIn],
  )

  // 브라우저를 껐다 켜거나 F5로 새로고침해도 열려 있던 탭들과 분할 배치를 복원한다. 프로젝트를
  // 처음 열 때(전환 포함) 한 번만 — StrictMode의 이펙트 2회 실행도 hydratedRef가 막는다.
  useEffect(() => {
    if (hydratedRef.current.has(project)) return
    hydratedRef.current.add(project)
    const stored = loadStoredTabs(project)
    if (!stored) {
      patch(project, (s) => s) // 빈 상태라도 만들어 둬야 이후 저장이 이 프로젝트를 기록한다
      return
    }
    // 칸 뼈대를 먼저 세운다 — openFileIn이 그 칸을 찾아 탭을 붙인다
    patch(project, () => ({
      panes: stored.panes.map((p) => ({ id: p.id, tabs: [], activePath: null })),
      layout: stored.layout,
      focusedPaneId: stored.focusedPaneId,
    }))
    const activeLoads: { paneId: string; path: string; preview: boolean; viewMode: Tab['viewMode'] }[] = []
    for (const pane of stored.panes) {
      // 탭 껍데기와 캐시 본문은 전부 즉시 복원하되, 첫 요청은 각 칸의 활성 탭 하나로 제한한다.
      // 비활성 탭은 사용자가 선택할 때만 openFileIn의 deferredLoad 경로로 읽는다.
      for (const t of pane.tabs) {
        openFileIn(project, pane.id, t.path, { preview: t.preview, viewMode: t.viewMode, forceNewTab: true, deferLoad: true })
      }
      if (pane.activePath) patchPane(project, pane.id, (x) => ({ ...x, activePath: pane.activePath }))
      if (pane.activePath) {
        const active = pane.tabs.find((t) => t.path === pane.activePath)
        if (active) activeLoads.push({ paneId: pane.id, path: active.path, preview: active.preview, viewMode: active.viewMode })
      }
    }
    pendingRestoreLoadsRef.current.set(project, activeLoads)
  }, [project, openFileIn, patch, patchPane])

  // 위 hydration effect가 만든 모든 탭이 상태에 붙은 뒤 활성 탭만 읽는다. statesRef 동기화 effect가
  // 선언 순서상 먼저 돌기 때문에 openFileIn은 deferred tab을 찾아 본문 요청만 시작한다.
  useEffect(() => {
    const activeLoads = pendingRestoreLoadsRef.current.get(project)
    if (!activeLoads) return
    pendingRestoreLoadsRef.current.delete(project)
    for (const load of activeLoads) {
      openFileIn(project, load.paneId, load.path, { preview: load.preview, viewMode: load.viewMode })
    }
  }, [project, states, openFileIn])

  // 복원이 끝난(=상태가 만들어진) 프로젝트만 저장한다 — 아직 열어보지 않은 프로젝트의 저장분을
  // 빈 목록으로 덮어쓰지 않는다.
  useEffect(() => {
    for (const [p, s] of Object.entries(states)) {
      const payload: StoredTabs = {
        panes: s.panes.map((pane) => ({
          id: pane.id,
          tabs: pane.tabs.filter((t) => !isExternalTabPath(t.path)).map((t) => ({ path: t.path, preview: t.preview, viewMode: t.viewMode })),
          activePath: pane.activePath && !isExternalTabPath(pane.activePath) ? pane.activePath : null,
        })),
        layout: s.layout,
        focusedPaneId: s.focusedPaneId,
      }
      localStorage.setItem(openTabsKey(p), JSON.stringify(payload))
    }
  }, [states])

  const pinTab = useCallback(
    (path: string, paneId?: string) => {
      const p = projectRef.current
      patchPane(p, paneId ?? stateOf(p).focusedPaneId, (pane) => ({
        ...pane,
        tabs: pane.tabs.map((t) => (t.path === path ? { ...t, preview: false } : t)),
      }))
    },
    [patchPane],
  )

  const reorderTabs = useCallback(
    (from: number, to: number, paneId?: string) => {
      const p = projectRef.current
      patchPane(p, paneId ?? stateOf(p).focusedPaneId, (pane) => {
        if (from === to || from < 0 || to < 0 || from >= pane.tabs.length || to >= pane.tabs.length) return pane
        const next = [...pane.tabs]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        return { ...pane, tabs: next }
      })
    },
    [patchPane],
  )

  const setTabViewMode = useCallback(
    (path: string, viewMode: Tab['viewMode'], paneId?: string) => {
      const p = projectRef.current
      patchPane(p, paneId ?? stateOf(p).focusedPaneId, (pane) => ({
        ...pane,
        tabs: pane.tabs.map((t) => (t.path === path ? { ...t, viewMode } : t)),
      }))
    },
    [patchPane],
  )

  // 경로 기준으로 디스크에 저장 (git 커밋 없음)
  // statesRef로 최신 content를 읽어 디바운스 스테일 문제를 피하고, setState 업데이터 안에서 부수효과(fetch)를
  // 실행하지 않는다 — StrictMode가 업데이터 함수를 두 번 호출해 fetch가 중복 발생하는 것을 방지
  const autosave = useCallback(
    (p: string, path: string) => {
      const tab = findTab(p, path)
      if (!tab || tab.content === tab.savedContent || isArchivedPath(tab.path, p) || !tab.editable) return
      const content = tab.content
      mapTabs(p, (t) => (t.path === path ? { ...t, status: 'saving' } : t))
      const save = isExternalTabPath(path)
        ? saveExternalFile(externalAbsolutePath(path), content).then(() => ({ ok: true as const, commit: null }))
        : saveFile(path, content, false, p)
      save
        .then(() => {
          if (!isExternalTabPath(path)) putCachedFile(p, path, { content, editable: tab.editable })
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
    (path: string, paneId?: string) => {
      const p = projectRef.current
      const id = paneId ?? stateOf(p).focusedPaneId
      // 디바운스를 기다리지 않고 닫히는 탭의 변경 내용을 즉시 디스크에 반영
      settlePendingSave(p, path)
      autosave(p, path)
      patch(p, (s) =>
        prunePanes({
          ...s,
          panes: s.panes.map((pane) => {
            if (pane.id !== id) return pane
            const next = pane.tabs.filter((t) => t.path !== path)
            if (pane.activePath !== path) return { ...pane, tabs: next }
            const idx = pane.tabs.findIndex((t) => t.path === path)
            return { ...pane, tabs: next, activePath: next[Math.min(idx, next.length - 1)]?.path ?? null }
          }),
        }),
      )
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
      const pane = paneOf(p)
      const tab = pane.tabs.find((t) => t.path === pane.activePath) ?? null
      if (!tab || !tab.editable) return
      const dirty = commit ? tab.content !== tab.committedContent : tab.content !== tab.savedContent
      if (!dirty || isArchivedPath(tab.path, p)) return

      settlePendingSave(p, tab.path)
      mapTabs(p, (t) => (t.path === tab.path ? { ...t, status: 'saving' } : t))
      try {
        const external = isExternalTabPath(tab.path)
        const result = external
          ? { ...(await saveExternalFile(externalAbsolutePath(tab.path), tab.content)), commit: null }
          : await saveFile(tab.path, tab.content, commit, p)
        if (!external) putCachedFile(p, tab.path, { content: tab.content, editable: tab.editable })
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
        if (commit && !external) {
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
      putCachedFile(p, path, { content, editable: findTab(p, path)?.editable ?? true })
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

  /** 탭을 다른 칸으로 옮긴다 (탭을 끌어 그 칸 가운데에 놓았을 때) */
  const moveTabToPane = useCallback(
    (path: string, fromPaneId: string, toPaneId: string) => {
      if (fromPaneId === toPaneId) return
      patch(projectRef.current, (s) => {
        const moved = s.panes.find((x) => x.id === fromPaneId)?.tabs.find((t) => t.path === path)
        if (!moved || !s.panes.some((x) => x.id === toPaneId)) return s
        return prunePanes({
          ...s,
          focusedPaneId: toPaneId,
          panes: s.panes.map((pane) => {
            if (pane.id === fromPaneId) {
              const next = pane.tabs.filter((t) => t.path !== path)
              return { ...pane, tabs: next, activePath: pane.activePath === path ? (next[0]?.path ?? null) : pane.activePath }
            }
            if (pane.id !== toPaneId) return pane
            // 그 칸에 이미 열려 있으면 그 탭을 활성화만 한다
            if (pane.tabs.some((t) => t.path === path)) return { ...pane, activePath: path }
            return { ...pane, tabs: [...pane.tabs, moved], activePath: path }
          }),
        })
      })
    },
    [patch],
  )

  /** 탭을 끌어 칸의 가장자리에 놓았을 때 — 그 방향으로 새 칸을 세우고 탭을 옮긴다 */
  const splitWithTab = useCallback(
    (path: string, fromPaneId: string, targetPaneId: string, side: DropSide) => {
      patch(projectRef.current, (s) => {
        const from = s.panes.find((x) => x.id === fromPaneId)
        const moved = from?.tabs.find((t) => t.path === path)
        if (!from || !moved || !s.panes.some((x) => x.id === targetPaneId)) return s
        // 그 칸의 유일한 탭을 자기 칸에서 갈라내면 옮기기 전과 같은 화면이 된다 — 하지 않는다
        if (from.id === targetPaneId && from.tabs.length === 1) return s
        const id = newPaneId()
        const rest = from.tabs.filter((t) => t.path !== path)
        return prunePanes({
          layout: splitLeaf(s.layout, targetPaneId, id, side),
          focusedPaneId: id,
          panes: [
            ...s.panes.map((pane) =>
              pane.id === fromPaneId
                ? { ...pane, tabs: rest, activePath: pane.activePath === path ? (rest[0]?.path ?? null) : pane.activePath }
                : pane,
            ),
            { id, tabs: [moved], activePath: path },
          ],
        })
      })
    },
    [patch],
  )

  /**
   * 사이드바에서 파일을 끌어 칸 가장자리에 놓았을 때 — 그 방향으로 **빈** 새 칸을 세우고 id를 돌려준다.
   * 탭은 호출한 쪽이 openFile(paneId)로 붙인다 — 탭 생성·본문 로딩 경로를 openFileIn 하나로 유지하기 위해서다.
   */
  const splitEmptyPane = useCallback(
    (targetPaneId: string, side: DropSide): string => {
      const id = newPaneId()
      patch(projectRef.current, (s) => {
        if (!s.panes.some((x) => x.id === targetPaneId)) return s
        return {
          layout: splitLeaf(s.layout, targetPaneId, id, side),
          focusedPaneId: id,
          panes: [...s.panes, { id, tabs: [], activePath: null }],
        }
      })
      return id
    },
    [patch],
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
        ...s,
        panes: s.panes.map((pane) => ({
          ...pane,
          tabs: pane.tabs.map((t) => ({ ...t, path: remap(t.path) })),
          activePath: pane.activePath ? remap(pane.activePath) : pane.activePath,
        })),
      }))
    },
    [patch],
  )

  // 파일/폴더 삭제 시 해당 탭 닫기
  const removePaths = useCallback(
    (path: string, type: 'file' | 'dir') => {
      const p = projectRef.current
      patch(p, (s) => {
        const gone = (t: Tab) => (type === 'file' ? t.path === path : t.path === path || t.path.startsWith(path + '/'))
        const removed = new Set(s.panes.flatMap((pane) => pane.tabs.filter(gone).map((t) => t.path)))
        if (removed.size === 0) return s
        removed.forEach((x) => dropCachedFile(p, x))
        return prunePanes({
          ...s,
          panes: s.panes.map((pane) => {
            const next = pane.tabs.filter((t) => !removed.has(t.path))
            return {
              ...pane,
              tabs: next,
              activePath: pane.activePath && removed.has(pane.activePath) ? (next[0]?.path ?? null) : pane.activePath,
            }
          }),
        })
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
    /** 저장된 탭 복원이 끝났는지 — 복원 전의 잠깐 빈 상태를 진짜 빈 프로젝트로 오인하지 않게 한다 */
    hydrated: hydratedRef.current.has(project),
    panes,
    layout,
    focusedPaneId: focusedPane.id,
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
    forgetProject,
  }
}
