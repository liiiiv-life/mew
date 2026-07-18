// 모바일 온스크린 키보드가 뜨면 그 바로 위에 붙는 보조키 바 (Termux의 extra keys 같은 역할).
// Ctrl/Shift는 이 바 안의 Tab·화살표 버튼에만 적용되는 토글 — 실제로 다음에 입력될 임의의 글자에
// 결합시키는 건(터미널 onData 가로채기 제외) contentEditable 쪽에서 신뢰성 있게 구현할 방법이 없다.
function KeyButton({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // 포커스(=키보드)를 안 뺏기게 — 버튼 탭이 blur를 유발하면 안 됨
      onClick={onClick}
      className={`flex h-9 min-w-9 shrink-0 items-center justify-center rounded px-2 text-xs font-medium ${
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
}: {
  ctrlActive: boolean
  shiftActive: boolean
  onToggleCtrl: () => void
  onToggleShift: () => void
  onEsc: () => void
  onTab: () => void
  onArrow: (dir: 'up' | 'down' | 'left' | 'right') => void
}) {
  return (
    <div className="sticky bottom-0 z-30 flex shrink-0 items-center gap-1 overflow-x-auto border-t border-edge bg-surface-deep px-2 py-1.5">
      <KeyButton label="Esc" onClick={onEsc} />
      <KeyButton label="Tab" onClick={onTab} />
      <KeyButton label="Ctrl" active={ctrlActive} onClick={onToggleCtrl} />
      <KeyButton label="Shift" active={shiftActive} onClick={onToggleShift} />
      <div className="mx-1 h-5 w-px shrink-0 bg-edge" />
      <KeyButton label="←" onClick={() => onArrow('left')} />
      <KeyButton label="↑" onClick={() => onArrow('up')} />
      <KeyButton label="↓" onClick={() => onArrow('down')} />
      <KeyButton label="→" onClick={() => onArrow('right')} />
    </div>
  )
}
