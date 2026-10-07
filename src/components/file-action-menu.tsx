import type { ReactNode } from 'react'
import { Copy, EditPencil, Folder, FolderPlus, FolderSettings, GitBranch, MultiplePagesPlus, PagePlus, PasteClipboard, Scissor, Star, Trash, Upload } from 'iconoir-react'
import { ActionMenu, ActionMenuItem } from '@mew/ui'
import { useI18n } from '../i18n'

export function FileActionMenu({
  x,
  y,
  onRename,
  onDuplicate,
  onCopyClip,
  onCutClip,
  onPasteClip,
  onDownload,
  onDelete,
  onNewFile,
  onNewFolder,
  onUpload,
  onInitGit,
  onCreateSubproject,
  onAddFavorite,
  onOpenProject,
  pasteDisabled = false,
  onClose,
}: {
  x: number
  y: number
  /** 루트(빈 공간) 메뉴에서는 대상 경로가 없어 undefined로 숨긴다 */
  onRename?: () => void
  /** 복제 — 파일에만 제공(폴더는 undefined로 숨긴다) */
  onDuplicate?: () => void
  onCopyClip?: () => void
  onCutClip?: () => void
  /** 클립보드에 담긴 항목이 있을 때만 제공 — 없으면 undefined로 숨긴다 */
  onPasteClip?: () => void
  onDownload?: ReactNode
  onDelete?: () => void
  onNewFile?: () => void
  onNewFolder?: () => void
  onUpload?: () => void
  onInitGit?: () => void
  onCreateSubproject?: () => void
  onAddFavorite?: () => void
  onOpenProject?: () => void
  pasteDisabled?: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  return <ActionMenu x={x} y={y} onClose={onClose} fileMenu>
    {onRename && <ActionMenuItem icon={<EditPencil />} onClick={onRename}>{t('fileExplorer.rename')}</ActionMenuItem>}
    {onDuplicate && <ActionMenuItem icon={<MultiplePagesPlus />} onClick={onDuplicate}>{t('fileExplorer.duplicate')}</ActionMenuItem>}
    {onCopyClip && <ActionMenuItem icon={<Copy />} onClick={onCopyClip}>{t('fileExplorer.copy')}</ActionMenuItem>}
    {onCutClip && <ActionMenuItem icon={<Scissor />} onClick={onCutClip}>{t('fileExplorer.cut')}</ActionMenuItem>}
    {onPasteClip && <ActionMenuItem icon={<PasteClipboard />} onClick={onPasteClip} disabled={pasteDisabled}>{t('fileExplorer.paste')}</ActionMenuItem>}
    {onDownload}
    {onNewFile && <ActionMenuItem icon={<PagePlus />} onClick={onNewFile}>{t('sidebar.newFile')}</ActionMenuItem>}
    {onNewFolder && <ActionMenuItem icon={<FolderPlus />} onClick={onNewFolder}>{t('sidebar.newFolder')}</ActionMenuItem>}
    {onUpload && <ActionMenuItem icon={<Upload />} onClick={onUpload}>{t('fileExplorer.upload')}</ActionMenuItem>}
    {onCreateSubproject && <ActionMenuItem icon={<FolderSettings />} onClick={onCreateSubproject}>{t('fileExplorer.createSubproject')}</ActionMenuItem>}
    {onInitGit && <ActionMenuItem icon={<GitBranch />} onClick={onInitGit}>{t('fileExplorer.initGit')}</ActionMenuItem>}
    {onAddFavorite && <ActionMenuItem icon={<Star />} onClick={onAddFavorite}>{t('favorites.add')}</ActionMenuItem>}
    {onOpenProject && <ActionMenuItem icon={<Folder />} onClick={onOpenProject}>{t('fileExplorer.openProject')}</ActionMenuItem>}
    {onDelete && <ActionMenuItem icon={<Trash />} danger onClick={onDelete}>{t('fileExplorer.delete')}</ActionMenuItem>}
  </ActionMenu>
}
