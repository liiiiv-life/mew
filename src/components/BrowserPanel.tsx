import { useEffect, useRef, useState, type ReactNode } from 'react'
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

export function BrowserPanel({ onClose, standalone = false }: { onClose: () => void; standalone?: boolean }) {
  const { t } = useI18n()
  const shortcutScopeRef = useRef<HTMLElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const controllers = useRef(new Map<string, DomBrowserController>())
  const [tabs, setTabs] = useState<ServerBrowserTab[]>([])
  const [activeId, setActiveId] = useState('')
  const [frames, setFrames] = useState<Record<string, DomBrowserStatus & { loading: boolean }>>({})
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0]
  const activeFrame = activeTab ? frames[activeTab.id] : undefined
  const [draft, setDraft] = useState(DEFAULT_URL)
  const [localError, setLocalError] = useState<string | null>(null)
  const initialId = useRef(crypto.randomUUID())
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  useEffect(() => {
    let cancelled = false
    void listServerBrowserTabs().then(async (existing) => {
      const restored = existing.length ? existing : [await openServerBrowserTab(initialId.current, DEFAULT_URL)]
      if (cancelled) return
      setTabs(restored.map((tab) => ({ ...tab, title: tab.title || labelForUrl(tab.url) })))
      setActiveId(restored[0].id)
    }).catch((error: unknown) => { if (!cancelled) setLocalError(error instanceof Error ? error.message : String(error)) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    const tab = tabsRef.current.find((item) => item.id === activeId)
    if (tab) setDraft(tab.url)
    setLocalError(null)
  }, [activeId])

  function updateStatus(id: string, status: DomBrowserStatus) {
    if (status.popup) {
      const popup = status.popup
      setTabs((current) => current.some((tab) => tab.id === popup.id) ? current : [...current, { ...popup, title: popup.title || labelForUrl(popup.url) }])
      setActiveId(popup.id)
    }
    if (status.closed) { removeTab(id); return }
    setFrames((current) => ({ ...current, [id]: { ...status, loading: status.state === 'connecting' } }))
    if (status.url) {
      setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, url: status.url!, title: status.title || labelForUrl(status.url!) } : tab))
      if (id === activeId && document.activeElement !== addressRef.current) setDraft(status.url)
    }
  }
  function addTab(url = DEFAULT_URL) {
    void openServerBrowserTab(crypto.randomUUID(), url).then((tab) => {
      setTabs((current) => [...current, { ...tab, title: labelForUrl(tab.url) }]); setActiveId(tab.id)
    }).catch((error: unknown) => setLocalError(error instanceof Error ? error.message : String(error)))
  }
  function removeTab(id: string) {
    controllers.current.delete(id)
    setFrames((current) => { const next = { ...current }; delete next[id]; return next })
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== id)
      if (id === activeId) setActiveId(next[0]?.id ?? '')
      return next
    })
  }
  function closeTab(id: string) {
    if (tabs.length <= 1) return
    void closeServerBrowserTab(id).then(() => removeTab(id)).catch((error: unknown) => setLocalError(String(error)))
  }
  function navigate() {
    try {
      const url = normalizeUrl(draft)
      if (activeTab && controllers.current.has(activeTab.id)) controllers.current.get(activeTab.id)?.command('navigate', { url })
      else addTab(url)
      setDraft(url); setLocalError(null); addressRef.current?.blur()
    } catch (error) { setLocalError(error instanceof Error && error.message === 'http-only' ? t('browser.httpOnly') : t('browser.invalidAddress')) }
  }
  function navigateHistory(name: 'back' | 'forward') { if (activeTab) controllers.current.get(activeTab.id)?.command(name) }
  function reloadOrStop() { if (activeTab) controllers.current.get(activeTab.id)?.command(activeFrame?.loading ? 'stop' : 'reload') }
  useFocusedShortcutScope(shortcutScopeRef, { closeTab: () => {
    if (!activeTab || tabs.length <= 1) return false
    closeTab(activeTab.id); return true
  } })
  const error = localError

  return (
    <section ref={shortcutScopeRef} className="flex h-full min-w-0 flex-col bg-surface-deep text-ink" aria-label={t('browser.title')}>
      <div className="flex h-9 shrink-0 items-stretch border-b border-edge bg-surface">
        <div className="no-scrollbar flex min-w-0 flex-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button key={tab.id} type="button" onClick={() => setActiveId(tab.id)}
              className={`group flex min-w-[7rem] max-w-[14rem] items-center gap-1 border-r border-edge px-2 text-left text-xs ${tab.id === activeTab?.id ? 'bg-surface-raised text-ink' : 'text-ink-secondary hover:bg-surface-hover hover:text-ink'}`}
              title={tab.url}>
              <span className="truncate">{tab.title}</span>
              {tabs.length > 1 && <span role="button" tabIndex={-1} onClick={(event) => { event.stopPropagation(); closeTab(tab.id) }} className="ml-auto rounded px-1 text-ink-muted opacity-70 hover:bg-surface hover:text-ink group-hover:opacity-100" aria-label={t('browser.closeTab')}>×</span>}
            </button>
          ))}
        </div>
        <IconButton label={t('browser.newTab')} onClick={() => addTab()}><span className="text-lg leading-none">+</span></IconButton>
        <button
          type="button"
          onClick={onClose}
          className="mx-1 flex h-6 w-6 shrink-0 self-center items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
          title={standalone ? t('browser.closePopup') : t('browser.close')}
          aria-label={standalone ? t('browser.closePopup') : t('browser.close')}
        >
          <WindowCloseGlyph />
        </button>
      </div>

      <form className="flex shrink-0 items-center gap-1 border-b border-edge bg-surface px-2 py-1" onSubmit={(event) => { event.preventDefault(); navigate() }}>
        <IconButton label={t('browser.back')} disabled={!activeFrame?.canGoBack} onClick={() => navigateHistory('back')}><NavGlyph path="m15 18-6-6 6-6" /></IconButton>
        <IconButton label={t('browser.forward')} disabled={!activeFrame?.canGoForward} onClick={() => navigateHistory('forward')}><NavGlyph path="m9 18 6-6-6-6" /></IconButton>
        <IconButton label={activeFrame?.loading ? t('browser.stopLoading') : t('common.refresh')} onClick={reloadOrStop}>
          {activeFrame?.loading ? <StopGlyph /> : <ReloadGlyph />}
        </IconButton>
        <div className="mx-1 flex min-w-0 flex-1 items-center rounded-md border border-edge-strong bg-surface-deep focus-within:border-accent">
          <span className={`ml-2 h-1.5 w-1.5 shrink-0 rounded-full ${error ? 'bg-danger' : activeFrame?.loading ? 'animate-pulse bg-warning' : 'bg-success'}`} title={t('browser.serverStatus')} />
          <input ref={addressRef} value={draft} onChange={(event) => setDraft(event.target.value)} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 bg-transparent px-2 py-1 font-mono text-xs text-ink outline-none" spellCheck={false} inputMode="url" aria-label={t('browser.address')} placeholder="https://example.com" />
        </div>
        <button type="submit" className="rounded bg-accent px-2.5 py-1 text-xs text-ink-on-accent hover:opacity-90">{t('browser.go')}</button>
      </form>

      {error && <div className="shrink-0 border-b border-danger bg-danger-surface px-3 py-2 text-xs text-danger-ink">{error}</div>}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
        {tabs.filter((tab) => tab.streamUrl).map((tab) => (
          <div key={tab.id} className={`absolute inset-0 flex h-full w-full flex-col ${tab.id === activeTab?.id ? '' : 'hidden'}`}>
            <ServerDomBrowser streamUrl={tab.streamUrl} reopen={async () => (await openServerBrowserTab(tab.id, tab.url)).streamUrl}
              onController={(controller) => { if (controller) controllers.current.set(tab.id, controller); else controllers.current.delete(tab.id) }}
              onStatus={(status) => updateStatus(tab.id, status)} />
          </div>
        ))}
        {activeFrame?.loading && (
          <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-surface/85 p-2 shadow-lg" aria-label={t('browser.pageLoading')}>
            <span className="block h-4 w-4 animate-spin rounded-full border-2 border-edge-strong border-t-accent" />
          </div>
        )}
      </div>
      <div className="flex h-6 shrink-0 items-center border-t border-edge bg-surface px-2 text-[10px] text-ink-muted">
        <span className="truncate">{t('browser.serverHint')}</span>
        <span className="ml-auto shrink-0 pl-2">SERVER BROWSER</span>
      </div>
    </section>
  )
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
function StopGlyph() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1" /></svg> }
function ReloadGlyph() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M20 6v5h-5" /><path d="M19 11a8 8 0 1 0 .2 4" /></svg> }
