// 이 프로젝트의 모든 데이터베이스를 한 팝업에서 열람/편집한다 — 헤더의 원통 아이콘으로 연다.
// 왼쪽 목록에서 고르면 오른쪽에 DatabasePanel(노드뷰와 같은 표)을 편집 가능 상태로 띄운다.
import { useEffect, useId, useState } from 'react'
import { DatabasePanel, DbGlyph, type DbSummary, type EditorDbApi, type EditorOpenLink } from '@mew/editor'
import { DialogFrame } from '@mew/ui'
import { PanelCloseButton } from './panel-close-button'
import { dbApi, getProject } from '../api/client'
import { useI18n } from '../i18n'

export function DatabaseListModal({ onClose, onOpenPage, api = dbApi, project = getProject(), initialDbId, readonly = false }: {
  onClose: () => void
  onOpenPage?: EditorOpenLink
  api?: EditorDbApi
  project?: string
  initialDbId?: string
  readonly?: boolean
}) {
  const { t } = useI18n()
  const titleId = useId()
  const [items, setItems] = useState<DbSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(initialDbId ?? null)

  useEffect(() => {
    let cancelled = false
    api
      .list()
      .then((list) => {
        if (cancelled) return
        setItems(list)
        setSelected((s) => s ?? list[0]?.id ?? null)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t('database.listLoadFailed'))
      })
    return () => {
      cancelled = true
    }
  }, [api, t])

  return (
    <DialogFrame labelledBy={titleId} onClose={onClose} className="flex h-[80dvh] max-w-4xl flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
        <DbGlyph className="shrink-0 text-ink-muted" />
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{t('database.title')}</h2>
        <span className="shrink-0 text-[11px] text-ink-muted">{project}</span>
        <PanelCloseButton onClick={onClose} aria-label={t('common.close')} />
      </header>
      <div className="flex min-h-0 flex-1">
        {/* 왼쪽: DB 목록 */}
        <div className="flex w-28 shrink-0 flex-col border-r border-edge sm:w-56">
          <div className="flex-1 overflow-y-auto">
            {error ? (
              <div className="select-text px-3 py-4 text-center text-xs text-danger-strong">{error}</div>
            ) : items === null ? (
              <div className="px-3 py-4 text-center text-xs text-ink-muted">{t('common.loading')}</div>
            ) : items.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-ink-muted">{t('database.none')}</div>
            ) : (
              items.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelected(d.id)}
                  className={`flex w-full items-center gap-2 border-b border-edge px-3 py-2 text-left text-xs last:border-b-0 hover:bg-surface-hover ${
                    selected === d.id ? 'bg-surface-hover text-ink' : 'text-ink-secondary'
                  }`}
                >
                  <DbGlyph className="shrink-0 text-ink-muted" size={13} />
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  {d.kind === 'external' && (
                    <span className="shrink-0 rounded bg-surface px-1 py-0.5 text-[9px] text-ink-muted">{t('database.external')}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* 오른쪽: 선택한 DB */}
        <div className="min-w-0 flex-1 overflow-auto p-3">
          {selected ? (
            <DatabasePanel key={selected} api={api} dbId={selected} readonly={readonly && selected === initialDbId} onOpenPage={(path, options) => { onClose(); onOpenPage?.(path, options) }} />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-ink-muted">
              {items && items.length === 0 ? t('database.createHint') : t('database.selectHint')}
            </div>
          )}
        </div>
      </div>
    </DialogFrame>
  )
}
