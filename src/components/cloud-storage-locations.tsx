import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Cloud, RefreshDouble } from 'iconoir-react'
import type { CloudStorageFolder } from '../../shared/cloud-storage'
import { fetchCloudStorage } from '../api/client'
import { useI18n } from '../i18n'

export function CloudStorageLocations({ disabled, onSelect }: {
  disabled: boolean
  onSelect: (path: string) => void
}) {
  const { t } = useI18n()
  const id = useId()
  const [folders, setFolders] = useState<CloudStorageFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const sequence = useRef(0)
  const refresh = useCallback(() => {
    const request = ++sequence.current
    setLoading(true)
    setFailed(false)
    fetchCloudStorage().then(result => {
      if (request === sequence.current) setFolders(result.folders)
    }).catch(() => {
      if (request === sequence.current) { setFailed(true); setFolders([]) }
    }).finally(() => {
      if (request === sequence.current) setLoading(false)
    })
  }, [])
  const invalidate = useCallback(() => { sequence.current++ }, [])
  useEffect(() => { refresh(); return invalidate }, [refresh, invalidate])

  if (!loading && !failed && folders.length === 0) return null
  const nameCounts = new Map<string, number>()
  for (const folder of folders) nameCounts.set(folder.name, (nameCounts.get(folder.name) ?? 0) + 1)

  return <section aria-labelledby={id} className="max-h-24 shrink-0 overflow-y-auto px-3 pb-2 sm:px-4">
    <div className="flex items-center justify-between gap-2">
      <h3 id={id} className="text-xs font-medium text-ink-secondary">{t('project.cloudShortcuts')}</h3>
      <button type="button" onClick={refresh} disabled={disabled || loading} aria-label={t('project.cloudRefresh')} title={t('project.cloudRefresh')} className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg text-ink-secondary hover:bg-surface-hover disabled:opacity-40"><RefreshDouble width={16} height={16} /></button>
    </div>
    {loading ? <p role="status" className="py-1 text-xs text-ink-secondary">{t('project.cloudLoading')}</p>
      : failed ? <p role="status" className="py-1 text-xs text-ink-secondary">{t('project.cloudError')}</p>
      : <div className="flex flex-wrap gap-1">{folders.map(folder => {
        const duplicate = nameCounts.get(folder.name)! > 1
        return <button key={folder.path} type="button" disabled={disabled} onClick={() => onSelect(folder.path)} aria-label={t('project.cloudGo', { name: duplicate ? `${folder.name} (${folder.path})` : folder.name })} className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md bg-surface-deep px-2 py-1 text-left text-xs text-ink hover:bg-surface-hover disabled:opacity-40" title={folder.path}>
        <Cloud width={16} height={16} className="shrink-0 text-ink-secondary" aria-hidden="true" />
        <span className="min-w-0"><span className="block truncate">{folder.name}</span>{duplicate && <span className="block break-all text-xs text-ink-secondary">{folder.path}</span>}</span>
      </button>})}</div>}
  </section>
}
