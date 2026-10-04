import { NavArrowDown, NavArrowRight } from 'iconoir-react'
import { uiText } from '@mew/ui/i18n-core'

export function TaskDisclosure({ parent, collapsed, onToggle }: { parent: boolean; collapsed: boolean; onToggle: () => void }) {
  if (!parent) return <span className="task-disclosure-space" aria-hidden="true" />
  const label = uiText(collapsed ? '펼치기' : '접기'), Icon = collapsed ? NavArrowRight : NavArrowDown
  return <button type="button" className="task-disclosure" aria-label={label} data-tip={label} aria-expanded={!collapsed} onClick={onToggle}><Icon width={14} height={14} aria-hidden="true" /></button>
}
