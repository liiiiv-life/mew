import { PanelCloseButton } from './panel-close-button'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useFocusedShortcutScope } from '@mew/shortcuts'
import { restoreGitPanel, type GitPanelState } from '../utils/git-panel-state'
import { DockBody, DockGrip, DockPanel, useDock } from './DockWorkspace'
import type { GitDiffTarget } from '../utils/git-diff-tabs'
import { GitWorkbench } from './GitWorkbench'
import type { GitWorkbenchNavigation } from '../utils/git-workbench-navigation'
import { GitHubAccount } from './github-account'

export function GitPanel({ visible, initialState, onChange, onNotice, onOpenDiff, onClose, onPanelFocus, closeTabSignal = 0, navigation }: {
  visible: boolean
  initialState: unknown
  onChange: (state: GitPanelState) => void
  onNotice: (message: string) => void
  onOpenDiff?: (target: GitDiffTarget) => void
  onClose: () => void
  onPanelFocus: () => void
  nextTabSignal?: number
  previousTabSignal?: number
  closeTabSignal?: number
  navigation?: GitWorkbenchNavigation
}) {
  useUiLocale()
  const dock = useDock()
  const [state] = useState(() => restoreGitPanel(initialState))
  const [branchHost, setBranchHost] = useState<HTMLDivElement | null>(null)
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
          <div ref={setBranchHost} data-git-branch className="flex min-w-0 flex-1 items-center" />
          <div className="flex shrink-0 items-center justify-end" data-git-controls>
            <div ref={setActionsHost} className="flex min-w-0 items-center" />
            <GitHubAccount key={tab.project} project={tab.project} />
          </div>
          <PanelCloseButton onClick={onClose} aria-label={uiText("Git 닫기")} />
        </div>
      </GitShortcutScope>
    </DockPanel>
    <DockBody group={group} active onFocus={onPanelFocus}>
      <GitShortcutScope onClose={onClose} className="flex h-full min-h-0 min-w-0 flex-col">
        <GitWorkbench project={tab.project} repositoryPath={tab.path} onNotice={onNotice} onOpenDiff={onOpenDiff} branchHost={branchHost} actionsHost={actionsHost} navigation={navigation}
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
