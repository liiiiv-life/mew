import { mewFetch } from '../utils/remote-transport.ts'
import { editorImageUrl } from '../utils/editor-image-url.ts'
import { PanelCloseButton } from './panel-close-button'
import { observeEditorViewport, useDialog, useToast } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useShortcutBindings } from '@mew/shortcuts'
import { ArrowLeft, ArrowRight, OpenNewWindow, Quote } from 'iconoir-react'
import { useDock, DockGrip, DockInlineBody } from './DockWorkspace'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  deleteComment,
  createEditorApi,
  externalRawUrl,
  fetchExternalFile,
  fetchFile,
  fetchComments,
  fetchMembers,
  isArchivedPath,
  postComment,
  rawUrl,
  updateComment,
  type CommentThread,
  type Role,
  type TreeNode,
} from '../api/client'
import { AnnotationPopover, readSourceAnnotations, Editor, splitFrontmatter, type CommentAnchor, type EditorContextTarget, type EditorDbApi, type EditorHandle, type EditorOpenLink, type EditorOpenLinkOptions, type EditorViewAnchor } from '@mew/editor'
import { DatabaseListModal } from './DatabaseListModal'
import type { DatabaseLink } from '../utils/database-links'
import { CodePane, type CodePaneHandle } from './CodePane'
import { CommentComposer, CommentListPopover, CommentPopover, CommentThreadView } from './Comments'
import { EditorContextMenu, type EditorContextAction } from './EditorContextMenu'
import { MediaViewer } from './MediaViewer'
import { SvgPreview } from './SvgPreview'
import { TableOfContents } from './TableOfContents'
import { gitDiffTarget } from '../utils/git-diff-tabs'
import { GitDiffEditor } from './git-diff-editor'
import { TabBar } from './TabBar'
import { mediaKind } from '../utils/media'
import { canOpenEditorFile } from '../utils/editor-open-policy.ts'
import { editorFile, editorTabPath, editorLinkTabPath } from '../utils/editor-files'
import { saveScroll, getScroll } from '../utils/scrollMemory'
import { useCollab } from '../hooks/useCollab'
import type { Pane, Tab } from '../hooks/useTabs'
import type { DropZone } from '../utils/paneTree'
import { externalAbsolutePath, isExternalTabPath } from '../utils/externalFiles'
import { documentPageLabel, documentPageTarget } from '../../shared/document-pages'
import { afterFirstPaint, markFileOpen } from '../utils/fileOpenPerformance'
import { MarkdownErrorBoundary } from './markdown-error-boundary'
import { useI18n } from '../i18n'

/** 상태줄용 바이트 표기 — 1KB 미만은 바이트 그대로, 그 위는 소수 한 자리 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 댓글 팝업을 띄울 화면 좌표 — hotview·plain 모두 진짜 DOM 선택을 쓰므로 한 함수로 충분하다 */
function selectionPoint(fallback: HTMLElement | null): { x: number; y: number } {
  const sel = window.getSelection()
  const rect = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null
  if (rect && (rect.width > 0 || rect.height > 0)) return { x: rect.left, y: rect.bottom }
  const box = fallback?.getBoundingClientRect()
  return box ? { x: box.left + 24, y: box.top + 24 } : { x: 24, y: 80 }
}

/** 칸 바깥(App)에서 지금 포커스된 칸의 에디터를 건드릴 때 쓰는 손잡이 */
export interface PaneHandle {
  getSelectedText: () => string | null
  /** 선택(없으면 커서) 시작·끝의 파일 줄 번호 — [경로:줄] 참조 삽입용. 텍스트 편집기가 아니면 null */
  getSelectedLineRange: () => { start: number; end: number } | null
  openSearch: (query?: string) => void
  /** 요청한 파일의 Plain 편집기가 준비됐을 때만 이동하고 true. 프로젝트·탭 전환 중 옛 손잡이면 false. */
  revealLine: (path: string, line: number) => boolean
  /** 히스토리 되돌리기 — hotview(md)는 collab 문서가 진실 원천이라 에디터를 통해 갈아끼워야 한다 */
  setRawContent: (content: string) => void
  /** Ctrl+Shift+C — 선택한 글자에 댓글 작성 팝업을 연다. 텍스트 편집기가 아니면 무시 */
  startComment: () => boolean
}

/** 지금 떠 있는 댓글 팝업 — 새로 쓰는 중(compose)이거나 기존 스레드를 보는 중(thread) 하나뿐이다 */
type CommentPopup =
  | { kind: 'compose'; anchor: CommentAnchor; x: number; y: number }
  // notice: 본문에서 자리를 못 찾았을 때 그 사실을 적는다 — 스크롤이 안 된 이유가 화면에 보여야 한다
  | { kind: 'thread'; id: string; x: number; y: number; notice?: string }
  | null

type EditorMenuSession = {
  target: EditorContextTarget
  scope: object
  x: number
  y: number
  busy: boolean
  closed: boolean
}

// 실시간 협업은 파일별 "주 편집화면"에서만 지원한다 — .md는 Hotview, 그 외는 Plain.
// 게스트는 파일별 편집 허용이 있어도 collab 소켓 자체가 서버에서 막혀 있어 항상 로컬 편집으로 처리한다.
function primaryCollabPath(tab: Tab | null, role: Role, project: string, prepare = false): string | null {
  if (role === 'guest' || !tab || tab.deferredLoad || tab.anchorPreview || isExternalTabPath(tab.path) || !canOpenEditorFile(tab.path) || isArchivedPath(tab.path, project) || mediaKind(tab.path)) return null
  if (!(prepare && tab.revalidating) && (tab.revalidating || !tab.editable)) return null
  const eligible = tab.path.endsWith('.md') ? tab.viewMode === 'hotview' : tab.viewMode === 'plain'
  return eligible ? tab.path : null
}

/** 사이드바가 닫혀 있을 때 맨 왼쪽 칸 좌상단에 뜨는 여는 버튼 — 우상단 도구 줄과 같은 생김새 */
function SidebarOpenButton({ onClick }: { onClick: () => void }) {
  useUiLocale()
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-edge-strong bg-surface-raised p-1.5 text-ink-muted shadow-sm hover:bg-surface-hover"
      title={uiText("사이드바 열기 (Ctrl+B)")}
      aria-label={uiText("사이드바 열기")}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18" />
        <path d="m14 9 3 3-3 3" />
      </svg>
    </button>
  )
}

/** 탭을 끌어와 놓으면 무슨 일이 일어나는지 미리 보이는 그림자 */
function DropHint({ zone }: { zone: DropZone }) {
  useUiLocale()
  const box =
    zone === 'center'
      ? 'inset-0'
      : zone === 'left'
        ? 'left-0 top-0 h-full w-[30%]'
        : zone === 'right'
          ? 'right-0 top-0 h-full w-[30%]'
          : zone === 'top'
            ? 'left-0 top-0 h-[30%] w-full'
            : 'bottom-0 left-0 h-[30%] w-full'
  return <div className={`pointer-events-none absolute z-40 bg-accent/25 ${box}`} aria-hidden="true" />
}

