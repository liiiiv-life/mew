import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useDragReorder } from '@mew/ui'
import { useFocusedShortcutScope } from '@mew/shortcuts'
import { restoreGitPanel, type GitPanelState } from '../utils/git-panel-state'
import { DockBody, DockGrip, DockPanel, useDock } from './DockWorkspace'
import { GitWorkbench } from './GitWorkbench'

export function GitPanel({ visible, initialState, onChange, onNotice, onClose, onPanelFocus, closeTabSignal = 0 }: {
  visible: boolean
  initialState: unknown
  onChange: (state: GitPanelState) => void
  onNotice: (message: string) => void
  onClose: () => void
  onPanelFocus: () => void
  nextTabSignal?: number
  previousTabSignal?: number
  closeTabSignal?: number
}) {
  const dock = useDock()
  const [state] = useState(() => restoreGitPanel(initialState))
  const tab = state.tabs[0]
  const group = dock?.groupFor('git', tab.id) ?? 'git'
  useEffect(() => onChange(state), [state, onChange])
  const signal = useRef(closeTabSignal)
  useEffect(() => {
    if (signal.current !== closeTabSignal) { signal.current = closeTabSignal; onClose() }
  }, [closeTabSignal, onClose])
  const drag = useDragReorder({ onReorder: () => {}, immediateMouseDrag: true,
    onDragMove: (_index, x, y) => dock?.preview(group, tab.id, x, y),
    onDrop: (_index, x, y) => dock?.drop(group, tab.id, x, y),
  })
  return <>
    <DockPanel id={group} kind="git" tabs={[tab.id]} visible={visible} onFocus={onPanelFocus}>
      <GitShortcutScope onClose={onClose} tabBar className="flex h-9 shrink-0 items-center border-b border-edge bg-surface-deep">
        <DockGrip group={group} />
        <div className="no-scrollbar flex h-full min-w-0 flex-1 items-center overflow-x-auto">
          <div {...drag.getItemProps(0)} draggable={false} role="tab" tabIndex={0} aria-selected="true"
            onDragStart={event => { event.preventDefault(); event.stopPropagation() }}
            onClick={() => { if (!drag.consumeClick()) dock?.select(group, tab.id) }}
            onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); dock?.select(group, tab.id) } }}
            className={`flex h-full shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-edge bg-surface-raised px-2.5 text-xs text-ink [-webkit-touch-callout:none] ${drag.dragIndex === 0 ? 'opacity-70 ring-1 ring-inset ring-accent' : ''}`}>
            <GitGlyph />
            <span className="max-w-[9rem] truncate">{tab.label}</span>
            <button type="button" onClick={event => { event.stopPropagation(); onClose() }} className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink" aria-label={`${tab.label} 탭 닫기`}>×</button>
          </div>
        </div>
        <button type="button" onClick={onClose} className="mx-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink" title="Git 닫기" aria-label="Git 닫기">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </GitShortcutScope>
    </DockPanel>
    <DockBody group={group} active onFocus={onPanelFocus}>
      <GitShortcutScope onClose={onClose} className="flex h-full min-h-0 min-w-0 flex-col">
        <GitWorkbench project={tab.project} repositoryPath={tab.path} onNotice={onNotice} />
      </GitShortcutScope>
    </DockBody>
  </>
}

// Register after the portal mounts its actual header/body elements.
function GitShortcutScope({ onClose, children, className, tabBar }: { onClose: () => void; children: ReactNode; className: string; tabBar?: boolean }) {
  const scope = useRef<HTMLDivElement>(null)
  useFocusedShortcutScope(scope, { closeTab: () => { onClose(); return true } })
  return <div ref={scope} data-dock-tab-bar={tabBar ? '' : undefined} className={className}>{children}</div>
}

function GitGlyph() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-muted" aria-hidden="true"><circle cx="6" cy="5" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="7" cy="19" r="2" /><path d="M6 7v10M8 8.5c3.5 0 4.5-1.5 8-1.5" /></svg>
}
