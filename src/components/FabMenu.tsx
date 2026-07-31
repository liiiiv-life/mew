// 모바일·편집 모드 전용 우하단 플로팅 버튼 — 전체화면만 남았다
// (터미널은 에디터 우상단 도구 줄로, 테마는 설정 창으로 옮겼다)
export function FabMenu({ onFullscreen }: { onFullscreen: () => void }) {
  return (
    <div className="fixed right-4 bottom-4 z-40">
      <button
        type="button"
        onClick={onFullscreen}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-raised text-ink-bright shadow-lg hover:bg-surface-hover"
        title="전체화면 (Alt+Enter)"
        aria-label="전체화면 토글"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
          <path d="M3 16v3a2 2 0 0 0 2 2h3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      </button>
    </div>
  )
}
