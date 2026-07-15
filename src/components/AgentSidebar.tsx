import { useState, useEffect, useRef } from 'react'
import {
  chatWithAgent,
  fetchAgentMessages,
  fetchAgentModels,
  fetchAgentSessions,
  fetchAgentSkills,
  type AgentModels,
  type AgentProvider,
  type AgentSession,
} from '../api/client'

type Message = { role: 'user' | 'assistant'; content: string }

type AgentTab = {
  id: string
  provider: AgentProvider
  title: string
  messages: Message[]
  sessionId: string
  skill: string
  model: string
  input: string
  loading: boolean
}

const PROVIDERS: { id: AgentProvider; label: string }[] = [
  { id: 'hermes', label: 'Hermes' },
  { id: 'claude', label: 'Claude Code' },
]

function sessionLabel(s: AgentSession): string {
  const d = new Date(s.lastActiveAt * 1000)
  const time = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${time} · ${s.title ?? '(제목 없음)'}`
}

// crypto.randomUUID() needs a secure context (https or localhost) — the dev server binds
// 0.0.0.0 and may be reached over plain http from another host, so avoid relying on it.
function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function makeTab(provider: AgentProvider, defaultModel: string): AgentTab {
  return {
    id: makeId(),
    provider,
    title: '새 대화',
    messages: [],
    sessionId: '',
    skill: '',
    model: defaultModel,
    input: '',
    loading: false,
  }
}

function ModelPicker({
  models,
  value,
  onChange,
  disabled,
}: {
  models: string[]
  value: string
  onChange: (m: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = query.trim()
    ? models.filter((m) => m.toLowerCase().includes(query.trim().toLowerCase()))
    : models

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function openPicker() {
    setOpen(true)
    setQuery('')
    setActiveIndex(0)
    requestAnimationFrame(() => inputRef.current?.select())
  }

  function pick(m: string) {
    onChange(m)
    setOpen(false)
    setQuery('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[activeIndex]) pick(filtered[activeIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        value={open ? query : value}
        onChange={(e) => {
          setQuery(e.target.value)
          setActiveIndex(0)
        }}
        onFocus={openPicker}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="모델 검색…"
        title="사용할 모델"
        className="w-full truncate rounded-lg border border-edge bg-surface px-2 py-1.5 text-xs text-ink-secondary focus:border-edge-bright focus:outline-none disabled:opacity-50"
      />
      {open && filtered.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 z-10 mb-1 max-h-48 overflow-y-auto rounded-lg border border-edge-strong bg-surface py-1 shadow-lg">
          {filtered.map((m, i) => (
            <button
              key={m}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                pick(m)
              }}
              className={`block w-full truncate px-3 py-1.5 text-left text-xs ${
                i === activeIndex ? 'bg-surface-hover text-ink' : 'text-ink-soft hover:bg-surface-raised'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function AgentSidebar({ onClose }: { onClose?: () => void }) {
  const [tabs, setTabs] = useState<AgentTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [skillsByProvider, setSkillsByProvider] = useState<Record<AgentProvider, string[]>>({ hermes: [], claude: [] })
  const [modelsByProvider, setModelsByProvider] = useState<Record<AgentProvider, AgentModels>>({
    hermes: { default: '', models: [] },
    claude: { default: '', models: [] },
  })
  const [sessionsByProvider, setSessionsByProvider] = useState<Record<AgentProvider, AgentSession[]>>({ hermes: [], claude: [] })
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashCancelled, setSlashCancelled] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const activeSkills = activeTab ? skillsByProvider[activeTab.provider] : []
  const activeModels = activeTab ? modelsByProvider[activeTab.provider].models : []
  const activeSessions = activeTab ? sessionsByProvider[activeTab.provider] : []

  // 입력이 "/검색어" 형태(공백 없이)면 스킬 검색 팝업을 연다
  const slashQuery = activeTab ? /^\/(\S*)$/.exec(activeTab.input)?.[1] : undefined
  const slashMatches =
    slashQuery !== undefined && !slashCancelled
      ? activeSkills.filter((s) => s.toLowerCase().includes(slashQuery.toLowerCase()))
      : []
  const slashActive = Math.min(slashIndex, Math.max(0, slashMatches.length - 1))

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeTab?.messages])

  useEffect(() => {
    for (const { id: provider } of PROVIDERS) {
      fetchAgentModels(provider)
        .then((m) => {
          setModelsByProvider((prev) => ({ ...prev, [provider]: m }))
          setTabs((prev) => prev.map((t) => (t.provider === provider && !t.model ? { ...t, model: m.default } : t)))
        })
        .catch(console.error)
      fetchAgentSkills(provider)
        .then((s) => setSkillsByProvider((prev) => ({ ...prev, [provider]: s })))
        .catch(console.error)
      fetchAgentSessions(provider)
        .then((s) => setSessionsByProvider((prev) => ({ ...prev, [provider]: s })))
        .catch(console.error)
    }
    const first = makeTab('hermes', '')
    setTabs([first])
    setActiveTabId(first.id)
  }, [])

  function addTab(provider: AgentProvider) {
    const t = makeTab(provider, modelsByProvider[provider].default)
    setTabs((prev) => [...prev, t])
    setActiveTabId(t.id)
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      const next = prev.filter((t) => t.id !== id)
      if (id === activeTabId) setActiveTabId(next[Math.min(idx, next.length - 1)]?.id ?? null)
      return next
    })
  }

  function patchTab(id: string, patch: Partial<AgentTab> | ((t: AgentTab) => Partial<AgentTab>)) {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)))
  }

  function loadSession(tab: AgentTab, sessionId: string) {
    if (!sessionId) {
      patchTab(tab.id, { sessionId: '', messages: [], title: '새 대화' })
      return
    }
    fetchAgentMessages(tab.provider, sessionId)
      .then((messages) => {
        patchTab(tab.id, { sessionId, messages, title: messages[0]?.content.slice(0, 30) || '새 대화' })
      })
      .catch(console.error)
  }

  async function send(tabId: string) {
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab || !tab.input.trim() || tab.loading) return
    const userMessage = tab.input.trim()
    const isFirst = tab.messages.length === 0
    patchTab(tabId, (t) => ({
      input: '',
      loading: true,
      messages: [...t.messages, { role: 'user', content: userMessage }],
      title: isFirst ? userMessage.slice(0, 30) : t.title,
    }))
    try {
      const res = await chatWithAgent(userMessage, {
        sessionId: tab.sessionId || undefined,
        skill: tab.skill || undefined,
        model: tab.model || undefined,
        provider: tab.provider,
      })
      patchTab(tabId, (t) => ({
        loading: false,
        sessionId: res.sessionId || t.sessionId,
        messages: [...t.messages, { role: 'assistant', content: res.response }],
      }))
      if (res.sessionId) {
        fetchAgentSessions(tab.provider)
          .then((s) => setSessionsByProvider((prev) => ({ ...prev, [tab.provider]: s })))
          .catch(console.error)
      }
    } catch (e) {
      const errText = `오류: ${e instanceof Error ? e.message : String(e)}`
      patchTab(tabId, (t) => ({ loading: false, messages: [...t.messages, { role: 'assistant', content: errText }] }))
    }
  }

  function pickSkill(tabId: string, name: string) {
    patchTab(tabId, { skill: name, input: '' })
    setSlashIndex(0)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!activeTab) return
    if (slashMatches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIndex((slashActive + 1) % slashMatches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex((slashActive - 1 + slashMatches.length) % slashMatches.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickSkill(activeTab.id, slashMatches[slashActive])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashCancelled(true)
        return
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      send(activeTab.id)
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-surface-deep">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <div className="text-sm font-semibold text-ink-soft">에이전트 채팅</div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-ink-muted">Ctrl+Enter로 전송</div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
              aria-label="에이전트 채팅 닫기"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="flex h-9 items-center overflow-x-auto border-b border-edge bg-surface">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={`group flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-r border-edge px-2.5 text-xs select-none ${
              tab.id === activeTabId ? 'bg-surface-raised text-ink' : 'text-ink-secondary hover:bg-surface-raised'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${tab.provider === 'claude' ? 'bg-accent-strong' : 'bg-ink-muted'}`}
              title={PROVIDERS.find((p) => p.id === tab.provider)?.label}
            />
            {tab.loading && <span className="inline-block animate-pulse text-ink-muted">…</span>}
            <span className="max-w-[100px] truncate">{tab.title}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
            >
              ×
            </button>
          </div>
        ))}
        <div className="flex shrink-0 items-center gap-1 px-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => addTab(p.id)}
              title={`새 ${p.label} 대화`}
              className="rounded border border-edge-strong px-1.5 py-0.5 text-xs text-ink-secondary hover:bg-surface-raised"
            >
              + {p.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab && (
        <div className="border-b border-edge p-2">
          <select
            value={activeTab.sessionId}
            onChange={(e) => loadSession(activeTab, e.target.value)}
            disabled={activeTab.loading}
            className="w-full truncate rounded-lg border border-edge bg-surface px-2 py-1.5 text-xs text-ink-soft focus:border-edge-bright focus:outline-none disabled:opacity-50"
          >
            <option value="">새 대화</option>
            {activeSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {sessionLabel(s)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3">
        {(!activeTab || activeTab.messages.length === 0) && (
          <div className="text-sm text-ink-muted">문서를 작성하거나 에이전트에게 질문하세요.</div>
        )}
        {activeTab?.messages.map((msg, i) => (
          <div key={i} className="mb-3">
            <div className={`text-xs font-medium ${msg.role === 'user' ? 'text-link' : 'text-ink-secondary'}`}>
              {msg.role === 'user' ? 'You' : 'Agent'}
            </div>
            <div className="mt-1 whitespace-pre-wrap text-sm text-ink">{msg.content}</div>
          </div>
        ))}
        {activeTab?.loading && (
          <div className="text-sm text-ink-secondary">
            <span className="inline-block animate-pulse">생각 중...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {activeTab && (
        <div className="border-t border-edge p-3">
          <div className="relative">
            {slashMatches.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 z-10 mb-1 max-h-48 overflow-y-auto rounded-lg border border-edge-strong bg-surface py-1 shadow-lg">
                {slashMatches.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      pickSkill(activeTab.id, s)
                    }}
                    className={`block w-full px-3 py-1.5 text-left text-xs ${
                      i === slashActive ? 'bg-surface-hover text-ink' : 'text-ink-soft hover:bg-surface-raised'
                    }`}
                  >
                    /{s}
                  </button>
                ))}
              </div>
            )}
            <textarea
              value={activeTab.input}
              onChange={(e) => {
                patchTab(activeTab.id, { input: e.target.value })
                setSlashIndex(0)
                setSlashCancelled(false)
              }}
              onKeyDown={handleKeyDown}
              placeholder="메시지 입력... ('/'로 스킬 검색)"
              disabled={activeTab.loading}
              rows={3}
              className="block w-full resize-none rounded-xl border border-edge bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-edge-bright focus:outline-none disabled:opacity-50"
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            {activeTab.skill && (
              <button
                type="button"
                onClick={() => patchTab(activeTab.id, { skill: '' })}
                disabled={activeTab.loading}
                title="스킬 해제"
                className="flex shrink-0 items-center gap-1 truncate rounded-lg border border-edge bg-surface px-2 py-1.5 text-xs text-ink-secondary hover:bg-surface-raised disabled:opacity-50"
              >
                /{activeTab.skill} ✕
              </button>
            )}
            <ModelPicker
              models={activeModels}
              value={activeTab.model}
              onChange={(m) => patchTab(activeTab.id, { model: m })}
              disabled={activeTab.loading}
            />
            <button
              type="button"
              onClick={() => send(activeTab.id)}
              disabled={activeTab.loading || !activeTab.input.trim()}
              className="shrink-0 rounded-lg bg-accent-strong px-3.5 py-1.5 text-xs font-medium text-ink-on-accent hover:bg-accent disabled:opacity-40"
            >
              전송
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
