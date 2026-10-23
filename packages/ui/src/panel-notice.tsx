import type { ReactNode } from 'react'

export function PanelNotice({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'status' }) {
  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-30 flex justify-center">
      <div role={tone === 'error' ? 'alert' : 'status'} className={`pointer-events-auto max-h-24 max-w-[min(100%,22rem)] select-text overflow-y-auto overscroll-contain whitespace-pre-wrap rounded-md bg-surface/85 px-2.5 py-1.5 text-xs shadow-md backdrop-blur-sm [overflow-wrap:anywhere] ${tone === 'error' ? 'text-danger-ink' : 'text-ink-secondary'}`}>
        {children}
      </div>
    </div>
  )
}