export interface EditorPaneProps {
  pane: Pane
  role: Role
  authEmail: string | null
  project: string
  workspace?: { path: string; docsPath?: string } | null
  tree: TreeNode[]
  presence: Record<string, string[]>
  /** 지금 포커스된 칸인지 — 커밋·단축키·터미널이 가리키는 칸이다 */
  focused: boolean
  canCollaborate?: boolean
  isGuest: boolean
  diffVisible?: boolean
  onOpenDiffFile?: (project: string, path: string) => void
  /** 사이드바 여는 버튼을 이 칸이 맡는지 (사이드바 닫힘 + 맨 앞 칸) */
  showSidebarButton: boolean
  tocOpen: boolean
  dropZone: DropZone | null
  registerHandle: (paneId: string, handle: PaneHandle | null) => void
  registerElement: (paneId: string, el: HTMLElement | null) => void
  /** 탭 줄 — 다른 칸의 탭을 여기에 놓으면 이 칸으로 옮겨온다 */
  registerTabBar: (paneId: string, el: HTMLElement | null) => void
  onFocus: () => void
  onActivate: (path: string, tabId?: string) => void
  onPin: (path: string) => void
  onCloseTab: (path: string, tabId?: string) => void
  onClosePanel?: () => void
  onReorder: (from: number, to: number) => void
  onSetViewMode: (path: string, viewMode: Tab['viewMode']) => void
  onChangeContent: (path: string, content: string, paneId?: string) => void
  onOpenLink: EditorOpenLink
  onNavigateTab?: (direction: -1 | 1) => void
  onCreateChildPage?: (path: string, name: string) => Promise<void>
  onOpenHistory: () => void
  onSetTocOpen: (open: boolean) => void
  onOpenSidebar: () => void
  onTabDragMove: (paneId: string, path: string, x: number, y: number, tabId?: string) => void
  onTabDrop: (paneId: string, path: string, x: number, y: number, tabId?: string) => void
}

/**
 * 편집 칸 하나 — 자기 탭 줄, 자기 활성 문서, 자기 협업 세션을 가진다. 화면 분할은 이 칸을
 * 여러 개 세우는 것이고, 배치는 `utils/paneTree.ts`가 들고 있다.
 */
