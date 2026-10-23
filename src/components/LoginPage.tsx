import { canAutoFocusInput, HoverTipLayer } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useEffect, useRef, useState } from 'react'
import { Xmark } from 'iconoir-react'
import { useOverlayDismiss } from '@mew/ui'
import type { MewlinkAccessStatus } from '../../shared/mewlink-identity.ts'
import { changePassword, fetchAuthStatus, login, type AuthStatus } from '../api/auth'
import { useI18n } from '../i18n'
import { requestMewlinkLogin } from '../utils/remote-app.ts'
import { isRemoteMode, mewFetch } from '../utils/remote-transport.ts'

const PASSWORD_MIN_LENGTH = 10

interface LoginPageProps {
  onClose: () => void
  onSuccess: (status: AuthStatus) => void
  dismissible?: boolean
  initialMustChangePassword?: boolean
  passwordOnly?: boolean
}

function MewlinkLogin({ onSuccess }: Pick<LoginPageProps, 'onSuccess'>) {
  const [status, setStatus] = useState<MewlinkAccessStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(false)
  const latestRequest = useRef(0)
  const onSuccessRef = useRef(onSuccess)
  onSuccessRef.current = onSuccess

  async function request(method = 'GET', suffix = '') {
    const response = await mewFetch(`/api/auth/mewlink${suffix}`, { method })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || uiText('Mewlink 접근 상태를 확인하지 못했습니다.'))
    return result as MewlinkAccessStatus
  }

  async function enter() {
    setBusy(true)
    setError('')
    try {
      await request('POST', '/login')
      const auth = await fetchAuthStatus()
      if (mounted.current) onSuccessRef.current(auth)
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : uiText('로그인하지 못했습니다. 다시 시도하세요.'))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  useEffect(() => {
    mounted.current = true
    const revision = ++latestRequest.current
    void request().then(result => {
      if (mounted.current && revision === latestRequest.current) setStatus(result)
    }).catch(error => {
      if (mounted.current && revision === latestRequest.current) setError(error instanceof Error ? error.message : uiText('Mewlink 접근 상태를 확인하지 못했습니다.'))
    })
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (status?.state !== 'pending' || busy) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await request()
        if (!active || !mounted.current) return
        setStatus(result)
        setError('')
        if (result.state === 'approved') { void enter(); return }
        if (result.state !== 'pending') return
      } catch (error) {
        if (!active || !mounted.current) return
        setError(error instanceof Error ? error.message : uiText('Mewlink 접근 상태를 확인하지 못했습니다.'))
      }
      if (active) timer = setTimeout(() => { void poll() }, 3000)
    }
    timer = setTimeout(() => { void poll() }, 3000)
    return () => { active = false; clearTimeout(timer) }
  }, [status?.state, busy])

  async function askForAccess() {
    setBusy(true)
    setError('')
    latestRequest.current++
    try {
      const result = await request('POST', '/request')
      if (mounted.current) setStatus(result)
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : uiText('Mewlink 접근 요청을 보내지 못했습니다.'))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const identity = status?.identity
  return <section className="mb-3 border-b border-edge pb-3" aria-label={uiText('Mewlink 계정')}>
    {identity ? <>
      <div className="mb-2 min-w-0 text-sm">
        <div className="break-words font-medium text-ink-bright">{identity.displayName}</div>
        <div className="break-words text-xs text-ink-secondary">{identity.provider}{identity.username ? ` · ${identity.username}` : ''}</div>
      </div>
      {status.state === 'pending' ? <p role="status" className="text-sm text-ink-secondary">{uiText('관리자 승인 대기 중')}</p>
        : status.state === 'approved' ? <button type="button" disabled={busy} onClick={() => void enter()} className="w-full rounded bg-accent px-3 py-2 text-sm font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40">{busy ? uiText('로그인 중…') : uiText('Mewlink로 로그인')}</button>
          : <>
            {status.state === 'denied' && <p role="status" className="mb-2 text-sm text-ink-secondary">{uiText('접근 요청이 거절됐습니다.')}</p>}
            <button type="button" disabled={busy} onClick={() => void askForAccess()} className="w-full rounded border border-edge-strong px-3 py-2 text-sm font-medium text-ink hover:bg-surface-raised disabled:opacity-40">{busy ? uiText('요청 중…') : status.state === 'denied' ? uiText('다시 접근 요청') : uiText('접근 요청')}</button>
          </>}
    </> : <button type="button" disabled={busy} onClick={() => {
      setError('')
      try { requestMewlinkLogin() } catch (error) { setError(error instanceof Error ? error.message : uiText('로그인 페이지를 열지 못했습니다')) }
    }} className="w-full rounded border border-edge-strong px-3 py-2 text-sm font-medium text-ink hover:bg-surface-raised disabled:opacity-40">{uiText('Mewlink로 로그인')}</button>}
    {error && <p role="alert" className="mt-2 select-text text-sm text-danger">{error}</p>}
  </section>
}

