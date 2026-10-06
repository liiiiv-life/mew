import { OpenInWindow, SidebarExpand } from 'iconoir-react'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { setToolPresentation, useToolPresentation, type ToolPresentation } from '../hooks/use-tool-presentation'

export function ToolPresentationToggle({ tool }: { tool: keyof ToolPresentation }) {
  useUiLocale()
  const modes = useToolPresentation(), floating = modes[tool] === 'popup'
  const label = uiText(floating ? '패널로 전환' : '팝업으로 전환')
  const Icon = floating ? SidebarExpand : OpenInWindow
  return <button type="button" aria-label={label} data-tip={label} aria-pressed={floating}
    className="mx-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-ink md:flex"
    onClick={() => setToolPresentation(tool, floating ? 'tab' : 'popup')}><Icon width={14} height={14} aria-hidden="true" /></button>
}
