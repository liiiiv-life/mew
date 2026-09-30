import { useEffect, useState } from 'react'
import { DialogFrame } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { Xmark } from 'iconoir-react'
import { fetchUpdatesStatus, runUpdates, type MewUpdateStatus } from '../api/client'
import { resolveMewcatNotice } from '../utils/mewcat-notifications'
import { batchUpdateIds } from '../../shared/updates'
import type { UpdatesStatus } from '../../shared/updates'

export function UpdatesModal({ open, mew, mewUpdating, onMewUpdate, onRefreshMew, onClose }: {
  open: boolean; mew: MewUpdateStatus | null; mewUpdating: boolean; onMewUpdate: () => Promise<void>; onRefreshMew: () => Promise<void>; onClose: () => void
}) {
  const [status, setStatus] = useState<UpdatesStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingMew, setPendingMew] = useState(false)
  const busy = loading || !!status?.job.running || mewUpdating
  const refresh = async () => {
    setLoading(true); setError(null)
    try { const [next] = await Promise.all([fetchUpdatesStatus(true), onRefreshMew()]); setStatus(next) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false) }
  }
  useEffect(() => { let alive = true; fetchUpdatesStatus().then(value => { if (alive) setStatus(value) }).catch(error => { if (alive) setError(String(error)) }); return () => { alive = false } }, [])
  useEffect(() => {
    if (!status?.job.running) return
    let alive = true
    const timer = window.setInterval(() => {
      fetchUpdatesStatus().then(next => { if (alive) setStatus(next) }).catch(error => { if (alive) setError(String(error)) })
    }, 2000)
    return () => { alive = false; clearInterval(timer) }
  }, [status?.job.running])
  useEffect(() => {
    if (!pendingMew || status?.job.running) return
    setPendingMew(false)
    if (status?.job.items.some(item => item.state === 'failed')) { setError(uiText('일부 업데이트가 실패해 Mew 업데이트를 보류했습니다. 실패 항목을 다시 시도하세요.')); return }
    void onMewUpdate()
  }, [pendingMew, status?.job.running, status?.job.items, onMewUpdate])
  const update = async (ids: string[], includeMew = false) => {
    setLoading(true); setError(null)
    try {
      if (ids.length) { setStatus(await runUpdates(ids)); setPendingMew(includeMew) }
      else if (includeMew) await onMewUpdate()
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    if (status && !status.items.some(item => item.available) && !mew?.available) resolveMewcatNotice('updates:available')
  }, [status, mew?.available])
  const available = batchUpdateIds(status?.items ?? [])
  const button = 'whitespace-nowrap rounded border border-edge px-1.5 py-1.5 text-xs hover:bg-surface-hover disabled:opacity-40'
  const mewReady = !!mew?.available && mew.canUpdate
  if (!open) return null
  return <DialogFrame labelledBy="updates-title" onClose={onClose} className="max-w-3xl max-h-[90dvh] flex flex-col">
    <header className="flex items-center gap-1.5 border-b border-edge px-3 py-3 sm:px-4">
      <h2 id="updates-title" className="flex-1 text-sm font-semibold">{uiText('업데이트')}</h2>
      <button className={button} disabled={busy} onClick={() => void refresh()}>{uiText('다시 확인')}</button>
      <button className={`${button} bg-accent text-ink-on-accent`} disabled={busy || (!available.length && !mewReady)} onClick={() => void update(available, mewReady)}>{uiText('일괄 업데이트')}</button>
      <button type="button" className="rounded p-1.5 hover:bg-surface-hover" aria-label={uiText('닫기')} onClick={onClose}><Xmark width={18} height={18} /></button>
    </header>
    {error && <p role="alert" className="px-4 py-2 text-xs text-danger">{error}</p>}
    <div className="overflow-auto px-4 pb-3" aria-busy={busy}>
      <table className="w-full table-fixed text-left text-xs">
        <thead className="sticky top-0 bg-surface text-ink-secondary"><tr><th className="w-[36%] py-2 font-medium">{uiText('항목')}</th><th className="w-[20%] font-medium">{uiText('현재 버전')}</th><th className="w-[20%] font-medium">{uiText('최신 버전')}</th><th className="w-[24%] text-right font-medium">{uiText('업데이트')}</th></tr></thead>
        <tbody>
          <tr className="border-t border-edge"><td className="py-2 pr-2">Mew{(mew?.error || mew?.available && !mew.canUpdate) && <p className="mt-1 text-ink-secondary break-words">{mew.error ?? uiText('터미널에서 업데이트해 주세요.')}</p>}</td><td className="break-all pr-2 tabular-nums">{mew?.localHash ?? '—'}</td><td className="break-all pr-2 tabular-nums">{mew?.remoteHash ?? '—'}</td><td className="text-right"><button className={button} disabled={busy || !mewReady} onClick={() => void update([], true)}>{uiText(mewUpdating ? '업데이트 중…' : mew?.available ? '업데이트' : mew?.localHash && mew.remoteHash && !mew.error ? '최신' : '확인 불가')}</button></td></tr>
          {(['agent', 'system', 'dependency'] as const).map(category => <CategoryRows key={category} category={category} status={status} busy={busy} button={button} update={ids => void update(ids)} />)}
        </tbody>
      </table>
      {!status && <p role="status" className="py-3 text-xs text-ink-secondary">{uiText('버전을 확인하는 중…')}</p>}
    </div>
  </DialogFrame>
}
function CategoryRows({ category, status, busy, button, update }: { category: 'agent' | 'system' | 'dependency'; status: UpdatesStatus | null; busy: boolean; button: string; update: (ids: string[]) => void }) {
  const rows = status?.items.filter(item => item.category === category) ?? []
  if (!rows.length) return null
  return <>
    <tr><th colSpan={4} className="pt-3 pb-2 text-ink-secondary font-medium">{uiText(category === 'agent' ? '에이전트 런타임' : category === 'system' ? '시스템 도구' : '의존성')}</th></tr>
    {rows.map(item => {
      const job = status?.job.items.find(job => job.id === item.id)
      return <tr key={item.id} className="border-t border-edge align-top">
        <td className="py-2 pr-2 break-words">{item.label}{(job?.error || item.error) && <p className="mt-1 text-ink-secondary break-words">{job?.error || item.error}</p>}{job && <p className={`mt-1 ${job.state === 'failed' ? 'text-danger' : 'text-ink-secondary'}`} role="status">{uiText(({ queued: '대기 중', running: '업데이트 중…', succeeded: '완료', failed: '실패' } as const)[job.state])}</p>}</td>
        <td className="py-2 pr-2 break-all tabular-nums">{item.current ?? uiText('확인 불가')}</td><td className="py-2 pr-2 break-all tabular-nums">{item.latest ?? uiText('확인 불가')}</td>
        <td className="py-2 text-right"><button className={button} disabled={busy || !item.canUpdate} onClick={() => update([item.id])}>{uiText(item.available ? '업데이트' : item.latest && item.current ? '최신' : '확인 불가')}</button></td>
      </tr>
    })}
  </>
}
