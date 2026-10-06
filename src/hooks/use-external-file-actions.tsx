import { Download } from 'iconoir-react'
import { useRef, useState } from 'react'
import { useDialog } from '@mew/ui'
import { deleteExternalPath, externalDownloadUrl, pasteExternalPath, renameExternalPath, setFileFavorite, type ExternalEntry } from '../api/client'
import { useI18n } from '../i18n'
import { FileActionMenu } from '../components/file-action-menu'
import { DownloadLink } from '../components/DownloadLink'

type Clipboard = { path: string; type: ExternalEntry['type']; mode: 'copy' | 'cut' }
// Both server browsers retain their clipboard across closing/reopening. Project-relative
// sidebar operations keep their own permission-aware clipboard and endpoints.
let clipboard: Clipboard | null = null
export const externalParent = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'

export function useExternalFileActions(options: {
  onRefresh: (directories: string[]) => void
  onRenamed?: (oldPath: string, newPath: string, type: ExternalEntry['type']) => void
  onDeleted?: (path: string, type: ExternalEntry['type']) => void
  onOpenProject?: (path: string) => void
}) {
  const { t } = useI18n()
  const dialogs = useDialog()
  const callbacks = useRef(options)
  callbacks.current = options
  const [menu, setMenu] = useState<{ entry: ExternalEntry; x: number; y: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const run = async (action: () => Promise<void>) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError(null)
    try { await action() }
    catch (err) { setError(err instanceof Error ? err.message : t('fileExplorer.operationFailed')) }
    finally { running.current = false; setBusy(false) }
  }
  const choose = (action: (entry: ExternalEntry) => void) => {
    if (!menu) return
    setMenu(null)
    action(menu.entry)
  }
  const rename = (entry: ExternalEntry) => void run(async () => {
    const name = await dialogs.prompt({ message: t('fileExplorer.renameTitle'), defaultValue: entry.name, confirmLabel: t('common.save'), cancelLabel: t('common.cancel') })
    if (!name || name === entry.name) return
    const result = await renameExternalPath(entry.path, name)
    callbacks.current.onRenamed?.(entry.path, result.path, entry.type)
    callbacks.current.onRefresh([externalParent(entry.path)])
  })
  const remove = (entry: ExternalEntry) => void run(async () => {
    if (!(await dialogs.confirm({ message: t('fileExplorer.deleteTitle'), detail: `${t('fileExplorer.deleteDescription')}\n\n${entry.path}`, danger: true, confirmLabel: t('common.delete'), cancelLabel: t('common.cancel') }))) return
    await deleteExternalPath(entry.path)
    callbacks.current.onDeleted?.(entry.path, entry.type)
    callbacks.current.onRefresh([externalParent(entry.path)])
  })
  const paste = (entry: ExternalEntry) => {
    const clip = clipboard
    if (!clip) return
    const destination = entry.type === 'dir' ? entry.path : externalParent(entry.path)
    void run(async () => {
      const result = await pasteExternalPath(clip.path, destination, clip.mode)
      if (clip.mode === 'cut') {
        if (clipboard === clip) clipboard = null
        callbacks.current.onRenamed?.(clip.path, result.path, clip.type)
      }
      callbacks.current.onRefresh([...new Set([destination, ...(clip.mode === 'cut' ? [externalParent(clip.path)] : [])])])
    })
  }
  return {
    busy, error,
    openMenu: (entry: ExternalEntry, x: number, y: number) => { if (!running.current) { setError(null); setMenu({ entry, x, y }) } },
    closeMenu: () => { setMenu(null); setError(null) },
    menu: menu && <FileActionMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}
      onRename={() => choose(rename)} onDelete={() => choose(remove)}
      onCopyClip={() => choose(entry => { clipboard = { path: entry.path, type: entry.type, mode: 'copy' } })}
      onCutClip={() => choose(entry => { clipboard = { path: entry.path, type: entry.type, mode: 'cut' } })}
      onPasteClip={() => choose(paste)} pasteDisabled={!clipboard}
      onAddFavorite={menu.entry.type === 'dir' ? () => choose(entry => void run(async () => { await setFileFavorite(entry.path, true) })) : undefined}
      onOpenProject={menu.entry.type === 'dir' && options.onOpenProject ? () => choose(entry => callbacks.current.onOpenProject?.(entry.path)) : undefined}
      onDownload={menu.entry.type === 'file' && <DownloadLink href={externalDownloadUrl(menu.entry.path)} name={menu.entry.name} onStarted={() => setMenu(null)} className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-hover"><Download width={16} height={16} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />{t('fileExplorer.download')}</DownloadLink>}
    />,
    dialog: dialogs.dialog,
  }
}
