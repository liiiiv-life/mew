import { useState } from 'react'

// 모바일·편집 모드 전용 우하단 플로팅 메뉴 — 전체화면/에이전트/터미널/테마 전환
export function FabMenu({
  theme,
  onFullscreen,
  onOpenAgent,
  onOpenTerminal,
  onToggleTheme,
}: {
  theme: 'dark' | 'light'
  onFullscreen: () => void
  onOpenAgent: () => void
  onOpenTerminal: () => void
  onToggleTheme: () => void
}) {
  const [open, setOpen] = useState(false)

  function run(action: () => void) {
    action()
    setOpen(false)
  }

  return (
    <>
      {open && <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />}
      <div className="fixed right-4 bottom-4 z-40 flex flex-col items-center gap-3">
        {open && (
          <>
            <button
              type="button"
              onClick={() => run(onFullscreen)}
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
            <button
              type="button"
              onClick={() => run(onOpenAgent)}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-raised text-ink-bright shadow-lg hover:bg-surface-hover"
              title="에이전트 채팅"
              aria-label="에이전트 채팅 열기"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => run(onOpenTerminal)}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-raised text-ink-bright shadow-lg hover:bg-surface-hover"
              title="터미널 (Ctrl+`)"
              aria-label="터미널 열기"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="m7 9 3 3-3 3" />
                <line x1="13" y1="15" x2="17" y2="15" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => run(onToggleTheme)}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-raised text-ink-bright shadow-lg hover:bg-surface-hover"
              title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
              aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
            >
              {theme === 'dark' ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-raised text-ink-bright shadow-lg hover:bg-surface-hover"
          title={open ? '닫기' : '메뉴'}
          aria-label={open ? '메뉴 닫기' : '메뉴 열기'}
        >
          {open ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          )}
        </button>
      </div>
    </>
  )
}
