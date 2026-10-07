import { useEffect, useState } from 'react'
import { Copy, RefreshDouble, Xmark } from 'iconoir-react'
import { HoverTipLayer, SelectField } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import type { RemoteStatus } from '../../shared/remote-access.ts'
import { mewFetch, isRemoteMode } from '../utils/remote-transport.ts'
export function RemoteAccessSettings({ users = [] }: { users?: { email: string; role: string }[] }) {
  const [members, setMembers] = useState<Record<string, string>>({}), [subject, setSubject] = useState(''), [email, setEmail] = useState('')
  const [status, setStatus] = useState<RemoteStatus | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false), [confirm, setConfirm] = useState(false)
  async function request(method = 'GET', suffix = '') {
    const response = await mewFetch(`/api/remote-access${suffix}`, { method })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || uiText('원격 접속 설정을 불러오지 못했습니다.'))
    return result as RemoteStatus
  }
  const refresh = () => request().then(result => { setStatus(result); if (result.enabled) void mewFetch('/api/remote-access/members').then(response => response.ok ? response.json() : {}).then(setMembers) }).catch(error => setError(error.message))
  useEffect(() => { void refresh(); const timer = setInterval(() => { void refresh() }, 3000); return () => clearInterval(timer) }, [])
  async function update(method: string, suffix = '') { setBusy(true); setError(''); try { setStatus(await request(method, suffix)); setConfirm(false) } catch (error) { setError(error instanceof Error ? error.message : uiText('원격 접속 설정을 불러오지 못했습니다.')) } finally { setBusy(false) } }
  async function member(enabled: boolean, memberSubject = subject) {
    setBusy(true); setError('')
    try { const response = await mewFetch('/api/remote-access/members', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: memberSubject, email, enabled }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setMembers(result); setSubject('') }
    catch (error) { setError(error instanceof Error ? error.message : uiText('요청을 처리하지 못했습니다.')) } finally { setBusy(false) }
  }
  const url = status?.registrationUrl ?? status?.url
  return <HoverTipLayer><section className="mb-3 border-b border-edge pb-3" aria-labelledby="remote-access-title">
    <div className="flex items-center justify-between gap-2">
      <h2 id="remote-access-title" className="text-sm font-medium">{uiText('원격 접속')}</h2>
      <span data-tip={uiText('새로고침')}><button type="button" className="rounded p-1 text-ink-secondary hover:bg-surface-raised" aria-label={uiText('새로고침')} disabled={busy} onClick={() => void refresh()}><RefreshDouble width={16} height={16} /></button></span>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <span role="status" className="text-ink-secondary">{uiText(status?.state === 'online' ? '온라인' : status?.state === 'connecting' ? '연결 중' : status?.state === 'registering' ? '등록 대기' : status?.state === 'offline' ? '오프라인' : '등록 안 됨')}</span>
      {!isRemoteMode() && !status?.enabled && status?.state !== 'registering' && <button type="button" disabled={busy} className="rounded bg-accent px-2 py-1 text-ink-on-accent disabled:opacity-40" onClick={() => void update('POST', '/register')}>{uiText('기기 등록')}</button>}
      {url && <><a href={url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-accent hover:underline">{status?.state === 'registering' ? uiText('로그인하고 등록 완료') : url}</a><span data-tip={uiText('주소 복사')}><button type="button" aria-label={uiText('주소 복사')} className="rounded p-1 hover:bg-surface-raised" onClick={() => { void navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => setError(uiText('주소를 복사하지 못했습니다.'))) }}><Copy width={16} height={16} /></button></span></>}
      {!isRemoteMode() && (status?.enabled || status?.state === 'registering') && <span data-tip={uiText('등록 해제')}><button type="button" aria-label={uiText('등록 해제')} disabled={busy} className="rounded p-1 text-ink-secondary hover:bg-surface-raised" onClick={() => setConfirm(true)}><Xmark width={16} height={16} /></button></span>}
    </div>
    {confirm && <div className="mt-2 flex flex-wrap items-center gap-2 text-sm"><span>{uiText('이 기기의 원격 연결을 종료하고 등록을 해제할까요?')}</span><button type="button" disabled={busy} className="rounded bg-accent px-2 py-1 text-ink-on-accent" onClick={() => void update('DELETE')}>{uiText('등록 해제')}</button><button type="button" className="rounded px-2 py-1 hover:bg-surface-raised" onClick={() => setConfirm(false)}>{uiText('취소')}</button></div>}
    {status?.enabled && <details className="mt-2"><summary className="cursor-pointer py-1 text-sm">{uiText('멤버 접근')}</summary>
      <form className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={event => { event.preventDefault(); void member(true) }}>
        <label className="flex min-w-0 flex-col gap-1 text-xs">{uiText('중앙 계정 ID')}<input required pattern="[a-zA-Z0-9_-]{20,64}" value={subject} onChange={event => setSubject(event.target.value)} className="min-w-0 rounded border border-edge bg-surface px-2 py-1.5 text-sm" /></label>
        <SelectField label={uiText('로컬 계정')} value={email} onChange={setEmail} disabled={busy} options={users.map(user => ({ value: user.email, label: user.email }))} />
        <button type="submit" disabled={busy || !email} className="self-end rounded bg-accent px-2 py-1.5 text-sm text-ink-on-accent disabled:opacity-40">{uiText('접근 허용')}</button>
      </form>
      <ul className="mt-2 divide-y divide-edge">{Object.entries(members).map(([id, email]) => <li key={id} className="flex min-w-0 items-center gap-2 py-1.5 text-xs"><span className="min-w-0 flex-1 truncate">{email}</span><span className="min-w-0 max-w-32 truncate text-ink-secondary">{id}</span><button type="button" disabled={busy} aria-label={uiText('접근 회수')} data-tip={uiText('접근 회수')} onClick={() => void member(false, id)} className="rounded p-1 hover:bg-surface-raised"><Xmark width={14} height={14} /></button></li>)}</ul>
    </details>}
    {copied && <p role="status" className="mt-1 text-xs text-ink-secondary">{uiText('주소를 복사했습니다.')}</p>}
    {(error || status?.error) && <p role="alert" className="mt-2 text-sm text-red-500">{error || status?.error}</p>}
  </section></HoverTipLayer>
}
