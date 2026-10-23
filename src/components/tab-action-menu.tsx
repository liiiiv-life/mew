import { EditPencil, Expand, Collapse, Xmark } from 'iconoir-react'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { ActionMenu, ActionMenuItem } from '@mew/ui'

export function TabActionMenu({ x, y, onRename, onCloseTab, onMaximize, maximized, onClose }: {
  x: number
  y: number
  onRename: () => void
  onCloseTab: () => void
  onMaximize?: () => void
  maximized?: boolean
  onClose: () => void
}) {
  useUiLocale()
  return (
    <ActionMenu x={x} y={y} onClose={onClose}>
      <ActionMenuItem icon={<EditPencil />} onClick={onRename}>{uiText('이름 변경')}</ActionMenuItem>
      {onMaximize && <ActionMenuItem icon={maximized ? <Collapse /> : <Expand />} onClick={onMaximize}>
        {maximized ? uiText('원래 크기로 복귀') : uiText('탭 최대화')}
      </ActionMenuItem>}
      <ActionMenuItem icon={<Xmark />} danger onClick={onCloseTab}>{uiText('탭 닫기')}</ActionMenuItem>
    </ActionMenu>
  )
}
