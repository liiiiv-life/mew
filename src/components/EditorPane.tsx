import { useEffect, useMemo, useRef } from 'react'
import { editorApi, isArchivedPath, type Role, type TreeNode } from '../api/client'
import { Editor, type EditorHandle } from '@mew/editor'
import { useSwipeGesture } from '@mew/mobile-keys'
import { CodePane, type CodePaneHandle } from './CodePane'
import { MediaViewer } from './MediaViewer'
import { SvgPreview } from './SvgPreview'
import { TableOfContents } from './TableOfContents'
import { TabBar } from './TabBar'
import { mediaKind } from '../utils/media'
import { useCollab } from '../hooks/useCollab'
import type { Pane, Tab } from '../hooks/useTabs'
import type { DropZone } from '../utils/paneTree'

/** 칸 바깥(App)에서 지금 포커스된 칸의 에디터를 건드릴 때 쓰는 손잡이 */
export interface PaneHandle {
  getSelectedText: () => string | null
  openSearch: (query?: string) => void
  revealLine: (line: number) => void
  /** 히스토리 되돌리기 — hotview(md)는 collab 문서가 진실 원천이라 에디터를 통해 갈아끼워야 한다 */
  setRawContent: (content: string) => void
}

// 실시간 협업은 파일별 "주 편집화면"에서만 지원한다 — .md는 Hotview, 그 외는 Plain.
// 게스트는 파일별 편집 허용이 있어도 collab 소켓 자체가 서버에서 막혀 있어 항상 로컬 편집으로 처리한다.
function primaryCollabPath(tab: Tab | null, role: Role): string | null {
  if (role === 'guest' || !tab || !tab.editable || isArchivedPath(tab.path) || mediaKind(tab.path)) return null
  const eligible = tab.path.endsWith('.md') ? tab.viewMode === 'hotview' : tab.viewMode === 'plain'
  return eligible ? tab.path : null
}

/** 에디터 우상단 도구 줄의 터미널 버튼 — 문서가 열려 있지 않을 때도 같은 자리에 뜬다 */
function TerminalOpenButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-edge-strong bg-surface-raised p-1.5 text-ink-muted shadow-sm hover:bg-surface-hover"
      title="터미널 (Ctrl+` / Alt+T)"
      aria-label="터미널 열기"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="m7 9 3 3-3 3" />
        <line x1="13" y1="15" x2="17" y2="15" />
      </svg>
    </button>
  )
}

