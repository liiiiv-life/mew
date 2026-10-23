import { useEffect, useState } from 'react'
import { Check, Copy, Link, LogOut, OpenNewWindow, RefreshDouble, Xmark } from 'iconoir-react'
import { DialogFrame, HoverTipLayer } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import type { RemoteStatus } from '../../shared/remote-access.ts'
import { mewFetch, isRemoteMode } from '../utils/remote-transport.ts'
export function RemoteAccessSettings() {
  const [status, setStatus] = useState<RemoteStatus | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false), [confirm, setConfirm] = useState(false)
  async function request(method = 'GET', suffix = '') {
    const response = await mewFetch(`/api/remote-access${suffix}`, { method })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || uiText('원격 접속 설정을 불러오지 못했습니다.'))
    return result as RemoteStatus
  }
  const refresh = (force = false) => request('GET', force ? '?refresh=1' : '').then(result => { setStatus(result); setError('') }).catch(error => setError(error.message))
  useEffect(() => { void refresh(); const timer = setInterval(() => { void refresh() }, 3000); return () => clearInterval(timer) }, [])
  async function update(method: string, suffix = '') { setBusy(true); setError(''); try { setStatus(await request(method, suffix)); setConfirm(false) } catch (error) { setError(error instanceof Error ? error.message : uiText('원격 접속 설정을 불러오지 못했습니다.')) } finally { setBusy(false) } }
  const remote = isRemoteMode()
  const url = status?.state === 'registering' ? status.registrationUrl : status?.url
  const preparing = busy || status?.network?.state === 'preparing'
  const needsPreparation = status?.enabled && status.network && status.network.state !== 'ready' && status.network.reason !== 'platform-unmanaged' && status.network.state !== 'checking'
  const stateLabel = !status ? '불러오는 중' : status.state === 'online' ? '온라인' : status.state === 'connecting' ? '연결 중' : status.state === 'registering' ? '등록 대기' : status.state === 'offline' ? '오프라인' : status.state === 'error' ? '오류' : '등록 안 됨'
  const iconButton = 'inline-flex shrink-0 items-center justify-center rounded-md p-2 text-ink-secondary hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40'
  return <HoverTipLayer><section aria-labelledby="remote-access-title" className="space-y-3">
    <div className="flex items-center justify-between gap-2">
      <h3 id="remote-access-title" className="text-sm font-medium">{uiText('원격 접속')}</h3>
      <div className="flex items-center gap-1">
        <span role="status" className="inline-flex items-center gap-1.5 text-xs text-ink-secondary"><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${status?.state === 'online' ? 'bg-success' : status?.state === 'error' || status?.state === 'offline' ? 'bg-warning' : 'bg-ink-muted'}`} />{uiText(stateLabel)}</span>
        <span data-tip={uiText('새로고침')}><button type="button" className={iconButton} aria-label={uiText('새로고침')} disabled={busy} onClick={() => void refresh(true)}><RefreshDouble aria-hidden="true" width={16} height={16} /></button></span>
      </div>
    </div>
    {status?.enabled ? <>
      <div className="rounded-lg bg-surface-deep p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-ink-secondary"><Link aria-hidden="true" width={14} height={14} />{uiText('접속 주소')}</div>
        <div className="flex items-center gap-1">
          {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 break-all text-base font-medium text-ink underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent">{url.replace(/^https?:\/\//, '')}</a> : <span className="flex-1 text-sm text-ink-secondary">{uiText(status.addressError ? '접속 주소 확인 필요' : '확인 중')}</span>}
          {url && <span data-tip={uiText(copied ? '주소를 복사했습니다.' : '주소 복사')}><button type="button" aria-label={uiText('주소 복사')} className={iconButton} onClick={() => { void navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => setError(uiText('주소를 복사하지 못했습니다.'))) }}>{copied ? <Check aria-hidden="true" width={18} height={18} /> : <Copy aria-hidden="true" width={18} height={18} />}</button></span>}
        </div>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 text-sm">
        <dt className="text-ink-secondary">{uiText('Mewlink 계정')}</dt>
        <dd className="min-w-0 break-all text-right font-medium">{status.username ? `@${status.username}` : uiText(status.addressError ? '확인 필요' : '확인 중')}</dd>
        <dt className="text-ink-secondary">{uiText('기기 이름')}</dt>
        <dd className="min-w-0 break-all text-right">{status.deviceName || uiText('확인 중')}</dd>
        <dt className="text-ink-secondary">{uiText('직접 연결 준비')}</dt>
        <dd className="text-right">{uiText(status.network?.state === 'preparing' ? '연결 준비 중' : needsPreparation ? '연결 준비 필요' : status.network?.state === 'ready' ? '준비됨' : status.network?.reason === 'platform-unmanaged' ? '시스템에서 관리' : '확인 중')}</dd>
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-2">
        {status.dashboardUrl && <a href={status.dashboardUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded py-1 text-xs text-ink-secondary hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">{uiText('계정·기기 관리')}<OpenNewWindow aria-hidden="true" width={14} height={14} /></a>}
        <div className="ml-auto flex items-center gap-1">
          {!remote && needsPreparation && <button type="button" disabled={preparing} className="rounded-md bg-accent px-3 py-1.5 text-sm text-ink-on-accent disabled:opacity-40" onClick={() => void update('POST', '/prepare-network')}>{uiText('연결 준비')}</button>}
          {!remote && <span data-tip={uiText('등록 해제')}><button type="button" aria-label={uiText('등록 해제')} disabled={busy} className={iconButton} onClick={() => setConfirm(true)}><LogOut aria-hidden="true" width={16} height={16} /></button></span>}
        </div>
      </div>
      <p className="text-xs leading-relaxed text-ink-secondary">{uiText('접속 시 이 기기의 mew 계정으로 로그인합니다.')}</p>
    </> : status && <div className="space-y-3 rounded-lg bg-surface-deep p-3">
      <p className="text-sm leading-relaxed text-ink-secondary">{uiText(status.state === 'registering' ? 'Mewlink에서 계정과 기기 이름을 선택해 등록을 완료하세요.' : '이 기기를 등록하고 다른 기기에서도 mew에 접속하세요.')}</p>
      {status.state === 'registering' && url ? <div className="flex items-center justify-between gap-2"><a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-ink-on-accent">{uiText('로그인하고 등록 완료')}<OpenNewWindow aria-hidden="true" width={16} height={16} /></a>{!remote && <span data-tip={uiText('등록 해제')}><button type="button" aria-label={uiText('등록 해제')} className={iconButton} disabled={busy} onClick={() => setConfirm(true)}><Xmark aria-hidden="true" width={16} height={16} /></button></span>}</div> : !remote && <button type="button" disabled={preparing} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-ink-on-accent disabled:opacity-40" onClick={() => void update('POST', '/register')}>{uiText(preparing ? '연결 준비 중' : '기기 등록')}</button>}
    </div>}
    {confirm && <div className="space-y-2 rounded-lg bg-danger-surface p-3 text-sm text-danger-ink"><p>{uiText('이 기기의 원격 연결을 종료하고 등록을 해제할까요?')}</p><div className="flex justify-end gap-2"><button type="button" disabled={busy} className="rounded-md px-2 py-1 hover:bg-surface-hover" onClick={() => setConfirm(false)}>{uiText('취소')}</button><button type="button" disabled={busy} className="rounded-md bg-danger-strong px-2 py-1 text-ink-on-danger disabled:opacity-40" onClick={() => void update('DELETE')}>{uiText('등록 해제')}</button></div></div>}
    {copied && <p role="status" className="text-xs text-ink-secondary">{uiText('주소를 복사했습니다.')}</p>}
    {(error || status?.error || status?.network?.error || status?.addressError) && <p role="alert" className="break-words text-sm text-danger-ink">{error || status?.error || status?.network?.error || (status?.addressError && uiText('접속 주소를 확인하지 못했습니다. 새로고침해 주세요.'))}</p>}
  </section></HoverTipLayer>
}

export function RemoteAccessModal({ onClose }: { onClose: () => void }) {
  return <DialogFrame labelledBy="mewlink-title" onClose={onClose} className="max-w-lg max-h-[90dvh] overflow-y-auto">
    <HoverTipLayer>
      <header className="flex items-center justify-between gap-2 border-b border-edge px-3 py-2">
        <h2 id="mewlink-title" className="text-sm font-semibold">Mewlink</h2>
        <span data-tip={uiText('닫기')}><button type="button" aria-label={uiText('닫기')} className="rounded p-1 text-ink-secondary hover:bg-surface-raised hover:text-ink" onClick={onClose}><Xmark width={18} height={18} /></button></span>
      </header>
      <div className="p-3"><RemoteAccessSettings /></div>
    </HoverTipLayer>
  </DialogFrame>
}
