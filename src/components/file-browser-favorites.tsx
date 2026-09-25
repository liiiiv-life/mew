import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Cloud, Folder, HomeSimple, RefreshDouble, Star, Xmark, NavArrowDown } from 'iconoir-react'
import { createPortal } from 'react-dom'
import { useOverlayDismiss } from '@mew/ui'
import { fetchFileFavorites, setFileFavorite, FILE_FAVORITES_CHANGED } from '../api/client'
import { useI18n } from '../i18n'
import type { FileFavorite } from '../../shared/file-favorites'

export function FileBrowserFavorites({ currentPath, disabled, onSelect }: {
  currentPath?: string; disabled: boolean; onSelect: (path: string) => void
}) {
  const { t } = useI18n()
  const id = useId()
  const [folders, setFolders] = useState<FileFavorite[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const sequence = useRef(0)
  const savingRef = useRef(false)
  const refresh = useCallback(async () => {
    const request = ++sequence.current
    setLoading(true)
    setError(null)
    try {
      const result = await fetchFileFavorites()
      if (request === sequence.current) { setFolders(result.folders); setLoaded(true) }
    } catch (err) {
      if (request === sequence.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (request === sequence.current) setLoading(false)
    }
  }, [])
  const invalidate = useCallback(() => { sequence.current++ }, [])
  useEffect(() => { void refresh(); return invalidate }, [refresh, invalidate])
  useEffect(() => {
    const changed = () => { void refresh() }
    window.addEventListener(FILE_FAVORITES_CHANGED, changed)
    return () => window.removeEventListener(FILE_FAVORITES_CHANGED, changed)
  }, [refresh])

  const change = async (path: string, favorite: boolean) => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    const request = sequence.current
    try {
      await setFileFavorite(path, favorite)
    } catch (err) {
      if (request === sequence.current) setError(err instanceof Error ? err.message : String(err))
    } finally { savingRef.current = false; setSaving(false) }
  }
  const label = (folder: FileFavorite) => {
    const name = folder.kind === 'custom' || folder.kind === 'cloud' ? folder.name : t(`favorites.${folder.kind}`)
    return folder.account ? `${name} · ${folder.account}` : name
  }
  const names = new Map<string, number>()
  for (const folder of folders) names.set(label(folder), (names.get(label(folder)) ?? 0) + 1)
  const active = folders.some(folder => folder.path === currentPath)
  const locked = disabled || saving || loading

  return <section aria-labelledby={id} aria-busy={loading || saving} className="mb-2 shrink-0 border-b border-edge px-3 pb-2 sm:px-4">
    <div className="flex min-h-8 items-center gap-1">
      <FavoritesDropdown id={id} label={t('favorites.title')} disabled={disabled}>
        {close => loading && !loaded ? <p role="status" className="px-3 py-2 text-xs text-ink-secondary">{t('common.loading')}</p>
          : folders.length === 0 ? <p className="px-3 py-2 text-xs text-ink-secondary">{t('favorites.empty')}</p>
          : folders.map(folder => {
            const name = label(folder)
            const duplicate = names.get(name)! > 1
            const fullName = duplicate ? `${name} (${folder.path})` : name
            const Icon = folder.kind === 'cloud' ? Cloud : folder.kind === 'home' || folder.kind === 'wsl-home' ? HomeSimple : Folder
            return <div key={folder.path} className={`flex min-w-0 items-center rounded-md ${folder.path === currentPath ? 'bg-surface-hover' : ''}`}>
              <button type="button" disabled={disabled || saving} onClick={() => { close(); onSelect(folder.path) }} title={folder.path} aria-label={t('favorites.go', { name: fullName })} className="inline-flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-ink hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">
                <Icon width={15} height={15} className="shrink-0 text-ink-secondary" />
                <span className="min-w-0"><span className="block truncate">{name}</span><span className="block break-all text-ink-secondary">{folder.path}</span></span>
              </button>
              <button type="button" disabled={locked} onClick={() => { close(); void change(folder.path, false) }} aria-label={t('favorites.remove', { name: fullName })} title={t('favorites.remove', { name: fullName })} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"><Xmark width={15} height={15} /></button>
            </div>
          })}
      </FavoritesDropdown>
      <button type="button" disabled={locked || !loaded || !currentPath} aria-pressed={active} onClick={() => { if (currentPath) void change(currentPath, !active) }} className="ml-auto inline-flex min-h-8 min-w-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs text-ink-secondary hover:bg-surface-hover disabled:opacity-40" title={t(active ? 'favorites.unpinCurrent' : 'favorites.pinCurrent')} aria-label={t(active ? 'favorites.unpinCurrent' : 'favorites.pinCurrent')}><Star width={15} height={15} fill={active ? 'currentColor' : 'none'} /><span>{t(active ? 'favorites.saved' : 'favorites.pin')}</span></button>
      <button type="button" disabled={locked} onClick={() => void refresh()} aria-label={t('favorites.refresh')} title={t('favorites.refresh')} className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-hover disabled:opacity-40"><RefreshDouble width={15} height={15} /></button>
    </div>
    {error && <p role="alert" className="select-text mt-1 break-words text-xs text-danger-ink">{t('favorites.failed')} {error}</p>}
  </section>
}

/** A composite disclosure: navigation and removal stay separate keyboard controls. */
function FavoritesDropdown({ id, label, disabled, children }: {
  id: string; label: string; disabled: boolean; children: (close: () => void) => ReactNode
}) {
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const expanded = open && !disabled
  const close = useCallback(() => { setOpen(false); trigger.current?.focus({ preventScroll: true }) }, [])
  useOverlayDismiss(expanded && close)
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  useLayoutEffect(() => {
    if (!expanded) return
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect(), viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight
      const below = top + height - rect.bottom - 8, above = rect.top - top - 8
      const down = below >= Math.min(280, above)
      const popupWidth = Math.min(360, width - 16)
      setPosition({ width: popupWidth, left: Math.max(left + 8, Math.min(rect.left, left + width - popupWidth - 8)),
        maxHeight: Math.max(0, Math.min(280, down ? below : above)),
        ...(down ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }) })
    }
    const outside = (event: PointerEvent) => {
      if (trigger.current?.contains(event.target as Node) || menu.current?.contains(event.target as Node)) return
      event.preventDefault()
      event.stopPropagation()
      close()
      // Consume the associated click too, so the same gesture cannot close the parent dialog.
      const swallow = (click: MouseEvent) => { click.preventDefault(); click.stopPropagation(); clear() }
      const clear = () => {
        document.removeEventListener('click', swallow, true)
        document.removeEventListener('pointerdown', clear, true)
        clearTimeout(timer)
      }
      document.addEventListener('click', swallow, { capture: true, once: true })
      document.addEventListener('pointerdown', clear, { capture: true, once: true })
      const timer = setTimeout(clear, 1000)
    }
    const focusOutside = (event: FocusEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false)
    }
    place()
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', focusOutside)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', focusOutside)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [expanded, close])
  const positioned = position !== null
  useEffect(() => {
    if (expanded && positioned) menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  }, [expanded, positioned])
  return <>
    <button ref={trigger} id={id} type="button" disabled={disabled} aria-expanded={expanded} aria-controls={expanded ? `${id}-list` : undefined}
      onClick={() => expanded ? close() : setOpen(true)} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) }
      }} className="inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">
      <Star width={15} height={15} /><span>{label}</span><NavArrowDown width={14} height={14} className={expanded ? 'rotate-180' : ''} />
    </button>
    {expanded && position && createPortal(<div ref={menu} id={`${id}-list`} role="group" aria-label={label} style={position}
      className="fixed z-[1201] overflow-y-auto overscroll-contain rounded-lg border border-edge-bright bg-surface-raised p-1 shadow-lg"
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        const items = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        const current = items.indexOf(document.activeElement as HTMLButtonElement)
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        items[index]?.focus()
      }}>{children(close)}</div>, trigger.current?.closest('.mew-dialog') ?? document.body)}
  </>
}
