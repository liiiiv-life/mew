import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
export function GitButton({ onClick, title = uiText("Git 열기") }: { onClick: () => void; title?: string }) {
  useUiLocale()
  return (
    <button type="button" onClick={onClick} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink" title={title} aria-label={title}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="6" cy="5" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="7" cy="19" r="2" />
        <path d="M6 7v10M8 8.5c3.5 0 4.5-1.5 8-1.5" />
      </svg>
    </button>
  )
}
