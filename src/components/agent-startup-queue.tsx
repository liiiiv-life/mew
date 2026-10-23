import { useState } from 'react'
import { Xmark } from 'iconoir-react'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { AgentAttachmentIcon } from './agent-attachment-icon'
import { withoutAttachmentTokens } from '../utils/agent-attachments'
import type { AgentAttachmentInput } from '../../shared/agent-attachment'
import type { AgentStartupQueueEntry } from '../utils/agent-startup-queue'

export function AgentStartupQueueView({ entries, onCancel }: {
  entries: readonly AgentStartupQueueEntry<{ text: string; attachments: AgentAttachmentInput[] }>[]
  onCancel: (id: number) => void
}) {
  useUiLocale()
  const [expanded, setExpanded] = useState<number | null>(null)
  if (!entries.length) return null
  return <div data-agent-startup-queue className="relative z-10 max-h-[109px] shrink-0 space-y-1 overflow-y-auto overscroll-contain border-t border-edge bg-surface px-3 py-1.5 text-xs">
    <div role="status" className="text-ink-muted">{uiText('대기 중')}</div>
    {entries.map(({ id, payload }) => <div key={id} data-startup-prompt={id} className="flex items-start gap-2">
      <button type="button" aria-expanded={expanded === id} onClick={() => setExpanded(expanded === id ? null : id)}
        aria-label={withoutAttachmentTokens(payload.text).trim() || uiText('첨부 파일 {p0}개', { p0: payload.attachments.length })}
        className="flex min-w-0 flex-1 items-start gap-1 text-left text-ink-secondary focus-visible:outline-2 focus-visible:outline-ink">
        <span className={expanded === id ? 'min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] select-text' : 'min-w-0 truncate'}>{withoutAttachmentTokens(payload.text).trim()}</span>
        {payload.attachments.length > 0 && <span className="flex shrink-0 gap-1" data-startup-attachments>
          {payload.attachments.map(file => <span key={`${file.project}:${file.path}`} title={file.path.split('/').pop()}><AgentAttachmentIcon mimeType={file.mimeType} path={file.path} /></span>)}
        </span>}
      </button>
      <button type="button" onClick={() => onCancel(id)} aria-label={uiText('대기 메시지 취소')} title={uiText('대기 메시지 취소')}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">
        <Xmark width={14} height={14} aria-hidden="true" />
      </button>
    </div>)}
  </div>
}
