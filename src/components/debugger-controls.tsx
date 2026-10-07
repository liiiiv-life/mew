import { useState, type ReactNode } from 'react'
import { NavArrowRight } from 'iconoir-react'
import { debugButton, debugPrimaryButton } from './debugger-helpers'

export function DebugAction({ label, disabled, onClick, children, primary = false, compact = false, pressed }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode; primary?: boolean; compact?: boolean; pressed?: boolean }) {
  const style = primary ? debugPrimaryButton : compact ? debugButton.replace('h-8 w-8', 'h-6 w-6') : debugButton
  return <button type="button" className={`${style} ${pressed ? 'text-accent' : ''}`} aria-label={label} aria-pressed={pressed} data-tip={label} disabled={disabled} onClick={onClick}><span aria-hidden="true" className="inline-flex items-center gap-1.5">{children}</span></button>
}

export function DebugSection({ title, count, open, children, onToggle, meta, className = '' }: { title: string; count?: number; open?: boolean; children: ReactNode; onToggle?: (open: boolean) => void; meta?: ReactNode; className?: string }) {
  const [expanded, setExpanded] = useState(!!open)
  return <details open={open || undefined} className={`min-w-0 border-b border-edge ${className}`} onToggle={e => { setExpanded(e.currentTarget.open); onToggle?.(e.currentTarget.open) }}>
    <summary aria-label={title} className="flex min-h-8 min-w-0 cursor-pointer list-none items-center gap-1.5 px-2 py-1 text-xs font-medium text-ink hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
      <NavArrowRight width={12} height={12} aria-hidden="true" className={`shrink-0 text-ink-secondary ${expanded ? 'rotate-90' : ''}`} />
      <span className="min-w-0 truncate">{title}</span>
      {count !== undefined && <span className="tabular-nums text-ink-secondary">{count}</span>}
      {meta && <span className="ml-auto min-w-0 truncate font-normal text-ink-secondary">{meta}</span>}
    </summary>
    <div className="min-w-0 space-y-1 px-2 pb-2 pt-1">{children}</div>
  </details>
}
