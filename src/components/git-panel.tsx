import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useFocusedShortcutScope } from '@mew/shortcuts'
import { GitBranch } from 'iconoir-react'
import { restoreGitPanel, type GitPanelState } from '../utils/git-panel-state'
import { DockBody, DockGrip, DockPanel, useDock } from './DockWorkspace'
import { GitWorkbench } from './GitWorkbench'
import { GitHubAccount } from './github-account'

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
  useUiLocale()
  const dock = useDock()
  const [state] = useState(() => restoreGitPanel(initialState))
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null)
  const tab = state.tabs[0]
  const group = dock?.groupFor('git', tab.id) ?? 'git'
  useEffect(() => onChange(state), [state, onChange])
  const signal = useRef(closeTabSignal)
  useEffect(() => {
    if (signal.current !== closeTabSignal) { signal.current = closeTabSignal; onClose() }
  }, [closeTabSignal, onClose])
  return <>
    <DockPanel id={group} kind="git" tabs={[tab.id]} visible={visible} onFocus={onPanelFocus}>
      <GitShortcutScope onClose={onClose} className="shrink-0">
        <div data-dock-tab-bar className="flex h-9 shrink-0 items-center border-b border-edge bg-surface-deep">
          <DockGrip group={group} />
          <div className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 text-xs text-ink">
            <GitBranch width={14} height={14} className="shrink-0" aria-hidden="true" />
            <span>Git</span>
          </div>
          <div className="flex min-w-0 items-center justify-end" data-git-controls>
            <div ref={setActionsHost} className="flex shrink-0 items-center" />
            <GitHubAccount key={tab.project} project={tab.project} />
          </div>
          <button type="button" onClick={onClose} className="mx-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink" title={uiText("Git 닫기")} aria-label={uiText("Git 닫기")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
      </GitShortcutScope>
    </DockPanel>
    <DockBody group={group} active onFocus={onPanelFocus}>
      <GitShortcutScope onClose={onClose} className="flex h-full min-h-0 min-w-0 flex-col">
        <GitWorkbench project={tab.project} repositoryPath={tab.path} onNotice={onNotice} actionsHost={actionsHost}
          visible={visible && (!dock || (dock.desktop ? !dock.maximized || dock.maximized === group : dock.foreground === 'git'))} />
      </GitShortcutScope>
    </DockBody>
  </>
}

// Register after the portal mounts its actual body element.
function GitShortcutScope({ onClose, children, className }: { onClose: () => void; children: ReactNode; className: string }) {
  useUiLocale()
  const scope = useRef<HTMLDivElement>(null)
  useFocusedShortcutScope(scope, { closeTab: () => { onClose(); return true } })
  return <div ref={scope} className={className}>{children}</div>
}
