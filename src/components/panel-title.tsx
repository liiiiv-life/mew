import { Brain, EditPencil, Globe, Terminal } from 'iconoir-react'
import { useI18n } from '../i18n'

const icons = { editor: EditPencil, agent: Brain, terminal: Terminal, browser: Globe }
const labels = { editor: 'panel.editor', agent: 'header.agent', terminal: 'header.terminal', browser: 'header.browser' } as const

/** Empty tab bars keep their panel identity without creating a selectable tab. */
export function PanelTitle({ kind }: { kind: keyof typeof icons }) {
  const { t } = useI18n()
  const Icon = icons[kind]
  return <div className="flex h-full shrink-0 items-center gap-1.5 px-2.5 text-xs text-ink">
    <Icon width={14} height={14} className="shrink-0" aria-hidden="true" />
    <span>{t(labels[kind])}</span>
  </div>
}
