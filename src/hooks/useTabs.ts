import { scopedBrowserStorage } from '@mew/ui/browser-storage-scope'
import { mewFetch } from '../utils/remote-transport.ts'
import { mergeTaskFrontmatter } from '../../packages/editor/src/utils/task-frontmatter-merge'
import { remapPagePath, rewritePageLinks, type DocumentPageMutation } from '../../shared/document-pages'
import { editorTabPath } from '../utils/editor-files'
import { useRefreshTasks } from './use-refresh-tasks'
import { writeBrowserStorage } from '@mew/ui/browser-storage'
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchExternalFile, fetchFile, fetchFileAnchorPreview, fetchRules, isArchivedPath, saveExternalFile, saveFile, type DocRules, type FileVersion } from '../api/client'
import { mediaKind } from '../utils/media'
import { dropCachedFile, getCachedFile, putCachedFile } from '../utils/contentCache'
import { leaf, normalizeLayout, removeLeaf, splitLeaf, type DropSide, type PaneNode } from '../utils/paneTree'
import { externalAbsolutePath, externalTabPath, isExternalTabPath } from '../utils/externalFiles'
import { afterFirstPaint, markFileOpen, startFileOpen, type FileOpenTrace } from '../utils/fileOpenPerformance'
import { gitDiffTarget } from '../utils/git-diff-tabs'
import { isGitTabPath } from '../utils/gitTabs'
import { editorFile, mergeEditorTabs } from '../utils/editor-files'

function savedBuffer(current: string, submitted: string, saved: string): string {
  if (saved === submitted) return current
  try { return mergeTaskFrontmatter(submitted, current, saved, false) } catch { return current }
}

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
  /** File-body request in progress; separate from save status and empty content. */
  loading?: boolean
  /** 세션 복원 때는 탭 껍데기만 먼저 세운다. 선택되는 순간 기존 파일 로드 경로로 본문을 받는다. */
  deferredLoad?: boolean
  /** DevTools 성능 mark를 잇는 일시 id — 탭 복원 저장에는 넣지 않는다. */
  openTrace?: FileOpenTrace
  /** 큰 plain 파일의 목표 줄 주변만 받은 읽기 전용 상태. 전체 본문이 오면 즉시 제거한다. */
  anchorPreview?: { anchorLine: number; lineStart: number; lineEnd: number; totalLines: number | null; version: FileVersion }
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
export function openTabsKey(project: string, workspaceScope?: string): string {
  // `.workspace`와 `docs`는 서버 API 식별자가 모든 루트 프로젝트에서 같다. 화면 상태까지
  // 같은 키를 쓰면 다른 루트의 README가 잠깐 보이거나 탭 목록을 덮어쓴다. scope가 없을 때는
  // 기존 설치의 저장 키를 그대로 읽어 한 번의 호환 이관 기회를 남긴다.
  if (workspaceScope) return `mew:open-tabs:${project}@${workspaceScope}`
  return project === 'docs' ? 'mew:open-tabs' : `mew:open-tabs:${project}`
}

type StoredTab = { path: string; preview: boolean; viewMode: 'hotview' | 'plain' }
export type StoredTabs = {
  unifiedScopes?: boolean
  panes: { id: string; tabs: StoredTab[]; activePath: string | null }[]
  layout: PaneNode
  focusedPaneId: string
}

