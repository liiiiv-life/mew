import { useEffect, useState } from 'react'
import { Editor, type EditorApi, type TreeNode } from '@mew/editor'
import { useOverlayDismiss } from '@mew/ui'
import { SvgPreview } from './SvgPreview'
import { fetchFileAtCommit, fetchFileHistory, type FileHistoryEntry } from '../api/client'
import { useI18n } from '../i18n'

interface FileHistoryModalProps {
  path: string
  canRevert: boolean
  editorApi: EditorApi
  tree: TreeNode[]
  onRevert: (hash: string) => Promise<void>
  onClose: () => void
}

/** Hotview/Plain 토글 왼쪽의 히스토리 버튼으로 여는 팝업 — 목록에서 커밋을 고르면 그 시점의
 * 내용을 에디터와 같은 뷰어(읽기 전용)로 보여주고, 필요하면 그 버전으로 되돌릴 수 있다 */
export function FileHistoryModal({ path, canRevert, editorApi, tree, onRevert, onClose }: FileHistoryModalProps) {
  const { formatDate, t } = useI18n()
  const [entries, setEntries] = useState<FileHistoryEntry[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [selected, setSelected] = useState<FileHistoryEntry | null>(null)
  const [detailContent, setDetailContent] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [reverting, setReverting] = useState(false)
  const [revertError, setRevertError] = useState<string | null>(null)

  useOverlayDismiss(onClose)

  useEffect(() => {
    let cancelled = false
    fetchFileHistory(path)
      .then(({ history }) => {
        if (!cancelled) setEntries(history)
      })
      .catch((err) => {
        if (!cancelled) setListError(err instanceof Error ? err.message : t('history.loadFailed'))
      })
    return () => {
      cancelled = true
    }
  }, [path, t])

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setDetailContent(null)
    setDetailError(null)
    setRevertError(null)
    fetchFileAtCommit(path, selected.hash)
      .then(({ content }) => {
        if (cancelled) return
        if (content === null) setDetailError(t('history.fileMissing'))
        else setDetailContent(content)
      })
      .catch((err) => {
        if (!cancelled) setDetailError(err instanceof Error ? err.message : t('history.contentLoadFailed'))
      })
    return () => {
      cancelled = true
    }
  }, [path, selected, t])

  async function handleRevert() {
    if (!selected) return
    setReverting(true)
    setRevertError(null)
    try {
      await onRevert(selected.hash)
      onClose()
    } catch (err) {
      setRevertError(err instanceof Error ? err.message : t('history.revertFailed'))
      setReverting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        className={`flex max-h-[85vh] w-full flex-col rounded-lg border border-edge bg-surface-deep ${
          selected ? 'max-w-3xl' : 'max-w-md'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-edge px-4 py-3">
          {selected ? (
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="flex items-center gap-1 text-sm text-ink-secondary hover:text-ink"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              {t('history.list')}
            </button>
          ) : (
            <div className="truncate text-sm font-semibold text-ink-bright" title={path}>
              {path}
            </div>
          )}
          <div className="flex items-center gap-2">
            {selected && (
              <button
                type="button"
                onClick={handleRevert}
                disabled={!canRevert || reverting || detailContent === null}
                title={canRevert ? undefined : t('history.revertUnavailable')}
                className="rounded border border-edge-strong px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover disabled:opacity-40"
              >
                {reverting ? t('history.reverting') : t('history.revertVersion')}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
              aria-label={t('common.close')}
            >
              ×
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!selected && (
            <>
              {listError && <div className="select-text text-sm text-danger">{listError}</div>}
              {!listError && entries === null && <div className="text-sm text-ink-muted">{t('common.loading')}</div>}
              {!listError && entries?.length === 0 && <div className="text-sm text-ink-muted">{t('history.none')}</div>}
              {!listError && entries && entries.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {entries.map((entry) => (
                    <li key={entry.hash}>
                      <button
                        type="button"
                        onClick={() => setSelected(entry)}
                        className="w-full rounded border border-edge px-3 py-2 text-left text-sm hover:bg-surface-raised"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-ink">{entry.message}</span>
                          <span className="shrink-0 font-mono text-xs text-ink-faint">{entry.hash.slice(0, 7)}</span>
                        </div>
                        <div className="text-xs text-ink-muted">{formatDate(entry.date, { dateStyle: 'medium', timeStyle: 'short' })}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {selected && (
            <>
              {revertError && <div className="select-text mb-2 text-sm text-danger">{revertError}</div>}
              <div className="select-text mb-3 rounded border border-edge bg-surface px-3 py-2 text-sm text-ink">
                {selected.message}
                <div className="text-xs text-ink-muted">{formatDate(selected.date, { dateStyle: 'medium', timeStyle: 'short' })}</div>
              </div>
              {detailError && <div className="select-text text-sm text-danger">{detailError}</div>}
              {!detailError && detailContent === null && <div className="text-sm text-ink-muted">{t('common.loading')}</div>}
              {!detailError &&
                detailContent !== null &&
                (path.endsWith('.svg') ? (
                  <SvgPreview content={detailContent} />
                ) : (
                  <Editor value={detailContent} onChange={() => {}} api={editorApi} readOnly path={path} tree={tree} />
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
