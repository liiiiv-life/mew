import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import type { EditorContextTarget } from '@mew/editor'
import { ChatBubble, Copy, FrameSelect, PasteClipboard, Quote, Scissor, Trash } from 'iconoir-react'
import { useI18n } from '../i18n'

export type EditorContextAction = 'annotation' | 'comment' | 'copy' | 'cut' | 'paste' | 'delete' | 'selectAll'

export function EditorContextMenu({ x, y, target, canAnnotate, canComment, onAction, onClose }: {
  x: number
  y: number
  target: EditorContextTarget
  canAnnotate: boolean
  canComment: boolean
  onAction: (action: EditorContextAction) => void
  onClose: () => void
}) {
  useUiLocale()
  const { t } = useI18n()
  return <ActionMenu x={x} y={y} label={uiText('에디터 메뉴')} onClose={onClose}>
    <ActionMenuItem icon={<Quote />} disabled={!canAnnotate || !target.editable} onClick={() => onAction('annotation')}>{uiText('주석 추가')}</ActionMenuItem>
    <ActionMenuItem icon={<ChatBubble />} disabled={!canComment || !target.editable || !target.canComment} onClick={() => onAction('comment')}>{t('comment.add')}</ActionMenuItem>
    <ActionMenuSeparator />
    <ActionMenuItem icon={<Copy />} disabled={!target.hasSelection} onClick={() => onAction('copy')}>{uiText('복사')}</ActionMenuItem>
    <ActionMenuItem icon={<Scissor />} disabled={!target.editable || !target.hasSelection} onClick={() => onAction('cut')}>{uiText('잘라내기')}</ActionMenuItem>
    <ActionMenuItem icon={<PasteClipboard />} disabled={!target.editable} onClick={() => onAction('paste')}>{uiText('붙여넣기')}</ActionMenuItem>
    <ActionMenuItem icon={<Trash />} disabled={!target.editable || !target.hasSelection} onClick={() => onAction('delete')}>{uiText('삭제')}</ActionMenuItem>
    <ActionMenuSeparator />
    <ActionMenuItem icon={<FrameSelect />} onClick={() => onAction('selectAll')}>{uiText('전체 선택')}</ActionMenuItem>
    {target.extraItems && <><ActionMenuSeparator />{target.extraItems}</>}
  </ActionMenu>
}