export function EditorPane({
  pane,
  role,
  authEmail,
  project: tabProject,
  workspace,
  tree,
  presence,
  focused,
  isGuest,
  canCollaborate = true,
  showSidebarButton,
  tocOpen,
  dropZone,
  registerHandle,
  registerElement,
  registerTabBar,
  onFocus,
  onActivate,
  onPin: pinTab,
  onCloseTab,
  onClosePanel,
  onReorder,
  onSetViewMode: setViewMode,
  onChangeContent: changeContent,
  onOpenLink: openLink,
  onNavigateTab,
  onCreateChildPage,
  onOpenHistory,
  onSetTocOpen,
  onOpenSidebar,
  diffVisible = true,
  onOpenDiffFile,
  onTabDragMove,
  onTabDrop,
}: EditorPaneProps) {
  useUiLocale()
  const dock = useDock()
  const { t } = useI18n()
  const pageDialogs = useDialog()
  const { toast: commentToast, showToast } = useToast()
  const shortcutBindings = useShortcutBindings()
  const selectedTab = (pane.activeTabId ? pane.tabs.find((t) => t.id === pane.activeTabId) : undefined) ?? pane.tabs.find((t) => t.path === pane.activePath) ?? null
  const file = editorFile(pane.activePath ?? '', tabProject)
  const diffTarget = gitDiffTarget(pane.activePath ?? '')
  const project = file.project
  const activeTab = useMemo(() => selectedTab ? { ...selectedTab, path: file.path } : null, [selectedTab, file.path])
  const activePath = activeTab?.path ?? null
  const activeContent = activeTab?.content
  const loading = activeTab?.loading === true
  const revalidating = activeTab?.revalidating === true
  const activeKeyRef = useRef(pane.activePath)
  activeKeyRef.current = pane.activePath
  const toTabPath = (path: string) => editorTabPath(project, path, tabProject)
  const onPin = (path: string) => pinTab(toTabPath(path))
  const onSetViewMode = (path: string, mode: Tab['viewMode']) => setViewMode(toTabPath(path), mode)
  const onChangeContent = (path: string, content: string) => changeContent(toTabPath(path), content, pane.id)
  const onOpenLink = (path: string, options?: EditorOpenLinkOptions) => openLink(editorLinkTabPath(project, path, workspace, tabProject), options)
  const navigation = selectedTab?.navigation
  const canGoBack = !!navigation && navigation.index > 0
  const canGoForward = !!navigation && navigation.index < navigation.entries.length - 1
  const editorApi = useMemo(() => ({
    ...createEditorApi(project, file.path),
    resolveImageUrl: (src: string, documentPath: string) => editorImageUrl(src, documentPath, project, workspace),
    fetchFile: (path: string) => {
      const target = editorLinkTabPath(project, path, workspace, tabProject)
      if (isExternalTabPath(target)) return fetchExternalFile(externalAbsolutePath(target))
      const file = editorFile(target, tabProject)
      return fetchFile(file.path, file.project)
    },
  }), [project, file.path, workspace, tabProject])
  const databasePage = useMemo(() => {
    if (activeContent === undefined || loading || revalidating || !activePath?.endsWith('.md') || isExternalTabPath(activePath)) return null
    const fields = splitFrontmatter(activeContent).frontmatter?.fields
    const dbId = fields?.find(field => field.key === '_mew_database')?.value
    const rowId = fields?.find(field => field.key === '_mew_row')?.value
    return dbId && rowId ? { dbId, rowId } : null
  }, [activeContent, activePath, loading, revalidating])
  const databaseId = databasePage?.dbId, databaseRowId = databasePage?.rowId
  useEffect(() => {
    if (!databaseId || !databaseRowId) return
    let cancelled = false, request = 0
    const refresh = () => {
      const current = ++request
      void fetchFile(file.path, project).then(({ content }) => {
        if (!cancelled && current === request) window.dispatchEvent(new CustomEvent('mew:database-page-updated', {
          detail: { project, path: file.path, content },
        }))
      }).catch(() => {})
    }
    const unsubscribe = editorApi.db.subscribe(databaseId, event => {
      if (event.type === 'schema' || event.type === 'title'
        || event.type === 'row.update' && event.rowId === databaseRowId
        || event.type === 'row.insert' && event.row.id === databaseRowId) refresh()
    })
    refresh()
    return () => { cancelled = true; unsubscribe() }
  }, [databaseId, databaseRowId, editorApi.db, file.path, project])
  const unsupportedFile = !!activeTab && !canOpenEditorFile(activeTab.path)
  const editorRef = useRef<EditorHandle>(null)
  const codePaneRef = useRef<CodePaneHandle>(null)
  const [databasePopup, setDatabasePopup] = useState<(DatabaseLink & { api: EditorDbApi; project: string; onOpenPage: EditorOpenLink }) | null>(null)
  useEffect(() => setDatabasePopup(null), [project, activePath])
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const scrollHostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const host = scrollHostRef.current
    if (host) return observeEditorViewport(host, () => {}, true)
  }, [])
  const viewAnchorRef = useRef<{ project: string; path: string; mode: Tab['viewMode']; anchor: EditorViewAnchor } | null>(null)
  const changeViewMode = (mode: Tab['viewMode']) => {
    if (!activeTab || activeTab.viewMode === mode) return
    const source = activeTab.viewMode === 'plain' ? codePaneRef.current : editorRef.current
    const anchor = activeTab.path.endsWith('.md') ? source?.getViewAnchor() : null
    viewAnchorRef.current = anchor ? { project, path: activeTab.path, mode, anchor } : null
    onSetViewMode(activeTab.path, mode)
  }

  const collabPath = canCollaborate ? primaryCollabPath(activeTab, role, project) : null
  // The socket authorizes independently. Prepare it alongside the file read, but
  // attach the document only after that read confirms the body and edit access.
  const preparedCollabPath = canCollaborate ? primaryCollabPath(activeTab, role, project, true) : null
  const collabSession = useCollab(project, preparedCollabPath, authEmail)
  const collab = collabPath ? collabSession : null

  // 하단 상태줄 — 파일 종류를 가리지 않아야 하므로 뷰어(Editor)가 아니라 칸이 그린다.
  const [selChars, setSelChars] = useState(0)
  useEffect(() => setSelChars(0), [activePath]) // 탭을 바꾸면 앞 문서의 선택 수가 남는다
  // 미디어(바이너리)는 본문을 받아오지 않는다 — 크기는 /raw HEAD의 Content-Length로 묻는다
  const mediaPath = activeTab && mediaKind(activeTab.path) ? activeTab.path : null
  const [mediaBytes, setMediaBytes] = useState<number | null>(null)
  useEffect(() => {
    setMediaBytes(null)
    if (!mediaPath) return
    let alive = true
    const url = isExternalTabPath(mediaPath) ? externalRawUrl(externalAbsolutePath(mediaPath)) : rawUrl(mediaPath, project)
    mewFetch(url, { method: 'HEAD' })
      .then((res) => {
        const len = Number(res.headers.get('content-length'))
        if (alive && Number.isFinite(len)) setMediaBytes(len)
      })
      .catch(() => {}) // 크기를 못 구하면 상태줄에서 빼는 것으로 충분하다
    return () => {
      alive = false
    }
  }, [mediaPath, project])
  // 상태줄의 전체 본문 순회·UTF-8 버퍼 할당은 첫 표시를 늦추지 않도록 paint 뒤에 한다.
  // 다음 입력이나 탭 전환이 먼저 오면 이전 본문에 예약한 계산을 취소한다.
  const textContent = activeTab && !unsupportedFile && !mediaPath ? activeTab.content : null
  const [measuredText, setMeasuredText] = useState<{ project: string; path: string | null; bytes: number } | null>(null)
  useEffect(() => {
    if (textContent === null) return
    return afterFirstPaint(() => setMeasuredText({ project, path: activePath, bytes: new TextEncoder().encode(textContent).length }))
  }, [textContent, project, activePath])
  // 같은 파일의 재계산 중에는 마지막 크기를 유지해 상태줄이 비지 않게 한다.
  const textBytes = textContent !== null && measuredText?.project === project && measuredText.path === activePath ? measuredText.bytes : null
  const fileBytes = mediaPath ? mediaBytes : textBytes

  // ── 파일 댓글 ────────────────────────────────────────────────────────────────
  // 스레드는 서버(`<프로젝트>/.mew/comments.json`)에 있고 이 칸은 **지금 문서의 것만** 들고 있다.
  // 본문에는 아무것도 남기지 않는다 — 하이라이트는 에디터가 앵커를 다시 풀어 그리는 장식이다.
  // 미디어·SVG 미리보기처럼 텍스트 편집기가 없는 화면과 게스트에게는 아예 뜨지 않는다.
  const isTextPane =
    !!activeTab && !unsupportedFile && !diffTarget && !isExternalTabPath(activeTab.path) && !mediaKind(activeTab.path) && !(activeTab.path.endsWith('.svg') && activeTab.viewMode === 'hotview')
  const canComment = canCollaborate && !isGuest && isTextPane && !revalidating && !activeTab?.anchorPreview
  const canWriteComment = canComment && !!activeTab?.editable && !loading && !isArchivedPath(activeTab.path, project)
  const canCommentRef = useRef(canWriteComment)
  canCommentRef.current = canWriteComment
  const commentButtonRef = useRef<HTMLButtonElement>(null)
  const commentToolsRef = useRef<HTMLDivElement>(null)
  const [threads, setThreads] = useState<CommentThread[]>([])
  const [members, setMembers] = useState<string[]>([])
  const [commentPopup, setCommentPopup] = useState<CommentPopup>(null)
  const [commentListOpen, setCommentListOpen] = useState(false)
  const commentScopeRef = useRef<object>({})
  useLayoutEffect(() => {
    const scope = {}
    commentScopeRef.current = scope
    setCommentPopup(null)
    setCommentListOpen(false)
    setThreads([])
    return () => { if (commentScopeRef.current === scope) commentScopeRef.current = {} }
  }, [workspace?.path, project, activePath, authEmail, canComment, canWriteComment, activeTab?.viewMode])
  const annotationButtonRef = useRef<HTMLButtonElement>(null)
  const [annotationPopup, setAnnotationPopup] = useState<{ num: number | null; identity?: string | null; x: number; y: number } | null>(null)
  const annotationEntries = useMemo(() => activeTab?.path.endsWith('.md') ? readSourceAnnotations(activeTab.content) : [], [activeTab?.path, activeTab?.content])
  const annotationReadOnly = loading || revalidating || !activeTab?.editable || !!activeTab?.anchorPreview || (!!activeTab && isArchivedPath(activeTab.path, project))
  const [editorMenu, setEditorMenu] = useState<EditorMenuSession | null>(null)
  const editorMenuScope = useRef<object>({})
  const editorMenuTargets = useRef(new Set<EditorContextTarget>())
  const disposeMenuTarget = (target: EditorContextTarget) => {
    target.dispose()
    editorMenuTargets.current.delete(target)
  }
  useLayoutEffect(() => {
    editorMenuScope.current = {}
    setEditorMenu(null)
    const targets = editorMenuTargets.current
    const invalidate = () => {
      editorMenuScope.current = {}
      for (const target of targets) target.dispose()
      targets.clear()
    }
    return invalidate
  }, [workspace?.path, project, activePath, authEmail, role, canComment, canWriteComment, annotationReadOnly, activeTab?.viewMode])
  useEffect(() => {
    if (!editorMenu) return
    return () => {
      editorMenu.closed = true
      // The menu closes before its command runs; pending clipboard work owns the snapshot.
      if (!editorMenu.busy) disposeMenuTarget(editorMenu.target)
    }
  }, [editorMenu])
  const annotationPane = () => activeTabRef.current?.viewMode === 'plain' ? codePaneRef.current : editorRef.current
  const openAnnotation = (num: number, x: number, y: number) => {
    setCommentPopup(null)
    setCommentListOpen(false)
    setAnnotationPopup({ num, identity: annotationPane()?.getAnnotationIdentity(num), x, y })
  }
  const pickAnnotation = (num: number) => {
    const point = annotationPane()?.revealAnnotation(num) ?? annotationPopup ?? selectionPoint(scrollHostRef.current)
    openAnnotation(num, point.x, point.y)
  }
  useEffect(() => setAnnotationPopup(null), [activePath, project, activeTab?.viewMode])
  useLayoutEffect(() => {
    if (annotationPopup?.identity && annotationPane()?.findAnnotationNumber(annotationPopup.identity) !== annotationPopup.num) setAnnotationPopup(null)
  }, [activeTab?.content, annotationPopup])
  const editingAnnotationNumber = (num: number) => {
    if (!annotationPopup?.identity) return num
    const current = annotationPane()?.findAnnotationNumber(annotationPopup.identity)
    if (current === num) return current
    setAnnotationPopup(null)
    return null
  }
  // 다른 사람이 남긴 댓글도 바로 뜨게 — presence의 {type:'comments'} 신호를 받아 다시 읽는다
  const reloadThreads = useRef<() => void>(() => {})

  useEffect(() => {
    if (!canComment || !activePath) {
      setThreads([])
      return
    }
    let alive = true
    const scope = commentScopeRef.current
    const load = () => {
      fetchComments(activePath, project)
        .then((list) => {
          if (!alive || commentScopeRef.current !== scope) return
          markFileOpen(activeTab?.openTrace, 'comments-response')
          setThreads(list)
        })
        .catch(() => {}) // 못 읽으면 하이라이트만 없는 것 — 편집을 막지는 않는다
    }
    reloadThreads.current = load
    // 댓글 장식은 첫 본문 표시의 선행조건이 아니다. 첫 paint 뒤에 읽되, 실시간 신호가 오면 즉시 최신 목록을 다시 읽는다.
    const cancelInitialLoad = afterFirstPaint(load)
    const onSignal = (e: Event) => {
      if ((e as CustomEvent<{ type?: string }>).detail?.type === 'comments') load()
    }
    window.addEventListener('mew:signal', onSignal)
    return () => {
      alive = false
      cancelInitialLoad()
      window.removeEventListener('mew:signal', onSignal)
    }
  }, [canComment, canWriteComment, workspace?.path, authEmail, activePath, project, activeTab?.viewMode, activeTab?.openTrace])

  // 멘션 자동완성용 계정 목록 — 바뀌는 일이 드물어 칸이 뜰 때 한 번만 읽는다
  useEffect(() => {
    if (isGuest) return
    fetchMembers()
      .then(setMembers)
      .catch(() => {})
  }, [isGuest])

  /** 지금 화면의 텍스트 편집기 — 앵커를 만들고 되찾는 쪽. hotview·plain이 같은 두 메서드를 낸다 */
  const commentPane = (): Pick<EditorHandle, 'getCommentAnchor' | 'revealCommentAnchor'> | null =>
    activeTabRef.current?.viewMode === 'plain' ? codePaneRef.current : editorRef.current

  const commentPath = () => activeTabRef.current?.path ?? null

  const receiveThread = (thread: CommentThread) => setThreads(previous => {
    const index = previous.findIndex(item => item.id === thread.id)
    return index < 0 ? [...previous, thread] : previous.map(item => item.id === thread.id ? thread : item)
  })

  const submitThread = async (anchor: CommentAnchor, text: string) => {
    const path = commentPath(), scope = commentScopeRef.current
    if (!path || !canCommentRef.current) throw new Error('comment-unavailable')
    const thread = await postComment(path, { anchor, text }, project)
    if (commentScopeRef.current !== scope || !canCommentRef.current) return
    receiveThread(thread)
    setCommentPopup(current => current?.kind === 'compose' && current.anchor === anchor ? { kind: 'thread', id: thread.id, x: current.x, y: current.y } : current)
  }

  const submitReply = async (threadId: string, text: string) => {
    const path = commentPath(), scope = commentScopeRef.current
    if (!path || !canCommentRef.current) throw new Error('comment-unavailable')
    const thread = await postComment(path, { threadId, text }, project)
    if (commentScopeRef.current === scope && canCommentRef.current) receiveThread(thread)
  }

  const submitEdit = async (threadId: string, commentId: string, text: string) => {
    const path = commentPath(), scope = commentScopeRef.current
    if (!path || !canCommentRef.current) throw new Error('comment-unavailable')
    const thread = await updateComment(path, threadId, commentId, text, project)
    if (commentScopeRef.current === scope && canCommentRef.current) receiveThread(thread)
  }

  const submitDelete = async (threadId: string, commentId: string) => {
    const path = commentPath(), scope = commentScopeRef.current
    if (!path || !canCommentRef.current) throw new Error('comment-unavailable')
    const thread = await deleteComment(path, threadId, commentId, project)
    if (commentScopeRef.current !== scope || !canCommentRef.current) return
    if (thread) receiveThread(thread)
    else {
      setThreads(previous => previous.filter(item => item.id !== threadId))
      setCommentPopup(current => current?.kind === 'thread' && current.id === threadId ? null : current)
    }
  }

  /** 본문에서 자리를 못 찾았을 때 화면에 적을 말 — 대개 다른 보기 모드에서 단 댓글이다(ADR 0049) */
  const lostAnchorNotice = (): string => {
    const tab = activeTabRef.current
    const other = tab?.path.endsWith('.md') ? (tab.viewMode === 'plain' ? 'Hotview' : 'Plain') : null
    return other
      ? uiText("댓글 위치를 찾을 수 없습니다. {p0} 보기에서 확인하세요.", { p0: other })
      : uiText("댓글이 달린 부분이 수정되거나 삭제됐습니다")
  }

  /**
   * 목록에서 고른 스레드 — 그 자리로 스크롤하고 거기에 팝업을 띄운다.
   * 자리를 못 찾으면 **누른 자리**에 띄우고 왜 안 갔는지 적는다. 예전에는 칸 좌상단 구석에
   * 조용히 떠서, 눌러도 아무 일도 안 일어난 것처럼 보였다.
   */
  const jumpToThread = (thread: CommentThread, from?: { x: number; y: number }) => {
    setCommentListOpen(false)
    disarmRestoreRef.current()
    const at = commentPane()?.revealCommentAnchor(thread.anchor)
    const point = at ?? from ?? selectionPoint(scrollHostRef.current)
    setCommentPopup({ kind: 'thread', id: thread.id, x: point.x, y: point.y, notice: at ? undefined : lostAnchorNotice() })
  }

  /**
   * 고른 글자에 새 댓글 — Ctrl+Shift+C와 모바일 보조키의 댓글 아이콘이 같이 쓴다.
   * 선택이 비어 있으면 선택 안내를 띄운다(보조키 아이콘도 그때는 안 뜬다, ADR 0051).
   */
  const startComment = () => {
    if (!canCommentRef.current) { showToast(t('comment.unavailable')); return false }
    const anchor = commentPane()?.getCommentAnchor()
    if (!anchor) { showToast(t('comment.selectText')); return false }
    const { x, y } = selectionPoint(scrollHostRef.current)
    setAnnotationPopup(null)
    setCommentListOpen(false)
    setCommentPopup({ kind: 'compose', anchor, x, y })
    return true
  }
  // 손잡이(handle)는 한 번만 만들어지므로 최신 함수를 ref로 읽는다
  const startCommentRef = useRef(startComment)
  startCommentRef.current = startComment

  const openEditorMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!activeTab || loading || revalidating || diffTarget || unsupportedFile || mediaKind(activeTab.path)
      || (activeTab.path.endsWith('.svg') && activeTab.viewMode === 'hotview')) return
    const element = event.target instanceof Element ? event.target : null
    if (!element || element.closest('input, textarea, select, button, [role="dialog"], [role="menu"], [role="listbox"], [inert]')) return
    const surface = event.currentTarget.querySelector('.ProseMirror, .cm-editor')
    if (!surface || (!surface.contains(element) && !element.contains(surface))) return
    const target = annotationPane()?.prepareContextMenu(event.clientX, event.clientY)
    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    disarmRestoreRef.current()
    setAnnotationPopup(null)
    setCommentPopup(null)
    setCommentListOpen(false)
    editorMenuTargets.current.add(target)
    setEditorMenu({ target, x: event.clientX, y: event.clientY, scope: editorMenuScope.current, busy: false, closed: false })
  }

  const runEditorAction = (session: EditorMenuSession, action: EditorContextAction) => {
    if (session.scope !== editorMenuScope.current || session.busy) return
    session.busy = true
    const failed = () => {
      if (session.scope !== editorMenuScope.current) return
      if (action === 'copy') showToast(uiText('복사하지 못했습니다. Ctrl/Cmd+C로 다시 시도하세요.'))
      else if (action === 'cut') showToast(uiText('잘라내지 못했습니다. Ctrl/Cmd+X로 다시 시도하세요.'))
      else if (action === 'paste') showToast(uiText('붙여넣지 못했습니다. Ctrl/Cmd+V로 다시 시도하세요.'))
    }
    const run = () => {
      const target = session.target
      if (action === 'annotation') {
        if (annotationReadOnly || !activeTabRef.current?.path.endsWith('.md') || isExternalTabPath(activeTabRef.current.path) || !target.restoreSelection()) return false
        annotationPane()?.startAnnotation()
        return true
      }
      if (action === 'comment') return canCommentRef.current && target.selectCommentTarget() && startCommentRef.current()
      if (action === 'delete') return target.deleteSelection()
      if (action === 'selectAll') return target.selectAll()
      return target[action]()
    }
    try {
      const result = run()
      void Promise.resolve(result).then(ok => { if (!ok) failed() }, failed).finally(() => {
        session.busy = false
        if (session.closed) disposeMenuTarget(session.target)
      })
    } catch {
      failed()
      session.busy = false
      if (session.closed) disposeMenuTarget(session.target)
    }
  }

  const openThread = (id: string, x: number, y: number) => { setAnnotationPopup(null); setCommentListOpen(false); setCommentPopup({ kind: 'thread', id, x, y }) }
  const shownThread = commentPopup?.kind === 'thread' ? threads.find((t) => t.id === commentPopup.id) : undefined

  // 손잡이는 항상 같은 객체다 — 안에서 ref로 지금 값을 읽으므로 탭이 바뀌어도 다시 등록할 일이 없다
  const handle = useMemo<PaneHandle>(
    () => ({
      getSelectedText: () => {
        const tab = activeTabRef.current
        if (!tab) return null
        if (tab.viewMode === 'plain') return codePaneRef.current?.getSelectedText() ?? null
        return editorRef.current?.getSelectedText() ?? null
      },
      getSelectedLineRange: () => {
        const tab = activeTabRef.current
        if (!tab) return null
        if (tab.viewMode === 'plain') return codePaneRef.current?.getSelectedLineRange() ?? null
        return editorRef.current?.getSelectedLineRange() ?? null
      },
      // 검색 결과 점프는 칸 밖(사이드바) 클릭에서 와서 pin 해제 입력이 없다 — 직접 풀고 점프한다
      openSearch: (query) => {
        disarmRestoreRef.current()
        if (activeTabRef.current?.viewMode === 'plain') codePaneRef.current?.openSearch(query)
        else editorRef.current?.openSearch(query)
      },
      revealLine: (path, line) => {
        const tab = activeTabRef.current
        if (!tab || activeKeyRef.current !== path || tab.viewMode !== 'plain' || !codePaneRef.current) return false
        const moved = codePaneRef.current.revealLine(line, tab.content)
        if (!moved) return false
        disarmRestoreRef.current()
        return true
      },
      setRawContent: (content) => editorRef.current?.setRawContent(content),
      startComment: () => startCommentRef.current(),
    }),
    [],
  )

  useEffect(() => {
    registerHandle(pane.id, handle)
    return () => registerHandle(pane.id, null)
  }, [pane.id, handle, registerHandle])

  // 복원 추격이 도는 동안은 저장을 막는다 — 에디터 초기화가 쏘는 scroll(0)이 pending에
  // 끼어들어 저장값을 0으로 오염시키면 다음 복원이 통째로 사라진다
  const restoringRef = useRef(false)

  // 스크롤 위치 저장 — scroll은 버블링하지 않아 capture로 받는다. 에디터 종류(hotview .editor-root /
  // plain .cm-scroller)와 무관하게 칸 래퍼 한 곳에서 처리한다 (ADR 0038)
  useEffect(() => {
    const host = scrollHostRef.current
    if (!host) return
    const onScroll = (e: Event) => {
      if (restoringRef.current) return
      const el = e.target
      if (!(el instanceof HTMLElement) || !el.matches('.editor-root, .cm-scroller, .pdf-scroll')) return
      const tab = activeTabRef.current
      if (tab) saveScroll(project, tab.path, el.scrollTop)
    }
    host.addEventListener('scroll', onScroll, true)
    return () => host.removeEventListener('scroll', onScroll, true)
  }, [project])

  // 복원은 활성 문서가 바뀔 때마다 — 새로고침 hydration·탭 전환·칸 분할 리마운트 모두 (ADR 0039).
  // useLayoutEffect인 이유: paint 뒤(useEffect)로 미루면 에디터 초기화의 scroll(0) 이벤트가 먼저
  // 도착해 복원할 값을 읽기도 전에 0으로 덮는다 — paint 전에 값을 확보해야 한다.
  //
  // 한 번 맞추고 끝내지 않고 **첫 사용자 입력까지 위치를 붙든다(pin)** — 분할·해제 리마운트에서는
  // 에디터 초기화·collab 재동기화가 복원 완료 *뒤에도* scroll(0)을 쏴서, 한 번짜리 복원은 화면이
  // 되돌아가고 저장값까지 0으로 오염됐다. 붙드는 동안은 저장도 잠근다. 사용자 입력(휠·터치·
  // 포인터·키)이 오는 순간 풀어 정상 스크롤 저장으로 복귀한다.
  const disarmRestoreRef = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    const tab = activeTabRef.current
    const host = scrollHostRef.current
    if (!tab || !tab.path || !host) return
    const pending = viewAnchorRef.current
    const anchor = pending?.project === project && pending.path === tab.path && pending.mode === tab.viewMode ? pending.anchor : null
    viewAnchorRef.current = null
    const top = anchor ? null : getScroll(project, tab.path)
    if (top === null && !anchor) return
    restoringRef.current = true
    let observedScroll: HTMLElement | null = null
    let observedContent: Element | null = null
    let resizeObserver: ResizeObserver | null = null
    let mutationObserver: MutationObserver | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    const stop = () => {
      restoringRef.current = false
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      if (timeout) clearTimeout(timeout)
      for (const ev of events) host.removeEventListener(ev, stop, true)
    }
    const restore = () => {
      if (activeTabRef.current?.path !== tab.path) return stop() // 탭을 바꿨으면 그만둔다
      const el = host.querySelector<HTMLElement>('.editor-root, .cm-scroller, .pdf-scroll')
      if (!el) return
      // 늦은 collab 동기화·이미지·분할 리마운트로 본문 높이가 자랄 때만 다시 맞춘다. 예전처럼
      // 매 프레임 DOM을 읽지 않는다.
      if (anchor) {
        const target = tab.viewMode === 'plain' ? codePaneRef.current : editorRef.current
        if (target?.restoreViewAnchor(anchor)) saveScroll(project, tab.path, el.scrollTop)
      } else if (top !== null && el.scrollHeight >= top + el.clientHeight && Math.abs(el.scrollTop - top) > 1) el.scrollTop = top
      const content = el.querySelector('.ProseMirror, .cm-content, .pdf-pages')
      if (el === observedScroll && content === observedContent) return
      resizeObserver?.disconnect()
      observedScroll = el
      observedContent = content
      resizeObserver = new ResizeObserver(restore)
      resizeObserver.observe(el)
      if (content) resizeObserver.observe(content)
    }
    disarmRestoreRef.current = stop
    mutationObserver = new MutationObserver(restore)
    mutationObserver.observe(host, { childList: true, subtree: true })
    for (const ev of events) host.addEventListener(ev, stop, true)
    restore()
    // 동기화가 영영 오지 않은 탭이 listener를 무한히 붙들지 않도록 이전과 같은 약 10초 상한은 둔다.
    timeout = setTimeout(stop, 10_000)
    return stop
  }, [pane.activePath, project, activeTab?.viewMode])

  const isMd = !!activeTab?.path.endsWith('.md') && !isExternalTabPath(activeTab.path)
  const isSvg = !!activeTab?.path.endsWith('.svg') && !isExternalTabPath(activeTab.path)
  const htmlPath = activeTab ? (isExternalTabPath(activeTab.path) ? externalAbsolutePath(activeTab.path) : activeTab.path) : ''
  const htmlUrl = activeTab && /\.html?$/i.test(htmlPath)
    ? isExternalTabPath(activeTab.path) ? externalRawUrl(htmlPath) : rawUrl(htmlPath, project)
    : null

  // 자식 편집기가 마운트된 뒤 첫 paint까지를 파일 열기 trace에 남긴다. 캐시 본문도 이 지점을
  // 지나므로 캐시·콜드·복원 오픈을 같은 기준으로 비교할 수 있다.
  useEffect(() => {
    const trace = activeTab?.openTrace
    if (!trace || mediaKind(activeTab.path)) return
    markFileOpen(trace, 'editor-ready')
    const raf = requestAnimationFrame(() => markFileOpen(trace, 'first-paint'))
    return () => cancelAnimationFrame(raf)
  }, [activeTab?.openTrace, activeTab?.path])

  return (
    <div onPointerDownCapture={onFocus} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* 포커스되지 않은 칸의 탭 줄은 흐리게 — 커밋·단축키가 어느 칸을 가리키는지 보이게 */}
      <div data-dock-tab-bar ref={(el) => registerTabBar(pane.id, el)} className={`flex h-9 shrink-0 items-stretch ${focused ? '' : 'opacity-60'}`}>
        <DockGrip group={`editor:${pane.id}`} />
        <TabBar
          tabs={pane.tabs.map(tab => {
            const diff = gitDiffTarget(tab.path)
            if (diff) return { ...tab, label: `${diff.filePath.split('/').pop()} · diff${diff.source.kind === 'commit' ? ` · ${diff.source.hash.slice(0, 7)}` : ''}` }
            const entry = editorFile(tab.path, tabProject)
            const logical = documentPageTarget(entry.path)
            return entry.project === 'docs' && entry.path.endsWith('.md') ? { ...tab, label: documentPageLabel(logical) || uiText('문서 홈') } : tab
          })}
          activePath={pane.activePath}
          activeId={pane.activeTabId}
          presence={presence}
          onActivate={onActivate}
          onPin={pinTab}
          onClose={onCloseTab}
          onReorder={onReorder}
          onDragMove={(path, x, y, tabId) => onTabDragMove(pane.id, path, x, y, tabId)}
          onDrop={(path, x, y, tabId) => onTabDrop(pane.id, path, x, y, tabId)}
        />
        {onClosePanel && <div className="flex items-center border-b border-edge bg-surface-deep">
          <PanelCloseButton onClick={onClosePanel} aria-label={t('common.close')} />
        </div>}
      </div>

      {/* 드롭 자리 판정은 **본문**만 본다 — 탭 줄 안에서 끄는 건 순서 바꾸기지 분할이 아니다 */}
      <DockInlineBody group={`editor:${pane.id}`}
        ref={(el) => {
          scrollHostRef.current = el
          registerElement(pane.id, el)
        }}
        tabIndex={-1}
        aria-busy={loading}
        className="relative flex min-h-0 flex-1 bg-surface-deep"
      >
        <div inert={loading} className="relative flex min-h-0 min-w-0 flex-1">
        {diffTarget && pane.activePath ? (
          <GitDiffEditor key={pane.activePath} path={pane.activePath}
            visible={diffVisible && (!dock || (dock.desktop ? !dock.maximized || dock.maximized === `editor:${pane.id}` : !dock.foreground || dock.foreground === 'editor'))}
            onOpenFile={(project, path) => onOpenDiffFile?.(project, path)} />
        ) : activeTab ? (
          <>
            {isArchivedPath(activeTab.path, project) && !isGuest && (
              <div className="absolute inset-x-0 top-0 z-10 bg-warning-surface px-4 py-1 text-center text-sm text-warning-ink">
                {uiText("보관 문서 · 읽기 전용")}</div>
            )}
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              {showSidebarButton && (
                <div className="absolute left-3 top-3 z-20">
                  <SidebarOpenButton onClick={onOpenSidebar} />
                </div>
              )}
              {/* 에디터 우상단 도구 줄 — 히스토리·뷰 모드·목차는 md/svg 문서에만, 터미널은 파일 종류와
                  무관하게 뜬다. right-5는 에디터 오른쪽 스크롤바를 비켜 앉기 위한 여백 */}
              <div data-editor-tools className="absolute right-5 top-3 z-20 flex items-start gap-2">
                <div data-editor-navigation className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigateTab?.(-1)}
                    disabled={!onNavigateTab || !canGoBack || loading}
                    className="rounded border border-edge-strong bg-surface-raised p-1.5 text-ink-muted shadow-sm enabled:hover:bg-surface-hover disabled:cursor-default disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"
                    aria-label={uiText('뒤로가기')}
                    data-tip={uiText('뒤로가기')}
                  >
                    <ArrowLeft width={14} height={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigateTab?.(1)}
                    disabled={!onNavigateTab || !canGoForward || loading}
                    className="rounded border border-edge-strong bg-surface-raised p-1.5 text-ink-muted shadow-sm enabled:hover:bg-surface-hover disabled:cursor-default disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"
                    aria-label={uiText('앞으로가기')}
                    data-tip={uiText('앞으로가기')}
                  >
                    <ArrowRight width={14} height={14} aria-hidden="true" />
                  </button>
                </div>
                {htmlUrl && (
                  <a
                    href={htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded border border-edge-strong bg-surface-raised p-1.5 text-ink-muted shadow-sm hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent"
                    aria-label={uiText('브라우저 새 탭에서 열기')}
                    data-tip={uiText('브라우저 새 탭에서 열기')}
                  >
                    <OpenNewWindow width={14} height={14} aria-hidden="true" />
                  </a>
                )}
                {(isMd || isSvg) && (
                  <>
                    {!isGuest && (
                      <button
                        type="button"
                        onClick={onOpenHistory}
                        className="rounded border border-edge-strong bg-surface-raised p-1.5 text-ink-muted shadow-sm hover:bg-surface-hover"
                        title={uiText("히스토리")}
                        aria-label={uiText("히스토리")}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 3v5h5" />
                          <path d="M3.05 13a9 9 0 1 0 .5-4.5L3 8" />
                          <path d="M12 7v5l4 2" />
                        </svg>
                      </button>
                    )}
                    {/* 렌더 보기(md=Hotview 눈, svg=이미지) ↔ 원문 보기(Plain, 코드 괄호) */}
                    <div className="flex overflow-hidden rounded border border-edge-strong shadow-sm">
                      <button
                        type="button"
                        onClick={() => changeViewMode('hotview')}
                        className={`p-1.5 ${
                          activeTab.viewMode === 'hotview'
                            ? 'bg-accent text-ink-on-accent'
                            : 'bg-surface-raised text-ink-secondary hover:bg-surface-hover'
                        }`}
                        title={isSvg ? uiText("이미지") : 'Hotview'}
                        aria-label={isSvg ? uiText("이미지") : 'Hotview'}
                      >
                        {isSvg ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <circle cx="9" cy="9" r="1.5" />
                            <path d="m21 15-4.5-4.5L6 21" />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => changeViewMode('plain')}
                        className={`p-1.5 ${
                          activeTab.viewMode === 'plain'
                            ? 'bg-accent text-ink-on-accent'
                            : 'bg-surface-raised text-ink-secondary hover:bg-surface-hover'
                        }`}
                        title={isSvg ? uiText("텍스트") : 'Plain'}
                        aria-label={isSvg ? uiText("텍스트") : 'Plain'}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m18 16 4-4-4-4" />
                          <path d="m6 8-4 4 4 4" />
                          <path d="m14.5 4-5 16" />
                        </svg>
                      </button>
                    </div>
                  </>
                )}
                {(canComment || (isMd && !diffTarget && !loading && !revalidating)) && <div ref={commentToolsRef} className="flex items-center gap-2">
                {/* 댓글 목록 — 목차 버튼 **왼쪽**의 플로팅 버튼. 목차와 달리 md가 아니어도,
                    좁은 화면에서도 뜬다(댓글은 코드 파일에도 달린다). 팝업은 이 버튼 아래에 붙는다 */}
                {canComment && (
                  <div className="relative">
                    <button
                      type="button"
                      ref={commentButtonRef}
                      aria-expanded={commentListOpen}
                      onClick={() => { setCommentPopup(null); setAnnotationPopup(null); setCommentListOpen((open) => !open) }}
                      className={`rounded border border-edge-strong p-1.5 shadow-sm ${
                        commentListOpen ? 'bg-accent text-ink-on-accent' : 'bg-surface-raised text-ink-muted hover:bg-surface-hover'
                      }`}
                      title={uiText("댓글 목록 ({p0}로 달기)", { p0: shortcutBindings.addComment })}
                      aria-label={uiText("댓글 목록")}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 11.5a8.38 8.38 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.2A8.5 8.5 0 0 1 4 11.5a8.38 8.38 0 0 1 8.5-8.4 8.38 8.38 0 0 1 8.5 8.4z" />
                      </svg>
                      {threads.length > 0 && (
                        <span className="absolute -right-1 -top-1 min-w-[14px] rounded-full bg-accent px-1 text-[9px] leading-[14px] text-ink-on-accent">
                          {threads.length}
                        </span>
                      )}
                    </button>
                    {commentListOpen && (
                      <CommentListPopover outsideIgnore={() => commentToolsRef.current} anchorRef={commentButtonRef} threads={threads} onPick={jumpToThread} onClose={() => setCommentListOpen(false)} />
                    )}
                  </div>
                )}
                {isMd && !diffTarget && !loading && !revalidating && (
                  <button
                    ref={annotationButtonRef}
                    type="button"
                    aria-label={uiText('주석 목록')}
                    title={uiText('주석 목록')}
                    aria-expanded={annotationPopup?.num === null}
                    onClick={event => {
                      if (annotationPopup?.num === null) { setAnnotationPopup(null); return }
                      const rect = event.currentTarget.getBoundingClientRect()
                      setCommentListOpen(false)
                      setCommentPopup(null)
                      setAnnotationPopup({ num: null, x: rect.right - 288, y: rect.bottom })
                    }}
                    className={`rounded border border-edge-strong p-1.5 shadow-sm ${annotationPopup ? 'bg-accent text-ink-on-accent' : 'bg-surface-raised text-ink-muted hover:bg-surface-hover'}`}
                  >
                    <Quote width={14} height={14} aria-hidden="true" />
                  </button>
                )}
                </div>}
                {isMd && (
                  <button
                    type="button"
                    onClick={() => onSetTocOpen(!tocOpen)}
                    className={`hidden rounded border border-edge-strong p-1.5 shadow-sm lg:block ${
                      tocOpen ? 'bg-accent text-ink-on-accent' : 'bg-surface-raised text-ink-muted hover:bg-surface-hover'
                    }`}
                    title={uiText("목차")}
                    aria-label={uiText("목차")}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M9 6h12M9 12h12M9 18h12" />
                      <circle cx="4" cy="6" r="1" fill="currentColor" />
                      <circle cx="4" cy="12" r="1" fill="currentColor" />
                      <circle cx="4" cy="18" r="1" fill="currentColor" />
                    </svg>
                  </button>
                )}
              </div>
              {/* 뷰어는 남는 높이를 전부 차지한다 — 그래야 아래 상태줄이 짧은 문서에서도 칸 맨 밑에 선다.
                  min-h-0이 없으면 내용이 긴 문서에서 뷰어가 칸 밖으로 자라 상태줄을 밀어낸다. */}
              <div className="relative min-h-0 flex-1" onContextMenuCapture={openEditorMenu}>
                {unsupportedFile ? (
                  <div role="status" className="flex h-full items-center justify-center px-4 text-center text-sm text-ink-muted">
                    {t('editor.unsupportedFile')}
                  </div>
                ) : mediaKind(activeTab.path) ? (
                  // key로 파일 전환 시 리마운트 — 이전 파일의 재생 상태가 남지 않게
                  <MediaViewer key={`${project}:${activeTab.path}`} path={activeTab.path} kind={mediaKind(activeTab.path)!} project={project} identity={authEmail ?? 'guest'} onEdit={() => onPin(activeTab.path)} />
                ) : isSvg && activeTab.viewMode === 'hotview' ? (
                  <SvgPreview content={activeTab.content} />
                ) : activeTab.viewMode === 'plain' ? (
                  <CodePane
                    ref={codePaneRef}
                    path={activeTab.path}
                    project={project}
                    debuggerContext={workspace?.path && authEmail && (role === 'owner' || role === 'manager') && (project === '.workspace' || activeTab.path.startsWith('/')) ? { root: workspace.path, account: authEmail } : undefined}
                    value={activeTab.content}
                    onChange={(content) => onChangeContent(activeTab.path, content)}
                    readOnly={loading || revalidating || !activeTab.editable || isArchivedPath(activeTab.path, project) || !!activeTab.anchorPreview}
                    collab={collab}
                    commentThreads={threads}
                    onCommentClick={openThread}
                    onAnnotationOpen={openAnnotation}
                    onOpenDatabase={!isGuest && isMd && !loading && !revalidating ? reference => setDatabasePopup({ ...reference, api: editorApi.db, project, onOpenPage: onOpenLink }) : undefined}
                    lineOffset={activeTab.anchorPreview ? activeTab.anchorPreview.lineStart - 1 : 0}
                  />
                ) : (
                  <MarkdownErrorBoundary
                    resetKey={JSON.stringify([project, activeTab.path])}
                    onOpenPlain={() => changeViewMode('plain')}
                  >
                    <Editor
                      key={collab?.ydoc.clientID ?? 'local'}
                      ref={editorRef}
                      value={activeTab.content}
                      api={editorApi}
                      onChange={(content) => onChangeContent(activeTab.path, content)}
                      readOnly={loading || revalidating || !activeTab.editable || isArchivedPath(activeTab.path, project)}
                      path={externalAbsolutePath(activeTab.path)}
                      fileLinkContext={workspace?.docsPath ? {
                        path: isExternalTabPath(activeTab.path) ? externalAbsolutePath(activeTab.path) : `${project === 'docs' ? workspace.docsPath : project === '.workspace' ? workspace.path : `${workspace.path}/${project}`}/${activeTab.path}`,
                        docsRoot: workspace.docsPath,
                        projectRoot: workspace.path,
                      } : undefined}
                      tree={tree}
                      onOpenLink={onOpenLink}
                      onCreateChildPage={!isGuest && !isExternalTabPath(activeTab.path) && onCreateChildPage ? async () => {
                        const sourcePath = pane.activePath
                        const name = await pageDialogs.prompt({ message: uiText('새 하위 페이지 만들기'), label: uiText('새 문서 이름'), confirmLabel: uiText('만들기') })
                        if (name && activeKeyRef.current === sourcePath) await onCreateChildPage(toTabPath(activeTab.path), name)
                      } : undefined}
                      onSelectionChars={setSelChars}
                      collab={collab}
                      commentThreads={threads}
                      onCommentClick={openThread}
                      onAnnotationOpen={openAnnotation}
                      onStartComment={canWriteComment && selChars > 0 ? startComment : undefined}
                    />
                  </MarkdownErrorBoundary>
                )}
              </div>
              {/* 상태줄은 늘 떠 있다 — 가운데는 파일 크기, 오른쪽은 선택했을 때만 글자 수.
                  양옆 칸을 같은 flex-1로 둬야 가운데가 바 한가운데에 선다. */}
              <div data-editor-status-bar className="flex min-h-4 shrink-0 items-center border-t border-edge bg-surface-deep px-2 py-0.5 text-[10px] leading-none text-ink-muted">
                <span className="flex-1" />
                <span>
                  {activeTab.anchorPreview
                    ? `${activeTab.anchorPreview.lineStart}–${activeTab.anchorPreview.lineEnd}${activeTab.anchorPreview.totalLines ? ` / ${activeTab.anchorPreview.totalLines}` : ''} lines · loading full file…`
                    : fileBytes === null
                      ? ''
                      : formatBytes(fileBytes)}
                </span>
                <span className="flex-1 text-right">{selChars > 0 && uiText("{p0}자 선택", { p0: selChars })}</span>
              </div>
            </div>
            {tocOpen && isMd && (
              <TableOfContents
                content={activeTab.content}
                onJump={(i) => editorRef.current?.scrollToHeading(i)}
                onClose={() => onSetTocOpen(false)}
              />
            )}
            {editorMenu && <EditorContextMenu {...editorMenu} canAnnotate={isMd && !annotationReadOnly} canComment={canWriteComment}
              onClose={() => setEditorMenu(null)} onAction={action => runEditorAction(editorMenu, action)} />}
            {/* 댓글 작성·스레드 보기 — 하이라이트나 커서 자리에 붙는 카드 하나. 둘이 동시에 뜨지 않는다 */}
            {annotationPopup && isMd && (
              <AnnotationPopover
                outsideIgnore={() => commentToolsRef.current}
                entries={annotationEntries}
                {...annotationPopup}
                readOnly={annotationReadOnly}
                onPick={pickAnnotation}
                onChange={(num, text) => {
                  if (annotationReadOnly) return
                  const current = editingAnnotationNumber(num)
                  if (current !== null) annotationPane()?.updateAnnotation(current, text)
                }}
                onDelete={num => {
                  if (annotationReadOnly) return
                  const current = editingAnnotationNumber(num)
                  if (current !== null) annotationPane()?.deleteAnnotation(current)
                  setAnnotationPopup(null)
                }}
                onAdd={() => { setAnnotationPopup(null); annotationPane()?.startAnnotation() }}
                onClose={() => setAnnotationPopup(null)}
              />
            )}
            {commentPopup?.kind === 'compose' && (
              <CommentPopover outsideIgnore={() => commentToolsRef.current} x={commentPopup.x} y={commentPopup.y} onClose={() => setCommentPopup(null)}>
                <CommentComposer
                  quote={commentPopup.anchor.text}
                  members={members}
                  onSubmit={(text) => submitThread(commentPopup.anchor, text)}
                  onClose={() => setCommentPopup(null)}
                />
              </CommentPopover>
            )}
            {commentPopup?.kind === 'thread' && shownThread && (
              <CommentPopover outsideIgnore={() => commentToolsRef.current} x={commentPopup.x} y={commentPopup.y} onClose={() => setCommentPopup(null)}>
                <CommentThreadView
                  thread={shownThread}
                  readOnly={!canWriteComment}
                  authEmail={authEmail}
                  isOwner={role === 'owner'}
                  members={members}
                  notice={commentPopup.notice}
                  onReply={(text) => submitReply(shownThread.id, text)}
                  onEdit={(commentId, text) => submitEdit(shownThread.id, commentId, text)}
                  onDelete={(commentId) => submitDelete(shownThread.id, commentId)}
                  onClose={() => setCommentPopup(null)}
                />
              </CommentPopover>
            )}
          </>
        ) : (
          <div className="relative flex min-h-0 flex-1 items-center justify-center text-ink-secondary">
            {/* 문서가 없어도 사이드바·터미널은 열 수 있어야 한다 — 도구 줄과 같은 자리 */}
            {showSidebarButton && (
              <div className="absolute left-3 top-3 z-20">
                <SidebarOpenButton onClick={onOpenSidebar} />
              </div>
            )}
            <dl className="grid max-w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 px-3 text-sm">
              <dt>{uiText("사이드바 열기")}</dt>
              <dd className="text-right"><kbd className="font-mono text-xs">{shortcutBindings.toggleSidebar}</kbd></dd>
              <dt>{uiText("문서 검색")}</dt>
              <dd className="text-right"><kbd className="font-mono text-xs">{shortcutBindings.projectSearch}</kbd></dd>
              <dt>{uiText("문서 파일 검색")}</dt>
              <dd className="text-right"><kbd className="font-mono text-xs">{shortcutBindings.quickOpen}</kbd></dd>
            </dl>
          </div>
        )}
        {dropZone && <DropHint zone={dropZone} />}
        </div>
        {loading && <div data-editor-loading role="status" aria-label={t('common.loading')}
          className="absolute inset-0 z-50 flex cursor-wait items-center justify-center bg-black/50">
          <span aria-hidden="true" className="h-8 w-8 rounded-full border-2 border-white/30 border-t-white motion-safe:animate-spin" />
          <span className="sr-only">{t('common.loading')}</span>
        </div>}
        {databasePopup && <DatabaseListModal api={databasePopup.api} project={databasePopup.project}
          initialDbId={databasePopup.id} readonly={databasePopup.readonly}
          onClose={() => setDatabasePopup(null)} onOpenPage={databasePopup.onOpenPage} />}
      </DockInlineBody>
      {pageDialogs.dialog}
      {commentToast}
    </div>
  )
}
