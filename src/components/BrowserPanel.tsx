import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useFocusedShortcutScope } from '@mew/shortcuts'
import { fetchBrowserFrameUrl } from '../api/client'
import { useI18n } from '../i18n'

type BrowserTab = { id: string; url: string; title: string }
type BrowserFrame = { src: string; loading: boolean; error: string | null; historyLength: number; loadId: number }
type BrowserStateMessage = { type: 'mew-browser-state'; url: string; title?: string; historyLength?: number }
type BrowserCommand = 'back' | 'forward' | 'reload' | 'stop'

const TABS_KEY = 'mew:browser-tabs'
const ACTIVE_KEY = 'mew:browser-active-tab'
const DEFAULT_URL = 'http://localhost:3100/'
const TAB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const BROWSER_ERROR_HTTP_ONLY = 'mew:browser-http-only'
const BROWSER_ERROR_LOOPBACK_ONLY = 'mew:browser-loopback-only'

function newTab(url = DEFAULT_URL): BrowserTab {
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10)
  return { id, url, title: labelForUrl(url) }
}

function normalizeUrl(raw: string): URL {
  const trimmed = raw.trim()
  const hostWithPort = /^[^/?#]+:\d+(?:[/?#]|$)/.test(trimmed)
  const scheme = hostWithPort ? undefined : /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https') throw new Error(BROWSER_ERROR_HTTP_ONLY)
  const url = new URL(scheme ? trimmed : `http://${trimmed}`)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(BROWSER_ERROR_HTTP_ONLY)
  const host = url.hostname.toLowerCase()
  const parts = host.split('.')
  const loopbackIpv4 = parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  if (host !== 'localhost' && host !== '[::1]' && !loopbackIpv4) {
    throw new Error(BROWSER_ERROR_LOOPBACK_ONLY)
  }
  return url
}

function labelForUrl(raw: string, fallback = ''): string {
  try {
    const url = normalizeUrl(raw)
    return `${url.hostname}${url.port ? `:${url.port}` : ''}`
  } catch {
    return raw.trim() || fallback
  }
}

function continuationUrl(frameSrc: string, target: URL): string | null {
  try {
    const frame = new URL(frameSrc, location.origin)
    const parts = frame.pathname.split('/')
    if (parts[1] !== '__mew_browser' || !parts[3]) return null
    const origin = btoa(target.origin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    return `/__mew_browser/${origin}/${parts[3]}${target.pathname}${target.search}${target.hash}`
  } catch {
    return null
  }
}

function loadTabs(): BrowserTab[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TABS_KEY) ?? '[]')
    if (Array.isArray(parsed)) {
      const tabs = parsed.filter((entry): entry is BrowserTab => {
        const tab = entry as BrowserTab | null
        return typeof tab?.id === 'string' && TAB_ID_RE.test(tab.id) && typeof tab.url === 'string' && typeof tab.title === 'string'
      })
      if (tabs.length > 0) return tabs
    }
  } catch {
    /* 깨진 로컬 상태는 기본 탭으로 복구한다 */
  }
  return [newTab()]
}

function messageState(value: unknown): BrowserStateMessage | null {
  if (!value || typeof value !== 'object') return null
  const message = value as Partial<BrowserStateMessage>
  if (message.type !== 'mew-browser-state' || typeof message.url !== 'string' || message.url.length > 8192) return null
  try {
    normalizeUrl(message.url)
  } catch {
    return null
  }
  return {
    type: 'mew-browser-state',
    url: message.url,
    title: typeof message.title === 'string' ? message.title.slice(0, 256) : '',
    historyLength: typeof message.historyLength === 'number' ? Math.max(1, Math.floor(message.historyLength)) : 1,
  }
}

