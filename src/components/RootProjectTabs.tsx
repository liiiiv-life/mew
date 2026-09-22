import { useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { DialogFrame } from '@mew/ui'
import { useI18n } from '../i18n'
import { IconPicker } from './IconPicker'
import { ProjectIcon } from './ProjectIcon'
import { useProjectTabGesture } from '../hooks/use-project-tab-gesture'
import { moveProjectTab, normalizeProjectTabLayout, projectTabDropZone, type ProjectTabDrop, type ProjectTabGroup, type ProjectTabLayout } from '../../shared/project-tab-groups'

function labelOf(projectPath: string): string {
  const parts = projectPath.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts.at(-1) || projectPath
}

export function RootProjectTabs({ paths, groups, activePath, fallbackLabel, canOpen, canChangeIcon, icons, onActivate, onClose, onIconChange, onOpen, onLayoutChange }: {
  paths: string[]
  groups?: ProjectTabGroup[]
  activePath: string | null
  fallbackLabel: string
  canOpen: boolean
  canChangeIcon: boolean
  icons: Record<string, string>
  onActivate: (path: string) => void
  onClose: (path: string) => void
  onIconChange: (path: string, icon: string) => void
  onOpen: () => void
  onLayoutChange?: (layout: ProjectTabLayout) => void
}) {
  const { t } = useI18n()
  const layout = useMemo(() => normalizeProjectTabLayout(paths, groups), [paths, groups])
  const byPath = useMemo(() => new Map(layout.groups.flatMap(g => g.paths.map(p => [p, g] as const))), [layout])
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const helpId = useId()
  const iconTitleId = useId()
  const canArrange = !!onLayoutChange && canOpen

  function move(path: string, target: ProjectTabDrop) {
    if (!canArrange) return
    onLayoutChange?.(moveProjectTab(layout, path, target, `group-${Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-')}`))
    setAnnouncement(t('project.tabsMoved'))
    requestAnimationFrame(() => {
      const button = Array.from(gesture.ref.current?.querySelectorAll<HTMLElement>('[data-project-drag]') ?? []).find(el => el.dataset.projectDrag === path)
      button?.focus({ preventScroll: true })
    })
  }
  function hitTest(x: number, y: number): ProjectTabDrop | null {
    if (!canArrange) return null
    const strip = gesture.ref.current
    const hit = document.elementFromPoint(x, y)
    if (!strip || !hit || !strip.contains(hit)) return null
    if (hit.closest('[data-project-drop-end]')) return { type: 'end' }
    const tab = hit.closest<HTMLElement>('[data-project-path]')
    if (tab?.dataset.projectPath) {
      const box = tab.getBoundingClientRect()
      const zone = projectTabDropZone(x, box.left, box.width)
      return zone === 'group' ? { type: 'group', path: tab.dataset.projectPath } : { type: 'insert', path: tab.dataset.projectPath, side: zone }
    }
    const container = hit.closest<HTMLElement>('[data-project-group]')
    const group = layout.groups.find(g => g.id === container?.dataset.projectGroup)
    if (container && group) {
      const box = container.getBoundingClientRect()
      if (x < box.left + 6) return { type: 'insert', path: group.paths[0], side: 'before', outsideGroup: true }
      if (x > box.right - 6) return { type: 'insert', path: group.paths.at(-1)!, side: 'after', outsideGroup: true }
      return { type: 'group', path: group.paths[0] }
    }
    return hit === strip ? { type: 'end' } : null
  }
  const gesture = useProjectTabGesture({
    enabled: canArrange || canChangeIcon,
    onMenu: path => { if (canChangeIcon) setEditingPath(path) },
    hitTest,
    onDrop: move,
  })
  const target = gesture.drag?.target
  const targetGroup = target && target.type !== 'end' ? byPath.get(target.path) : undefined
  const grouping = target?.type === 'group' && target.path !== gesture.drag?.path && !targetGroup?.paths.includes(gesture.drag?.path ?? '')
  const previewText = grouping ? t(targetGroup ? 'project.addToGroup' : 'project.createGroup') : t('project.moveTab')

  function tab(projectPath: string) {
    const active = projectPath === activePath
    const label = labelOf(projectPath)
    const labelVisible = active ? 'inline' : 'hidden md:inline'
    const insert = target?.type === 'insert' && target.path === projectPath && !target.outsideGroup && target.path !== gesture.drag?.path ? target.side : null
    const preview = grouping && target?.type === 'group' && target.path === projectPath && !targetGroup
    return (
      <div key={projectPath} data-project-path={projectPath}
        className={`relative flex h-full shrink-0 items-stretch border-r border-edge text-xs ${active ? 'bg-surface-raised text-ink' : 'bg-surface text-ink-secondary hover:bg-surface-raised'} ${gesture.drag?.path === projectPath ? 'opacity-40' : ''} ${preview ? 'z-10 bg-accent/15 outline-2 -outline-offset-2 outline-dashed outline-accent' : ''}`}>
        {insert && <span aria-hidden="true" className={`pointer-events-none absolute inset-y-1 z-10 w-0.5 rounded bg-accent ${insert === 'before' ? 'left-0' : 'right-0'}`} />}
        <button type="button" data-project-drag={projectPath} aria-current={active ? 'page' : undefined}
          aria-label={label} aria-describedby={canArrange ? helpId : undefined}
          onClick={() => { if (!gesture.consumeClick()) onActivate(projectPath) }}
          onContextMenu={event => {
            if (!canChangeIcon) return
            event.preventDefault()
            if (!gesture.isHolding()) setEditingPath(projectPath)
          }}
          onKeyDown={event => {
            if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && canChangeIcon) {
              event.preventDefault(); setEditingPath(projectPath); return
            }
            if (!canArrange || !event.altKey) return
            if (event.key === 'ArrowDown') { event.preventDefault(); move(projectPath, { type: 'end' }); return }
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const direction = event.key === 'ArrowLeft' ? -1 : 1
            const neighbor = layout.paths[layout.paths.indexOf(projectPath) + direction]
            if (neighbor) move(projectPath, event.shiftKey ? { type: 'group', path: neighbor } : { type: 'insert', path: neighbor, side: direction < 0 ? 'before' : 'after' })
          }}
          title={projectPath} className="flex h-full min-w-0 select-none items-center gap-1.5 px-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          style={{ WebkitTouchCallout: 'none' }}>
          <span className="flex h-5 w-5 items-center justify-center font-semibold" aria-hidden="true">
            {icons[projectPath] ? <ProjectIcon icon={icons[projectPath]} size={15} /> : (label[0]?.toUpperCase() || '/')}
          </span>
          <span className={`max-w-[10rem] truncate ${labelVisible}`}>{label}</span>
        </button>
        {layout.paths.length > 1 && <button type="button" onClick={() => { if (!gesture.consumeClick()) onClose(projectPath) }}
          className={`mr-1 flex h-full w-5 shrink-0 items-center justify-center text-sm text-ink-muted hover:text-ink ${labelVisible}`}
          title={`${label} ${t('common.close')}`} aria-label={`${label} ${t('common.close')}`}>×</button>}
      </div>
    )
  }

  return <>
    <div ref={gesture.ref} data-project-tabs className={`no-scrollbar flex h-full min-w-0 flex-1 items-stretch overflow-x-auto ${gesture.drag ? 'cursor-grabbing select-none' : ''}`}>
      {layout.paths.length === 0 && <div className="flex h-full shrink-0 items-center gap-1.5 border-r border-edge bg-surface-raised px-2.5 text-xs text-ink">
        <span className="flex h-5 w-5 items-center justify-center font-semibold">{fallbackLabel[0]?.toUpperCase() || 'P'}</span>
        <span className="max-w-[10rem] truncate">{fallbackLabel}</span>
      </div>}
      {layout.paths.map(projectPath => {
        const group = byPath.get(projectPath)
        if (!group) return tab(projectPath)
        if (group.paths[0] !== projectPath) return null
        const active = group.paths.includes(activePath ?? '')
        const preview = grouping && targetGroup?.id === group.id
        const outside = target?.type === 'insert' && target.outsideGroup && targetGroup?.id === group.id ? target.side : null
        return <div key={group.id} data-project-group={group.id} role="group" aria-label={group.paths.map(labelOf).join(', ')}
          className={`relative flex shrink-0 items-stretch rounded-md border px-1.5 ${preview ? 'border-accent bg-accent/15 outline-2 -outline-offset-2 outline-dashed outline-accent' : active ? 'border-accent/60 bg-accent/5' : 'border-edge-bright bg-surface-deep'}`}>
          {outside && <span aria-hidden="true" className={`pointer-events-none absolute inset-y-0 w-0.5 bg-accent ${outside === 'before' ? 'left-0' : 'right-0'}`} />}
          {group.paths.map(tab)}
        </div>
      })}
      {gesture.drag && canArrange && <div data-project-drop-end className={`flex h-full shrink-0 items-center border-x border-dashed px-3 text-xs ${target?.type === 'end' ? 'border-accent bg-accent/15 text-ink' : 'border-edge-bright text-ink-secondary'}`}>{t('project.outsideGroup')}</div>}
      {canOpen && <button type="button" onClick={onOpen} className="flex h-full shrink-0 items-center border-r border-edge px-3 text-xs text-ink-secondary hover:bg-surface-raised hover:text-ink" title={`${t('project.open')} (Ctrl+O)`}>
        <span className="text-lg leading-none" aria-hidden="true">+</span><span className="sr-only">{t('project.newTab')}</span>
      </button>}
    </div>
    <span id={helpId} className="sr-only">{t('project.arrangeHelp')}</span>
    <span role="status" className="sr-only">{gesture.drag ? previewText : announcement}</span>
    {gesture.drag && createPortal(<div aria-hidden="true" className="pointer-events-none fixed z-[1100] max-w-60 rounded-md bg-surface-raised px-3 py-2 text-xs text-ink shadow-lg"
      style={{ left: Math.max(8, Math.min(gesture.drag.x - 30, window.innerWidth - 248)), top: gesture.drag.y + 24 }}>
      <div className="truncate font-medium">{labelOf(gesture.drag.path)}</div>
      <div className="mt-1 text-ink-secondary">{previewText}</div>
    </div>, document.body)}
    {editingPath && <DialogFrame labelledBy={iconTitleId} onClose={() => setEditingPath(null)}>
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2"><h2 id={iconTitleId} className="text-sm font-semibold text-ink">{t('project.tabIcon')}</h2>
          <button type="button" onClick={() => setEditingPath(null)} className="px-2 py-1 text-sm text-ink-secondary hover:text-ink" aria-label={t('common.close')}>×</button></div>
        <IconPicker value={icons[editingPath] ?? ''} onChange={icon => { onIconChange(editingPath, icon); setEditingPath(null) }} />
      </div>
    </DialogFrame>}
  </>
}
