import { Check, Minus, Undo } from 'iconoir-react'
import { ActionMenu, ActionMenuItem } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'

export function GitChangesMenu({ x, y, onClose, onInclude, onExclude, onDiscard }: {
  x: number; y: number; onClose: () => void; onInclude: () => void; onExclude: () => void; onDiscard: () => void
}) {
  useUiLocale()
  return <ActionMenu x={x} y={y} label={uiText('변경 파일 작업')} onClose={onClose}>
    <ActionMenuItem icon={<Check />} onClick={onInclude}>{uiText('커밋 대상에 포함')}</ActionMenuItem>
    <ActionMenuItem icon={<Minus />} onClick={onExclude}>{uiText('커밋 대상에서 제외')}</ActionMenuItem>
    <ActionMenuItem icon={<Undo />} danger onClick={onDiscard}>{uiText('취소 (Discard)')}</ActionMenuItem>
  </ActionMenu>
}
