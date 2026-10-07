import type { ReactNode } from 'react'
import { Copy, EditPencil, Folder, FolderPlus, FolderSettings, GitBranch, MultiplePagesPlus, PagePlus, PasteClipboard, Scissor, Star, Trash, Upload } from 'iconoir-react'
import { ActionMenu } from './action-menu'
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
  return (
    <ActionMenu x={x} y={y} onClose={onClose} fileMenu>
      {onRename && (
        <button type="button" onClick={onRename} className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-hover disabled:opacity-40">
          <EditPencil width={16} height={16} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />{t('fileExplorer.rename')}
        </button>
      )}
      {onDuplicate && (
        <button type="button" onClick={onDuplicate} className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-hover disabled:opacity-40">
          <MultiplePagesPlus width={16} height={16} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />{t('fileExplorer.duplicate')}
        </button>
      )}
      {onCopyClip && (
        <button type="button" onClick={onCopyClip} className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-hover disabled:opacity-40">
          <Copy width={16} height={16} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />{t('fileExplorer.copy')}
        </button>
      )}
      {onCutClip && (
        <button type="button" onClick={onCutClip} className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-hover disabled:opacity-40">
          <Scissor width={16} height={16} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />{t('fileExplorer.cut')}
        </button>
      )}
      {onPasteClip && (
        <button type="button" onClick={onPasteClip} disabled={pasteDisabled} className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-hover disabled:opacity-40">
          <PasteClipboard width={16} height={16} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />{t('fileExplorer.paste')}
        </button>
      )}
      {onDownload}
      {onNewFile && (
        <button type="button" onClick={onNewFile} className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-hover disabled:opacity-40">
          <PagePlus width={16} height={16} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />{t('sidebar.newFile')}
        </button>
      )}
      {onNewFolder && (
        <button type="button" onClick={onNewFolder} className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-hover disabled:opacity-40">
          <FolderPlus width={16} height={16} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />{t('sidebar.newFolder')}
        </button>
      )}
      {onUpload && (
        <button type="button" onClick={onUpload} className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-hover disabled:opacity-40">
          <Upload width={16} height={16} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />{t('fileExplorer.upload')}
        </button>
      )}
      {onCreateSubproject && (
        <button type="button" onClick={onCreateSubproject} className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-hover disabled:opacity-40">
          <FolderSettings width={16} height={16} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />{t('fileExplorer.createSubproject')}
        </button>
      )}
      {onInitGit && (
        <button type="button" onClick={onInitGit} className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-hover disabled:opacity-40">
          <GitBranch width={16} height={16} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />{t('fileExplorer.initGit')}
        </button>
      )}
      {onAddFavorite && <button type="button" onClick={onAddFavorite} className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-hover"><Star width={16} height={16} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />{t('favorites.add')}</button>}
      {onOpenProject && <button type="button" onClick={onOpenProject} className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-hover"><Folder width={16} height={16} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />{t('fileExplorer.openProject')}</button>}
      {onDelete && (
        <button type="button" onClick={onDelete} className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-danger hover:bg-surface-hover">
          <Trash width={16} height={16} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />{t('fileExplorer.delete')}
        </button>
      )}
    </ActionMenu>
  )
}
