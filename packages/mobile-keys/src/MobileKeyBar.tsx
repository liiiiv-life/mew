// 모바일에서 입력 영역 아래에 항상 붙어 있는 보조키 바 (Termux의 extra keys 같은 역할).
// 키보드가 떠 있을 때만 쓰는 게 아니라 — 키보드를 내린 채 방향키로 스크롤하거나 Esc를 보내는 데도
// 쓰므로 — 띄울지 말지는 useMobileLayout(화면 폭)이 정한다.
// 이 컴포넌트는 Ctrl/Shift 토글 상태만 노출한다. 그 토글을 다음에 입력될 글자에 어떻게 결합할지는
// 호스트가 정한다 — 터미널은 onData를 가로채고, 에디터는 beforeinput을 가로채 단축키로 처리한다.
function KeyButton({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // 포커스(=키보드)를 안 뺏기게 — 버튼 탭이 blur를 유발하면 안 됨
      onClick={onClick}
      className={`flex h-6 min-w-6 shrink-0 items-center justify-center rounded px-1.5 text-[10px] leading-none font-medium ${
        active ? 'bg-accent text-ink-on-accent' : 'bg-surface-raised text-ink-secondary hover:bg-surface-hover'
      }`}
    >
      {label}
    </button>
  )
}

export function MobileKeyBar({
  ctrlActive,
  shiftActive,
  onToggleCtrl,
  onToggleShift,
  onEsc,
  onTab,
  onArrow,
  onComment,
  onCodeBlock,
  onTable,
  onUndo,
  onRedo,
}: {
  ctrlActive: boolean
  shiftActive: boolean
  onToggleCtrl: () => void
  onToggleShift: () => void
  onEsc: () => void
  onTab: () => void
  onArrow: (dir: 'up' | 'down' | 'left' | 'right') => void
  /** 주면 댓글 아이콘이 뜬다 — 선택(없으면 커서) 자리에 댓글을 단다. 폰에는 Alt+Shift+C가 없다 */
  onComment?: () => void
  /** 주면 코드블럭 아이콘이 뜬다 — 커서 문단을 코드블럭으로 바꾸거나 되돌린다(toggle). md 핫뷰만 넘긴다 */
  onCodeBlock?: () => void
  /** 주면 표 아이콘이 뜬다 — 슬래시 메뉴 '표'와 같은 3×3 표를 삽입한다. md 핫뷰만 넘긴다 */
  onTable?: () => void
  /** 주면 되돌리기 아이콘이 뜬다 — Ctrl+Z와 같은 경로(커서 보존)로 되돌린다 */
  onUndo?: () => void
  /** 주면 다시 실행 아이콘이 뜬다 — Ctrl+Y와 같은 경로로 다시 실행한다 */
  onRedo?: () => void
}) {
  return (
    // z-20 — 전체 화면 오버레이(사이드바·채팅·에이전트·터미널)는 z-30이다. 같은 z-30으로 두면
    // DOM 순서상 에디터가 사이드바보다 뒤라 보조키가 사이드바 위에 떠 버린다
    <div className="sticky bottom-0 z-20 flex shrink-0 items-center gap-0.5 overflow-x-auto border-t border-edge bg-surface-deep px-1.5 py-1">
      <KeyButton label="Esc" onClick={onEsc} />
      <KeyButton label="Tab" onClick={onTab} />
      <KeyButton label="Ctrl" active={ctrlActive} onClick={onToggleCtrl} />
      <KeyButton label="Shift" active={shiftActive} onClick={onToggleShift} />
      <div className="mx-0.5 h-3.5 w-px shrink-0 bg-edge" />
      <KeyButton label="←" onClick={() => onArrow('left')} />
      <KeyButton label="↑" onClick={() => onArrow('up')} />
      <KeyButton label="↓" onClick={() => onArrow('down')} />
      <KeyButton label="→" onClick={() => onArrow('right')} />
      {onComment && (
        <>
          <div className="mx-0.5 h-3.5 w-px shrink-0 bg-edge" />
          <button
            type="button"
            // 선택을 살려야 그 자리에 댓글이 붙는다 — 탭이 blur를 일으키면 선택이 풀린다
            onMouseDown={(e) => e.preventDefault()}
            onClick={onComment}
            className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded bg-surface-raised px-1.5 text-ink-secondary hover:bg-surface-hover"
            aria-label="선택한 곳에 댓글"
            title="선택한 곳에 댓글"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.2A8.5 8.5 0 0 1 4 11.5a8.38 8.38 0 0 1 8.5-8.4 8.38 8.38 0 0 1 8.5 8.4z" />
            </svg>
          </button>
        </>
      )}
      {(onCodeBlock || onTable) && (
        <>
          <div className="mx-0.5 h-3.5 w-px shrink-0 bg-edge" />
          {onCodeBlock && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onCodeBlock}
              className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded bg-surface-raised px-1.5 text-ink-secondary hover:bg-surface-hover"
              aria-label="코드블럭"
              title="코드블럭"
            >
              {/* 코드블럭 — 꺾쇠괄호 사이 빗금(lucide code) */}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </button>
          )}
          {onTable && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onTable}
              className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded bg-surface-raised px-1.5 text-ink-secondary hover:bg-surface-hover"
              aria-label="표 삽입"
              title="표 삽입"
            >
              {/* 표 — 테두리 안 헤더 행 + 열 구분선(lucide table) */}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
                <line x1="15" y1="21" x2="15" y2="9" />
              </svg>
            </button>
          )}
          {(onUndo || onRedo) && (
            <>
              <div className="mx-0.5 h-3.5 w-px shrink-0 bg-edge" />
              {onUndo && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={onUndo}
                  className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded bg-surface-raised px-1.5 text-ink-secondary hover:bg-surface-hover"
                  aria-label="되돌리기"
                  title="되돌리기"
                >
                  {/* 되돌리기 — 왼쪽으로 도는 화살표(lucide undo-2) */}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 14 4 9 9 4" />
                    <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
                  </svg>
                </button>
              )}
              {onRedo && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={onRedo}
                  className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded bg-surface-raised px-1.5 text-ink-secondary hover:bg-surface-hover"
                  aria-label="다시 실행"
                  title="다시 실행"
                >
                  {/* 다시 실행 — 오른쪽으로 도는 화살표(lucide redo-2, undo-2의 좌우 대칭) */}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 14 20 9 15 4" />
                    <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
                  </svg>
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
