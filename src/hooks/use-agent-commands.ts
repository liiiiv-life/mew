import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentCommandRecord, AgentCommandScope } from '../../shared/agent-command'
import { listAgentCommands, startAgentCommand } from '../api/agent-commands'

const EMPTY_RECORDS: AgentCommandRecord[] = []

function commandId() {
  if (crypto.randomUUID) return crypto.randomUUID()
  // LAN HTTP can use getRandomValues but does not expose the secure-context randomUUID API.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function useAgentCommands(scope: AgentCommandScope, enabled: boolean) {
  const key = JSON.stringify(scope)
  const currentKey = useRef(key)
  currentKey.current = key
  const [snapshot, setSnapshot] = useState<{ key: string; records: AgentCommandRecord[] }>({ key, records: [] })
  const [submitting, setSubmitting] = useState(false)
  const pending = useRef(false)
  const retry = useRef<{ key: string; command: string; id: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (!enabled || !scope.sessionId) return
    const result = await listAgentCommands(scope)
    if (currentKey.current !== key) return
    setSnapshot(previous => {
      // An overlapping list request must not hide a just-accepted command.
      const incoming = new Map(result.commands.map(record => [record.id, record]))
      for (const record of previous.key === key ? previous.records : []) if (!incoming.has(record.id)) incoming.set(record.id, record)
      const records = [...incoming.values()].sort((a, b) => a.startedAt - b.startedAt)
      return previous.key === key && JSON.stringify(previous.records) === JSON.stringify(records) ? previous : { key, records }
    })
    setError(null)
  // The serialized scope is the dependency; object identity changes each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  useEffect(() => {
    let disposed = false
    let timer: number | undefined
    setError(null)
    if (!enabled || !scope.sessionId) return
    const poll = async () => {
      try { await refresh() } catch (error) {
        if (!disposed) setError(error instanceof Error ? error.message : String(error))
      }
      if (!disposed) timer = window.setTimeout(poll, 1500)
    }
    void poll()
    return () => { disposed = true; clearTimeout(timer) }
  }, [refresh, enabled, scope.sessionId])

  const submit = async (tab: string, command: string, afterUserCount: number) => {
    if (!enabled || !scope.sessionId || pending.current) return false
    pending.current = true
    setSubmitting(true)
    const attempt = retry.current?.key === key && retry.current.command === command
      ? retry.current : { key, command, id: commandId() }
    retry.current = attempt
    try {
      const result = await startAgentCommand({ ...scope, id: attempt.id, tab, command, afterUserCount })
      retry.current = null
      if (currentKey.current === key) {
        setSnapshot(previous => ({ key, records: [...(previous.key === key ? previous.records.filter(record => record.id !== result.command.id) : []), result.command] }))
        setError(null)
      }
      return true
    } catch (error) {
      if (currentKey.current === key) setError(error instanceof Error ? error.message : String(error))
      return false
    } finally { pending.current = false; setSubmitting(false) }
  }
  return { records: enabled && snapshot.key === key ? snapshot.records : EMPTY_RECORDS, submitting, error, submit, refresh }
}
