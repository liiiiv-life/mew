import { useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { changePassword, fetchAuthStatus, login, type AuthStatus } from '../api/client'

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
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setError(`비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다`)
      return
    }
    if (newPassword !== confirmPassword) {
      setError('새 비밀번호가 서로 다릅니다')
      return
    }
    setBusy(true)
    try {
      await changePassword(password, newPassword)
      onSuccess(await fetchAuthStatus())
    } catch (err) {
      setError(err instanceof Error ? err.message : '비밀번호 변경에 실패했습니다')
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
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        {step === 'credentials' ? (
          <>
            <p className="mb-5 text-sm text-ink-muted">승인된 계정만 접근할 수 있습니다</p>
            <form onSubmit={handleLogin} className="flex flex-col gap-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="이메일"
                autoComplete="username"
                autoFocus
                required
                className={inputClass}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호"
                autoComplete="current-password"
                required
                className={inputClass}
              />
              {error && <div className="text-sm text-danger">{error}</div>}
              <button
                type="submit"
                disabled={busy || !email || !password}
                className="mt-1 rounded bg-accent py-2 text-sm font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
              >
                {busy ? '확인 중…' : '로그인'}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="mb-5 text-sm text-ink-muted">
              임시 비밀번호로 로그인했습니다 — 사용할 비밀번호를 새로 정해주세요 ({PASSWORD_MIN_LENGTH}자 이상)
            </p>
            <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="새 비밀번호"
                autoComplete="new-password"
                autoFocus
                required
                className={inputClass}
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="새 비밀번호 확인"
                autoComplete="new-password"
                required
                className={inputClass}
              />
              {error && <div className="text-sm text-danger">{error}</div>}
              <button
                type="submit"
                disabled={busy || !newPassword || !confirmPassword}
                className="mt-1 rounded bg-accent py-2 text-sm font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
              >
                {busy ? '변경 중…' : '비밀번호 변경하고 시작하기'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
