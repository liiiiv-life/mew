import { HoverTipLayer } from '@mew/ui'
import { useI18n } from '../i18n'

export function SidebarCreateButtons({ onCreate, disabled = false }: { onCreate: (kind: 'file' | 'folder') => void; disabled?: boolean }) {
  const { t } = useI18n()
  return <HoverTipLayer className="ml-auto flex items-center gap-1">
    {(['file', 'folder'] as const).map(kind => <button key={kind} type="button" disabled={disabled} onClick={() => onCreate(kind)} aria-label={t(kind === 'file' ? 'sidebar.newFile' : 'sidebar.newFolder')} data-tip={t(kind === 'file' ? 'sidebar.newFile' : 'sidebar.newFolder')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {kind === 'file' ? <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8M14 2l6 6M14 2v6h6v5" /><path d="M19 16v6m-3-3h6" /></> : <><path d="M13 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v4" /><path d="M19 16v6m-3-3h6" /></>}
      </svg>
    </button>)}
  </HoverTipLayer>
}
