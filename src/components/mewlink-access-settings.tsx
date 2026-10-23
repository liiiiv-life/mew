import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, RefreshDouble, Xmark } from 'iconoir-react'
import { HoverTipLayer } from '@mew/ui'
import { useUiLocale } from '@mew/ui/i18n'
import { uiText } from '@mew/ui/i18n-core'
import type { MewlinkAccessOverview, MewlinkIdentity } from '../../shared/mewlink-identity.ts'
import type { AdminUser } from '../api/client.ts'
import { mewFetch } from '../utils/remote-transport.ts'

interface MewlinkAccessSettingsProps {
  users: AdminUser[]
  onUsersChanged: () => Promise<void>
}

function IdentityLabel({ identity }: { identity: MewlinkIdentity }) {
  return <div className="min-w-0">
    <div className="break-words text-sm font-medium text-ink">{identity.displayName}</div>
    <div className="break-words text-xs text-ink-secondary">{identity.provider}{identity.username ? ` · ${identity.username}` : ''}</div>
    <details className="mt-1 text-xs text-ink-secondary"><summary className="cursor-pointer">{uiText('계정 식별 정보')}</summary><div className="mt-1 break-all select-text">{identity.issuer}<br />{identity.subject}</div></details>
  </div>
}

export function MewlinkAccessSettings({ users, onUsersChanged }: MewlinkAccessSettingsProps) {
  useUiLocale()
  const [overview, setOverview] = useState<MewlinkAccessOverview | null>(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const mounted = useRef(false)
  const latestRequest = useRef(0)

  const load = useCallback(async () => {
    const revision = ++latestRequest.current
    try {
      const response = await mewFetch('/api/admin/mewlink')
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || uiText('Mewlink 계정 접근을 불러오지 못했습니다.'))
      if (!mounted.current || revision !== latestRequest.current) return
      setOverview(result as MewlinkAccessOverview)
      setError('')
    } catch (error) {
      if (mounted.current && revision === latestRequest.current) setError(error instanceof Error ? error.message : uiText('Mewlink 계정 접근을 불러오지 못했습니다.'))
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => { mounted.current = false }
  }, [load])

  useEffect(() => {
    if (busy) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      await load()
      if (active) timer = setTimeout(() => { void poll() }, 3000)
    }
    timer = setTimeout(() => { void poll() }, 3000)
    return () => { active = false; clearTimeout(timer) }
  }, [busy, load])

  async function update(method: string, suffix: string, body?: unknown) {
    setBusy(true)
    setActionError('')
    latestRequest.current++
    try {
      const response = await mewFetch(`/api/admin/mewlink${suffix}`, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || uiText('Mewlink 계정 접근을 변경하지 못했습니다.'))
      if (!mounted.current) return
      await onUsersChanged()
      await load()
      if (mounted.current) setDisconnecting(null)
    } catch (error) {
      if (mounted.current) setActionError(error instanceof Error ? error.message : uiText('Mewlink 계정 접근을 변경하지 못했습니다.'))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const requests = overview?.requests.filter(request => request.status !== 'approved') ?? []
  const pending = requests.filter(request => request.status === 'pending').length
  return <HoverTipLayer><details className="shrink-0">
    <summary className="cursor-pointer py-1 text-sm font-medium text-ink">{uiText('Mewlink 계정 접근')}{pending > 0 && <span className="ml-2 text-xs text-accent">{uiText('승인 대기 {count}건', { count: pending })}</span>}<span className="float-right" data-tip={uiText('새로고침')}><button type="button" aria-label={uiText('Mewlink 계정 새로고침')} disabled={busy} onClick={event => { event.preventDefault(); void load() }} className="rounded p-1 text-ink-secondary hover:bg-surface-raised disabled:opacity-40"><RefreshDouble width={16} height={16} aria-hidden="true" /></button></span></summary>
    {(actionError || error) && <p role="alert" className="mb-2 select-text text-sm text-danger">{actionError || error}</p>}
    {!overview && !error && <p role="status" className="text-sm text-ink-secondary">{uiText('불러오는 중…')}</p>}
    {overview && <div className="max-h-[35dvh] overflow-y-auto">
      {!requests.length && !overview.links.length && <p className="py-1 text-sm text-ink-secondary">{uiText('접근 요청과 승인된 Mewlink 계정이 없습니다.')}</p>}
      {requests.length > 0 && <ul className="divide-y divide-edge" aria-label={uiText('Mewlink 접근 요청')}>
        {requests.map(request => <li key={request.id} className="py-2">
          <div className="flex items-start justify-between gap-2">
            <IdentityLabel identity={request.identity} />
            {request.status === 'pending' ? <div className="flex shrink-0 items-center gap-1">
              <button type="button" disabled={busy} onClick={() => void update('POST', `/requests/${encodeURIComponent(request.id)}/approve`, {})} aria-label={uiText('{name} 접근 승인', { name: request.identity.displayName })} className="flex items-center gap-1 rounded px-2 py-1 text-sm text-ink hover:bg-surface-raised disabled:opacity-40"><Check width={16} height={16} aria-hidden="true" />{uiText('승인')}</button>
              <span data-tip={uiText('요청 거절')}><button type="button" disabled={busy} aria-label={uiText('{name} 접근 요청 거절', { name: request.identity.displayName })} onClick={() => void update('POST', `/requests/${encodeURIComponent(request.id)}/deny`)} className="rounded p-1 text-ink-secondary hover:bg-surface-raised disabled:opacity-40"><Xmark width={16} height={16} aria-hidden="true" /></button></span>
            </div> : <span className="shrink-0 text-xs text-ink-secondary">{uiText('거절됨')}</span>}
          </div>
        </li>)}
      </ul>}
      {overview.links.length > 0 && <ul className="divide-y divide-edge" aria-label={uiText('승인된 Mewlink 계정')}>
        {overview.links.map(link => {
          const account = users.find(user => user.email === link.accountId)
          return <li key={link.id} className="py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><IdentityLabel identity={link.identity} /><div className="mt-1 break-words text-xs text-ink-secondary">{uiText('mew 계정: {name}', { name: account?.displayName || link.accountId })}{account ? ` · ${account.role}` : ''}</div></div>
              <span data-tip={uiText('연결 해제')}><button type="button" disabled={busy} onClick={() => setDisconnecting(link.id)} aria-label={uiText('{name} Mewlink 연결 해제', { name: link.identity.displayName })} className="shrink-0 rounded p-1 text-ink-secondary hover:bg-surface-raised disabled:opacity-40"><Xmark width={16} height={16} aria-hidden="true" /></button></span>
            </div>
            {disconnecting === link.id && <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span>{uiText('연결을 해제하면 이 계정의 Mewlink 접속이 종료됩니다.')}</span>
              <button type="button" disabled={busy} onClick={() => void update('DELETE', `/links/${encodeURIComponent(link.id)}`)} className="rounded bg-accent px-2 py-1 text-ink-on-accent hover:bg-accent-strong disabled:opacity-40">{uiText('연결 해제')}</button>
              <span data-tip={uiText('취소')}><button type="button" disabled={busy} onClick={() => setDisconnecting(null)} aria-label={uiText('연결 해제 취소')} className="rounded p-1 text-ink-secondary hover:bg-surface-raised disabled:opacity-40"><Xmark width={16} height={16} aria-hidden="true" /></button></span>
            </div>}
          </li>
        })}
      </ul>}
    </div>}
  </details></HoverTipLayer>
}
