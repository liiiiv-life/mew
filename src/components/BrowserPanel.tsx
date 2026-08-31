import { useEffect, useRef, useState } from 'react'
import { useFocusedShortcutScope } from '@mew/shortcuts'
import { fetchBrowserFrameUrl } from '../api/client'

type BrowserTab = {
  id: string
  url: string
  title: string
}

const TABS_KEY = 'mew:browser-tabs'
const ACTIVE_KEY = 'mew:browser-active-tab'
const DEFAULT_URL = 'http://localhost:3100/'

function newTab(url = DEFAULT_URL): BrowserTab {
  return { id: Math.random().toString(36).slice(2, 10), url, title: labelForUrl(url) }
}

function labelForUrl(raw: string): string {
  try {
    const url = normalizeUrl(raw)
    return `${url.hostname}${url.port ? `:${url.port}` : ''}`
  } catch {
    return raw.trim() || 'localhost'
  }
}

function normalizeUrl(raw: string): URL {
  const trimmed = raw.trim()
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  return new URL(withScheme)
}

function loadTabs(): BrowserTab[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TABS_KEY) ?? '[]')
    if (Array.isArray(parsed)) {
      const tabs = parsed.filter((entry): entry is BrowserTab => {
        const tab = entry as BrowserTab | null
        return typeof tab?.id === 'string' && typeof tab.url === 'string' && typeof tab.title === 'string'
      })
      if (tabs.length > 0) return tabs
    }
  } catch {
    /* ignore */
  }
  return [newTab()]
}

export function BrowserPanel({ onClose }: { onClose: () => void }) {
  const shortcutScopeRef = useRef<HTMLElement>(null)
  const [tabs, setTabs] = useState(loadTabs)
  const [activeId, setActiveId] = useState(() => localStorage.getItem(ACTIVE_KEY) || tabs[0]?.id || '')
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0]
  const activeUrl = activeTab?.url ?? ''
  const [draft, setDraft] = useState(activeTab?.url ?? DEFAULT_URL)
  const [frameSrc, setFrameSrc] = useState('about:blank')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs))
  }, [tabs])

  useEffect(() => {
    localStorage.setItem(ACTIVE_KEY, activeId)
  }, [activeId])

  useEffect(() => {
    setDraft(activeTab?.url ?? DEFAULT_URL)
    setError(null)
  }, [activeTab?.id, activeTab?.url])

  useEffect(() => {
    let alive = true
    if (!activeUrl) {
      setFrameSrc('about:blank')
      return
    }
    fetchBrowserFrameUrl(activeUrl)
      .then(({ url }) => {
        if (alive) {
          setFrameSrc(url)
          setError(null)
        }
      })
      .catch((err) => {
        if (alive) {
          setFrameSrc('about:blank')
          setError(err instanceof Error ? err.message : String(err))
        }
      })
    return () => {
      alive = false
    }
  }, [activeUrl])

  function addTab() {
    const tab = newTab()
    setTabs((prev) => [...prev, tab])
    setActiveId(tab.id)
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      if (prev.length <= 1) return prev
      const index = prev.findIndex((tab) => tab.id === id)
      const next = prev.filter((tab) => tab.id !== id)
      if (id === activeId) setActiveId(next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? '')
      return next
    })
  }

  function navigate() {
    if (!activeTab) return
    try {
      const url = normalizeUrl(draft).toString()
      setTabs((prev) => prev.map((tab) => (tab.id === activeTab.id ? { ...tab, url, title: labelForUrl(url) } : tab)))
      setError(null)
    } catch {
      setError('주소가 올바르지 않습니다')
    }
  }

  function reload() {
    if (!activeTab) return
    setTabs((prev) => prev.map((tab) => (tab.id === activeTab.id ? { ...tab, url: `${tab.url}${tab.url.includes('#') ? '' : '#'}` } : tab)))
    requestAnimationFrame(() => {
      setTabs((prev) => prev.map((tab) => (tab.id === activeTab.id ? { ...tab, url: tab.url.replace(/#$/, '') } : tab)))
    })
  }

  // 마지막 탭이면 브라우저 자체의 Ctrl+W를 양보한다.
  useFocusedShortcutScope(shortcutScopeRef, { closeTab: () => {
    if (!activeTab || tabs.length <= 1) return false
    closeTab(activeTab.id)
    return true
  } })

  return (
    <section ref={shortcutScopeRef} className="flex h-full min-w-0 flex-col bg-surface-deep text-ink" aria-label="브라우저">
      <div className="flex h-9 shrink-0 items-stretch border-b border-edge bg-surface">
        <div className="no-scrollbar flex min-w-0 flex-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveId(tab.id)}
              className={`group flex min-w-[7rem] max-w-[12rem] items-center gap-1 border-r border-edge px-2 text-left text-xs ${
                tab.id === activeTab?.id ? 'bg-surface-raised text-ink' : 'text-ink-secondary hover:bg-surface-hover hover:text-ink'
              }`}
              title={tab.url}
            >
              <span className="truncate">{tab.title}</span>
              {tabs.length > 1 && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(tab.id)
                  }}
                  className="ml-auto rounded px-1 text-ink-muted opacity-70 hover:bg-surface hover:text-ink group-hover:opacity-100"
                  aria-label="탭 닫기"
                >
                  ×
                </span>
              )}
            </button>
          ))}
        </div>
        <button type="button" onClick={addTab} className="w-9 shrink-0 border-r border-edge text-ink-secondary hover:bg-surface-hover hover:text-ink" title="새 탭" aria-label="새 탭">
          +
        </button>
        <button type="button" onClick={onClose} className="w-9 shrink-0 text-ink-secondary hover:bg-surface-hover hover:text-ink" title="브라우저 닫기" aria-label="브라우저 닫기">
          ×
        </button>
      </div>

      <form
        className="flex shrink-0 items-center gap-1 border-b border-edge bg-surface px-2 py-1"
        onSubmit={(e) => {
          e.preventDefault()
          navigate()
        }}
      >
        <button type="button" onClick={reload} className="rounded p-1 text-ink-secondary hover:bg-surface-hover hover:text-ink" title="새로고침" aria-label="새로고침">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.6-6.4" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-w-0 flex-1 rounded border border-edge-strong bg-surface-deep px-2 py-1 font-mono text-xs text-ink outline-none focus:border-edge-bright"
          spellCheck={false}
          inputMode="url"
          aria-label="주소"
        />
        <button type="submit" className="rounded bg-surface-raised px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink">
          이동
        </button>
      </form>

      {error ? (
        <div className="border-b border-danger bg-danger-surface px-3 py-2 text-xs text-danger-ink">{error}</div>
      ) : (
        <div className="border-b border-edge bg-surface px-3 py-1 text-[11px] text-ink-muted">
          이 서버의 localhost/loopback 주소만 열립니다.
        </div>
      )}

      <iframe
        key={frameSrc}
        src={frameSrc}
        title={activeTab?.title ?? '브라우저'}
        className="min-h-0 flex-1 border-0 bg-white"
        sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-scripts"
        referrerPolicy="same-origin"
      />
    </section>
  )
}
