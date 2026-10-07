import { createPortal } from 'react-dom'
import { EditPencil, Expand, Collapse, Xmark } from 'iconoir-react'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { ActionMenu } from './action-menu'

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
  const itemClass = 'flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none'
  const iconProps = { width: 16, height: 16, strokeWidth: 1.6, 'aria-hidden': true, className: 'shrink-0' } as const
  const run = (action: () => void) => { onClose(); action() }
  return createPortal(
    <ActionMenu x={x} y={y} onClose={onClose} keyboard>
      <button type="button" role="menuitem" className={itemClass} onClick={() => run(onRename)}><EditPencil {...iconProps} />{uiText('이름 변경')}</button>
      {onMaximize && <button type="button" role="menuitem" className={itemClass} onClick={() => run(onMaximize)}>
        {maximized ? <Collapse {...iconProps} /> : <Expand {...iconProps} />}{maximized ? uiText('원래 크기로 복귀') : uiText('탭 최대화')}
      </button>}
      <button type="button" role="menuitem" className={`${itemClass} text-danger`} onClick={() => run(onCloseTab)}><Xmark {...iconProps} />{uiText('탭 닫기')}</button>
    </ActionMenu>, document.body,
  )
}
