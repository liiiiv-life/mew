import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'

type Action = { label: string; icon: ReactNode; run: () => void }
const RADIUS = 64

/** 우하단 핸들 — 첫 터치로 8방향 슬롯을 펼치고, 채워진 방향만 명령으로 동작한다. */
export function FabMenu({
  onFullscreen,
  onNextProject,
  onNextWindowTab,
}: {
  onFullscreen: () => void
  onNextProject: () => void
  onNextWindowTab: () => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const actions: Array<Action | null> = [
    {
      label: t('fab.fullscreen'), run: onFullscreen,
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3" /></svg>,
    },
    {
      label: t('fab.nextProject'), run: onNextProject,
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="11" height="14" rx="2" /><path d="m15 8 4 4-4 4M19 12h-8" /></svg>,
    },
    {
      label: t('fab.nextWindowTab'), run: onNextWindowTab,
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h10M4 17h10M4 7v10M14 7v10" /><path d="m16 9 3 3-3 3M19 12h-7" /></svg>,
    },
    null, null, null, null, null,
  ]

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div ref={rootRef} className="fixed right-16 bottom-16 z-40 h-12 w-12">
      <div role="menu" aria-hidden={!open}>
        {actions.map((action, index) => {
          const angle = (-90 + index * 45) * (Math.PI / 180)
          const x = Math.cos(angle) * RADIUS
          const y = Math.sin(angle) * RADIUS
          const position = `translate(-50%, -50%) translate(${open ? x : 0}px, ${open ? y : 0}px) scale(${open ? 1 : 0.6})`
          if (!action) return (
            <span key={index} className={`pointer-events-none absolute top-1/2 left-1/2 h-9 w-9 rounded-full border border-edge bg-surface-raised transition-all duration-150 ${open ? 'opacity-35' : 'opacity-0'}`} style={{ transform: position }} aria-hidden="true" />
          )
          return (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              tabIndex={open ? 0 : -1}
              onClick={() => { action.run(); setOpen(false) }}
              className={`absolute top-1/2 left-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-edge-bright bg-surface-raised text-ink shadow-lg transition-all duration-150 hover:bg-surface-hover hover:text-ink-bright ${open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
              style={{ transform: position }}
              title={action.label}
              aria-label={action.label}
            >
              {action.icon}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`relative z-10 flex h-12 w-12 items-center justify-center rounded-full border border-edge-bright bg-surface-raised text-ink-bright shadow-xl transition-transform hover:bg-surface-hover ${open ? 'rotate-45' : ''}`}
        title={t('fab.handle')}
        aria-label={t('fab.handle')}
        aria-expanded={open}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="3" r="1.5" /><circle cx="18.4" cy="5.6" r="1.5" /><circle cx="21" cy="12" r="1.5" />
          <circle cx="18.4" cy="18.4" r="1.5" /><circle cx="12" cy="21" r="1.5" /><circle cx="5.6" cy="18.4" r="1.5" />
          <circle cx="3" cy="12" r="1.5" /><circle cx="5.6" cy="5.6" r="1.5" /><circle cx="12" cy="12" r="2" />
        </svg>
      </button>
    </div>
  )
}
