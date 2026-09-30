import { uuid } from '../utils/uuid'
import { useEffect, useRef, useState } from 'react'
import type { MewcatAction, MewcatActionRequest } from '../../shared/mewcat-assistant'
import type { AgentEvent } from '../utils/agentFold'
import { useI18n } from '../i18n'

export interface AssistantMessage { role: 'user' | 'assistant'; text: string }
export function appendAssistantEvent(messages: AssistantMessage[], event: AgentEvent): AssistantMessage[] {
  if (event.type === 'reset') return []
  if (event.type !== 'update') return messages
  const update = event.update
  if (update.sessionUpdate !== 'agent_message_chunk' && update.sessionUpdate !== 'user_message_chunk') return messages
  if (update.content.type !== 'text' || typeof update.content.text !== 'string') return messages
  const role = update.sessionUpdate === 'agent_message_chunk' ? 'assistant' : 'user'
  const last = messages.at(-1)
  return last?.role === role
    ? [...messages.slice(0, -1), { role, text: last.text + update.content.text }]
    : [...messages.slice(-199), { role, text: update.content.text }]
}

export interface MewcatAssistantOptions {
  account: string; enabled: boolean; runtime: string | null; projectRoot: string | null
  onAction: (action: MewcatAction) => Promise<void>
}

export function useMewcatAssistant(options: MewcatAssistantOptions) {
  const { locale } = useI18n()
  const latest = useRef({ ...options, locale })
  latest.current = { ...options, locale }
  const socket = useRef<WebSocket | null>(null)
  const needsAuth = useRef(false)
  const browserIdentity = useRef<{ account: string; id: string } | null>(null)
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [login, setLogin] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [permission, setPermission] = useState<Extract<AgentEvent, { type: 'permission' }> | null>(null)
  const [action, setAction] = useState<MewcatAction['kind'] | null>(null)
  const [retry, setRetry] = useState(0)
  const send = (message: object) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return false
    socket.current.send(JSON.stringify(message)); return true
  }
  useEffect(() => {
    setMessages([]); setReady(false); setBusy(false); setLogin(false); setError(null); setPermission(null); needsAuth.current = false
    if (!options.enabled || !options.runtime) return
    let closed = false
    const browserKey = `mew:mewcat-browser:${options.account}`
    let browser = browserIdentity.current?.account === options.account ? browserIdentity.current.id : ''
    try { browser = sessionStorage.getItem(browserKey) ?? browser } catch { /* Memory-only fallback. */ }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(browser)) browser = uuid()
    try { sessionStorage.setItem(browserKey, browser) } catch { /* Memory-only fallback. */ }
    browserIdentity.current = { account: options.account, id: browser }
    const sessionKey = `mew:mewcat-session:${options.account}:${browser}:${options.runtime}`
    const query = new URLSearchParams({ runtime: options.runtime, tab: 'mewcat', mewcat: browser })
    try { const resume = localStorage.getItem(sessionKey); if (resume) query.set('resume', resume) } catch { /* No stored session. */ }
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/agent/ws?${query}`)
    socket.current = ws
    const context = () => ({ type: 'mewcat_context', context: { projectRoot: latest.current.projectRoot, locale: latest.current.locale } })
    const receive = (event: AgentEvent) => {
      if (event.type === 'meta') {
        needsAuth.current = false
        setReady(true); setLogin(false); setBusy(event.meta.busy)
        if (event.meta.sessionId) try { localStorage.setItem(sessionKey, event.meta.sessionId) } catch { /* No persistence. */ }
      }
      if (event.type === 'turn_start') { setBusy(true); setError(null) }
      if (event.type === 'turn_end') { setBusy(false); setAction(null) }
      if (event.type === 'auth') { needsAuth.current = true; setLogin(true); setReady(false) }
      if (event.type === 'auth_complete') setLogin(false)
      if (event.type === 'error') { setError(event.message); setBusy(false) }
      if (event.type === 'permission') setPermission(event)
      if (event.type === 'permission_done') setPermission(current => current?.id === event.id ? null : current)
      setMessages(current => appendAssistantEvent(current, event))
    }
    const runtimeReady = (event: Event) => {
      if ((event as CustomEvent<string>).detail === options.runtime && needsAuth.current && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'retry_auth' }))
    }
    window.addEventListener('mew:mewcat-agent-ready', runtimeReady)
    ws.onopen = () => ws.send(JSON.stringify(context()))
    ws.onmessage = raw => {
      if (closed) return
      const message = JSON.parse(String(raw.data))
      if (message.type === 'ready') ws.send(JSON.stringify(context()))
      else if (message.type === 'replay') { setMessages([]); for (const event of message.events) receive(event); if (message.restoreFailure) setError(message.restoreFailure.message) }
      else if (message.type === 'mewcat_action') {
        const request = message as MewcatActionRequest
        setAction(request.action.kind)
        void latest.current.onAction(request.action).then(() => {
          if (!closed && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'mewcat_action_result', id: request.id, ok: true }))
        }).catch(() => {
          if (!closed && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'mewcat_action_result', id: request.id, ok: false }))
          if (!closed) setError('MEWCAT_ACTION_FAILED')
        }).finally(() => { if (!closed) setAction(null) })
      } else if (message.type === 'fatal') { setError(message.message ?? 'MEWCAT_CONNECTION_FAILED'); setReady(false); setBusy(false) }
      else receive(message)
    }
    ws.onerror = () => { if (!closed) setError('MEWCAT_CONNECTION_FAILED') }
    ws.onclose = () => { if (!closed) { setReady(false); setBusy(false); setError(current => current ?? 'MEWCAT_DISCONNECTED') } }
    return () => { closed = true; window.removeEventListener('mew:mewcat-agent-ready', runtimeReady); ws.close(); if (socket.current === ws) socket.current = null }
  }, [options.account, options.enabled, options.runtime, retry])
  useEffect(() => { send({ type: 'mewcat_context', context: { projectRoot: options.projectRoot, locale } }) }, [options.projectRoot, locale])
  return { messages, ready, busy, login, error, permission, action,
    ask: (text: string) => {
      if (!ready || busy || !text.trim()) return false
      setBusy(true); setError(null)
      const accepted = send({ type: 'prompt', text })
      if (!accepted) setBusy(false)
      return accepted
    },
    cancel: () => send({ type: 'cancel' }),
    reconnect: () => setRetry(value => value + 1),
    newConversation: () => { if (!busy && send({ type: 'clear_session' })) { setMessages([]); setPermission(null) } },
    answerPermission: (optionId: string | null) => permission && send({ type: 'permission', id: permission.id, optionId }),
  }
}
export type MewcatAssistantState = ReturnType<typeof useMewcatAssistant>