/** 터미널 버튼 바로 아래 — 서버가 도는 기계의 CPU·메모리·GPU 현황 팝업 */
function SystemStatsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-edge-strong bg-surface-raised p-1.5 text-ink-muted shadow-sm hover:bg-surface-hover"
      title="시스템 자원 (CPU·메모리·GPU)"
      aria-label="시스템 자원 보기"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 14a8 8 0 0 1 8-8" />
        <path d="M4 14a8 8 0 0 1 3.5-6.6" />
        <path d="M12 14 8.5 9.5" />
        <path d="M4 14h16" />
        <path d="M3 18h18" />
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
  tmuxOpen: boolean
  /** 터미널·시스템 자원처럼 화면에 하나뿐인 버튼을 이 칸이 맡는지 (맨 끝 칸) */
  showGlobalTools: boolean
  tocOpen: boolean
  dropZone: DropZone | null
  registerHandle: (paneId: string, handle: PaneHandle | null) => void
  registerElement: (paneId: string, el: HTMLElement | null) => void
  onFocus: () => void
  onActivate: (path: string) => void
  onPin: (path: string) => void
  onCloseTab: (path: string) => void
  onReorder: (from: number, to: number) => void
  onSetViewMode: (path: string, viewMode: Tab['viewMode']) => void
  onChangeContent: (path: string, content: string) => void
  onOpenLink: (path: string) => void
  onOpenHistory: () => void
  onOpenTerminal: () => void
  onOpenSysStats: () => void
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
  tmuxOpen,
  showGlobalTools,
  tocOpen,
  dropZone,
  registerHandle,
  registerElement,
  onFocus,
  onActivate,
  onPin,
  onCloseTab,
  onReorder,
  onSetViewMode,
  onChangeContent,
  onOpenLink,
  onOpenHistory,
  onOpenTerminal,
  onOpenSysStats,
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

  const collab = useCollab(project, primaryCollabPath(activeTab, role), authEmail)

  // 손잡이는 항상 같은 객체다 — 안에서 ref로 지금 값을 읽으므로 탭이 바뀌어도 다시 등록할 일이 없다
  const handle = useMemo<PaneHandle>(
    () => ({
      getSelectedText: () => {
        const tab = activeTabRef.current
        if (!tab) return null
        if (tab.viewMode === 'plain') return codePaneRef.current?.getSelectedText() ?? null
        return editorRef.current?.getSelectedText() ?? null
      },
      openSearch: (query) => editorRef.current?.openSearch(query),
      revealLine: (line) => codePaneRef.current?.revealLine(line),
      setRawContent: (content) => editorRef.current?.setRawContent(content),
    }),
    [],
  )

  useEffect(() => {
    registerHandle(pane.id, handle)
    return () => registerHandle(pane.id, null)
  }, [pane.id, handle, registerHandle])

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
      if (canUseTerminal) onOpenTerminal()
    },
  })

  const isMd = !!activeTab?.path.endsWith('.md')
  const isSvg = !!activeTab?.path.endsWith('.svg')

  return (
    <div onPointerDownCapture={onFocus} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* 포커스되지 않은 칸의 탭 줄은 흐리게 — 커밋·단축키가 어느 칸을 가리키는지 보이게 */}
      <div className={focused ? undefined : 'opacity-60'}>
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
      <div ref={(el) => registerElement(pane.id, el)} className="relative flex min-h-0 flex-1">
        {activeTab ? (
          <>
            {isArchivedPath(activeTab.path) && !isGuest && (
              <div className="absolute inset-x-0 top-0 z-10 bg-warning-surface px-4 py-1 text-center text-sm text-warning-ink">
                archives/ 문서는 불변입니다 — 편집이 차단되었습니다
              </div>
            )}
            <div className="relative min-w-0 flex-1" {...swipe}>
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
                {isMd && !tocOpen && (
                  <button
                    type="button"
                    onClick={() => onSetTocOpen(true)}
                    className="hidden rounded border border-edge-strong bg-surface-raised p-1.5 text-ink-muted shadow-sm hover:bg-surface-hover lg:block"
                    title="목차 열기"
                    aria-label="목차 열기"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M9 6h12M9 12h12M9 18h12" />
                      <circle cx="4" cy="6" r="1" fill="currentColor" />
                      <circle cx="4" cy="12" r="1" fill="currentColor" />
                      <circle cx="4" cy="18" r="1" fill="currentColor" />
                    </svg>
                  </button>
                )}
                {canUseTerminal && showGlobalTools && (
                  <div className="flex flex-col gap-2">
                    {!tmuxOpen && <TerminalOpenButton onClick={onOpenTerminal} />}
                    <SystemStatsButton onClick={onOpenSysStats} />
                  </div>
                )}
              </div>
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
                  collab={collab}
                />
              )}
            </div>
            {tocOpen && isMd && (
              <TableOfContents
                content={activeTab.content}
                onJump={(i) => editorRef.current?.scrollToHeading(i)}
                onClose={() => onSetTocOpen(false)}
              />
            )}
          </>
        ) : (
          <div className="relative flex flex-1 items-center justify-center text-ink-secondary" {...swipe}>
            {/* 문서가 없어도 터미널은 열 수 있어야 한다 — 도구 줄과 같은 자리 */}
            {canUseTerminal && showGlobalTools && (
              <div className="absolute right-5 top-3 z-20 flex flex-col gap-2">
                {!tmuxOpen && <TerminalOpenButton onClick={onOpenTerminal} />}
                <SystemStatsButton onClick={onOpenSysStats} />
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
