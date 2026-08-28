import { useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { IconPicker } from './IconPicker'
import { ProjectIcon } from './ProjectIcon'

function labelOf(projectPath: string): string {
  const parts = projectPath.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts.at(-1) || projectPath
}

export function RootProjectTabs({
  paths,
  activePath,
  fallbackLabel,
  canOpen,
  canChangeIcon,
  icons,
  onActivate,
  onIconChange,
  onOpen,
}: {
  paths: string[]
  activePath: string | null
  fallbackLabel: string
  canOpen: boolean
  canChangeIcon: boolean
  icons: Record<string, string>
  onActivate: (path: string) => void
  onIconChange: (path: string, icon: string) => void
  onOpen: () => void
}) {
  const { t } = useI18n()
  const unique = useMemo(() => [...new Set(paths)], [paths])
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const pressTimer = useRef<number | null>(null)
  const longPressed = useRef(false)

  function clearPressTimer() {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current)
    pressTimer.current = null
  }
  function saveIcon(path: string, icon: string) {
    onIconChange(path, icon)
  }
  return (
    <>
    <div data-project-tabs className="no-scrollbar flex h-full min-w-0 flex-1 items-stretch overflow-x-auto">
      {unique.length === 0 && (
        <div className="flex h-full shrink-0 items-center gap-1.5 border-r border-edge bg-surface-raised px-2.5 text-xs text-ink">
          <span className="flex h-5 w-5 items-center justify-center font-semibold">
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
            onClick={() => {
              if (longPressed.current) {
                longPressed.current = false
                return
              }
              onActivate(projectPath)
            }}
            onPointerDown={() => {
              if (!canChangeIcon) return
              clearPressTimer()
              longPressed.current = false
              pressTimer.current = window.setTimeout(() => {
                longPressed.current = true
                setEditingPath(projectPath)
              }, 500)
            }}
            onPointerUp={clearPressTimer}
            onPointerCancel={clearPressTimer}
            onPointerLeave={clearPressTimer}
            onContextMenu={(event) => {
              if (!canChangeIcon) return
              event.preventDefault()
              setEditingPath(projectPath)
            }}
            title={projectPath}
            className={`flex h-full shrink-0 items-center gap-1.5 border-r border-edge px-2.5 text-xs ${
              active ? 'bg-surface-raised text-ink' : 'bg-surface text-ink-secondary hover:bg-surface-raised'
            }`}
          >
            <span className="flex h-5 w-5 items-center justify-center font-semibold">
              {icons[projectPath] ? <ProjectIcon icon={icons[projectPath]} size={15} /> : (label[0]?.toUpperCase() || '/')}
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
          <span className="text-lg leading-none" aria-hidden="true">+</span>
          <span className="sr-only">{t('project.newTab')}</span>
        </button>
      )}
    </div>
    {editingPath && (
      <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4" onMouseDown={() => setEditingPath(null)}>
        <div className="w-full max-w-md rounded-lg border border-edge-bright bg-surface-raised p-3 shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
          <div className="mb-2 text-sm font-semibold text-ink">프로젝트 탭 아이콘</div>
          <IconPicker value={icons[editingPath] ?? ''} onChange={(icon) => { saveIcon(editingPath, icon); setEditingPath(null) }} />
        </div>
      </div>
    )}
    </>
  )
}
