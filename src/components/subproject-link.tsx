import type { ComponentProps } from 'react'
import { useI18n } from '../i18n'
import { ProjectIcon } from './ProjectIcon'

/** A project is a navigation boundary, with the same affordance at every depth. */
export function SubprojectLink({ name, icon = 'i:folder', unavailable = false, className = '', ...props }: ComponentProps<'button'> & {
  name: string
  icon?: string
  unavailable?: boolean
}) {
  const { t } = useI18n()
  return <button
    type="button"
    {...props}
    aria-disabled={unavailable || undefined}
    title={unavailable ? t('project.ownerOnly') : `${name} — ${t('project.openTab')}`}
    className={`flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm font-medium text-ink-secondary focus-visible:outline-2 focus-visible:outline-accent ${unavailable ? 'opacity-60' : 'hover:bg-surface-raised hover:text-ink'} ${className}`}
    onClick={event => { if (!unavailable) props.onClick?.(event) }}
  >
    <ProjectIcon icon={icon} size={16} />
    <span className="min-w-0 flex-1 truncate">{name}</span>
    <svg className="shrink-0 text-ink-muted" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M7 17 17 7M7 7h10v10" />
    </svg>
  </button>
}
