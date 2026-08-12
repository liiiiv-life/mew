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
    </div>
  )
}
