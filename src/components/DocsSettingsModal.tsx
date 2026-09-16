// docs 탭을 우클릭(모바일에선 꾹)하면 뜨는 창 — 어느 폴더를 docs로 쓸지 고르기, 폴더 통째로
// 가져오기/내보내기. docs는 프로젝트가 아니라 워크스페이스에 하나뿐인 특별 레포라(paths.ts)
// 이름 바꾸기·삭제가 없다 — 대신 워크스페이스 안의 폴더 아무거나 docs로 지정할 수 있다.
import { useEffect, useState } from 'react'
import { ConfirmDialog, useOverlayDismiss } from '@mew/ui'
import { exportDocs, fetchWorkspace, importDocs, setDocsRoot, type WorkspaceInfo } from '../api/client'
import { FolderPicker } from './FolderPicker'
import { useI18n } from '../i18n'

export function DocsSettingsModal({ onDone, onClose }: { onDone: (message: string) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [picking, setPicking] = useState<'root' | 'import' | 'export' | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  // 가져오기는 기존 docs를 지운다 — 폴더를 고른 뒤 한 번 더 확인을 받는다
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useOverlayDismiss(onClose)

  useEffect(() => {
    fetchWorkspace()
      .then(setWorkspace)
      .catch(() => setWorkspace(null))
  }, [])

  async function run(action: () => Promise<string>) {
    setBusy(true)
    setError(null)
    try {
      onDone(await action())
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('docs.operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (confirming !== null) {
    return (
      <ConfirmDialog
        message={t('docs.importConfirm')}
        detail={t('docs.importConfirmDetail', { path: confirming })}
        confirmLabel={t('docs.import')}
        danger
        onConfirm={() => {
          const from = confirming
          setConfirming(null)
          void run(async () => {
            await importDocs(from)
            return t('docs.importDone')
          })
        }}
        onCancel={() => setConfirming(null)}
      />
    )
  }

  if (picking === 'root') {
    return (
      <FolderPicker
        title={t('docs.pickRootTitle')}
        hint={t('docs.pickRootHint')}
        confirmLabel={t('docs.useAsRoot')}
        busy={busy}
        initialPath={workspace?.path}
        onPick={(path) =>
          void run(async () => {
            await setDocsRoot(path)
            // 열려 있는 docs 탭·트리가 전부 옛 폴더 것이다 — 통째로 다시 띄운다
            location.reload()
            return ''
          })
        }
        onClose={() => setPicking(null)}
      />
    )
  }

  if (picking === 'import') {
    return (
      <FolderPicker
        title={t('docs.pickImportTitle')}
        hint={t('docs.pickImportHint')}
        confirmLabel={t('docs.importFromFolder')}
        busy={busy}
        onPick={(path) => setConfirming(path)}
        onClose={() => setPicking(null)}
      />
    )
  }

  if (picking === 'export') {
    return (
      <FolderPicker
        title={t('docs.pickExportTitle')}
        confirmLabel={t('docs.exportToFolder')}
        busy={busy}
        onPick={(path) =>
          void run(async () => {
            const { path: dest } = await exportDocs(path)
            return t('docs.exportDone', { path: dest })
          })
        }
        onClose={() => setPicking(null)}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-xs overflow-hidden rounded-lg border border-edge-bright bg-surface-raised shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2.5 text-sm font-semibold text-ink">docs</div>
        {workspace && (
          <div className="border-t border-edge px-3 py-2 font-mono text-[11px] text-ink-secondary">{workspace.docsPath}</div>
        )}
        {error && <div className="select-text border-t border-edge px-3 py-2 text-xs text-danger-ink">{error}</div>}
        <button
          type="button"
          disabled={busy}
          onClick={() => setPicking('root')}
          className="flex min-h-10 w-full items-center border-t border-edge px-3 py-2.5 text-left hover:bg-surface-hover disabled:opacity-40"
        >
          <span className="text-xs text-ink">{t('docs.changeFolder')}</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setPicking('import')}
          className="flex min-h-10 w-full items-center border-t border-edge px-3 py-2.5 text-left hover:bg-surface-hover disabled:opacity-40"
        >
          <span className="text-xs text-ink">{t('docs.import')}</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setPicking('export')}
          className="flex min-h-10 w-full items-center border-t border-edge px-3 py-2.5 text-left hover:bg-surface-hover disabled:opacity-40"
        >
          <span className="text-xs text-ink">{t('docs.export')}</span>
        </button>
      </div>
    </div>
  )
}
