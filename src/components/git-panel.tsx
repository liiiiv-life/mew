import { useEffect, useRef, useState } from 'react'
import { useDragReorder } from '@mew/ui'
import { useFocusedShortcutScope } from '@mew/shortcuts'
import { fetchGitRepositories } from '../api/client'
import { WORKSPACE_PROJECT } from '../utils/active-project'
import { gitRepositoryTab, restoreGitPanel, type GitPanelState, type GitRepositoryTab } from '../utils/git-panel-state'
import { DockBody, DockGrip, DockPanel, useDock } from './DockWorkspace'
import { GitWorkbench } from './GitWorkbench'

export function GitPanel({ visible, initialState, onChange, onNotice, onClose, onPanelFocus, nextTabSignal = 0, previousTabSignal = 0, closeTabSignal = 0 }: {
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
  const [state, setState] = useState(() => restoreGitPanel(initialState))
  const [pickerGroup, setPickerGroup] = useState<string | null>(null)
  const [focusedGroup, setFocusedGroup] = useState('git')
  const { tabs, activeId } = state
  useEffect(() => onChange(state), [state, onChange])
  const groupFor = (id: string) => dock?.groupFor('git', id) ?? 'git'
  const groups = [...new Set(['git', ...tabs.map((tab) => groupFor(tab.id))])]
  const groupTabs = (group: string) => tabs.filter((tab) => groupFor(tab.id) === group)
  const selected = (group: string) => {
    const list = groupTabs(group)
    return list.find((tab) => tab.id === dock?.state.active[group])?.id ?? list.find((tab) => tab.id === activeId)?.id ?? list[0]?.id
  }
  const isPicker = (group: string) => !groupTabs(group).length || pickerGroup === group
  const focusGroup = (group: string) => { setFocusedGroup(group); onPanelFocus() }
  const activate = (id: string) => {
    setState((current) => ({ ...current, activeId: id }))
    setPickerGroup(null)
    dock?.select(groupFor(id), id)
  }
  const openRepository = (group: string, tab: GitRepositoryTab) => {
    if (tabs.some((entry) => entry.id === tab.id)) { activate(tab.id); return }
    setState((current) => ({ tabs: [...current.tabs, tab], activeId: tab.id }))
    setPickerGroup(null)
    dock?.assign(group, tab.id)
  }
  const closeTab = (id: string) => {
    const group = groupFor(id), list = groupTabs(group), index = list.findIndex((tab) => tab.id === id)
    const next = list[index + 1]?.id ?? list[index - 1]?.id
    setState((current) => ({ tabs: current.tabs.filter((tab) => tab.id !== id), activeId: current.activeId === id ? next ?? null : current.activeId }))
    if (selected(group) === id && next) dock?.select(group, next)
  }
  const closeCurrentTab = (group: string) => {
    if (isPicker(group)) {
      if (groupTabs(group).length) setPickerGroup(null)
      else onClose()
      return true
    }
    const id = selected(group)
    if (!id) return false
    closeTab(id)
    return true
  }
  const signals = useRef({ nextTabSignal, previousTabSignal, closeTabSignal })
  useEffect(() => {
    const previous = signals.current
    signals.current = { nextTabSignal, previousTabSignal, closeTabSignal }
    const group = dock?.desktop === false ? 'git' : focusedGroup
    if (previous.closeTabSignal !== closeTabSignal) { closeCurrentTab(group); return }
    const direction = previous.nextTabSignal !== nextTabSignal ? 1 : previous.previousTabSignal !== previousTabSignal ? -1 : 0
    const list = groupTabs(group), index = list.findIndex((tab) => tab.id === selected(group))
    if (direction && list.length) activate(list[(index + direction + list.length) % list.length].id)
    // Commands act on the group focused when the signal arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextTabSignal, previousTabSignal, closeTabSignal])

  return <>
    {groups.map((group) => <DockPanel key={group} id={group} kind="git" tabs={groupTabs(group).map((tab) => tab.id)} visible={visible && (groupTabs(group).length > 0 || tabs.length === 0)} onFocus={() => focusGroup(group)}>
      <GitTabBar group={group} tabs={groupTabs(group)} activeId={isPicker(group) ? undefined : selected(group)} pickerOpen={isPicker(group)} onActivate={activate} onAdd={() => setPickerGroup(group)} onCloseTab={closeTab} onCloseCurrent={() => closeCurrentTab(group)}
        onClose={() => { setPickerGroup(null); if (!dock?.desktop || !dock.closeGroup(group)) onClose() }}
        onReorder={(from, to) => {
          const list = groupTabs(group)
          setState((current) => {
            const next = [...current.tabs], a = next.findIndex((tab) => tab.id === list[from]?.id), b = next.findIndex((tab) => tab.id === list[to]?.id)
            if (a >= 0 && b >= 0) next.splice(b, 0, ...next.splice(a, 1))
            return { ...current, tabs: next }
          })
        }} />
      {visible && isPicker(group) && <RepositoryPicker onSelect={(tab) => openRepository(group, tab)} onClose={() => closeCurrentTab(group)} />}
    </DockPanel>)}
    {tabs.map((tab) => <DockBody key={tab.id} group={groupFor(tab.id)} active={!isPicker(groupFor(tab.id)) && selected(groupFor(tab.id)) === tab.id} onFocus={() => focusGroup(groupFor(tab.id))}>
      <GitTabContent tab={tab} onNotice={onNotice} onBack={() => setPickerGroup(groupFor(tab.id))} onClose={() => { closeTab(tab.id); return true }} />
    </DockBody>)}
  </>
}

function GitTabContent({ tab, onNotice, onBack, onClose }: { tab: GitRepositoryTab; onNotice: (message: string) => void; onBack: () => void; onClose: () => boolean }) {
  const scope = useRef<HTMLDivElement>(null)
  useFocusedShortcutScope(scope, { closeTab: onClose })
  return <div ref={scope} className="flex h-full min-h-0 min-w-0 flex-col">
    <GitWorkbench project={tab.project} repositoryPath={tab.path} onNotice={onNotice} onBack={onBack} />
  </div>
}

function GitTabBar({ group, tabs, activeId, pickerOpen, onActivate, onAdd, onClose, onCloseTab, onCloseCurrent, onReorder }: {
  group: string; tabs: GitRepositoryTab[]; activeId?: string; pickerOpen: boolean
  onActivate: (id: string) => void; onAdd: () => void; onClose: () => void; onCloseTab: (id: string) => void; onCloseCurrent: () => boolean; onReorder: (from: number, to: number) => void
}) {
  const dock = useDock(), scope = useRef<HTMLDivElement>(null)
  useFocusedShortcutScope(scope, { closeTab: onCloseCurrent })
  const drag = useDragReorder({ onReorder, immediateMouseDrag: true,
    onDragMove: (i, x, y) => { if (tabs[i]) dock?.preview(group, tabs[i].id, x, y) },
    onDrop: (i, x, y) => { if (tabs[i]) dock?.drop(group, tabs[i].id, x, y) },
  })
  return <div ref={scope} data-dock-tab-bar className="flex h-9 shrink-0 items-center border-b border-edge bg-surface-deep">
    <DockGrip group={group} />
    <div className="no-scrollbar flex h-full min-w-0 flex-1 items-center overflow-x-auto">
      {tabs.map((tab, i) => <div key={tab.id} {...drag.getItemProps(i)} draggable={false} role="tab" tabIndex={0} aria-selected={tab.id === activeId}
        onDragStart={(event) => { event.preventDefault(); event.stopPropagation() }}
        onClick={() => { if (!drag.consumeClick()) onActivate(tab.id) }}
        onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onActivate(tab.id) } }}
        onContextMenu={(event) => { if (drag.dragIndex !== null) event.preventDefault() }}
        className={`group flex h-full shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-edge px-2.5 text-xs [-webkit-touch-callout:none] ${tab.id === activeId ? 'bg-surface-raised text-ink' : 'text-ink-secondary hover:bg-surface-raised'} ${drag.dragIndex === i ? 'opacity-70 ring-1 ring-inset ring-accent' : ''}`} title={tab.label}>
        <GitGlyph />
        <span className="max-w-[9rem] truncate">{tab.label}</span>
        <button type="button" onClick={(event) => { event.stopPropagation(); onCloseTab(tab.id) }} className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink" aria-label={`${tab.label} 탭 닫기`}>×</button>
      </div>)}
      <button type="button" onClick={onAdd} aria-pressed={pickerOpen} className={`flex h-full w-9 shrink-0 items-center justify-center border-r border-edge ${pickerOpen ? 'bg-surface-raised text-ink' : 'text-ink-secondary hover:bg-surface-raised hover:text-ink'}`} title="새 Git 탭" aria-label="새 Git 탭">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>
    <button type="button" onClick={onClose} className="mx-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink" title="Git 닫기" aria-label="Git 닫기">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
    </button>
  </div>
}

