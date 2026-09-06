// 워크스페이스 **밖** 폴더를 고르는 창 — 네이티브 파일 대화상자가 아니라 서버(/api/fs/dirs)가
// 내려주는 목록을 그린다. 브라우저는 서버가 도는 기계의 파일시스템을 볼 수 없기 때문이다.
// docs 가져오기·내보내기와 워크스페이스 바꾸기가 같이 쓴다. owner 전용 API라 owner에게만 보인다.
import { useEffect, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { browseDirs, type BrowseResult } from '../api/client'
import { useI18n } from '../i18n'

export function FolderPicker({
  title,
  hint,
  confirmLabel,
  busy,
  initialPath,
  onPick,
  onClose,
}: {
  title: string
  /** 목록 위에 띄우는 한 줄 안내 (경고 등) */
  hint?: string
  confirmLabel: string
  busy?: boolean
  /** 처음 열어 둘 폴더 — 비우면 홈에서 시작한다 */
  initialPath?: string
  /** 지금 열려 있는 폴더를 고른다 — 창을 닫는 것은 호출한 쪽의 몫 */
  onPick: (path: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [path, setPath] = useState(initialPath ?? '')
  const [draft, setDraft] = useState('')
  const [result, setResult] = useState<BrowseResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    browseDirs(path)
      .then((r) => {
        if (cancelled) return
        setResult(r)
        setDraft(r.path)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t('folder.openFailed'))
      })
    return () => {
      cancelled = true
    }
  }, [path, t])

  useOverlayDismiss(onClose)

  const current = result?.path ?? path

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="flex h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-edge-bright bg-surface-raised shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2.5 text-sm font-semibold text-ink">{title}</div>
        {hint && <div className="border-t border-edge bg-warning-surface px-3 py-2 text-xs text-warning-ink">{hint}</div>}

        {/* 경로를 직접 쳐서 갈 수도 있다 — 깊은 폴더를 한 칸씩 내려가지 않아도 되게 */}
        <form
          className="flex items-center gap-1.5 border-t border-edge px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault()
            setPath(draft)
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="min-w-0 flex-1 rounded border border-edge bg-surface px-2 py-1 font-mono text-xs text-ink"
            placeholder="/home/…"
          />
          <button type="submit" className="shrink-0 rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover">
            {t('folder.go')}
          </button>
        </form>

        <div className="flex-1 overflow-y-auto border-t border-edge">
          {result?.parent && (
            <button
              type="button"
              onClick={() => setPath(result.parent!)}
              className="flex w-full items-center gap-2 border-b border-edge px-3 py-2 text-left text-xs text-ink-secondary hover:bg-surface-hover"
            >
              ../
            </button>
          )}
          {error ? (
            <div className="px-3 py-4 text-center text-xs text-danger-strong">{error}</div>
          ) : !result ? (
            <div className="px-3 py-4 text-center text-xs text-ink-muted">{t('common.loading')}</div>
          ) : result.dirs.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-ink-muted">{t('folder.empty')}</div>
          ) : (
            result.dirs.map((d) => (
              <button
                key={d.path}
                type="button"
                onClick={() => setPath(d.path)}
                className="flex w-full items-center gap-2 border-b border-edge px-3 py-2 text-left text-xs text-ink-secondary last:border-b-0 hover:bg-surface-hover"
              >
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                <span className="shrink-0 text-ink-muted">›</span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-edge px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-muted" title={current}>
            {current}
          </span>
          <button type="button" onClick={onClose} className="shrink-0 rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={busy || !result}
            onClick={() => onPick(current)}
            className="shrink-0 rounded bg-accent px-2.5 py-1 text-xs text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
