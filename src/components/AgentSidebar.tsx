import { useState, useEffect, useRef } from 'react'
import {
  chatWithAgent,
  fetchAgentMessages,
  fetchAgentModels,
  fetchAgentSessions,
  fetchAgentSkills,
  type AgentSession,
} from '../api/client'

type Message = { role: 'user' | 'assistant'; content: string }

function sessionLabel(s: AgentSession): string {
  const d = new Date(s.lastActiveAt * 1000)
  const time = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${time} · ${s.title ?? '(제목 없음)'}`
}

export function AgentSidebar({ onClose }: { onClose?: () => void }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [sessionId, setSessionId] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [skill, setSkill] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashCancelled, setSlashCancelled] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 입력이 "/검색어" 형태(공백 없이)면 스킬 검색 팝업을 연다
  const slashQuery = /^\/(\S*)$/.exec(input)?.[1]
  const slashMatches =
    slashQuery !== undefined && !slashCancelled
      ? skills.filter((s) => s.toLowerCase().includes(slashQuery.toLowerCase()))
      : []
  const slashActive = Math.min(slashIndex, Math.max(0, slashMatches.length - 1))

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    fetchAgentSessions().then(setSessions).catch(console.error)
    fetchAgentSkills().then(setSkills).catch(console.error)
    fetchAgentModels()
      .then((m) => {
        setModels(m.models)
        setModel(m.default)
      })
      .catch(console.error)
  }, [])

  function selectSession(id: string) {
    setSessionId(id)
    if (!id) {
      setMessages([])
      return
    }
    fetchAgentMessages(id)
      .then(setMessages)
      .catch((e) => {
        console.error(e)
        setMessages([])
      })
  }

  async function send() {
    if (!input.trim() || loading) return
    const userMessage = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)
    try {
      const res = await chatWithAgent(userMessage, {
        sessionId: sessionId || undefined,
        skill: skill || undefined,
        model: model || undefined,
      })
      setMessages((prev) => [...prev, { role: 'assistant', content: res.response }])
      if (res.sessionId && res.sessionId !== sessionId) {
        setSessionId(res.sessionId)
        fetchAgentSessions().then(setSessions).catch(console.error)
      }
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `오류: ${e instanceof Error ? e.message : String(e)}` }])
    } finally {
      setLoading(false)
    }
  }

  function pickSkill(name: string) {
    setSkill(name)
    setInput('')
    setSlashIndex(0)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
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
        pickSkill(slashMatches[slashActive])
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
      send()
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-surface-deep">
      <div className="space-y-2 border-b border-edge p-3">
        <div className="flex items-center justify-between">
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
        <select
          value={sessionId}
          onChange={(e) => selectSession(e.target.value)}
          disabled={loading}
          className="w-full truncate rounded-lg border border-edge bg-surface px-2 py-1.5 text-xs text-ink-soft focus:border-edge-bright focus:outline-none disabled:opacity-50"
        >
          <option value="">+ 새 대화</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {sessionLabel(s)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="text-sm text-ink-muted">
            문서를 작성하거나 에이전트에게 질문하세요.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className="mb-3">
            <div className={`text-xs font-medium ${msg.role === 'user' ? 'text-link' : 'text-ink-secondary'}`}>
              {msg.role === 'user' ? 'You' : 'Agent'}
            </div>
            <div className="mt-1 whitespace-pre-wrap text-sm text-ink">{msg.content}</div>
          </div>
        ))}
        {loading && (
          <div className="text-sm text-ink-secondary">
            <span className="inline-block animate-pulse">생각 중...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
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
                    pickSkill(s)
                  }}
                  className={`block w-full px-3 py-1.5 text-left text-xs ${
                    i === slashActive
                      ? 'bg-surface-hover text-ink'
                      : 'text-ink-soft hover:bg-surface-raised'
                  }`}
                >
                  /{s}
                </button>
              ))}
            </div>
          )}
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setSlashIndex(0)
              setSlashCancelled(false)
            }}
            onKeyDown={handleKeyDown}
            placeholder="메시지 입력... ('/'로 스킬 검색)"
            disabled={loading}
            rows={3}
            className="block w-full resize-none rounded-xl border border-edge bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-edge-bright focus:outline-none disabled:opacity-50"
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <select
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            disabled={loading}
            className="min-w-0 flex-1 truncate rounded-lg border border-edge bg-surface px-2 py-1.5 text-xs text-ink-secondary focus:border-edge-bright focus:outline-none disabled:opacity-50"
            title="이 세션에 프리로드할 스킬"
          >
            <option value="">스킬 없음</option>
            {skills.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={loading}
            className="min-w-0 flex-1 truncate rounded-lg border border-edge bg-surface px-2 py-1.5 text-xs text-ink-secondary focus:border-edge-bright focus:outline-none disabled:opacity-50"
            title="사용할 모델"
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={send}
            disabled={loading || !input.trim()}
            className="shrink-0 rounded-lg bg-accent-strong px-3.5 py-1.5 text-xs font-medium text-ink-on-accent hover:bg-accent disabled:opacity-40"
          >
            전송
          </button>
        </div>
      </div>
    </div>
  )
}