function RepositoryPicker({ onSelect, onClose }: { onSelect: (tab: GitRepositoryTab) => void; onClose: () => boolean }) {
  const scope = useRef<HTMLDivElement>(null)
  useFocusedShortcutScope(scope, { closeTab: onClose })
  const [choices, setChoices] = useState<GitRepositoryTab[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true); setError(null)
    void Promise.all([fetchGitRepositories(WORKSPACE_PROJECT), fetchGitRepositories('docs')])
      .then(([workspace, docs]) => {
        if (alive) setChoices([
          ...workspace.repositories.map(({ path }) => gitRepositoryTab(WORKSPACE_PROJECT, path)),
          ...docs.repositories.map(({ path }) => gitRepositoryTab('docs', path)),
        ])
      })
      .catch((error: unknown) => { if (alive) setError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [retry])
  return <div ref={scope} className="min-h-0 flex-1 overflow-y-auto p-2">
    <h2 className="px-3 py-2 text-sm font-semibold text-ink">저장소 선택</h2>
    {error ? <div role="alert" className="px-3 py-2 text-xs text-danger"><p>{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-2 rounded border border-edge px-2 py-1 text-ink hover:bg-surface-hover">다시 시도</button></div>
      : loading ? <p role="status" className="p-5 text-center text-xs text-ink-muted">저장소를 찾는 중…</p>
        : choices.length === 0 ? <p className="p-5 text-center text-xs text-ink-muted">열 수 있는 Git 저장소가 없습니다.</p>
          : choices.map((choice) => <button key={choice.id} type="button" onClick={() => onSelect(choice)} className="flex w-full items-center gap-3 rounded px-3 py-3 text-left hover:bg-surface-hover">
            <GitGlyph />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{choice.label}</span><span className="block truncate text-xs text-ink-muted">{choice.path || (choice.project === 'docs' ? 'Documents 저장소' : '현재 프로젝트 루트')}</span></span>
          </button>)}
  </div>
}

function GitGlyph() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-muted" aria-hidden="true"><circle cx="6" cy="5" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="7" cy="19" r="2" /><path d="M6 7v10M8 8.5c3.5 0 4.5-1.5 8-1.5" /></svg>
}
