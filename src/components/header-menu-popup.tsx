import { ActionMenu, ActionMenuItem } from '@mew/ui'
import type { HeaderMenuItem } from './HeaderMenu'

type HeaderMenuPopupProps = {
  x: number
  y: number
  label: string
  trigger: HTMLButtonElement | null
  items: HeaderMenuItem[]
  onClose: () => void
}

export function HeaderMenuPopup({ x, y, onClose, items, label, trigger }: HeaderMenuPopupProps) {
  return <ActionMenu variant="header" x={x} y={y} label={label} trigger={trigger} onClose={onClose}>
    {items.map(item => <ActionMenuItem key={item.id} data-header-menu-item
      disabled={item.disabled} checked={item.active} icon={item.icon} hint={item.hint}
      onClick={item.onSelect}>
      <span className="mew-action-menu-label">{item.label}</span>
    </ActionMenuItem>)}
  </ActionMenu>
}
