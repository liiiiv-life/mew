import type { ReactNode } from 'react'

export function GuidanceRow({ label, inputId, hint, children }: { label: string; inputId?: string; hint?: ReactNode; children: ReactNode }) {
  return <div data-guidance-row className="grid grid-cols-[minmax(6rem,2fr)_minmax(0,3fr)] items-center gap-x-3 gap-y-1 py-0.5 text-xs sm:grid-cols-[10rem_minmax(0,1fr)]">
    {inputId
      ? <label data-guidance-label htmlFor={inputId} className="min-w-0 leading-5 text-ink-secondary">{label}</label>
      : <span data-guidance-label className="min-w-0 leading-5 text-ink-secondary">{label}</span>}
    <div data-guidance-control className="min-w-0">{children}</div>
    {hint && <div className="col-start-2 min-w-0 pb-1 text-xs leading-4 text-ink-secondary">{hint}</div>}
  </div>
}