/**
 * 로그인 모달. 관리자가 준 임시 비밀번호로 처음 로그인하면 서버가 mustChangePassword를
 * 돌려주고, 이때는 비밀번호 변경까지 마쳐야 입장할 수 있다.
 */
export function LoginPage({ onClose, onSuccess, dismissible = true, initialMustChangePassword = false, passwordOnly = false }: LoginPageProps) {
  const { t } = useI18n()
  const [step, setStep] = useState<'credentials' | 'change'>(initialMustChangePassword ? 'change' : 'credentials')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useOverlayDismiss(dismissible && onClose)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await login(email, password)
      if (result.mustChangePassword) {
        setStep('change')
      } else {
        onSuccess(await fetchAuthStatus())
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.loginFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setError(t('auth.passwordTooShort', { length: PASSWORD_MIN_LENGTH }))
      return
    }
    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordMismatch'))
      return
    }
    setBusy(true)
    try {
      await changePassword(password, newPassword)
      onSuccess(await fetchAuthStatus())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.passwordChangeFailed'))
    } finally {
      setBusy(false)
    }
  }

  const inputClass =
    'w-full rounded border border-edge-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright'

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center px-4 ${dismissible ? 'bg-black/50' : 'bg-surface'}`} onClick={dismissible ? onClose : undefined}>
      <div role="dialog" aria-modal="true" aria-label={t('common.login')} className="max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-lg border border-edge bg-surface-deep p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-semibold text-ink-bright">mew</div>
          {dismissible && <HoverTipLayer><span data-tip={t('common.close')}><button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
            aria-label={t('common.close')}
          >
            <Xmark width={16} height={16} aria-hidden="true" />
          </button></span></HoverTipLayer>}
        </div>
        {step === 'credentials' ? (
          <>
            {!passwordOnly && isRemoteMode() && <MewlinkLogin onSuccess={onSuccess} />}
            <p className="mb-3 text-sm text-ink-muted">{t('auth.approvedAccountsOnly')}</p>
            <form onSubmit={handleLogin} className="flex flex-col gap-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.email')}
                autoComplete="username"
                autoFocus={canAutoFocusInput()}
                required
                className={inputClass}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.password')}
                autoComplete="current-password"
                required
                className={inputClass}
              />
              {error && <div role="alert" className="select-text text-sm text-danger">{error}</div>}
              <button
                type="submit"
                disabled={busy || !email || !password}
                className="mt-1 rounded bg-accent py-2 text-sm font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
              >
                {busy ? t('auth.checking') : t('common.login')}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="mb-5 text-sm text-ink-muted">
              {t('auth.temporaryPasswordNotice', { length: PASSWORD_MIN_LENGTH })}
            </p>
            <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
              {initialMustChangePassword && <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('settings.currentPassword')}
                autoComplete="current-password"
                autoFocus={canAutoFocusInput()}
                required
                className={inputClass}
              />}
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('settings.newPassword')}
                autoComplete="new-password"
                autoFocus={!initialMustChangePassword && canAutoFocusInput()}
                required
                className={inputClass}
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('settings.confirmPassword')}
                autoComplete="new-password"
                required
                className={inputClass}
              />
              {error && <div role="alert" className="select-text text-sm text-danger">{error}</div>}
              <button
                type="submit"
                disabled={busy || !newPassword || !confirmPassword || (initialMustChangePassword && !password)}
                className="mt-1 rounded bg-accent py-2 text-sm font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
              >
                {busy ? t('settings.changing') : t('auth.finishPasswordChange')}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
