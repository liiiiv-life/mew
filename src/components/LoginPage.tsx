import { canAutoFocusInput } from '@mew/ui'
import { useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { changePassword, fetchAuthStatus, login, type AuthStatus } from '../api/client'
import { useI18n } from '../i18n'

const PASSWORD_MIN_LENGTH = 10

interface LoginPageProps {
  onClose: () => void
  onSuccess: (status: AuthStatus) => void
}

/**
 * 로그인 모달. 관리자가 준 임시 비밀번호로 처음 로그인하면 서버가 mustChangePassword를
 * 돌려주고, 이때는 비밀번호 변경까지 마쳐야 입장할 수 있다.
 */
export function LoginPage({ onClose, onSuccess }: LoginPageProps) {
  const { t } = useI18n()
  const [step, setStep] = useState<'credentials' | 'change'>('credentials')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useOverlayDismiss(onClose)

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg border border-edge bg-surface-deep p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-semibold text-ink-bright">mew</div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>
        {step === 'credentials' ? (
          <>
            <p className="mb-5 text-sm text-ink-muted">{t('auth.approvedAccountsOnly')}</p>
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
              {error && <div className="select-text text-sm text-danger">{error}</div>}
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
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('settings.newPassword')}
                autoComplete="new-password"
                autoFocus={canAutoFocusInput()}
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
              {error && <div className="select-text text-sm text-danger">{error}</div>}
              <button
                type="submit"
                disabled={busy || !newPassword || !confirmPassword}
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
