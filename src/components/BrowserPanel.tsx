import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useDragReorder } from '@mew/ui'
import { DockBody, DockGrip, DockPanel, useDock } from './DockWorkspace'
import { useFocusedShortcutScope } from '@mew/shortcuts'
import { listServerBrowserTabs, openServerBrowserTab, closeServerBrowserTab, type ServerBrowserTab } from '../api/client'
import { useI18n } from '../i18n'
import { ServerDomBrowser } from './server-dom-browser'
import type { DomBrowserController, DomBrowserStatus } from '../utils/browser-dom-view'

const DEFAULT_URL = 'http://localhost:3100/'
function normalizeUrl(raw: string): string {
  const value = raw.trim()
  const local = /^(localhost|127\.[\d.]+|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value)
  const hostWithPort = /^[^/?#]+:\d+(?:[/?#]|$)/.test(value)
  const hasScheme = !hostWithPort && /^[a-z][a-z0-9+.-]*:/i.test(value)
  const url = new URL(hasScheme ? value : `${local || hostWithPort ? 'http' : 'https'}://${value}`)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('http-only')
  return url.href
}
function labelForUrl(url: string): string { try { return new URL(url).host || url } catch { return url } }

export function BrowserPanel({ onClose, standalone = false, visible = true, nextTabSignal = 0, previousTabSignal = 0, closeTabSignal = 0, onPanelFocus }: { onPanelFocus?: () => void; nextTabSignal?: number; previousTabSignal?: number; closeTabSignal?: number; onClose: () => void; standalone?: boolean; visible?: boolean }) {
  const { t } = useI18n()
  const dock = useDock()
  const latestDock = useRef(dock)
  latestDock.current = dock
  const [tabs, setTabs] = useState<ServerBrowserTab[]>([])
  const [activeId, setActiveId] = useState('')
  const [focusedGroup, setFocusedGroup] = useState('browser')
  const [error, setError] = useState<string | null>(null)
  const initialId = useRef(crypto.randomUUID())
  useEffect(() => {
    let cancelled = false
    void listServerBrowserTabs().then(async (existing) => existing.length ? existing : [await openServerBrowserTab(initialId.current, DEFAULT_URL)])
      .then((restored) => { if (!cancelled) { setTabs(restored); setActiveId(restored[0]?.id ?? '') } })
      .catch((error: unknown) => { if (!cancelled) setError(String(error)) })
    return () => { cancelled = true }
  }, [])
  const groupFor = (id: string) => dock?.groupFor('browser', id) ?? 'browser'
  const groups = [...new Set(['browser', ...tabs.map((tab) => groupFor(tab.id))])]
  const groupTabs = (group: string) => tabs.filter((tab) => groupFor(tab.id) === group)
  const selected = (group: string) => { const list = groupTabs(group); return list.find((tab) => tab.id === dock?.state.active[group])?.id ?? list.find((tab) => tab.id === activeId)?.id ?? list[0]?.id }
  const activate = (id: string) => { setActiveId(id); dock?.select(groupFor(id), id) }
  const addTab = (group: string, url = DEFAULT_URL) => {
    void openServerBrowserTab(crypto.randomUUID(), url).then((tab) => {
      setTabs((current) => [...current, tab]); setActiveId(tab.id); latestDock.current?.assign(group, tab.id)
    }).catch((error: unknown) => setError(String(error)))
  }
  const removeTab = (id: string) => setTabs((current) => current.filter((tab) => tab.id !== id))
  const closeTab = (id: string) => {
    if (tabs.length <= 1) return
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
  const tabBar = (group: string) => <BrowserTabBar group={group} tabs={groupTabs(group)} activeId={selected(group)} standalone={standalone} onActivate={activate} onAdd={() => addTab(group)} onClose={() => { if (!dock?.desktop || !dock.closeGroup(group)) onClose() }} onCloseTab={tabs.length > 1 ? closeTab : undefined}
    onReorder={(from, to) => { const list = groupTabs(group); setTabs((current) => { const next = [...current], a = next.findIndex((tab) => tab.id === list[from]?.id), b = next.findIndex((tab) => tab.id === list[to]?.id); if (a >= 0 && b >= 0) next.splice(b, 0, ...next.splice(a, 1)); return next }) }} />
  const page = (tab: ServerBrowserTab) => <BrowserPage tab={tab} onClose={() => closeTab(tab.id)} onStatus={(status) => {
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
      {error && <div role="alert" className="px-3 py-2 text-xs text-danger">{error}</div>}
      {!groupTabs(group).length && <button className="m-auto rounded border border-edge px-4 py-2 text-sm" onClick={() => addTab(group)}>{t('browser.newTab')}</button>}
    </DockPanel>)}
    {tabs.filter((tab) => tab.streamUrl).map((tab) => <DockBody key={tab.id} group={groupFor(tab.id)} active={selected(groupFor(tab.id)) === tab.id} onFocus={() => focusGroup(groupFor(tab.id))}>{page(tab)}</DockBody>)}
  </>
  return <section className="flex h-full min-w-0 flex-col bg-surface-deep text-ink" aria-label={t('browser.title')}>
    {tabBar('browser')}
    {error && <div role="alert" className="px-3 py-2 text-xs text-danger">{error}</div>}
    {tabs.filter((tab) => tab.streamUrl).map((tab) => <div key={tab.id} className={tab.id === selected('browser') ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>{page(tab)}</div>)}
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
        onContextMenu={(event) => { if (drag.dragIndex !== null) event.preventDefault() }}
        className={`group flex h-full shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-edge px-2.5 text-xs [-webkit-touch-callout:none] ${tab.id === activeId ? 'bg-surface-raised text-ink' : 'text-ink-secondary hover:bg-surface-raised'} ${drag.dragIndex === i ? 'opacity-70 ring-1 ring-inset ring-accent' : ''}`} title={tab.url}>
        <span className="max-w-[9rem] truncate">{tab.title || labelForUrl(tab.url)}</span>
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
function BrowserPage({ tab, onStatus, onClose }: { tab: ServerBrowserTab; onStatus: (status: DomBrowserStatus) => void; onClose: () => void }) {
  const { t } = useI18n()
  const scope = useRef<HTMLDivElement>(null), addressRef = useRef<HTMLInputElement>(null), controller = useRef<DomBrowserController | null>(null)
  const [draft, setDraft] = useState(tab.url), [frame, setFrame] = useState<DomBrowserStatus | null>(null), [error, setError] = useState<string | null>(null)
  const loading = frame?.state === 'connecting'
  useFocusedShortcutScope(scope, { closeTab: () => { onClose(); return true } })
  const command = (name: 'back' | 'forward' | 'reload' | 'stop') => controller.current?.command(name)
  return <div ref={scope} className="@container flex h-full min-h-0 flex-col">
    <form className="grid shrink-0 grid-cols-[2.25rem_2.25rem_2.25rem_minmax(0,1fr)_auto] items-center gap-1 border-b border-edge bg-surface px-2 py-1 @max-[20rem]:grid-cols-[2.25rem_2.25rem_2.25rem_minmax(0,1fr)]" onSubmit={(event) => { event.preventDefault(); try { const url = normalizeUrl(draft); controller.current?.command('navigate', { url }); setDraft(url); setError(null); addressRef.current?.blur() } catch (error) { setError(error instanceof Error && error.message === 'http-only' ? t('browser.httpOnly') : t('browser.invalidAddress')) } }}>
      <IconButton label={t('browser.back')} disabled={!frame?.canGoBack} onClick={() => command('back')}><NavGlyph path="m15 18-6-6 6-6" /></IconButton>
      <IconButton label={t('browser.forward')} disabled={!frame?.canGoForward} onClick={() => command('forward')}><NavGlyph path="m9 18 6-6-6-6" /></IconButton>
      <IconButton label={loading ? t('browser.stopLoading') : t('common.refresh')} onClick={() => command(loading ? 'stop' : 'reload')}>{loading ? <StopGlyph /> : <ReloadGlyph />}</IconButton>
      <div className="flex min-w-0 items-center rounded-md border border-edge-strong bg-surface-deep focus-within:border-accent @max-[20rem]:col-span-3 @max-[20rem]:row-start-2">
        <input ref={addressRef} value={draft} onChange={(event) => setDraft(event.target.value)} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 bg-transparent px-2 py-1 font-mono text-xs text-ink outline-none" spellCheck={false} inputMode="url" aria-label={t('browser.address')} placeholder="https://example.com" />
      </div>
      <button type="submit" className="whitespace-nowrap rounded bg-accent px-2 py-1 text-xs text-ink-on-accent hover:opacity-90 @max-[20rem]:col-start-4 @max-[20rem]:row-start-2">{t('browser.go')}</button>
    </form>
    {error && <div role="alert" className="shrink-0 border-b border-danger bg-danger-surface px-3 py-2 text-xs text-danger-ink">{error}</div>}
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <ServerDomBrowser streamUrl={tab.streamUrl} reopen={async () => (await openServerBrowserTab(tab.id, tab.url)).streamUrl} onController={(value) => { controller.current = value }}
        onStatus={(status) => { setFrame(status); if (status.url && document.activeElement !== addressRef.current) setDraft(status.url); onStatus(status) }} />
      {loading && <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-surface/85 p-2 shadow-lg" aria-label={t('browser.pageLoading')}><span className="block h-4 w-4 animate-spin rounded-full border-2 border-edge-strong border-t-accent" /></div>}
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
