import { useEffect, useState } from 'react'
import { RefreshDouble } from 'iconoir-react'
import { HoverTipLayer } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import type { MewlinkAccessStatus } from '../../shared/mewlink-identity.ts'
import { LoginPage } from './LoginPage.tsx'
import { reloadRemoteAppForIdentity, requestMewlinkLogin } from '../utils/remote-app.ts'
import { isRemoteMode, mewFetch } from '../utils/remote-transport.ts'

export function MewlinkAccountConnection({ email, authenticationMethod }: {
  email: string
  authenticationMethod?: 'password' | 'mewlink' | null
}) {
  useUiLocale()
  const [status, setStatus] = useState<MewlinkAccessStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const remote = isRemoteMode()

  useEffect(() => {
    if (!remote) return
    const controller = new AbortController()
    setStatus(null)
    setError('')
    void mewFetch('/api/auth/mewlink', { signal: controller.signal }).then(async response => {
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || uiText('Mewlink 접근 상태를 확인하지 못했습니다.'))
      if (!controller.signal.aborted) setStatus(result)
    }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : uiText('Mewlink 접근 상태를 확인하지 못했습니다.'))
    })
    return () => controller.abort()
  }, [remote, email, authenticationMethod, refresh])

  async function connect() {
    if (!status || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await mewFetch('/api/auth/mewlink/link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previousAccountId: status.accountId ?? null }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || uiText('Mewlink 계정을 연결하지 못했습니다.'))
      setStatus({ identity: status.identity, state: 'approved', accountId: email })
    } catch (error) {
      setError(error instanceof Error ? error.message : uiText('Mewlink 계정을 연결하지 못했습니다.'))
    } finally { setBusy(false) }
  }

  if (!remote) return null
  const passwordLogin = authenticationMethod === 'password'
  const connected = status?.state === 'approved' && status.accountId === email
  return <section className="mb-4 flex flex-col gap-2 border-t border-edge pt-4" aria-label={uiText('Mewlink 계정 연결')}>
    <div className="flex items-center justify-between gap-2 text-sm font-medium">{uiText('Mewlink 계정 연결')}<HoverTipLayer><span data-tip={uiText('새로고침')}><button type="button" disabled={busy} aria-label={uiText('Mewlink 계정 새로고침')} onClick={() => setRefresh(value => value + 1)} className="rounded p-1 text-ink-secondary hover:bg-surface-raised disabled:opacity-40"><RefreshDouble width={16} height={16} aria-hidden="true" /></button></span></HoverTipLayer></div>
    {status?.identity && <div className="min-w-0 text-sm">
      <div className="break-words text-ink">{status.identity.displayName}</div>
      <div className="break-words text-xs text-ink-secondary">{status.identity.provider}{status.identity.username ? ` · ${status.identity.username}` : ''}</div>
    </div>}
    {error && <p role="alert" className="select-text text-sm text-danger">{error}</p>}
    {!status && !error && <p role="status" className="text-sm text-ink-secondary">{uiText('불러오는 중…')}</p>}
    {status && (connected && passwordLogin ? <p role="status" className="break-words text-sm text-success">{uiText('{email}에 연결됨', { email })}</p>
      : !status.identity ? <button type="button" onClick={() => {
        try { requestMewlinkLogin() } catch (error) { setError(error instanceof Error ? error.message : uiText('로그인 페이지를 열지 못했습니다')) }
      }} className="w-fit rounded border border-edge-strong px-3 py-2 text-sm text-ink hover:bg-surface-raised">{uiText('Mewlink로 로그인')}</button>
        : !passwordLogin ? <button type="button" onClick={() => setLoginOpen(true)} className="w-fit rounded border border-edge-strong px-3 py-2 text-sm text-ink hover:bg-surface-raised">{uiText('기존 이메일 계정으로 로그인')}</button>
          : <>
            <p className="break-words text-sm text-ink-secondary">{uiText('연결할 이메일 계정: {email}', { email })}</p>
            {status.accountId && status.accountId !== email && <p className="text-xs text-ink-secondary">{uiText('병합 후 로그인 수단이 남지 않는 이전 계정은 삭제됩니다. 작업 기록은 보존됩니다.')}</p>}
            <button type="button" disabled={busy} onClick={() => void connect()} className="w-fit rounded bg-accent px-3 py-2 text-sm font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40">{busy ? uiText('연결 중…') : uiText('이 계정에 연결')}</button>
          </>)}
    {loginOpen && <LoginPage passwordOnly onClose={() => setLoginOpen(false)} onSuccess={status => {
      if (!reloadRemoteAppForIdentity(status.email)) window.location.reload()
    }} />}
  </section>
}
