import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'iconoir-react'
import { HoverTipLayer, useOverlayDismiss } from '@mew/ui'
import { useI18n } from '../i18n'
import { changeLayoutPreset, layoutFingerprint, layoutIconRects, readLayoutPresets, type LayoutPreset, type LayoutSnapshot } from '../utils/layout-presets'

export function LayoutIcon({ layout, width = 32 }: { layout: LayoutSnapshot; width?: number }) {
  return <svg width={width} height={width * .75} viewBox="0 0 64 48" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    {layoutIconRects(layout).map((rect, index) => <rect key={index} x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx={1}
      fill={rect.role === 'popup' ? 'var(--color-surface-raised)' : 'currentColor'} fillOpacity={rect.role === 'popup' ? 1 : rect.role === 'editor' ? .16 : .06} />)}
  </svg>
}
function menuKeys(event: KeyboardEvent<HTMLElement>) {
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
  const index = buttons.indexOf(event.target as HTMLButtonElement)
  const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : direction ? (index + direction + buttons.length) % buttons.length : -1
  if (next >= 0) { event.preventDefault(); buttons[next]?.focus() }
}

export function LayoutPresets({ storageKey, legacyStorageKey, factory, capture, onApply }: {
  storageKey: string; legacyStorageKey?: string; factory: LayoutSnapshot; capture: () => LayoutSnapshot; onApply: (layout: LayoutSnapshot) => void
}) {
  const { t } = useI18n()
  const [presets, setPresets] = useState(() => readLayoutPresets(storageKey, factory, legacyStorageKey))
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const renameTarget = useRef<string | null>(null)
  const renameId = renaming?.id
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), menu = useRef<HTMLDivElement>(null)
  const [context, setContext] = useState<{ preset: LayoutPreset; x: number; y: number; trigger: HTMLButtonElement } | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const close = useCallback(() => { setOpen(false); setContext(null); setRenaming(null); setNotice(''); trigger.current?.focus() }, [])
  const contextRef = useRef(context)
  contextRef.current = context
  const closeContext = useCallback(() => { contextRef.current?.trigger.focus(); setContext(null) }, [])
  useOverlayDismiss(open && close)
  const cancelRename = useCallback(() => {
    setRenaming(null)
    Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('[data-layout-preset]') ?? []).find(button => button.dataset.layoutPreset === renaming?.id)?.focus()
  }, [renaming?.id])
  useOverlayDismiss(context && closeContext)
  useOverlayDismiss(renaming && cancelRename)
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect(), box = popup.current?.getBoundingClientRect()
      if (anchor && box) setPosition({ left: Math.max(8, Math.min(anchor.right - box.width, innerWidth - box.width - 8)), top: Math.min(anchor.bottom + 6, innerHeight - box.height - 8) })
    }
    place()
    if (renameId) { renameTarget.current = renameId; nameInput.current?.focus(); nameInput.current?.select() }
    else if (renameTarget.current) {
      Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('[data-layout-preset]') ?? []).find(button => button.dataset.layoutPreset === renameTarget.current)?.focus()
      renameTarget.current = null
    } else popup.current?.querySelector<HTMLButtonElement>('button')?.focus()
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [open, presets.length, notice, renameId, close])
  useLayoutEffect(() => {
    if (!context || !menu.current) return
    const box = menu.current.getBoundingClientRect()
    setMenuPosition({ left: Math.max(8, Math.min(context.x, innerWidth - box.width - 8)), top: Math.max(8, Math.min(context.y, innerHeight - box.height - 8)) })
    menu.current.querySelector<HTMLButtonElement>('button')?.focus()
  }, [context])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (menu.current?.contains(target)) return
      if (context) { if (!context.trigger.contains(target)) closeContext(); return }
      if (!popup.current?.contains(target) && !trigger.current?.contains(target)) close()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open, context, close, closeContext])
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || event.key !== storageKey && event.key !== null) return
      setPresets(readLayoutPresets(storageKey, factory, legacyStorageKey))
      setContext(null); setRenaming(null)
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [storageKey, factory, legacyStorageKey])
  const label = (preset: LayoutPreset) => preset.name || (preset.number === 0 ? t('layout.default') : t('layout.preset', { number: preset.number }))
  const save = (next: LayoutPreset[]) => {
    setPresets(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setNotice('') } catch { setNotice(t('layout.storageFailed')) }
  }
  const update = (layout: LayoutSnapshot, id?: string) => {
    const result = changeLayoutPreset(presets, layout, id)
    if (result.duplicate) setNotice(t('layout.duplicate'))
    else save(result.presets)
    closeContext()
  }
  const current = open ? capture() : factory
  const fingerprint = layoutFingerprint(current)
  return <>
    <button ref={trigger} type="button" aria-label={t('layout.label')} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(value => !value)}
      className={`flex h-9 items-center justify-center gap-2 rounded border border-edge-strong px-3 text-sm font-medium hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent ${open ? 'bg-surface-raised' : ''}`}>
      <LayoutIcon layout={factory} width={20} /><span>{t('layout.label')}</span>
    </button>
    {open && createPortal(<HoverTipLayer className="contents" placement="bottom">
      <div ref={popup} role="dialog" aria-label={t('layout.label')} onKeyDown={event => { if (!(event.target instanceof HTMLInputElement)) menuKeys(event) }} style={position}
        className="fixed z-[1050] max-h-[calc(100dvh-64px)] max-w-[calc(100vw-16px)] overflow-auto rounded-lg border border-edge-bright bg-surface-raised p-2 shadow-xl">
        <div className="grid grid-cols-4 gap-1">
          {presets.map(preset => <button key={preset.id} type="button" data-layout-preset={preset.id} aria-label={label(preset)} data-tip={label(preset)}
            aria-pressed={fingerprint === layoutFingerprint(preset.layout)}
            onClick={() => { onApply(preset.layout); close() }}
            onContextMenu={event => { event.preventDefault(); setNotice(''); setRenaming(null); setContext({ preset, x: event.clientX, y: event.clientY, trigger: event.currentTarget }) }}
            onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); setContext({ preset, x: box.left, y: box.bottom, trigger: event.currentTarget }) } }}
            className="flex min-w-16 flex-col items-center justify-center gap-1 rounded px-2 py-2 text-xs text-ink-secondary hover:bg-surface-hover aria-pressed:bg-surface-hover aria-pressed:text-ink focus-visible:outline-2 focus-visible:outline-accent">
            <LayoutIcon layout={preset.layout} /><span className="max-w-28 truncate">{label(preset)}</span>
          </button>)}
          <button type="button" aria-label={t('layout.add')} data-tip={t('layout.add')} onClick={() => update(capture())}
            className="flex min-h-14 min-w-16 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent"><Plus width={20} height={20} aria-hidden="true" /></button>
        </div>
        {renaming && <form className="mt-2 flex max-w-80 items-center gap-1" onSubmit={event => {
          event.preventDefault()
          const name = renaming.name.trim()
          save(presets.map(preset => preset.id === renaming.id ? { ...preset, name: name || undefined } : preset))
          cancelRename()
        }}>
          <input ref={nameInput} aria-label={t('layout.name')} value={renaming.name} maxLength={60}
            onChange={event => setRenaming({ ...renaming, name: event.target.value })}
            className="min-w-0 flex-1 rounded border border-edge bg-surface px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none" />
          <button type="submit" className="rounded bg-accent px-2 py-1 text-xs text-white">{t('common.save')}</button>
          <button type="button" onClick={cancelRename} className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover">{t('common.cancel')}</button>
        </form>}
        {notice && <p role="status" className="mt-2 max-w-72 text-xs text-ink-secondary">{notice}</p>}
      </div>
    </HoverTipLayer>, document.body)}
    {context && createPortal(<div ref={menu} role="menu" aria-label={label(context.preset)} onKeyDown={menuKeys} style={menuPosition}
      className="fixed z-[1060] max-w-[calc(100vw-16px)] rounded-lg border border-edge-bright bg-surface-raised py-1 text-sm shadow-xl">
      {[
        { text: t('layout.rename'), action: () => { const preset = context.preset; closeContext(); setRenaming({ id: preset.id, name: preset.name ?? '' }) } },
        { text: t('layout.factory'), action: () => update(factory, context.preset.id) },
        { text: t('layout.replace'), action: () => update(capture(), context.preset.id) },
        { text: t('layout.delete'), action: () => { save(presets.filter(preset => preset.id !== context.preset.id)); closeContext(); popup.current?.querySelector<HTMLButtonElement>('button')?.focus() } },
      ].map(item => <button key={item.text} type="button" role="menuitem" onClick={item.action} className="flex w-full px-3 py-1.5 text-left hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none">{item.text}</button>)}
    </div>, document.body)}
  </>
}
