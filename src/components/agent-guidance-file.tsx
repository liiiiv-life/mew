import { useState } from 'react'
import { useI18n } from '../i18n'
import { ProjectIcon } from './ProjectIcon'
import { externalTabPath } from '../utils/externalFiles'

export function AgentGuidanceFile({ activePath, onOpen, onError }: {
  activePath: string | null
  onOpen: (path: string) => void
  onError: (message: string) => void
}) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [filePath, setFilePath] = useState<string | null>(null)
  const active = filePath !== null && activePath === externalTabPath(filePath)

  async function open() {
    if (loading) return
    setLoading(true)
    try {
      const response = await fetch('/api/fs/agent-guidance', { cache: 'no-store' })
      if (!response.ok) throw new Error(t('project.agentGuidanceError'))
      const result = await response.json() as { path: string }
      setFilePath(result.path)
      onOpen(result.path)
    } catch (error) { onError(error instanceof Error ? error.message : t('project.agentGuidanceError')) }
    finally { setLoading(false) }
  }

  return <button
    type="button"
    data-agent-guidance
    onClick={() => void open()}
    disabled={loading}
    aria-busy={loading}
    aria-current={active ? 'page' : undefined}
    title={t('project.agentGuidanceHint')}
    className={`flex w-full items-center gap-2 border-b border-edge px-2 py-1.5 text-left text-sm hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60 ${active ? 'bg-surface-raised font-medium text-ink' : 'text-ink-secondary'}`}
  >
    <span className="shrink-0"><ProjectIcon icon="i:notes" size={16} /></span>
    <span className="min-w-0 truncate">{t('project.agentGuidance')}</span>
  </button>
}