/** 저장분 읽기 — 분할 이전 형식(`{tabs, activePath}`)은 칸 하나짜리로 읽는다 */
function loadStoredTabs(project: string, workspaceScope?: string): StoredTabs | null {
  try {
    const raw = scopedBrowserStorage().getItem(openTabsKey(project, workspaceScope))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredTabs> & { tabs?: StoredTab[]; activePath?: string | null }
    const panes = Array.isArray(parsed?.panes)
      ? parsed.panes.filter((p) => p && typeof p.id === 'string' && Array.isArray(p.tabs))
      : Array.isArray(parsed?.tabs)
        ? [{ id: MAIN_PANE, tabs: parsed.tabs, activePath: parsed.activePath ?? null }]
        : []
    if (panes.length === 0) return null
    return {
      unifiedScopes: parsed.unifiedScopes === true,
      panes: panes.map((p) => {
        // 중간 저장·옛 버전의 복원 경쟁으로 같은 경로가 여러 번 남아도, 한 칸에는 파일 하나만 둔다.
        // React key 충돌과 "파일 탭이 세 개"로 보이는 복원을 여기서 같이 치운다.
        const seen = new Set<string>()
        const tabs = p.tabs.filter((tab): tab is StoredTab => {
          // Git 워크벤치가 팝업으로 바뀌면서 옛 가상 탭은 복원하지 않는다.
          if (!tab || typeof tab.path !== 'string' || !tab.path || isGitTabPath(tab.path) || seen.has(tab.path)) return false
          seen.add(tab.path)
          return tab.preview === true || tab.preview === false
        })
        const activePath = typeof p.activePath === 'string' && seen.has(p.activePath) ? p.activePath : tabs[0]?.path ?? null
        return { id: p.id, tabs, activePath }
      }),
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
export function useTabs(
  project: string,
  onCommitted: () => void,
  onNotice: (message: string) => void,
  workspaceScope?: string,
  accountTabs?: Record<string, StoredTabs>,
  onAccountTabsChange?: (project: string, state: StoredTabs) => void,
  accountHydrated = true,
) {
  const { pending: refreshing, track: trackRefresh } = useRefreshTasks()
  const [states, setStates] = useState<Record<string, ProjectTabs>>({})
  const workspaceRequestRef = useRef({ scope: workspaceScope, epoch: 0 })
  if (workspaceRequestRef.current.scope !== workspaceScope) {
    workspaceRequestRef.current = { scope: workspaceScope, epoch: workspaceRequestRef.current.epoch + 1 }
  }
  // 콜백 identity가 바뀌어도 openFileIn 등의 useCallback을 다시 만들지 않도록 ref로 든다
  const onNoticeRef = useRef(onNotice)
  onNoticeRef.current = onNotice
  const statesRef = useRef<Record<string, ProjectTabs>>({})
  // 디바운스가 걸려 있는 저장 — 예약할 때의 프로젝트를 함께 붙들어 둔다
  const inFlightSaves = useRef(new Set<Promise<unknown>>())
  const pageMutationRef = useRef<number | null>(null)
  const fileNavigationRef = useRef(0)
  const saveTimerRef = useRef<{ timer: ReturnType<typeof setTimeout>; project: string; path: string } | null>(null)
  const projectRef = useRef(project)
  projectRef.current = project
  const hydratedRef = useRef<string | null>(null)
  const hydratedWorkspaceRef = useRef(workspaceScope)
  const [hydratedSession, setHydratedSession] = useState<string | null>(null)
  // 탭 껍데기를 setState로 세운 직후에는 statesRef가 아직 옛 상태다. 활성 탭의 실제 로드는
  // 다음 렌더 effect로 넘겨야 existing 탭을 다시 만들지 않고 deferredLoad만 해제할 수 있다.
  const pendingRestoreLoadsRef = useRef(new Map<string, { paneId: string; path: string; preview: boolean; viewMode: Tab['viewMode'] }[]>())

  const sessionKey = `${project}\u0000${workspaceScope ?? ''}`
  const state = hydratedSession === sessionKey ? states[project] ?? EMPTY : EMPTY
  const { panes, layout, focusedPaneId } = state
  const focusedPane = panes.find((p) => p.id === focusedPaneId) ?? panes[0]
  const { tabs, activePath } = focusedPane
  const activeTab = tabs.find((t) => t.path === activePath) ?? null

  useEffect(() => {
    statesRef.current = states
  }, [states])

  // Settings can update an external file already open in any project/pane.
  // Refresh clean tabs only; unsaved drafts retain their original save baseline.
  useEffect(() => {
    const updated = (event: Event) => {
      const { path, content } = (event as CustomEvent<{ path: string; content: string }>).detail
      const tabPath = externalTabPath(path)
      setStates(all => Object.fromEntries(Object.entries(all).map(([project, state]) => [project, {
        ...state, panes: state.panes.map(pane => ({ ...pane, tabs: pane.tabs.map(tab =>
          tab.path === tabPath && tab.content === tab.savedContent && tab.status !== 'saving'
            ? { ...tab, content, savedContent: content, committedContent: content, status: 'idle' as const }
            : tab,
        ) })),
      }])))
    }
    window.addEventListener('mew:external-file-updated', updated)
    return () => window.removeEventListener('mew:external-file-updated', updated)
  }, [])

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

  /** 같은 경로를 연 칸만 갱신한다. 다른 칸·탭의 객체 identity를 보존해 파일 응답이 넓은 리렌더를 만들지 않게 한다. */
  const mapTabsAtPath = useCallback(
    (p: string, path: string, fn: (t: Tab) => Tab) => {
      patch(p, (s) => {
        let changed = false
        const panes = s.panes.map((pane) => {
          if (!pane.tabs.some((tab) => tab.path === path)) return pane
          changed = true
          return { ...pane, tabs: pane.tabs.map((tab) => (tab.path === path ? fn(tab) : tab)) }
        })
        return changed ? { ...s, panes } : s
      })
    },
    [patch],
  )

  useEffect(() => {
    const revalidate = () => {
      for (const [scopeProject, state] of Object.entries(statesRef.current)) {
        for (const filePath of new Set(state.panes.flatMap(pane => pane.tabs.map(tab => tab.path)))) {
          dropCachedFile(scopeProject, filePath)
          const diff = gitDiffTarget(filePath)
          const file = diff ? { project: diff.project, path: [diff.repositoryPath, diff.filePath].filter(Boolean).join('/') } : editorFile(filePath, scopeProject)
          void trackRefresh(mewFetch(`/api/file-access?project=${encodeURIComponent(file.project)}&path=${encodeURIComponent(file.path)}${isExternalTabPath(filePath) ? '&external=1' : ''}`)
            .then(response => response.ok ? response.json() as Promise<{ view: boolean; edit: boolean }> : { view: false, edit: false })
            .then(access => patch(scopeProject, current => prunePanes({ ...current, panes: current.panes.map(pane => {
              const tabs = access.view ? pane.tabs.map(tab => tab.path === filePath ? { ...tab, editable: !diff && access.edit } : tab) : pane.tabs.filter(tab => tab.path !== filePath)
              return { ...pane, tabs, activePath: pane.activePath === filePath && !access.view ? tabs[0]?.path ?? null : pane.activePath }
            }) })))
            .catch(() => mapTabsAtPath(scopeProject, filePath, tab => ({ ...tab, editable: false }))))
        }
      }
    }
    window.addEventListener('mew:permissions-changed', revalidate)
    return () => window.removeEventListener('mew:permissions-changed', revalidate)
  }, [patch, mapTabsAtPath, trackRefresh])

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
    (p: string, paneId: string, path: string, opts?: { preview?: boolean; forceNewTab?: boolean; replaceActive?: boolean; deferLoad?: boolean; restoring?: boolean; viewMode?: Tab['viewMode']; anchorLine?: number }) => {
      const diffTarget = gitDiffTarget(path)
      const file = editorFile(path, p)
      const preview = opts?.preview ?? true
      const existing = paneOf(p, paneId).tabs.find((t) => t.path === path)
      let trace: FileOpenTrace | undefined
      if (existing) {
        // 복원 때 뒤로 미뤘던 탭은 사용자가 고르는 바로 그때만 기존 전체 본문 요청을 시작한다.
        // 캐시된 본문이 있으면 이미 즉시 보이고, fetch는 최신본 확인 역할만 한다.
        const loadDeferred = existing.deferredLoad === true && !opts?.deferLoad
        if (loadDeferred) trace = startFileOpen()
        patchPane(p, paneId, (pane) => ({
          ...pane,
          tabs: pane.tabs.map((t) =>
            t.path !== path
              ? t
              : { ...t, preview: !preview && t.preview ? false : t.preview, deferredLoad: loadDeferred ? false : t.deferredLoad, loading: loadDeferred ? !diffTarget && !mediaKind(path) : t.loading, openTrace: trace ?? t.openTrace },
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
      const cached = external || diffTarget ? undefined : getCachedFile(p, path)
      if (!existing && !opts?.deferLoad && !diffTarget) trace = startFileOpen()
      markFileOpen(trace, 'cache-ready')
      const newTab: Tab = {
        ...blankTab(),
        path,
        editable: diffTarget ? false : true,
        preview,
        viewMode: opts?.viewMode ?? (previewFirst ? 'hotview' : 'plain'),
        deferredLoad: opts?.deferLoad === true,
        loading: !diffTarget && !mediaKind(path),
        openTrace: trace,
        ...(cached
          ? { content: cached.content, savedContent: cached.content, committedContent: cached.content, editable: cached.editable }
          : {}),
      }
      if (!existing) {
        patchPane(p, paneId, (pane) => {
          if (opts?.replaceActive) {
            const active = pane.tabs.find(tab => tab.path === pane.activePath)
            if (active && active.content === active.savedContent && active.status !== 'saving') return { ...pane, tabs: pane.tabs.map(tab => tab === active ? newTab : tab), activePath: path }
            return { ...pane, tabs: [...pane.tabs, newTab], activePath: path }
          }
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
      if (opts?.deferLoad || diffTarget) return
      // 바이너리 미디어는 뷰어가 /api/raw로 직접 스트리밍한다 — utf-8 fetch도 규칙 검사도 없음
      if (mediaKind(path)) return
      const requestEpoch = workspaceRequestRef.current.epoch
      const isCurrentWorkspace = () => requestEpoch === workspaceRequestRef.current.epoch
      const applyFullFile = ({ content, editable }: { content: string; editable: boolean }) => {
          if (!isCurrentWorkspace()) return
          markFileOpen(trace, 'file-response')
          if (!external) putCachedFile(p, path, { content, editable })
          mapTabsAtPath(p, path, (t) => {
            // 캐시 본문으로 이미 그려 둔 사이에 손을 댔으면(타이핑·협업 방 내용) 그 버퍼를 덮지 않는다.
            // 서버 본문은 savedContent로만 들어가므로, 다르면 dirty가 되어 자동저장이 내 것을 올린다.
            const edited = cached !== undefined && t.content !== cached.content
            return {
              ...t,
              content: edited ? t.content : content,
              savedContent: content,
              committedContent: content,
              status: 'idle',
              loading: false,
              editable,
              openTrace: trace ?? t.openTrace,
              anchorPreview: undefined,
            }
          })
      }
      const handleOpenError = (err: unknown) => {
        if (!isCurrentWorkspace()) return
        // 열 수 없는 파일(게스트 권한 밖 등)은 빈 탭만 남아 "아무 일도 안 일어난" 것처럼 보인다 — 이유를 띄운다
        if (!external) dropCachedFile(p, path)
        mapTabsAtPath(p, path, tab => ({ ...tab, content: '', savedContent: '', committedContent: '', editable: false, loading: false, anchorPreview: undefined }))
        console.error(err)
        onNoticeRef.current(err instanceof Error ? err.message : String(err))
      }
      // 목표 줄이 알려진 큰 plain 파일은 조각을 먼저 보여 준다. 조각 상태는 readOnly이고 cache에도
      // 저장하지 않는다. 뒤의 전체 요청이 완료되면 기존 편집·협업 경로로 원자적으로 바뀐다.
      const canPreviewAnchor = !external && cached === undefined && opts?.anchorLine !== undefined && opts.viewMode === 'plain'
      if (canPreviewAnchor) {
        fetchFileAnchorPreview(file.path, opts.anchorLine!, file.project)
          .then((first) => {
            if (!isCurrentWorkspace()) return
            if (!first.partial) {
              applyFullFile(first)
              return
            }
            markFileOpen(trace, 'anchor-preview')
            mapTabsAtPath(p, path, (t) => ({
              ...t,
              content: first.content,
              savedContent: first.content,
              committedContent: first.content,
              status: 'idle',
              editable: first.editable,
              openTrace: trace ?? t.openTrace,
              anchorPreview: {
                anchorLine: first.anchorLine,
                lineStart: first.lineStart,
                lineEnd: first.lineEnd,
                totalLines: first.totalLines,
                version: first.version,
              },
            }))
            fetchFile(file.path, file.project).then(applyFullFile).catch(handleOpenError)
          })
          .catch(handleOpenError)
      } else {
        const fileRequest = external ? fetchExternalFile(externalAbsolutePath(path)) : fetchFile(file.path, file.project)
        const loading = fileRequest.then(applyFullFile).catch(handleOpenError)
        if (opts?.restoring) void trackRefresh(loading)
      }
      if (!external) {
        // MOC·링크 검사는 본문 표시의 선행조건이 아니다. 로컬 서버에서 동기 검사하는 비용도 있으므로
        // 첫 편집기 paint 뒤에 시작한다. 실패해도 본문을 막지 않는 기존 계약은 그대로다.
        afterFirstPaint(() => {
          if (!isCurrentWorkspace()) return
          fetchRules(file.path, file.project)
            .then((rules) => {
              if (!isCurrentWorkspace()) return
              markFileOpen(trace, 'rules-response')
              mapTabsAtPath(p, path, (t) => ({ ...t, rules }))
            })
            .catch(console.error)
        })
      }
    },
    [patchPane, mapTabsAtPath, trackRefresh],
  )

  const openFile = useCallback(
    (path: string, opts?: { preview?: boolean; forceNewTab?: boolean; replaceActive?: boolean; paneId?: string; viewMode?: Tab['viewMode']; anchorLine?: number }) => {
      const p = projectRef.current
      const paneId = opts?.paneId ?? stateOf(p).focusedPaneId
      const active = paneOf(p, paneId).tabs.find(tab => tab.path === paneOf(p, paneId).activePath)
      const sequence = ++fileNavigationRef.current
      if (!opts?.replaceActive || !active?.editable || active.content === active.savedContent && active.status !== 'saving') {
        openFileIn(p, paneId, path, opts)
        return
      }
      const epoch = workspaceRequestRef.current.epoch
      if (pageMutationRef.current === epoch) { openFileIn(p, paneId, path, opts); return }
      const pending = saveTimerRef.current
      if (pending?.project === p && pending.path === active.path) { clearTimeout(pending.timer); saveTimerRef.current = null }
      // Keep the current editor alive until its draft is saved, then replace its
      // tab in place. A save failure leaves the draft visible and opens nothing.
      const navigation = (async () => {
        await Promise.all([...inFlightSaves.current])
        if (workspaceRequestRef.current.epoch !== epoch || pageMutationRef.current === epoch) return
        const file = editorFile(active.path, p), content = active.content
        let saved = content
        if (isExternalTabPath(active.path)) await saveExternalFile(externalAbsolutePath(active.path), content, active.savedContent)
        else {
          const result = await saveFile(file.path, content, false, file.project, active.savedContent)
          saved = result.content ?? content
        }
        if (workspaceRequestRef.current.epoch !== epoch) return
        if (!isExternalTabPath(active.path)) putCachedFile(p, active.path, { content: saved, editable: active.editable })
        mapTabsAtPath(p, active.path, tab => ({ ...tab, content: savedBuffer(tab.content, content, saved), savedContent: saved, status: 'saved' }))
        if (fileNavigationRef.current === sequence && paneOf(p, paneId).activePath === active.path) openFileIn(p, paneId, path, opts)
      })().catch(error => onNoticeRef.current(error instanceof Error ? error.message : String(error)))
        .finally(() => inFlightSaves.current.delete(navigation))
      inFlightSaves.current.add(navigation)
    },
    [openFileIn, mapTabsAtPath],
  )

  const openExternalFile = useCallback(
    (absolutePath: string, opts?: { paneId?: string }) => {
      const p = projectRef.current
      openFileIn(p, opts?.paneId ?? stateOf(p).focusedPaneId, externalTabPath(absolutePath), { preview: true })
    },
    [openFileIn],
  )

  // 브라우저를 껐다 켜거나 F5로 새로고침해도 열려 있던 탭들과 분할 배치를 복원한다. 루트 프로젝트별
  // 현재 저장 scope마다 한 번만 — StrictMode의 이펙트 2회 실행도 hydratedRef가 막는다.
  useEffect(() => {
    if (hydratedRef.current === sessionKey) return
    // 계정 원장이 기준이다. 새 기기에서 로컬 빈 상태가 서버 복원값을 덮기 전에 응답을 기다린다.
    if (workspaceScope && !accountHydrated) return
    hydratedRef.current = sessionKey
    if (hydratedWorkspaceRef.current !== workspaceScope) {
      hydratedWorkspaceRef.current = workspaceScope
      setStates({})
      pendingRestoreLoadsRef.current.clear()
    }
    // 같은 API 프로젝트(`.workspace`, `docs`)라도 루트가 바뀌면 이전 루트의 열린 탭은
    // 메모리에서도 즉시 버린다. 저장분은 workspaceScope별 키에 남아 다시 돌아올 때 복원된다.
    setHydratedSession(null)
    // 첫 도입 때만 기존 공용 키를 읽는다. 다음 저장부터는 루트별 키로 옮겨져 서로 덮지 않는다.
    const legacy = (scope: string) => accountTabs?.[scope] ?? loadStoredTabs(scope, workspaceScope) ?? (workspaceScope ? loadStoredTabs(scope) : null)
    const stored = project === '.workspace' ? mergeEditorTabs(legacy(project), legacy('docs')) : legacy(project)
    if (!stored) {
      patch(project, () => EMPTY) // 빈 상태라도 만들어 둬야 이후 저장이 이 프로젝트를 기록한다
      setHydratedSession(sessionKey)
      return
    }
    // Restore all shells in one update. Looking up existing tabs while queuing a
    // reset still sees the previous root's same-named files and can skip members.
    const restored: ProjectTabs = {
      panes: stored.panes.map(pane => ({
        id: pane.id,
        activePath: pane.activePath,
        tabs: pane.tabs.map(tab => {
          const cached = isExternalTabPath(tab.path) || gitDiffTarget(tab.path) ? undefined : getCachedFile(project, tab.path)
          return {
            ...blankTab(), ...tab, editable: !gitDiffTarget(tab.path), deferredLoad: true, loading: !gitDiffTarget(tab.path) && !mediaKind(tab.path),
            ...(cached ? { content: cached.content, savedContent: cached.content, committedContent: cached.content, editable: cached.editable } : {}),
          }
        }),
      })),
      layout: stored.layout,
      focusedPaneId: stored.focusedPaneId,
    }
    patch(project, () => restored)
    const activeLoads = stored.panes.flatMap(pane => {
      const active = pane.tabs.find(tab => tab.path === pane.activePath)
      return active ? [{ paneId: pane.id, path: active.path, preview: active.preview, viewMode: active.viewMode }] : []
    })
    pendingRestoreLoadsRef.current.set(sessionKey, activeLoads)
    setHydratedSession(sessionKey)
  }, [accountHydrated, accountTabs, project, sessionKey, workspaceScope, patch])

  // 위 hydration effect가 만든 모든 탭이 상태에 붙은 뒤 활성 탭만 읽는다. statesRef 동기화 effect가
  // 선언 순서상 먼저 돌기 때문에 openFileIn은 deferred tab을 찾아 본문 요청만 시작한다.
  useEffect(() => {
    if (hydratedSession !== sessionKey) return
    const activeLoads = pendingRestoreLoadsRef.current.get(sessionKey)
    pendingRestoreLoadsRef.current.delete(sessionKey)
    const loads = activeLoads ?? (states[project]?.panes ?? []).flatMap(pane => {
      const tab = pane.tabs.find(tab => tab.path === pane.activePath && tab.deferredLoad)
      return tab ? [{ paneId: pane.id, path: tab.path, preview: tab.preview, viewMode: tab.viewMode }] : []
    })
    for (const load of loads) {
      openFileIn(project, load.paneId, load.path, { restoring: !!activeLoads, preview: load.preview, viewMode: load.viewMode })
    }
  }, [project, sessionKey, hydratedSession, states, openFileIn])

  // 복원이 끝난(=상태가 만들어진) 프로젝트만 저장한다 — 아직 열어보지 않은 프로젝트의 저장분을
  // 빈 목록으로 덮어쓰지 않는다.
  useEffect(() => {
    // scope를 갈아끼운 첫 렌더에는 아직 옛 루트 상태가 남아 있다. 그 상태를 새 루트의
    // 저장 키에 쓰지 않고 hydration 업데이트가 반영된 다음 렌더까지 기다린다.
    if (hydratedSession !== sessionKey) return
    for (const [p, s] of Object.entries(states)) {
      const payload: StoredTabs = {
        ...(p === '.workspace' ? { unifiedScopes: true } : {}),
        panes: s.panes.map((pane) => ({
          id: pane.id,
          tabs: pane.tabs.filter((t) => !isExternalTabPath(t.path) && !isGitTabPath(t.path)).map((t) => ({ path: t.path, preview: t.preview, viewMode: t.viewMode })),
          activePath: pane.activePath && !isExternalTabPath(pane.activePath) && !isGitTabPath(pane.activePath) ? pane.activePath : null,
        })),
        layout: s.layout,
        focusedPaneId: s.focusedPaneId,
      }
      try {
        writeBrowserStorage(openTabsKey(p, workspaceScope), JSON.stringify(payload))
      } catch {
        // 로컬 복원은 fallback이다. 저장소가 가득 차거나 차단돼도 파일 열기와 계정 동기화는 계속한다.
      }
      onAccountTabsChange?.(p, payload)
    }
  }, [states, sessionKey, hydratedSession, workspaceScope, onAccountTabsChange])

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
      const file = editorFile(path, p)
      if (file.project === 'docs' && pageMutationRef.current === workspaceRequestRef.current.epoch) return
      if (!tab || tab.content === tab.savedContent || isArchivedPath(file.path, file.project) || !tab.editable) return
      const content = tab.content
      mapTabsAtPath(p, path, (t) => ({ ...t, status: 'saving' }))
      const save = isExternalTabPath(path)
        ? saveExternalFile(externalAbsolutePath(path), content, tab.savedContent).then(() => ({ ok: true as const, commit: null, content }))
        : saveFile(file.path, content, false, file.project, tab.savedContent)
      const request = save
        .then(result => {
          const saved = result.content ?? content
          if (!isExternalTabPath(path)) putCachedFile(p, path, { content: saved, editable: tab.editable })
          mapTabsAtPath(p, path, (t) =>
            t.content === content ? { ...t, content: saved, savedContent: saved, status: 'saved', statusMessage: 'Saved' }
              : saved !== content ? { ...t, content: savedBuffer(t.content, content, saved), savedContent: saved, status: 'idle' }
                : isExternalTabPath(path) && t.savedContent === tab.savedContent ? { ...t, savedContent: content, status: 'idle' } : t,
          )
        })
        .catch((err) => {
          mapTabsAtPath(p, path, (t) => ({ ...t, status: 'error', statusMessage: err instanceof Error ? err.message : String(err) }))
        })
        .finally(() => inFlightSaves.current.delete(request))
      inFlightSaves.current.add(request)
    },
    [mapTabsAtPath],
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
      mapTabsAtPath(p, path, (t) => ({ ...t, content, preview: false }))
      scheduleAutosave(p, path)
    },
    [mapTabsAtPath, scheduleAutosave],
  )

  const saveCurrentTab = useCallback(
    async (commit = false) => {
      const p = projectRef.current
      const pane = paneOf(p)
      const tab = pane.tabs.find((t) => t.path === pane.activePath) ?? null
      if (!tab || !tab.editable) return
      const file = editorFile(tab.path, p)
      if (file.project === 'docs' && pageMutationRef.current === workspaceRequestRef.current.epoch) return
      const dirty = commit ? tab.content !== tab.committedContent : tab.content !== tab.savedContent
      if (!dirty || isArchivedPath(file.path, file.project)) return

      settlePendingSave(p, tab.path)
      mapTabsAtPath(p, tab.path, (t) => ({ ...t, status: 'saving' }))
      try {
        const external = isExternalTabPath(tab.path)
        const request = external
          ? saveExternalFile(externalAbsolutePath(tab.path), tab.content, tab.savedContent).then(result => ({ ...result, commit: null, content: tab.content }))
          : saveFile(file.path, tab.content, commit, file.project, tab.savedContent)
        inFlightSaves.current.add(request)
        const result = await request.finally(() => inFlightSaves.current.delete(request))
        const saved = result.content ?? tab.content
        if (!external) putCachedFile(p, tab.path, { content: saved, editable: tab.editable })
        const message = commit
          ? `Committed${result.commit?.hash ? ' ' + result.commit.hash.slice(0, 7) : ''}`
          : 'Saved'
        mapTabsAtPath(p, tab.path, (t) => ({
          ...t,
          content: savedBuffer(t.content, tab.content, saved),
          savedContent: saved,
          committedContent: commit ? saved : t.committedContent,
          status: 'saved',
          statusMessage: message,
        }))
        if (commit && !external) {
          onCommitted()
          fetchRules(file.path, file.project)
            .then((rules) => mapTabsAtPath(p, tab.path, (t) => ({ ...t, rules })))
            .catch(console.error)
        }
      } catch (err) {
        mapTabsAtPath(p, tab.path, (t) => ({ ...t, status: 'error', statusMessage: err instanceof Error ? err.message : String(err) }))
      }
    },
    [settlePendingSave, mapTabsAtPath, onCommitted],
  )

  // 서버에서 이미 쓰기+커밋까지 끝낸 내용(히스토리 되돌리기)을 탭 상태에 반영 — saveFile을 다시
  // 부르지 않고 saveCurrentTab(true) 성공 시와 동일하게 savedContent/committedContent를 맞춘다
  const applyRevertedContent = useCallback(
    (path: string, content: string) => {
      const p = projectRef.current
      const file = editorFile(path, p)
      // 되돌리기는 지금 버퍼를 통째로 대체하므로 이 탭에 예약된 저장은 취소한다
      settlePendingSave(p, path)
      putCachedFile(p, path, { content, editable: findTab(p, path)?.editable ?? true })
      mapTabsAtPath(p, path, (t) => ({ ...t, content, savedContent: content, committedContent: content, status: 'saved', statusMessage: 'Reverted' }))
      onCommitted()
      fetchRules(file.path, file.project)
        .then((rules) => mapTabsAtPath(p, path, (t) => ({ ...t, rules })))
        .catch(console.error)
    },
    [settlePendingSave, mapTabsAtPath, onCommitted],
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

  const prepareDocumentPageMutation = useCallback(async () => {
    const p = projectRef.current
    const epoch = workspaceRequestRef.current.epoch
    if (pageMutationRef.current === epoch) throw new Error('문서 변경이 진행 중입니다. 잠시 후 다시 시도하세요.')
    pageMutationRef.current = epoch
    const release = () => {
      if (pageMutationRef.current !== epoch) return
      pageMutationRef.current = null
      for (const tab of stateOf(p).panes.flatMap(pane => pane.tabs)) {
        if (editorFile(tab.path, p).project === 'docs') setTimeout(() => { if (workspaceRequestRef.current.epoch === epoch) autosave(p, tab.path) }, 500)
      }
    }
    try {
      if (saveTimerRef.current) {
        const pending = saveTimerRef.current
        clearTimeout(pending.timer); saveTimerRef.current = null
        if (editorFile(pending.path, pending.project).project !== 'docs') autosave(pending.project, pending.path)
      }
      await Promise.all([...inFlightSaves.current])
      if (workspaceRequestRef.current.epoch !== epoch) throw new Error('프로젝트가 변경되었습니다. 다시 시도하세요.')
      const dirty = new Map(stateOf(p).panes.flatMap(pane => pane.tabs).filter(tab => editorFile(tab.path, p).project === 'docs' && tab.content !== tab.savedContent && tab.editable).map(tab => [tab.path, tab]))
      await Promise.all([...dirty.values()].map(async tab => {
        const file = editorFile(tab.path, p), content = tab.content
        const result = await saveFile(file.path, content, false, file.project, tab.savedContent)
        const saved = result.content ?? content
        mapTabsAtPath(p, tab.path, current => ({ ...current, content: savedBuffer(current.content, content, saved), savedContent: saved, status: 'saved' }))
      }))
      if (workspaceRequestRef.current.epoch !== epoch) throw new Error('프로젝트가 변경되었습니다. 다시 시도하세요.')
      return release
    } catch (error) { release(); throw error }
  }, [mapTabsAtPath, autosave])

  const applyDocumentPageMutation = useCallback((result: DocumentPageMutation) => {
    const p = projectRef.current
    const epoch = workspaceRequestRef.current.epoch
    pageMutationRef.current = null
    const mapTab = (tab: Tab): Tab => {
      if (isExternalTabPath(tab.path) || isGitTabPath(tab.path)) return tab
      const file = editorFile(tab.path, p)
      if (file.project !== 'docs') return tab
      const next = remapPagePath(file.path, result.moves)
      dropCachedFile(p, tab.path)
      const rewrite = (text: string) => rewritePageLinks(text, file.path, next, result.moves)
      return { ...tab, path: editorTabPath('docs', next, p), content: rewrite(tab.content), savedContent: rewrite(tab.savedContent), committedContent: rewrite(tab.committedContent) }
    }
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current.timer); saveTimerRef.current = null }
    const pendingPaths = stateOf(p).panes.flatMap(pane => pane.tabs).filter(tab => editorFile(tab.path, p).project === 'docs').map(tab => mapTab(tab).path)
    patch(p, state => ({ ...state, panes: state.panes.map(pane => {
      const next = pane.tabs.map(mapTab)
      return { ...pane, tabs: next, activePath: pane.activePath ? next[pane.tabs.findIndex(tab => tab.path === pane.activePath)]?.path ?? pane.activePath : null }
    }) }))
    // A file fetch started before promotion cannot populate its newly mapped tab.
    // Refresh current paths while retaining edits made during the structural request.
    for (const path of new Set(pendingPaths)) {
      const file = editorFile(path, p)
      if (result.removed && (file.path === result.removed.path || result.removed.directory && file.path.startsWith(`${result.removed.path}/`))) continue
      void fetchFile(file.path, file.project).then(({ content, editable }) => {
        if (workspaceRequestRef.current.epoch !== epoch) return
        putCachedFile(p, path, { content, editable })
        mapTabsAtPath(p, path, tab => ({ ...tab, content: tab.content === tab.savedContent ? content : tab.content, savedContent: content, editable, loading: false }))
      }).catch(error => onNoticeRef.current(error instanceof Error ? error.message : String(error)))
    }
    for (const path of new Set(pendingPaths)) setTimeout(() => { if (projectRef.current === p && workspaceRequestRef.current.epoch === epoch) autosave(p, path) }, 500)
  }, [patch, autosave, mapTabsAtPath])

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
    if (hydratedRef.current?.startsWith(`${p}\u0000`)) hydratedRef.current = null
    setStates((all) => {
      if (!(p in all)) return all
      const next = { ...all }
      delete next[p]
      return next
    })
  }, [])

  const restoreEditorPanes = useCallback((ids: string[]) => {
    if (!ids.length) return
    const unique = [...new Set(ids)].slice(0, 64)
    patch(projectRef.current, state => {
      const panes = unique.map(id => state.panes.find(pane => pane.id === id) ?? { id, tabs: [], activePath: null })
      const remaining = state.panes.filter(pane => !unique.includes(pane.id)).flatMap(pane => pane.tabs)
      panes[0] = { ...panes[0], tabs: [...new Map([...panes[0].tabs, ...remaining].map(tab => [tab.path, tab])).values()], activePath: panes[0].activePath ?? remaining[0]?.path ?? null }
      return { ...state, panes, layout: unique.length === 1 ? leaf(unique[0]) : { kind: 'split', dir: 'row', kids: unique.map(leaf) }, focusedPaneId: unique.includes(state.focusedPaneId) ? state.focusedPaneId : unique[0] }
    })
  }, [patch])

  return {
    /** 저장된 탭 복원이 끝났는지 — 복원 전의 잠깐 빈 상태를 진짜 빈 프로젝트로 오인하지 않게 한다 */
    hydrated: hydratedSession === sessionKey,
    refreshing,
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
    restoreEditorPanes,
    remapPaths,
    applyDocumentPageMutation,
    prepareDocumentPageMutation,
    removePaths,
    forgetProject,
  }
}
