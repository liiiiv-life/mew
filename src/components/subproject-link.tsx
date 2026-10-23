import type { ComponentProps } from 'react'
import { useI18n } from '../i18n'

/** Open a project without changing the adjacent folder expansion. */
export function SubprojectLink({ name, unavailable = false, className = '', ...props }: ComponentProps<'button'> & {
  name: string
  unavailable?: boolean
}) {
  const { t } = useI18n()
  return <button
    type="button"
    {...props}
    aria-label={`${name} — ${t('project.openTab')}`}
    data-tip={unavailable ? t('project.ownerOnly') : `${name} — ${t('project.openTab')}`}
    aria-disabled={unavailable || undefined}
    title={unavailable ? t('project.ownerOnly') : `${name} — ${t('project.openTab')}`}
    className={`mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-muted focus-visible:outline-2 focus-visible:outline-accent ${unavailable ? 'opacity-60' : 'hover:bg-surface-raised hover:text-ink'} ${className}`}
    onClick={event => { if (!unavailable) props.onClick?.(event) }}
  >
    <svg className="shrink-0 text-ink-muted" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M7 17 17 7M7 7h10v10" />
    </svg>
  </button>
}