export function BrowserPanel({ onClose, standalone = false }: { onClose: () => void; standalone?: boolean }) {
  const { t } = useI18n()
  const shortcutScopeRef = useRef<HTMLElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const iframeRefs = useRef(new Map<string, HTMLIFrameElement>())
  const tabsRef = useRef<BrowserTab[]>([])
  const [tabs, setTabs] = useState(loadTabs)
  const [activeId, setActiveId] = useState(() => {
    const saved = localStorage.getItem(ACTIVE_KEY)
    return saved && tabs.some((tab) => tab.id === saved) ? saved : tabs[0]?.id ?? ''
  })
  const [frames, setFrames] = useState<Record<string, BrowserFrame>>({})
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0]
  const activeFrame = activeTab ? frames[activeTab.id] : undefined
  const [draft, setDraft] = useState(activeTab?.url ?? DEFAULT_URL)
  const [localError, setLocalError] = useState<string | null>(null)
  tabsRef.current = tabs

  const openFrame = useCallback((tabId: string, url: string) => {
    setFrames((current) => ({
      ...current,
      [tabId]: { src: current[tabId]?.src ?? 'about:blank', loading: true, error: null, historyLength: current[tabId]?.historyLength ?? 1, loadId: current[tabId]?.loadId ?? 0 },
    }))
    fetchBrowserFrameUrl(url)
      .then(({ url: src }) => {
        setFrames((current) => ({ ...current, [tabId]: { src, loading: true, error: null, historyLength: 1, loadId: (current[tabId]?.loadId ?? 0) + 1 } }))
      })
      .catch((error) => {
        setFrames((current) => ({
          ...current,
          [tabId]: {
            src: 'about:blank',
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            historyLength: 1,
            loadId: (current[tabId]?.loadId ?? 0) + 1,
          },
        }))
      })
  }, [])

  useEffect(() => { localStorage.setItem(TABS_KEY, JSON.stringify(tabs)) }, [tabs])
  useEffect(() => { localStorage.setItem(ACTIVE_KEY, activeId) }, [activeId])
  useEffect(() => {
    const tab = tabsRef.current.find((item) => item.id === activeId)
    if (!tab) return
    setDraft(tab.url)
    setLocalError(null)
    if (!frames[tab.id]) openFrame(tab.id, tab.url)
    // 탭 안에서 URL이 바뀌어도 iframe 세션을 다시 만들지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, openFrame])

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const message = messageState(event.data)
      if (!message) return
      const tabId = [...iframeRefs.current].find(([, iframe]) => iframe.contentWindow === event.source)?.[0]
      if (!tabId) return
      setFrames((current) => {
        const frame = current[tabId]
        return frame ? { ...current, [tabId]: { ...frame, loading: false, error: null, historyLength: message.historyLength ?? 1 } } : current
      })
      setTabs((current) => current.map((tab) => tab.id === tabId
        ? { ...tab, url: message.url, title: message.title?.trim() || labelForUrl(message.url, t('browser.newTab')) }
        : tab))
      if (tabId === activeId && document.activeElement !== addressRef.current) setDraft(message.url)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [activeId, t])

  function addTab(url = DEFAULT_URL) {
    const tab = newTab(url)
    setTabs((current) => [...current, tab])
    setActiveId(tab.id)
  }

  function closeTab(id: string) {
    if (tabs.length <= 1) return
    iframeRefs.current.delete(id)
    setFrames((current) => {
      const { [id]: _removed, ...next } = current
      return next
    })
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id)
      const next = current.filter((tab) => tab.id !== id)
      if (id === activeId) setActiveId(next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? '')
      return next
    })
  }

  function command(tabId: string, name: BrowserCommand): boolean {
    const frame = iframeRefs.current.get(tabId)
    if (!frame?.contentWindow || !frames[tabId] || frames[tabId].src === 'about:blank') return false
    frame.contentWindow.postMessage({ type: 'mew-browser-command', command: name }, '*')
    return true
  }

  function navigate() {
    if (!activeTab) return
    try {
      const url = normalizeUrl(draft).toString()
      setTabs((current) => current.map((tab) => tab.id === activeTab.id ? { ...tab, url, title: labelForUrl(url) } : tab))
      const nextSrc = activeFrame ? continuationUrl(activeFrame.src, new URL(url)) : null
      if (nextSrc) {
        setFrames((current) => ({
          ...current,
          [activeTab.id]: { ...current[activeTab.id], src: nextSrc, loading: true, error: null, loadId: (current[activeTab.id]?.loadId ?? 0) + 1 },
        }))
      } else {
        openFrame(activeTab.id, url)
      }
      setDraft(url)
      setLocalError(null)
      addressRef.current?.blur()
    } catch (error) {
      if (error instanceof Error && error.message === BROWSER_ERROR_HTTP_ONLY) setLocalError(t('browser.httpOnly'))
      else if (error instanceof Error && error.message === BROWSER_ERROR_LOOPBACK_ONLY) setLocalError(t('browser.loopbackOnly'))
      else setLocalError(t('browser.invalidAddress'))
    }
  }

  function navigateHistory(name: 'back' | 'forward') {
    if (!activeTab) return
    command(activeTab.id, name)
  }

  function reloadOrStop() {
    if (!activeTab) return
    if (activeFrame?.loading) {
      command(activeTab.id, 'stop')
      setFrames((current) => ({ ...current, [activeTab.id]: { ...current[activeTab.id], loading: false } }))
      return
    }
    setFrames((current) => current[activeTab.id]
      ? { ...current, [activeTab.id]: { ...current[activeTab.id], loading: true, error: null, loadId: current[activeTab.id].loadId + 1 } }
      : current)
    if (!command(activeTab.id, 'reload')) openFrame(activeTab.id, activeTab.url)
  }

  useFocusedShortcutScope(shortcutScopeRef, { closeTab: () => {
    if (!activeTab || tabs.length <= 1) return false
    closeTab(activeTab.id)
    return true
  } })

  const error = localError ?? activeFrame?.error
  const canNavigateHistory = Boolean(activeFrame && activeFrame.historyLength > 1)

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
        <IconButton label={standalone ? t('browser.closePopup') : t('browser.close')} onClick={onClose}><span className="text-lg leading-none">×</span></IconButton>
      </div>

      <form className="flex shrink-0 items-center gap-1 border-b border-edge bg-surface px-2 py-1" onSubmit={(event) => { event.preventDefault(); navigate() }}>
        <IconButton label={t('browser.back')} disabled={!canNavigateHistory} onClick={() => navigateHistory('back')}><NavGlyph path="m15 18-6-6 6-6" /></IconButton>
        <IconButton label={t('browser.forward')} disabled={!canNavigateHistory} onClick={() => navigateHistory('forward')}><NavGlyph path="m9 18 6-6-6-6" /></IconButton>
        <IconButton label={activeFrame?.loading ? t('browser.stopLoading') : t('common.refresh')} onClick={reloadOrStop}>
          {activeFrame?.loading ? <StopGlyph /> : <ReloadGlyph />}
        </IconButton>
        <div className="mx-1 flex min-w-0 flex-1 items-center rounded-md border border-edge-strong bg-surface-deep focus-within:border-accent">
          <span className={`ml-2 h-1.5 w-1.5 shrink-0 rounded-full ${error ? 'bg-danger' : activeFrame?.loading ? 'animate-pulse bg-warning' : 'bg-success'}`} title={t('browser.loopbackStatus')} />
          <input ref={addressRef} value={draft} onChange={(event) => setDraft(event.target.value)} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 bg-transparent px-2 py-1 font-mono text-xs text-ink outline-none" spellCheck={false} inputMode="url" aria-label={t('browser.address')} placeholder="localhost:3100" />
        </div>
        <button type="submit" className="rounded bg-accent px-2.5 py-1 text-xs text-ink-on-accent hover:opacity-90">{t('browser.go')}</button>
      </form>

      {error && <div className="shrink-0 border-b border-danger bg-danger-surface px-3 py-2 text-xs text-danger-ink">{error}</div>}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
        {Object.entries(frames).map(([tabId, frame]) => (
          <iframe
            key={`${tabId}:${frame.loadId}`}
            ref={(element) => { if (element) iframeRefs.current.set(tabId, element); else iframeRefs.current.delete(tabId) }}
            src={frame.src}
            title={tabs.find((tab) => tab.id === tabId)?.title ?? t('browser.title')}
            className={`absolute inset-0 h-full w-full border-0 bg-white ${tabId === activeTab?.id ? 'block' : 'hidden'}`}
            sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-scripts"
            referrerPolicy="no-referrer"
            onLoad={() => setFrames((current) => current[tabId]
              ? { ...current, [tabId]: { ...current[tabId], loading: false } }
              : current)}
          />
        ))}
        {activeFrame?.loading && (
          <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-surface/85 p-2 shadow-lg" aria-label={t('browser.pageLoading')}>
            <span className="block h-4 w-4 animate-spin rounded-full border-2 border-edge-strong border-t-accent" />
          </div>
        )}
      </div>
      <div className="flex h-6 shrink-0 items-center border-t border-edge bg-surface px-2 text-[10px] text-ink-muted">
        <span className="truncate">{t('browser.loopbackHint')}</span>
        <span className="ml-auto shrink-0 pl-2">SERVER LOOPBACK</span>
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
function StopGlyph() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1" /></svg> }
function ReloadGlyph() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M20 6v5h-5" /><path d="M19 11a8 8 0 1 0 .2 4" /></svg> }
