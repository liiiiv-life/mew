import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  deleteComment,
  editorApi,
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
import { Editor, type CommentAnchor, type EditorHandle } from '@mew/editor'
import { useSwipeGesture } from '@mew/mobile-keys'
import { CodePane, type CodePaneHandle } from './CodePane'
import { CommentComposer, CommentListPopover, CommentPopover, CommentThreadView } from './Comments'
import { MediaViewer } from './MediaViewer'
import { SvgPreview } from './SvgPreview'
import { TableOfContents } from './TableOfContents'
import { TabBar } from './TabBar'
import { mediaKind } from '../utils/media'
import { saveScroll, getScroll } from '../utils/scrollMemory'
import { useCollab } from '../hooks/useCollab'
import type { Pane, Tab } from '../hooks/useTabs'
import type { DropZone } from '../utils/paneTree'

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
  /** Alt+Shift+C — 현재 선택(없으면 커서) 자리에 댓글 작성 팝업을 연다. 텍스트 편집기가 아니면 무시 */
  startComment: () => void
}

/** 지금 떠 있는 댓글 팝업 — 새로 쓰는 중(compose)이거나 기존 스레드를 보는 중(thread) 하나뿐이다 */
type CommentPopup =
  | { kind: 'compose'; anchor: CommentAnchor; x: number; y: number }
  // notice: 본문에서 자리를 못 찾았을 때 그 사실을 적는다 — 스크롤이 안 된 이유가 화면에 보여야 한다
  | { kind: 'thread'; id: string; x: number; y: number; notice?: string }
  | null

// 실시간 협업은 파일별 "주 편집화면"에서만 지원한다 — .md는 Hotview, 그 외는 Plain.
// 게스트는 파일별 편집 허용이 있어도 collab 소켓 자체가 서버에서 막혀 있어 항상 로컬 편집으로 처리한다.
function primaryCollabPath(tab: Tab | null, role: Role): string | null {
  if (role === 'guest' || !tab || !tab.editable || isArchivedPath(tab.path) || mediaKind(tab.path)) return null
  const eligible = tab.path.endsWith('.md') ? tab.viewMode === 'hotview' : tab.viewMode === 'plain'
  return eligible ? tab.path : null
}

/** 사이드바가 닫혀 있을 때 맨 왼쪽 칸 좌상단에 뜨는 여는 버튼 — 우상단 도구 줄과 같은 생김새 */
function SidebarOpenButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-edge-strong bg-surface-raised p-1.5 text-ink-muted shadow-sm hover:bg-surface-hover"
      title="사이드바 열기 (Ctrl+B)"
      aria-label="사이드바 열기"
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
  tree: TreeNode[]
  presence: Record<string, string[]>
  /** 지금 포커스된 칸인지 — 커밋·단축키·터미널이 가리키는 칸이다 */
  focused: boolean
  isGuest: boolean
  canUseTerminal: boolean
  /** 사이드바 여는 버튼을 이 칸이 맡는지 (사이드바 닫힘 + 맨 앞 칸) */
  showSidebarButton: boolean
  tocOpen: boolean
  dropZone: DropZone | null
  registerHandle: (paneId: string, handle: PaneHandle | null) => void
  registerElement: (paneId: string, el: HTMLElement | null) => void
  /** 탭 줄 — 다른 칸의 탭을 여기에 놓으면 이 칸으로 옮겨온다 */
  registerTabBar: (paneId: string, el: HTMLElement | null) => void
  onFocus: () => void
  onActivate: (path: string) => void
  onPin: (path: string) => void
  onCloseTab: (path: string) => void
  onReorder: (from: number, to: number) => void
  onSetViewMode: (path: string, viewMode: Tab['viewMode']) => void
  onChangeContent: (path: string, content: string) => void
  onOpenLink: (path: string) => void
  onOpenHistory: () => void
  /** 모바일 하단 우→좌 스와이프 제스처의 에이전트 창 열기 — 버튼은 햄버거 메뉴(App)에 있다 */
  onOpenAgent: () => void
  onSetTocOpen: (open: boolean) => void
  onOpenSidebar: () => void
  onTabDragMove: (paneId: string, path: string, x: number, y: number) => void
  onTabDrop: (paneId: string, path: string, x: number, y: number) => void
}

