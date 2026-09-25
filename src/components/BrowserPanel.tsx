import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { useDragReorder, useOverlayDismiss } from '@mew/ui'
import { DockBody, DockGrip, DockPanel, useDock } from './DockWorkspace'
import { useFocusedShortcutScope } from '@mew/shortcuts'
import { listServerBrowserTabs, openServerBrowserTab, closeServerBrowserTab, type ServerBrowserTab } from '../api/client'
import { useI18n } from '../i18n'
import { ServerDomBrowser } from './server-dom-browser'
import type { DomBrowserController, DomBrowserStatus } from '../utils/browser-dom-view'
import { BrowserStartPage } from './browser-start-page'
import { BrowserNotice } from './browser-notice'
import { normalizeBrowserUrl as normalizeUrl, readBrowserShortcuts, writeBrowserShortcuts, type BrowserShortcut } from '../utils/browser-shortcuts'

function labelForUrl(url: string): string { try { return new URL(url).host || url } catch { return url } }

export function BrowserPanel({ onClose, standalone = false, visible = true, nextTabSignal = 0, previousTabSignal = 0, closeTabSignal = 0, onPanelFocus, backNavigationRef }: { backNavigationRef?: Ref<() => boolean>; onPanelFocus?: () => void; nextTabSignal?: number; previousTabSignal?: number; closeTabSignal?: number; onClose: () => void; standalone?: boolean; visible?: boolean }) {
  const { t } = useI18n()
  const dock = useDock()
  const latestDock = useRef(dock)
  latestDock.current = dock
  const [tabs, setTabs] = useState<ServerBrowserTab[]>([])
  const [activeId, setActiveId] = useState('')
  const [focusedGroup, setFocusedGroup] = useState('browser')
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [shortcuts, setShortcuts] = useState(readBrowserShortcuts)
  const pendingOpens = useRef(new Map<string, { cancelled: boolean }>())
  const controls = useRef(new Map<string, DomBrowserController>())
  const history = useRef(new Map<string, boolean>())
  useEffect(() => {
    let cancelled = false
    void listServerBrowserTabs()
      .then((restored) => { if (!cancelled) { setTabs(restored); setActiveId(restored[0]?.id ?? '') } })
      .catch((error: unknown) => { if (!cancelled) setError(String(error)) })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [])
  const groupFor = (id: string) => dock?.groupFor('browser', id) ?? 'browser'
  const groups = [...new Set(['browser', ...tabs.map((tab) => groupFor(tab.id))])]
  const groupTabs = (group: string) => tabs.filter((tab) => groupFor(tab.id) === group)
  const selected = (group: string) => { const list = groupTabs(group); return list.find((tab) => tab.id === dock?.state.active[group])?.id ?? list.find((tab) => tab.id === activeId)?.id ?? list[0]?.id }
  const navigateBack = () => {
    const id = selected(dock?.desktop === false ? 'browser' : focusedGroup)
    const control = id ? controls.current.get(id) : undefined
    if (!visible || !id || !history.current.get(id) || !control) return false
    control.command('back')
    return true
  }
  useImperativeHandle(backNavigationRef, () => navigateBack)
  useOverlayDismiss(standalone && visible ? onClose : false, { closeOnBack: () => !navigateBack(), escapePhase: 'bubble' })
  const activate = (id: string) => { setActiveId(id); dock?.select(groupFor(id), id) }
  const addTab = (group: string) => {
    if (!loaded || !groupTabs(group).length) return
    const tab = { id: crypto.randomUUID(), url: '', title: '', streamUrl: '' }
    setTabs(current => [...current, tab]); setActiveId(tab.id); dock?.assign(group, tab.id)
  }
  const openTab = async (group: string, url: string, id: string = crypto.randomUUID()) => {
    const pending = { cancelled: false }
    pendingOpens.current.set(id, pending)
    try {
      const tab = await openServerBrowserTab(id, url)
      if (pending.cancelled) { await closeServerBrowserTab(id); return }
      setTabs(current => current.some(item => item.id === id) ? current.map(item => item.id === id ? tab : item) : [...current, tab])
      setActiveId(tab.id); latestDock.current?.assign(group, tab.id)
    } finally { pendingOpens.current.delete(id) }
  }
  const removeTab = (id: string) => setTabs((current) => current.filter((tab) => tab.id !== id))
  const closeTab = (id: string) => {
    const pending = pendingOpens.current.get(id)
    if (pending) pending.cancelled = true
    if (!tabs.find(tab => tab.id === id)?.streamUrl) { removeTab(id); return }
    void closeServerBrowserTab(id).then(() => removeTab(id)).catch((error: unknown) => setError(String(error)))
  }
  const signals = useRef({ nextTabSignal, previousTabSignal, closeTabSignal })
  useEffect(() => {
    const previous = signals.current
    signals.current = { nextTabSignal, previousTabSignal, closeTabSignal }
    const group = dock?.desktop === false ? 'browser' : focusedGroup, list = groupTabs(group), id = selected(group)
    if (!id) return
    if (previous.closeTabSignal !== closeTabSignal) { closeTab(id); return }
    const direction = previous.nextTabSignal !== nextTabSignal ? 1 : previous.previousTabSignal !== previousTabSignal ? -1 : 0
    if (direction && list.length > 1) activate(list[(list.findIndex((tab) => tab.id === id) + direction + list.length) % list.length].id)
    // Signals act once on the group that is focused when the command arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextTabSignal, previousTabSignal, closeTabSignal])
  const focusGroup = (group: string) => { setFocusedGroup(group); onPanelFocus?.() }
  const tabBar = (group: string) => <BrowserTabBar group={group} tabs={groupTabs(group)} activeId={selected(group)} standalone={standalone} onActivate={activate} onAdd={() => addTab(group)} onClose={() => { if (!dock?.desktop || !dock.closeGroup(group)) onClose() }} onCloseTab={closeTab}
    onReorder={(from, to) => { const list = groupTabs(group); setTabs((current) => { const next = [...current], a = next.findIndex((tab) => tab.id === list[from]?.id), b = next.findIndex((tab) => tab.id === list[to]?.id); if (a >= 0 && b >= 0) next.splice(b, 0, ...next.splice(a, 1)); return next }) }} />
  const panelNotice = error ? { message: error, onDismiss: () => setError(null) } : undefined
  const startPage = (group: string, id?: string) => <div className="relative flex min-h-0 flex-1 flex-col">{loaded ? <BrowserStartPage shortcuts={shortcuts} onChange={(next: BrowserShortcut[]) => {
    if (!writeBrowserShortcuts(next)) return false
    setShortcuts(next); return true
  }} onOpen={url => openTab(group, url, id)} onClose={id ? () => closeTab(id) : undefined} /> : <div role="status" className="m-auto p-6 text-sm text-ink-muted">{t('common.loading')}</div>}{panelNotice && <BrowserNotice {...panelNotice} />}</div>
  const page = (tab: ServerBrowserTab) => !tab.streamUrl ? startPage(groupFor(tab.id), tab.id) : <BrowserPage tab={tab} notice={panelNotice} onClose={() => closeTab(tab.id)} onController={(control) => {
    if (control) controls.current.set(tab.id, control)
    else { controls.current.delete(tab.id); history.current.delete(tab.id) }
  }} onStatus={(status) => {
    history.current.set(tab.id, !!status.canGoBack)
    if (status.closed) { removeTab(tab.id); return }
    if (status.popup) {
      const popup = status.popup
      setTabs((current) => current.some((tab) => tab.id === popup.id) ? current : [...current, popup])
      setActiveId(popup.id); dock?.assign(groupFor(tab.id), popup.id)
    }
    if (status.url) setTabs((current) => current.map((item) => item.id === tab.id && (item.url !== status.url || item.title !== status.title) ? { ...item, url: status.url!, title: status.title || labelForUrl(status.url!) } : item))
  }} />
  if (dock) return <>
    {groups.map((group) => <DockPanel key={group} id={group} tabs={groupTabs(group).map((tab) => tab.id)} kind="browser" visible={visible && (groupTabs(group).length > 0 || tabs.length === 0)} onFocus={() => focusGroup(group)}>
      {tabBar(group)}
      {!groupTabs(group).length && startPage(group)}
    </DockPanel>)}
    {tabs.map((tab) => <DockBody key={tab.id} group={groupFor(tab.id)} active={selected(groupFor(tab.id)) === tab.id} onFocus={() => focusGroup(groupFor(tab.id))}>{page(tab)}</DockBody>)}
  </>
  return <section className="relative flex h-full min-w-0 flex-col bg-surface-deep text-ink" aria-label={t('browser.title')}>
    {tabBar('browser')}
    {!tabs.length && startPage('browser')}
    {tabs.map((tab) => <div key={tab.id} className={tab.id === selected('browser') ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>{page(tab)}</div>)}
  </section>
}
function BrowserTabBar({ group, tabs, activeId, standalone, onActivate, onAdd, onClose, onCloseTab, onReorder }: {
  group: string; tabs: ServerBrowserTab[]; activeId?: string; standalone: boolean; onActivate: (id: string) => void; onAdd: () => void; onClose: () => void; onCloseTab?: (id: string) => void; onReorder: (from: number, to: number) => void
}) {
  const { t } = useI18n(), dock = useDock()
  const scopeRef = useRef<HTMLDivElement>(null)
  useFocusedShortcutScope(scopeRef, { closeTab: () => { if (!activeId || !onCloseTab) return false; onCloseTab(activeId); return true } })
  const drag = useDragReorder({ onReorder, immediateMouseDrag: true, onDragMove: (i, x, y) => { if (tabs[i]) dock?.preview(group, tabs[i].id, x, y) }, onDrop: (i, x, y) => { if (tabs[i]) dock?.drop(group, tabs[i].id, x, y) } })
  return <div data-dock-tab-bar ref={scopeRef} className="flex h-9 shrink-0 items-center border-b border-edge bg-surface-deep">
    {dock && <DockGrip group={group} />}
    <div className="no-scrollbar flex h-full min-w-0 flex-1 items-center overflow-x-auto">
      {tabs.map((tab, i) => <div key={tab.id} {...drag.getItemProps(i)} draggable={false} onDragStart={(event) => { event.preventDefault(); event.stopPropagation() }} role="tab" tabIndex={0} aria-selected={tab.id === activeId} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onActivate(tab.id) } }} onClick={() => { if (!drag.consumeClick()) onActivate(tab.id) }}
        aria-keyshortcuts={dock?.desktop ? 'Shift+Enter' : undefined}
        onContextMenu={(event) => { if (drag.dragIndex !== null) event.preventDefault() }}
        className={`group flex h-full shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-edge px-2.5 text-xs [-webkit-touch-callout:none] ${tab.id === activeId ? 'bg-surface-raised text-ink' : 'text-ink-secondary hover:bg-surface-raised'} ${drag.dragIndex === i ? 'opacity-70 ring-1 ring-inset ring-accent' : ''}`} title={tab.url}>
        <span className="max-w-[9rem] truncate">{tab.title || (tab.url ? labelForUrl(tab.url) : t('browser.newTab'))}</span>
        {onCloseTab && <button type="button" onClick={(event) => { event.stopPropagation(); onCloseTab(tab.id) }} className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink" aria-label={t('browser.closeTab')}>×</button>}
      </div>)}
      <button type="button" onClick={onAdd} className="flex h-full w-9 shrink-0 items-center justify-center border-r border-edge text-ink-secondary hover:bg-surface-raised hover:text-ink" title={t('browser.newTab')} aria-label={t('browser.newTab')}>
        <PlusGlyph />
      </button>
    </div>
    <button type="button" onClick={onClose} className="mx-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink" title={standalone ? t('browser.closePopup') : t('browser.close')} aria-label={standalone ? t('browser.closePopup') : t('browser.close')}>
      <WindowCloseGlyph />
    </button>
  </div>
}
function BrowserPage({ tab, onStatus, onClose, onController, notice }: { tab: ServerBrowserTab; onStatus: (status: DomBrowserStatus) => void; onClose: () => void; onController: (controller: DomBrowserController | null) => void; notice?: { message: string; onDismiss: () => void } }) {
  const { t } = useI18n()
  const scope = useRef<HTMLDivElement>(null), addressRef = useRef<HTMLInputElement>(null), controller = useRef<DomBrowserController | null>(null)
  const [draft, setDraft] = useState(tab.url), [frame, setFrame] = useState<DomBrowserStatus | null>(null), [error, setError] = useState<string | null>(null)
  const loading = frame?.state === 'connecting'
  useFocusedShortcutScope(scope, { closeTab: () => { onClose(); return true } })
  const command = (name: 'back' | 'forward' | 'reload' | 'stop') => controller.current?.command(name)
  return <div ref={scope} className="@container flex h-full min-h-0 flex-col">
    <form className="grid shrink-0 grid-cols-[2.25rem_2.25rem_2.25rem_minmax(0,1fr)_2.25rem] items-center gap-1 border-b border-edge bg-surface px-2 py-1 @max-[20rem]:grid-cols-[2.25rem_2.25rem_minmax(0,1fr)_2.25rem]" onSubmit={(event) => { event.preventDefault(); try { const url = normalizeUrl(draft); controller.current?.command('navigate', { url }); setDraft(url); setError(null); addressRef.current?.blur() } catch (error) { setError(error instanceof Error && error.message === 'http-only' ? t('browser.httpOnly') : t('browser.invalidAddress')) } }}>
      <IconButton label={t('browser.back')} disabled={!frame?.canGoBack} onClick={() => command('back')}><NavGlyph path="m15 18-6-6 6-6" /></IconButton>
      <IconButton label={t('browser.forward')} disabled={!frame?.canGoForward} onClick={() => command('forward')}><NavGlyph path="m9 18 6-6-6-6" /></IconButton>
      <IconButton label={loading ? t('browser.stopLoading') : t('common.refresh')} onClick={() => command(loading ? 'stop' : 'reload')}>{loading ? <StopGlyph /> : <ReloadGlyph />}</IconButton>
      <div className="flex min-w-0 items-center rounded-md border border-edge-strong bg-surface-deep focus-within:border-accent @max-[20rem]:col-span-3 @max-[20rem]:row-start-2">
        <input ref={addressRef} value={draft} onChange={(event) => setDraft(event.target.value)} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 bg-transparent px-2 py-1 font-mono text-xs text-ink outline-none" spellCheck={false} inputMode="url" aria-label={t('browser.address')} placeholder="https://example.com" />
      </div>
      <button type="submit" title={t('browser.go')} aria-label={t('browser.go')} className="flex h-9 w-9 items-center justify-center rounded bg-accent text-ink-on-accent hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent @max-[20rem]:col-start-4 @max-[20rem]:row-start-2"><NavGlyph path="M5 12h14m-6-6 6 6-6 6" /></button>
    </form>
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <ServerDomBrowser streamUrl={tab.streamUrl} reopen={async () => (await openServerBrowserTab(tab.id, tab.url)).streamUrl} notice={error ? { message: error, onDismiss: () => setError(null) } : notice} onController={(value) => { controller.current = value; onController(value) }}
        onStatus={(status) => { setFrame(status); if (status.url && document.activeElement !== addressRef.current) setDraft(status.url); onStatus(status) }} />
    </div>
  </div>
}

function IconButton({ label, onClick, disabled = false, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="flex h-9 w-9 shrink-0 items-center justify-center text-ink-secondary hover:bg-surface-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent" title={label} aria-label={label}>{children}</button>
}

function NavGlyph({ path }: { path: string }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
}
function WindowCloseGlyph() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
}
function PlusGlyph() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
}
function StopGlyph() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1" /></svg> }
function ReloadGlyph() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M20 6v5h-5" /><path d="M19 11a8 8 0 1 0 .2 4" /></svg> }
