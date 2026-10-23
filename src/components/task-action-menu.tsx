import { Calendar, CheckCircle, Page, Trash } from 'iconoir-react'
import { ActionMenu, ActionMenuItem } from '@mew/ui'
import { useUiLocale } from '@mew/ui/i18n'
import { uiText } from '@mew/ui/i18n-core'
import type { TaskItem } from '../../shared/task-list'

export type TaskMenuAnchor = { x: number; y: number; trigger: HTMLElement | SVGElement }

export function TaskActionMenu({ anchor, task, onOpenDocument, onEditDates, onToggleDone, onDelete, onClose }: {
  anchor: TaskMenuAnchor; task: TaskItem; onOpenDocument?: () => void; onEditDates?: () => void; onToggleDone?: () => void; onDelete?: () => void; onClose: () => void
}) {
  useUiLocale()
  return <ActionMenu x={anchor.x} y={anchor.y} trigger={anchor.trigger} label={uiText('태스크')} onClose={onClose}>
    {onOpenDocument && <ActionMenuItem icon={<Page />} onClick={onOpenDocument}>{uiText('문서 열기')}</ActionMenuItem>}
    {onEditDates && <ActionMenuItem icon={<Calendar />} onClick={onEditDates}>{uiText('일정 편집')}</ActionMenuItem>}
    {onToggleDone && <ActionMenuItem icon={<CheckCircle />} checked={task.done} onClick={onToggleDone}>{uiText('완료')}</ActionMenuItem>}
    {onDelete && <ActionMenuItem icon={<Trash />} danger onClick={onDelete}>{uiText('태스크 삭제')}</ActionMenuItem>}
  </ActionMenu>
}
