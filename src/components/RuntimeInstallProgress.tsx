import { useEffect, useRef, useState } from 'react'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import type { AgentRuntimeStatus } from '../api/client'
import { refreshAgentRuntimes } from '../utils/agentPickerCache'

export function RuntimeInstallProgress({ runtimeId, busy, installation }: {
  runtimeId: string
  busy: boolean
  installation?: AgentRuntimeStatus['installation']
}) {
  useUiLocale()
  const [latest, setLatest] = useState(installation)
  const outputRef = useRef<HTMLPreElement>(null)
  const followOutput = useRef(true)

  useEffect(() => { setLatest(installation) }, [installation])
  useEffect(() => {
    if (!busy) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const statuses = await refreshAgentRuntimes()
        if (alive) setLatest(statuses.find(item => item.id === runtimeId)?.installation)
      } catch { /* 일시적인 연결 실패 후에도 설치 상태 조회를 계속한다. */ }
      if (alive) timer = setTimeout(poll, 1000)
    }
    void poll()
    return () => { alive = false; clearTimeout(timer) }
  }, [busy, runtimeId])

  const progress = latest ?? installation
  useEffect(() => {
    const output = outputRef.current
    if (output && followOutput.current) output.scrollTop = output.scrollHeight
  }, [progress?.output])

  if (!busy && !progress) return null
  // eslint-disable-next-line no-control-regex -- 설치 CLI의 ANSI 제어 문자를 화면에서 제거한다.
  const plainOutput = progress?.output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r\n?/g, '\n')
  return (
    <div className="relative min-w-0 w-full basis-full py-1">
      <div role="status" className={`text-xs ${progress?.state === 'failed' ? 'text-danger' : 'text-ink-secondary'}`}>
        {progress?.state === 'failed' ? uiText('실패') : progress?.state === 'succeeded' ? uiText('설치됨') : uiText('설치 중…')}
      </div>
      {progress?.output && <pre
        ref={outputRef}
        tabIndex={0}
        aria-label={uiText('설치')}
        onScroll={event => {
          const el = event.currentTarget
          followOutput.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="mt-1 max-h-40 select-text overflow-auto whitespace-pre-wrap break-words rounded bg-surface-raised p-2 font-mono text-xs text-ink-secondary"
      >{plainOutput}</pre>}
    </div>
  )
}
