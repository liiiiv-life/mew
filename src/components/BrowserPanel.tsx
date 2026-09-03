import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useFocusedShortcutScope } from '@mew/shortcuts'
import { useRemoteBrowser, type RemoteBrowserState } from '../hooks/useRemoteBrowser'

type BrowserTab = { id: string; url: string; title: string }

const TABS_KEY = 'mew:browser-tabs'
const ACTIVE_KEY = 'mew:browser-active-tab'
const DEFAULT_URL = 'http://localhost:3100/'
const TAB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function newTab(url = DEFAULT_URL): BrowserTab {
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10)
  return { id, url, title: labelForUrl(url) }
}

function labelForUrl(raw: string): string {
  try {
    const url = normalizeUrl(raw)
    return `${url.hostname}${url.port ? `:${url.port}` : ''}`
  } catch {
    return raw.trim() || '새 탭'
  }
}

function normalizeUrl(raw: string): URL {
  const trimmed = raw.trim()
  const hostWithPort = /^[^/?#]+:\d+(?:[/?#]|$)/.test(trimmed)
  const scheme = hostWithPort ? undefined : /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https') throw new Error('http 또는 https 주소만 열 수 있습니다')
  const withScheme = scheme ? trimmed : `http://${trimmed}`
  const url = new URL(withScheme)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('http 또는 https 주소만 열 수 있습니다')
  return url
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

function modifiers(event: KeyboardEvent<HTMLElement>): number {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)
}

function cdpButton(button: number): 'left' | 'middle' | 'right' | 'none' {
  return button === 0 ? 'left' : button === 1 ? 'middle' : button === 2 ? 'right' : 'none'
}

export function BrowserPanel({ onClose, standalone = false }: { onClose: () => void; standalone?: boolean }) {
  const shortcutScopeRef = useRef<HTMLElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const keyboardRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)
  const composedTextRef = useRef('')
  const moveFrameRef = useRef(0)
  const pendingMoveRef = useRef<ReturnType<typeof pointerPayload> | null>(null)
  const lastRemoteUrlRef = useRef('')
  const clickRef = useRef({ at: 0, x: 0, y: 0, button: -1, count: 0 })
  const [tabs, setTabs] = useState(loadTabs)
  const [activeId, setActiveId] = useState(() => {
    const saved = localStorage.getItem(ACTIVE_KEY)
    return saved && tabs.some((tab) => tab.id === saved) ? saved : tabs[0]?.id ?? ''
  })
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0]
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const [draft, setDraft] = useState(activeTab?.url ?? DEFAULT_URL)
  const [remoteState, setRemoteState] = useState<RemoteBrowserState>({
    url: activeTab?.url ?? DEFAULT_URL,
    title: activeTab?.title ?? '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
  })
  const [localError, setLocalError] = useState<string | null>(null)

  const handleRemoteState = useCallback((state: RemoteBrowserState) => {
    setRemoteState(state)
    setDraft((current) => current === lastRemoteUrlRef.current || document.activeElement?.getAttribute('aria-label') !== '주소' ? state.url : current)
    lastRemoteUrlRef.current = state.url
    setTabs((current) => current.map((tab) => tab.id === activeId
      ? { ...tab, url: state.url, title: state.title.trim() || labelForUrl(state.url) }
      : tab))
  }, [activeId])

  const handlePopup = useCallback((tab: BrowserTab) => {
    setTabs((current) => current.some((item) => item.id === tab.id) ? current : [...current, tab])
    setActiveId(tab.id)
  }, [])

  const remote = useRemoteBrowser(activeTab?.id ?? '', activeTab?.url ?? DEFAULT_URL, handleRemoteState, handlePopup)
  const resizeRemote = remote.resize

  useEffect(() => { localStorage.setItem(TABS_KEY, JSON.stringify(tabs)) }, [tabs])
  useEffect(() => { localStorage.setItem(ACTIVE_KEY, activeId) }, [activeId])
  useEffect(() => {
    const tab = activeTabRef.current
    const url = tab?.url ?? DEFAULT_URL
    setDraft(url)
    lastRemoteUrlRef.current = url
    setLocalError(null)
    setRemoteState({ url, title: tab?.title ?? '', loading: false, canGoBack: false, canGoForward: false })
  }, [activeId])

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const observer = new ResizeObserver(([entry]) => resizeRemote(entry.contentRect.width, entry.contentRect.height))
    observer.observe(surface)
    return () => observer.disconnect()
  }, [activeTab?.id, resizeRemote])

  useEffect(() => () => cancelAnimationFrame(moveFrameRef.current), [])

  function addTab(url = DEFAULT_URL) {
    const tab = newTab(url)
    setTabs((previous) => [...previous, tab])
    setActiveId(tab.id)
  }

  function closeTab(id: string) {
    if (tabs.length <= 1) return
    remote.closeTab(id)
    setTabs((previous) => {
      const index = previous.findIndex((tab) => tab.id === id)
      const next = previous.filter((tab) => tab.id !== id)
      if (id === activeId) setActiveId(next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? '')
      return next
    })
  }

  function navigate() {
    if (!activeTab) return
    try {
      const url = normalizeUrl(draft).toString()
      remote.navigate(url)
      setLocalError(null)
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '주소가 올바르지 않습니다')
    }
  }

  function openPopup() {
    localStorage.setItem(ACTIVE_KEY, activeId)
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs))
    const popup = window.open('/browser', 'mew-browser', 'popup=yes,width=1280,height=860,resizable=yes,scrollbars=no')
    if (!popup) {
      setLocalError('팝업이 차단되었습니다. 이 사이트의 팝업을 허용한 뒤 다시 눌러 주세요.')
      return
    }
    popup.focus()
    if (!standalone) onClose()
  }

  function pointerPayload(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const width = remote.frame?.width ?? Math.max(320, rect.width)
    const height = remote.frame?.height ?? Math.max(240, rect.height)
    return {
      pointerType: event.pointerType === 'touch' ? 'touch' : 'mouse',
      x: Math.max(0, Math.min(width, (event.clientX - rect.left) * width / rect.width)),
      y: Math.max(0, Math.min(height, (event.clientY - rect.top) * height / rect.height)),
      button: cdpButton(event.button),
      buttons: event.buttons,
    }
  }

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus({ preventScroll: true })
    const position = pointerPayload(event)
    const now = Date.now()
    const previous = clickRef.current
    const close = Math.abs(previous.x - position.x) < 6 && Math.abs(previous.y - position.y) < 6
    const count = previous.button === event.button && close && now - previous.at < 500 ? Math.min(3, previous.count + 1) : 1
    clickRef.current = { at: now, x: position.x, y: position.y, button: event.button, count }
    remote.pointer('down', { ...position, clickCount: count })
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    pendingMoveRef.current = pointerPayload(event)
    if (moveFrameRef.current) return
    moveFrameRef.current = requestAnimationFrame(() => {
      moveFrameRef.current = 0
      const payload = pendingMoveRef.current
      pendingMoveRef.current = null
      if (payload) remote.pointer('move', { ...payload, clickCount: 0 })
    })
  }

  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (moveFrameRef.current) cancelAnimationFrame(moveFrameRef.current)
    moveFrameRef.current = 0
    pendingMoveRef.current = null
    const position = pointerPayload(event)
    remote.pointer('up', { ...position, clickCount: clickRef.current.count || 1 })
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function keyEvent(event: KeyboardEvent<HTMLElement>, type: 'down' | 'up', fromSoftKeyboard = false) {
    event.stopPropagation()
    if (fromSoftKeyboard && (event.key === 'Unidentified' || event.key === 'Process')) return
    event.preventDefault()
    remote.key(type, { key: event.key, code: event.code, modifiers: modifiers(event), repeat: event.repeat })
  }

  useFocusedShortcutScope(shortcutScopeRef, { closeTab: () => {
    if (!activeTab || tabs.length <= 1) return false
    closeTab(activeTab.id)
    return true
  } })

  const error = localError ?? remote.error

  return (
    <section ref={shortcutScopeRef} className="flex h-full min-w-0 flex-col bg-surface-deep text-ink" aria-label="브라우저">
      <div className="flex h-9 shrink-0 items-stretch border-b border-edge bg-surface">
        <div className="no-scrollbar flex min-w-0 flex-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button key={tab.id} type="button" onClick={() => setActiveId(tab.id)}
              className={`group flex min-w-[7rem] max-w-[14rem] items-center gap-1 border-r border-edge px-2 text-left text-xs ${tab.id === activeTab?.id ? 'bg-surface-raised text-ink' : 'text-ink-secondary hover:bg-surface-hover hover:text-ink'}`}
              title={tab.url}>
              <span className="truncate">{tab.title}</span>
              {tabs.length > 1 && <span role="button" tabIndex={-1} onClick={(event) => { event.stopPropagation(); closeTab(tab.id) }} className="ml-auto rounded px-1 text-ink-muted opacity-70 hover:bg-surface hover:text-ink group-hover:opacity-100" aria-label="탭 닫기">×</span>}
            </button>
          ))}
        </div>
        <IconButton label="새 탭" onClick={() => addTab()}><span className="text-lg leading-none">+</span></IconButton>
        {!standalone && <IconButton label="독립 팝업으로 열기" onClick={openPopup}><PopOutGlyph /></IconButton>}
        <IconButton label={standalone ? '팝업 닫기' : '브라우저 닫기'} onClick={onClose}><span className="text-lg leading-none">×</span></IconButton>
      </div>

      <form className="flex shrink-0 items-center gap-1 border-b border-edge bg-surface px-2 py-1" onSubmit={(event) => { event.preventDefault(); navigate() }}>
        <IconButton label="뒤로" disabled={!remoteState.canGoBack} onClick={remote.back}><NavGlyph path="m15 18-6-6 6-6" /></IconButton>
        <IconButton label="앞으로" disabled={!remoteState.canGoForward} onClick={remote.forward}><NavGlyph path="m9 18 6-6-6-6" /></IconButton>
        <IconButton label={remoteState.loading ? '불러오기 중지' : '새로고침'} onClick={remoteState.loading ? remote.stop : remote.reload}>
          {remoteState.loading ? <StopGlyph /> : <ReloadGlyph />}
        </IconButton>
        <div className="mx-1 flex min-w-0 flex-1 items-center rounded-md border border-edge-strong bg-surface-deep focus-within:border-accent">
          <span className={`ml-2 h-1.5 w-1.5 shrink-0 rounded-full ${remote.connection === 'connected' ? 'bg-success' : remote.connection === 'connecting' ? 'animate-pulse bg-warning' : 'bg-danger'}`} title="서버 브라우저 연결 상태" />
          <input value={draft} onChange={(event) => setDraft(event.target.value)} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 bg-transparent px-2 py-1 font-mono text-xs text-ink outline-none" spellCheck={false} inputMode="url" aria-label="주소" />
        </div>
        <button type="submit" className="rounded bg-accent px-2.5 py-1 text-xs text-ink-on-accent hover:opacity-90">이동</button>
        <IconButton label="화면 키보드" onClick={() => keyboardRef.current?.focus({ preventScroll: true })}><KeyboardGlyph /></IconButton>
      </form>

      {error && <div className="shrink-0 border-b border-danger bg-danger-surface px-3 py-2 text-xs text-danger-ink">{error}</div>}

      <div ref={surfaceRef} tabIndex={0} className="relative min-h-0 flex-1 touch-none overflow-hidden bg-white outline-none"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp} onPointerCancel={pointerUp}
        onWheel={(event) => {
          event.preventDefault(); event.stopPropagation()
          const rect = event.currentTarget.getBoundingClientRect()
          const width = remote.frame?.width ?? rect.width
          const height = remote.frame?.height ?? rect.height
          remote.wheel({ x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height, deltaX: event.deltaX, deltaY: event.deltaY })
        }}
        onKeyDown={(event) => keyEvent(event, 'down')} onKeyUp={(event) => keyEvent(event, 'up')}
        onPaste={(event) => { event.preventDefault(); event.stopPropagation(); remote.insertText(event.clipboardData.getData('text/plain')) }}
        onContextMenu={(event) => event.preventDefault()} aria-label="서버 브라우저 화면">
        {remote.frame ? <img src={remote.frame.src} alt="" draggable={false} className="pointer-events-none h-full w-full select-none" /> : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-deep text-center text-sm text-ink-muted">
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-edge-strong border-t-accent" />
            <span>WSL에서 브라우저를 여는 중…</span>
          </div>
        )}
        <textarea ref={keyboardRef} value=""
          onChange={(event) => {
            const text = event.currentTarget.value
            if (composedTextRef.current === text) { composedTextRef.current = ''; return }
            if (!composingRef.current && text) remote.insertText(text)
          }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={(event) => { composingRef.current = false; composedTextRef.current = event.data; if (event.data) remote.insertText(event.data) }}
          onKeyDown={(event) => keyEvent(event, 'down', true)} onKeyUp={(event) => keyEvent(event, 'up', true)}
          onPaste={(event) => { event.preventDefault(); remote.insertText(event.clipboardData.getData('text/plain')) }}
          className="absolute bottom-0 left-0 h-px w-px resize-none opacity-0" aria-label="원격 브라우저 키보드 입력" autoCapitalize="none" autoCorrect="off" />
      </div>
      <div className="flex h-6 shrink-0 items-center border-t border-edge bg-surface px-2 text-[10px] text-ink-muted">
        <span className="truncate">요청·쿠키·JavaScript는 이 기기가 아니라 Mew 서버의 격리된 Chromium에서 처리됩니다.</span>
        <span className="ml-auto shrink-0 pl-2">SERVER</span>
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
function PopOutGlyph() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6" /><path d="m20 4-9 9" /><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" /></svg> }
function KeyboardGlyph() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M19 10h.01M7 14h.01M11 14h6" /></svg> }
