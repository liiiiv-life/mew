import { useEffect, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { addUser, fetchUsers, setUserRole, type AdminUser, type Role } from '../api/client'
import { AccountAccessMatrix } from './account-access-matrix'
import { useI18n } from '../i18n'

const ROLES: Role[] = ['owner', 'manager', 'member']

const ROLE_LABEL: Record<Role, string> = {
  owner: 'owner',
  manager: 'manager',
  member: 'member',
  guest: 'guest',
}

interface AdminSettingsModalProps {
  onClose: () => void
}

/** owner 전용 — 허용 이메일 추가 + 계정 역할 부여. 프로젝트 선택 버튼 옆 설정 아이콘으로 연다. */
export function AdminSettingsModal({ onClose }: AdminSettingsModalProps) {
  const { t } = useI18n()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<Role>('member')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null)

  useOverlayDismiss(onClose)

  useEffect(() => {
    fetchUsers()
      .then(setUsers)
      .catch((err) => setLoadError(err instanceof Error ? err.message : t('admin.usersLoadFailed')))
      .finally(() => setLoading(false))
  }, [t])

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault()
    setAddError(null)
    setAddBusy(true)
    try {
      const result = await addUser(newEmail.trim().toLowerCase(), newRole)
      setTempPassword({ email: result.email, password: result.tempPassword })
      setUsers((prev) => [...prev, { email: result.email, role: newRole, mustChangePassword: true, createdAt: Date.now() }])
      setNewEmail('')
      setNewRole('member')
    } catch (err) {
      setAddError(err instanceof Error ? err.message : t('admin.addAccountFailed'))
    } finally {
      setAddBusy(false)
    }
  }

  async function handleRoleChange(email: string, role: Role) {
    const prev = users
    setUsers((curr) => curr.map((u) => (u.email === email ? { ...u, role } : u)))
    try {
      await setUserRole(email, role)
    } catch (err) {
      setUsers(prev)
      throw err
    }
  }

  const inputClass =
    'w-full rounded border border-edge-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright'
  const selectClass =
    'rounded border border-edge-strong bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-edge-bright'

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label={t('admin.title')}
        className="flex max-h-[90dvh] w-full max-w-6xl flex-col rounded-lg border border-edge bg-surface-deep p-3 md:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-semibold text-ink-bright">{t('admin.title')}</div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>

        <details className="mb-3 shrink-0"><summary className="cursor-pointer py-2 text-sm font-medium">{t('admin.addAllowedEmail')}</summary><form onSubmit={handleAddUser} className="mb-4 flex flex-col gap-2 border-b border-edge pb-4">
          <div className="text-sm font-medium">{t('admin.addAllowedEmail')}</div>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder={t('auth.email')}
            autoComplete="off"
            required
            className={inputClass}
          />
          <div className="flex items-center gap-2">
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)} aria-label={t('access.role')} className={selectClass}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={addBusy || !newEmail.trim()}
              className="flex-1 rounded bg-accent py-1.5 text-sm font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
            >
              {addBusy ? t('admin.adding') : t('common.add')}
            </button>
          </div>
          {addError && <div className="select-text text-sm text-danger">{addError}</div>}
          {tempPassword && (
            <div className="rounded border border-edge-strong bg-surface p-2 text-sm">
              <div className="text-ink-secondary">
                <span className="text-ink-bright">{tempPassword.email}</span> {t('admin.temporaryPassword')}
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <code className="text-ink-bright">{tempPassword.password}</code>
                <button
                  type="button"
                  onClick={() => setTempPassword(null)}
                  className="text-xs text-ink-muted hover:text-ink"
                >
                  {t('common.close')}
                </button>
              </div>
              <div className="mt-1 text-xs text-ink-muted">{t('admin.passwordDeliveryWarning')}</div>
            </div>
          )}
        </form></details>

        {loading && <p role="status" className="text-sm text-ink-secondary">{t('common.loading')}</p>}
        {loadError && <p role="alert" className="text-sm text-danger">{loadError}</p>}
        {!loading && <AccountAccessMatrix users={users} onRoleChange={handleRoleChange} />}
      </div>
    </div>
  )
}
