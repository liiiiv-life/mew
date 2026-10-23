import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, Plus, Xmark } from 'iconoir-react'
import { ActionMenu, ActionMenuItem, ActionMenuSeparator, DialogFrame } from '@mew/ui'
import { projectTabIndex } from '@mew/shortcuts'
import { useI18n } from '../i18n'
import { ProjectIcon } from './ProjectIcon'

const IconPicker = lazy(() => import('./IconPicker').then(module => ({ default: module.IconPicker })))

function labelOf(projectPath: string): string {
  const parts = projectPath.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts.at(-1) || projectPath
}

export function ProjectSwitcher({ paths, activePath, fallbackLabel, canOpen, canChangeIcon, icons, onActivate, onIconChange, onOpen, onPreview }: {
  paths: string[]
  activePath: string | null
  fallbackLabel: string
  canOpen: boolean
  canChangeIcon: boolean
  icons: Record<string, string>
  onActivate: (path: string) => void
  onIconChange: (path: string, icon: string) => void
  onOpen: () => void
  onPreview?: (path: string) => void
}) {
  const { t } = useI18n()
  const trigger = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const iconTitleId = useId()
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  const suppressClickUntil = useRef(0)
  const label = activePath ? labelOf(activePath) : fallbackLabel
  const labels = useMemo(() => {
    const counts = new Map<string, number>()
    for (const path of paths) counts.set(labelOf(path), (counts.get(labelOf(path)) ?? 0) + 1)
    return counts
  }, [paths])

  function cancelHold() {
    if (hold.current) clearTimeout(hold.current.timer)
    hold.current = null
  }
  function editIcon(path: string) {
    cancelHold()
    setMenu(null)
    trigger.current?.focus({ preventScroll: true })
    setEditingPath(path)
  }
  function openMenu() {
    if (!canOpen || !trigger.current) return
    const box = trigger.current.getBoundingClientRect()
    setMenu({ x: box.left, y: box.bottom + 4 })
  }

  useEffect(() => {
    const select = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !canOpen) return
      const index = projectTabIndex(event)
      if (index === null) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const target = event.target instanceof Element ? event.target : document.activeElement
      if (event.repeat || target?.closest('[role="dialog"], [aria-modal="true"]')) return
      const path = paths[index]
      if (path && path !== activePath) { setMenu(null); onActivate(path) }
    }
    window.addEventListener('keydown', select, true)
    return () => window.removeEventListener('keydown', select, true)
  }, [paths, activePath, canOpen, onActivate])

  useEffect(() => {
    setMenu(null)
    cancelHold()
  }, [activePath, canOpen, canChangeIcon])
  useEffect(() => {
    window.addEventListener('blur', cancelHold)
    window.addEventListener('resize', cancelHold)
    document.addEventListener('visibilitychange', cancelHold)
    return () => {
      cancelHold()
      window.removeEventListener('blur', cancelHold)
      window.removeEventListener('resize', cancelHold)
      document.removeEventListener('visibilitychange', cancelHold)
    }
  }, [])

  const content = <>
    <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true"><ProjectIcon icon={activePath ? icons[activePath] ?? 'i:folder' : 'i:folder'} size={15} /></span>
    <span className="max-w-[min(18rem,50vw)] truncate">{label}</span>
  </>

  return <>
    <div data-project-switcher-container className="flex h-full min-w-0 items-stretch">
      {canOpen || canChangeIcon ? <button ref={trigger} type="button" data-project-switcher data-current-project={activePath ?? ''}
        aria-label={canOpen ? `${label} — ${t('project.choose')}` : label} aria-haspopup={canOpen ? 'menu' : undefined} aria-expanded={canOpen ? !!menu : undefined}
        title={activePath ?? label} className="flex h-full min-w-0 select-none items-center gap-1.5 px-2.5 text-xs text-ink hover:bg-surface-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        style={{ WebkitTouchCallout: 'none' }}
        onClick={() => { if (Date.now() >= suppressClickUntil.current) openMenu() }}
        onContextMenu={event => { if (canChangeIcon && activePath) { event.preventDefault(); editIcon(activePath) } }}
        onKeyDown={event => {
          if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && canChangeIcon && activePath) {
            event.preventDefault(); editIcon(activePath)
          } else if (canOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); openMenu() }
        }}
        onPointerDown={event => {
          cancelHold()
          if (!canChangeIcon || !activePath || event.pointerType === 'mouse' || !event.isPrimary) return
          const path = activePath
          hold.current = { x: event.clientX, y: event.clientY, timer: setTimeout(() => {
            suppressClickUntil.current = Date.now() + 1000
            editIcon(path)
          }, 550) }
        }}
        onPointerMove={event => { if (hold.current && Math.hypot(event.clientX - hold.current.x, event.clientY - hold.current.y) > 10) cancelHold() }}
        onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold}>
        {content}
      </button> : <div data-project-switcher data-current-project={activePath ?? ''} title={activePath ?? label} className="flex h-full min-w-0 items-center gap-1.5 px-2.5 text-xs text-ink">{content}</div>}
    </div>
    {canOpen && menu && <ActionMenu variant="header" x={menu.x} y={menu.y} label={t('project.choose')} trigger={trigger.current} onClose={() => setMenu(null)}>
      {paths.map(path => <ActionMenuItem key={path} data-project-option={path} title={path} role="menuitemradio" checked={path === activePath}
        icon={<span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true"><ProjectIcon icon={icons[path] ?? 'i:folder'} size={16} /></span>}
        hint={<span className="flex h-4 w-4 items-center justify-center">{path === activePath && <Check aria-hidden="true" />}</span>}
        onPointerEnter={() => { if (path !== activePath) onPreview?.(path) }} onFocus={() => { if (path !== activePath) onPreview?.(path) }}
        onClick={() => { if (path !== activePath) onActivate(path) }}
        onContextMenu={event => { if (canChangeIcon) { event.preventDefault(); editIcon(path) } }}
        onKeyDown={event => { if (canChangeIcon && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) { event.preventDefault(); editIcon(path) } }}>
        <span className="min-w-0 flex-1 text-left"><span className="block truncate">{labelOf(path)}</span>
          {(labels.get(labelOf(path)) ?? 0) > 1 && <span className="block truncate text-[10px] text-ink-muted">{path}</span>}
        </span>
      </ActionMenuItem>)}
      {paths.length > 0 && <ActionMenuSeparator />}
      <ActionMenuItem icon={<Plus />} onClick={onOpen}>{t('project.add')}</ActionMenuItem>
    </ActionMenu>}
    {editingPath && canChangeIcon && <DialogFrame labelledBy={iconTitleId} onClose={() => setEditingPath(null)}>
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2"><h2 id={iconTitleId} className="text-sm font-semibold text-ink">{t('project.icon')}</h2>
          <button type="button" onClick={() => setEditingPath(null)} className="flex h-6 w-6 items-center justify-center text-ink-secondary hover:text-ink" aria-label={t('common.close')} data-tip={t('common.close')}><Xmark width={14} height={14} aria-hidden="true" /></button></div>
        <Suspense fallback={<div role="status" aria-label={t('common.loading')} className="h-52" />}>
          <IconPicker value={icons[editingPath] ?? ''} onChange={icon => { onIconChange(editingPath, icon); setEditingPath(null) }} />
        </Suspense>
      </div>
    </DialogFrame>}
  </>
}