/**
 * 편집 칸 하나 — 자기 탭 줄, 자기 활성 문서, 자기 협업 세션을 가진다. 화면 분할은 이 칸을
 * 여러 개 세우는 것이고, 배치는 `utils/paneTree.ts`가 들고 있다.
 */
export function EditorPane({
  pane,
  role,
  authEmail,
  project,
  tree,
  presence,
  focused,
  isGuest,
  canUseTerminal,
  showSidebarButton,
  tocOpen,
  dropZone,
  registerHandle,
  registerElement,
  registerTabBar,
  onFocus,
  onActivate,
  onPin,
  onCloseTab,
  onReorder,
  onSetViewMode,
  onChangeContent,
  onOpenLink,
  onOpenHistory,
  onOpenAgent,
  onSetTocOpen,
  onOpenSidebar,
  onTabDragMove,
  onTabDrop,
}: EditorPaneProps) {
  const activeTab = pane.tabs.find((t) => t.path === pane.activePath) ?? null
  const editorRef = useRef<EditorHandle>(null)
  const codePaneRef = useRef<CodePaneHandle>(null)
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const scrollHostRef = useRef<HTMLDivElement | null>(null)

  const collab = useCollab(project, primaryCollabPath(activeTab, role), authEmail)

  // 하단 상태줄 — 파일 종류를 가리지 않아야 하므로 뷰어(Editor)가 아니라 칸이 그린다.
  const [selChars, setSelChars] = useState(0)
  const activePath = activeTab?.path ?? null
  useEffect(() => setSelChars(0), [activePath]) // 탭을 바꾸면 앞 문서의 선택 수가 남는다
  // 미디어(바이너리)는 본문을 받아오지 않는다 — 크기는 /raw HEAD의 Content-Length로 묻는다
  const mediaPath = activeTab && mediaKind(activeTab.path) ? activeTab.path : null
  const [mediaBytes, setMediaBytes] = useState<number | null>(null)
  useEffect(() => {
    setMediaBytes(null)
    if (!mediaPath) return
    let alive = true
    fetch(rawUrl(mediaPath), { method: 'HEAD' })
      .then((res) => {
        const len = Number(res.headers.get('content-length'))
        if (alive && Number.isFinite(len)) setMediaBytes(len)
      })
      .catch(() => {}) // 크기를 못 구하면 상태줄에서 빼는 것으로 충분하다
    return () => {
      alive = false
    }
  }, [mediaPath])
  // 저장된 파일이 아니라 지금 화면의 본문 기준이라 타이핑하는 대로 움직인다
  const textBytes = useMemo(
    () => (activeTab && !mediaPath ? new TextEncoder().encode(activeTab.content).length : null),
    [activeTab?.content, mediaPath],
  )
  const fileBytes = mediaPath ? mediaBytes : textBytes

  // ── 파일 댓글 ────────────────────────────────────────────────────────────────
  // 스레드는 서버(`<프로젝트>/.mew/comments.json`)에 있고 이 칸은 **지금 문서의 것만** 들고 있다.
  // 본문에는 아무것도 남기지 않는다 — 하이라이트는 에디터가 앵커를 다시 풀어 그리는 장식이다.
  // 미디어·SVG 미리보기처럼 텍스트 편집기가 없는 화면과 게스트에게는 아예 뜨지 않는다.
  const isTextPane =
    !!activeTab && !mediaKind(activeTab.path) && !(activeTab.path.endsWith('.svg') && activeTab.viewMode === 'hotview')
  const canComment = !isGuest && isTextPane
  const canCommentRef = useRef(canComment)
  canCommentRef.current = canComment
  const [threads, setThreads] = useState<CommentThread[]>([])
  const [members, setMembers] = useState<string[]>([])
  const [commentPopup, setCommentPopup] = useState<CommentPopup>(null)
  const [commentListOpen, setCommentListOpen] = useState(false)
  // 다른 사람이 남긴 댓글도 바로 뜨게 — presence의 {type:'comments'} 신호를 받아 다시 읽는다
  const reloadThreads = useRef<() => void>(() => {})

  useEffect(() => {
    if (!canComment || !activePath) {
      setThreads([])
      return
    }
    let alive = true
    const load = () => {
      fetchComments(activePath, project)
        .then((list) => {
          if (alive) setThreads(list)
        })
        .catch(() => {}) // 못 읽으면 하이라이트만 없는 것 — 편집을 막지는 않는다
    }
    reloadThreads.current = load
    load()
    const onSignal = (e: Event) => {
      if ((e as CustomEvent<{ type?: string }>).detail?.type === 'comments') load()
    }
    window.addEventListener('mew:signal', onSignal)
    return () => {
      alive = false
      window.removeEventListener('mew:signal', onSignal)
    }
  }, [canComment, activePath, project])

  // 멘션 자동완성용 계정 목록 — 바뀌는 일이 드물어 칸이 뜰 때 한 번만 읽는다
  useEffect(() => {
    if (isGuest) return
    fetchMembers()
      .then(setMembers)
      .catch(() => {})
  }, [isGuest])

  useEffect(() => setCommentPopup(null), [activePath]) // 탭을 바꾸면 앞 문서의 팝업이 남는다

  /** 지금 화면의 텍스트 편집기 — 앵커를 만들고 되찾는 쪽. hotview·plain이 같은 두 메서드를 낸다 */
  const commentPane = (): Pick<EditorHandle, 'getCommentAnchor' | 'revealCommentAnchor'> | null =>
    activeTabRef.current?.viewMode === 'plain' ? codePaneRef.current : editorRef.current

  const commentPath = () => activeTabRef.current?.path ?? null

  const failComment = (err: unknown) => console.error(err) // 서버가 이유를 주지만 팝업을 붙들 만큼은 아니다

  const submitThread = (anchor: CommentAnchor, text: string) => {
    const path = commentPath()
    if (!path) return
    setCommentPopup(null)
    postComment(path, { anchor, text }, project).then(() => reloadThreads.current(), failComment)
  }

  const submitReply = (threadId: string, text: string) => {
    const path = commentPath()
    if (!path) return
    postComment(path, { threadId, text }, project).then(() => reloadThreads.current(), failComment)
  }

  const submitEdit = (threadId: string, commentId: string, text: string) => {
    const path = commentPath()
    if (!path) return
    updateComment(path, threadId, commentId, text, project).then(() => reloadThreads.current(), failComment)
  }

  const submitDelete = (threadId: string, commentId: string) => {
    const path = commentPath()
    if (!path) return
    deleteComment(path, threadId, commentId, project).then((thread) => {
      if (!thread) setCommentPopup(null) // 마지막 댓글이었다 — 스레드째 사라졌으니 팝업도 닫는다
      reloadThreads.current()
    }, failComment)
  }

  /** 본문에서 자리를 못 찾았을 때 화면에 적을 말 — 대개 다른 보기 모드에서 단 댓글이다(ADR 0049) */
  const lostAnchorNotice = (): string => {
    const tab = activeTabRef.current
    const other = tab?.path.endsWith('.md') ? (tab.viewMode === 'plain' ? 'Hotview' : 'Plain') : null
    return other
      ? `본문에서 이 댓글의 자리를 찾지 못했습니다 — ${other} 보기에서 달았거나 그 부분이 바뀐 댓글입니다`
      : '본문에서 이 댓글의 자리를 찾지 못했습니다 — 그 부분이 바뀌었거나 지워졌습니다'
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
   * 고른 글자에 새 댓글 — Alt+Shift+C와 모바일 보조키의 댓글 아이콘이 같이 쓴다.
   * 선택이 비어 있으면 앵커가 null이라 아무 일도 하지 않는다(보조키 아이콘도 그때는 안 뜬다, ADR 0051).
   */
  const startComment = () => {
    if (!canCommentRef.current) return
    const anchor = commentPane()?.getCommentAnchor()
    if (!anchor) return
    const { x, y } = selectionPoint(scrollHostRef.current)
    setCommentPopup({ kind: 'compose', anchor, x, y })
  }
  // 손잡이(handle)는 한 번만 만들어지므로 최신 함수를 ref로 읽는다
  const startCommentRef = useRef(startComment)
  startCommentRef.current = startComment

  const openThread = (id: string, x: number, y: number) => setCommentPopup({ kind: 'thread', id, x, y })
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
        if (tab?.path !== path || tab.viewMode !== 'plain' || !codePaneRef.current) return false
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
      if (!(el instanceof HTMLElement) || !el.matches('.editor-root, .cm-scroller')) return
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
    const top = getScroll(project, tab.path)
    if (top === null) return
    restoringRef.current = true
    let raf = 0
    let tries = 0
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    const stop = () => {
      restoringRef.current = false
      cancelAnimationFrame(raf)
      for (const ev of events) host.removeEventListener(ev, stop, true)
    }
    disarmRestoreRef.current = stop
    const attempt = () => {
      if (activeTabRef.current?.path !== tab.path) return stop() // 탭을 바꿨으면 그만둔다
      const el = host.querySelector<HTMLElement>('.editor-root, .cm-scroller')
      // ponytail: 복원 지점 아래에서 늦게 뜨는 이미지가 있으면 위치가 밀릴 수 있다 — 문제되면 높이 안정 감지로
      if (el && el.scrollHeight >= top + el.clientHeight && Math.abs(el.scrollTop - top) > 1) el.scrollTop = top
      if (++tries < 600) raf = requestAnimationFrame(attempt) // 최대 ~10초 — collab 동기화가 늦어도 따라붙는다
      else stop()
    }
    for (const ev of events) host.addEventListener(ev, stop, true)
    attempt()
    return stop
  }, [pane.activePath, project])

  // 화면 위 40% 스와이프 = 탭 전환, 아래 20% = 창(사이드바·터미널) 전환, 가운데 40%는 제스처 없음
  // 구역 안에서는 스크롤 위치를 따지지 않고 바로 전환한다 — 긴 줄을 가로로 끄는 손짓은 가운데
  // 40%(제스처 없는 구역)의 몫이라, "맨 끝에 닿아야 통과" 규칙을 둘 이유가 없다.
  const switchTab = (dir: 'left' | 'right') => {
    if (pane.tabs.length < 2 || !pane.activePath) return
    const idx = pane.tabs.findIndex((t) => t.path === pane.activePath)
    if (idx < 0) return
    const next = dir === 'left' ? (idx + 1) % pane.tabs.length : (idx - 1 + pane.tabs.length) % pane.tabs.length
    onActivate(pane.tabs[next].path)
  }

  const swipe = useSwipeGesture({
    onTopLeft: () => switchTab('left'),
    onTopRight: () => switchTab('right'),
    onBottomRight: onOpenSidebar,
    onBottomLeft: () => {
      if (canUseTerminal) onOpenAgent()
    },
  })

  const isMd = !!activeTab?.path.endsWith('.md')
  const isSvg = !!activeTab?.path.endsWith('.svg')

  return (
    <div onPointerDownCapture={onFocus} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* 포커스되지 않은 칸의 탭 줄은 흐리게 — 커밋·단축키가 어느 칸을 가리키는지 보이게 */}
      <div ref={(el) => registerTabBar(pane.id, el)} className={focused ? undefined : 'opacity-60'}>
        <TabBar
          tabs={pane.tabs}
          activePath={pane.activePath}
          presence={presence}
          onActivate={onActivate}
          onPin={onPin}
          onClose={onCloseTab}
          onReorder={onReorder}
          onDragMove={(path, x, y) => onTabDragMove(pane.id, path, x, y)}
          onDrop={(path, x, y) => onTabDrop(pane.id, path, x, y)}
        />
      </div>

      {/* 드롭 자리 판정은 **본문**만 본다 — 탭 줄 안에서 끄는 건 순서 바꾸기지 분할이 아니다 */}
      <div
        ref={(el) => {
          scrollHostRef.current = el
          registerElement(pane.id, el)
        }}
        className="relative flex min-h-0 flex-1"
      >
        {activeTab ? (
          <>
            {isArchivedPath(activeTab.path) && !isGuest && (
              <div className="absolute inset-x-0 top-0 z-10 bg-warning-surface px-4 py-1 text-center text-sm text-warning-ink">
                archives/ 문서는 불변입니다 — 편집이 차단되었습니다
              </div>
            )}
            <div className="relative flex min-w-0 flex-1 flex-col" {...swipe}>
              {showSidebarButton && (
                <div className="absolute left-3 top-3 z-20">
                  <SidebarOpenButton onClick={onOpenSidebar} />
                </div>
              )}
              {/* 에디터 우상단 도구 줄 — 히스토리·뷰 모드·목차는 md/svg 문서에만, 터미널은 파일 종류와
                  무관하게 뜬다. right-5는 에디터 오른쪽 스크롤바를 비켜 앉기 위한 여백 */}
              <div className="absolute right-5 top-3 z-20 flex items-start gap-2">
                {(isMd || isSvg) && (
                  <>
                    {!isGuest && (
                      <button
                        type="button"
                        onClick={onOpenHistory}
                        className="rounded border border-edge-strong bg-surface-raised p-1.5 text-ink-muted shadow-sm hover:bg-surface-hover"
                        title="히스토리"
                        aria-label="히스토리"
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
                        onClick={() => onSetViewMode(activeTab.path, 'hotview')}
                        className={`p-1.5 ${
                          activeTab.viewMode === 'hotview'
                            ? 'bg-accent text-ink-on-accent'
                            : 'bg-surface-raised text-ink-secondary hover:bg-surface-hover'
                        }`}
                        title={isSvg ? '이미지' : 'Hotview'}
                        aria-label={isSvg ? '이미지' : 'Hotview'}
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
                        onClick={() => onSetViewMode(activeTab.path, 'plain')}
                        className={`p-1.5 ${
                          activeTab.viewMode === 'plain'
                            ? 'bg-accent text-ink-on-accent'
                            : 'bg-surface-raised text-ink-secondary hover:bg-surface-hover'
                        }`}
                        title={isSvg ? '텍스트' : 'Plain'}
                        aria-label={isSvg ? '텍스트' : 'Plain'}
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
                {/* 댓글 목록 — 목차 버튼 **왼쪽**의 플로팅 버튼. 목차와 달리 md가 아니어도,
                    좁은 화면에서도 뜬다(댓글은 코드 파일에도 달린다). 팝업은 이 버튼 아래에 붙는다 */}
                {canComment && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setCommentListOpen((open) => !open)}
                      className={`rounded border border-edge-strong p-1.5 shadow-sm ${
                        commentListOpen ? 'bg-accent text-ink-on-accent' : 'bg-surface-raised text-ink-muted hover:bg-surface-hover'
                      }`}
                      title="댓글 목록 (Alt+Shift+C로 달기)"
                      aria-label="댓글 목록"
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
                      <CommentListPopover threads={threads} onPick={jumpToThread} onClose={() => setCommentListOpen(false)} />
                    )}
                  </div>
                )}
                {isMd && (
                  <button
                    type="button"
                    onClick={() => onSetTocOpen(!tocOpen)}
                    className={`hidden rounded border border-edge-strong p-1.5 shadow-sm lg:block ${
                      tocOpen ? 'bg-accent text-ink-on-accent' : 'bg-surface-raised text-ink-muted hover:bg-surface-hover'
                    }`}
                    title="목차"
                    aria-label="목차"
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
              <div className="relative min-h-0 flex-1">
                {mediaKind(activeTab.path) ? (
                  // key로 파일 전환 시 리마운트 — 이전 파일의 재생 상태가 남지 않게
                  <MediaViewer key={activeTab.path} path={activeTab.path} kind={mediaKind(activeTab.path)!} />
                ) : isSvg && activeTab.viewMode === 'hotview' ? (
                  <SvgPreview content={activeTab.content} />
                ) : activeTab.viewMode === 'plain' ? (
                  <CodePane
                    ref={codePaneRef}
                    path={activeTab.path}
                    value={activeTab.content}
                    onChange={(content) => onChangeContent(activeTab.path, content)}
                    readOnly={!activeTab.editable || isArchivedPath(activeTab.path)}
                    collab={collab}
                    commentThreads={threads}
                    onCommentClick={openThread}
                  />
                ) : (
                  <Editor
                    ref={editorRef}
                    value={activeTab.content}
                    api={editorApi}
                    onChange={(content) => onChangeContent(activeTab.path, content)}
                    readOnly={!activeTab.editable || isArchivedPath(activeTab.path)}
                    path={activeTab.path}
                    tree={tree}
                    onOpenLink={onOpenLink}
                    onSelectionChars={setSelChars}
                    collab={collab}
                    commentThreads={threads}
                    onCommentClick={openThread}
                    onStartComment={canComment && selChars > 0 ? startComment : undefined}
                  />
                )}
              </div>
              {/* 상태줄은 늘 떠 있다 — 가운데는 파일 크기, 오른쪽은 선택했을 때만 글자 수.
                  양옆 칸을 같은 flex-1로 둬야 가운데가 바 한가운데에 선다. */}
              <div className="flex shrink-0 items-center border-t border-edge bg-surface-deep px-2 py-0.5 text-[10px] leading-none text-ink-muted">
                <span className="flex-1" />
                <span>{fileBytes === null ? '' : formatBytes(fileBytes)}</span>
                <span className="flex-1 text-right">{selChars > 0 && `${selChars}자 선택`}</span>
              </div>
            </div>
            {tocOpen && isMd && (
              <TableOfContents
                content={activeTab.content}
                onJump={(i) => editorRef.current?.scrollToHeading(i)}
                onClose={() => onSetTocOpen(false)}
              />
            )}
            {/* 댓글 작성·스레드 보기 — 하이라이트나 커서 자리에 붙는 카드 하나. 둘이 동시에 뜨지 않는다 */}
            {commentPopup?.kind === 'compose' && (
              <CommentPopover x={commentPopup.x} y={commentPopup.y} onClose={() => setCommentPopup(null)}>
                <CommentComposer
                  quote={commentPopup.anchor.text}
                  members={members}
                  onSubmit={(text) => submitThread(commentPopup.anchor, text)}
                  onClose={() => setCommentPopup(null)}
                />
              </CommentPopover>
            )}
            {commentPopup?.kind === 'thread' && shownThread && (
              <CommentPopover x={commentPopup.x} y={commentPopup.y} onClose={() => setCommentPopup(null)}>
                <CommentThreadView
                  thread={shownThread}
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
          <div className="relative flex min-h-0 flex-1 items-center justify-center text-ink-secondary" {...swipe}>
            {/* 문서가 없어도 사이드바·터미널은 열 수 있어야 한다 — 도구 줄과 같은 자리 */}
            {showSidebarButton && (
              <div className="absolute left-3 top-3 z-20">
                <SidebarOpenButton onClick={onOpenSidebar} />
              </div>
            )}
            <div className="text-center">
              <div className="mb-2">왼쪽에서 문서를 선택하세요</div>
              {isGuest ? (
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
        {dropZone && <DropHint zone={dropZone} />}
      </div>
    </div>
  )
}
