import { useMemo } from 'react'
import { useI18n } from '../i18n'

function labelOf(projectPath: string): string {
  const parts = projectPath.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts.at(-1) || projectPath
}

export function RootProjectTabs({
  paths,
  activePath,
  fallbackLabel,
  canOpen,
  onActivate,
  onOpen,
}: {
  paths: string[]
  activePath: string | null
  fallbackLabel: string
  canOpen: boolean
  onActivate: (path: string) => void
  onOpen: () => void
}) {
  const { t } = useI18n()
  const unique = useMemo(() => [...new Set(paths)], [paths])
  return (
    <div data-project-tabs className="no-scrollbar flex h-full min-w-0 flex-1 items-stretch overflow-x-auto">
      {unique.length === 0 && (
        <div className="flex h-full shrink-0 items-center gap-1.5 border-r border-edge bg-surface-raised px-2.5 text-xs text-ink">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-surface-deep font-semibold">
            {fallbackLabel[0]?.toUpperCase() || 'P'}
          </span>
          <span className="max-w-[10rem] truncate">{fallbackLabel}</span>
        </div>
      )}
      {unique.map((projectPath) => {
        const active = projectPath === activePath
        const label = labelOf(projectPath)
        return (
          <button
            key={projectPath}
            type="button"
            onClick={() => onActivate(projectPath)}
            title={projectPath}
            className={`flex h-full shrink-0 items-center gap-1.5 border-r border-edge px-2.5 text-xs ${
              active ? 'bg-surface-raised text-ink' : 'bg-surface text-ink-secondary hover:bg-surface-raised'
            }`}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded bg-surface-deep font-semibold">
              {label[0]?.toUpperCase() || '/'}
            </span>
            <span className={`max-w-[10rem] truncate ${active ? 'inline' : 'hidden md:inline'}`}>{label}</span>
          </button>
        )
      })}
      {canOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="flex h-full shrink-0 items-center border-r border-edge px-3 text-xs text-ink-secondary hover:bg-surface-raised hover:text-ink"
          title={`${t('project.open')} (Ctrl+O)`}
        >
          {t('project.newTab')}
        </button>
      )}
    </div>
  )
}
