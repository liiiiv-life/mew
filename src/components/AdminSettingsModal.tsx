import { MewlinkAccessSettings } from './mewlink-access-settings'
import { useCallback, useEffect, useId, useState } from 'react'
import { DialogFrame, HoverTipLayer } from '@mew/ui'
import { Plus, Xmark } from 'iconoir-react'
import { addUser, deleteUser, fetchUsers, setUserRole, type AdminUser, type Role } from '../api/client'
import { AccountAccessMatrix } from './account-access-matrix'
import { useI18n } from '../i18n'
import { AccountRoleSelect } from './account-role-select'

interface AdminSettingsModalProps {
  onClose: () => void
}

/** owner 계정·역할·권한 관리. */
export function AdminSettingsModal({ onClose }: AdminSettingsModalProps) {
  const { t } = useI18n()
  const titleId = useId()
  const [showAdd, setShowAdd] = useState(false)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<Role>('member')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null)

  const loadUsers = useCallback(async () => {
    try { setUsers(await fetchUsers()); setLoadError(null) }
    catch (err) { setLoadError(err instanceof Error ? err.message : t('admin.usersLoadFailed')) }
    finally { setLoading(false) }
  }, [t])
  useEffect(() => { void loadUsers() }, [loadUsers])

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

  async function handleDelete(email: string) {
    await deleteUser(email)
    setUsers(current => current.filter(user => user.email !== email))
  }

  const inputClass =
    'w-full rounded border border-edge-strong bg-surface px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright'

  return (
    <DialogFrame labelledBy={titleId} onClose={onClose} busy={addBusy} size="settings" className="flex flex-col">
      <HoverTipLayer className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
          <h2 id={titleId} className="text-sm font-semibold text-ink-bright">{t('admin.title')}</h2>
          {!loading && <span className="text-xs tabular-nums text-ink-secondary">{users.length}</span>}
          <div className="ml-auto flex items-center gap-1">
            <button type="button" aria-label={t('admin.addAllowedEmail')} aria-expanded={showAdd} aria-controls={showAdd ? `${titleId}-add` : undefined} data-tip={t('admin.addAllowedEmail')} onClick={() => setShowAdd(value => !value)} className={`flex h-8 w-8 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-accent ${showAdd ? 'bg-accent/15 text-accent' : 'text-ink-secondary hover:bg-surface-hover hover:text-ink'}`}><Plus width={18} height={18} aria-hidden="true" /></button>
            <button type="button" onClick={onClose} disabled={addBusy} aria-label={t('common.close')} data-tip={t('common.close')} className="flex h-8 w-8 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"><Xmark width={18} height={18} aria-hidden="true" /></button>
          </div>
        </header>
        {showAdd && <form id={`${titleId}-add`} aria-label={t('admin.addAllowedEmail')} onSubmit={handleAddUser} className="flex shrink-0 flex-col gap-2 border-b border-edge bg-surface-deep p-3">
          <div className="flex flex-wrap items-center gap-2">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            aria-label={t('auth.email')}
            placeholder={t('auth.email')}
            autoComplete="off"
            required
            className={`${inputClass} min-w-40 flex-1`}
          />
            <AccountRoleSelect iconOnly={false} label={t('access.role')} value={newRole} disabled={addBusy}
              onChange={setNewRole} className="w-28 min-w-0" />
            <button
              type="submit"
              disabled={addBusy || !newEmail.trim()}
              className="min-h-9 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
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
        </form>}
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          {loading && <p role="status" className="text-sm text-ink-secondary">{t('common.loading')}</p>}
          {loadError && <p role="alert" className="text-sm text-danger">{loadError}</p>}
          {!loading && <AccountAccessMatrix users={users} onRoleChange={handleRoleChange} onDelete={handleDelete} />}
        </div>
        <div className="shrink-0 border-t border-edge px-3 py-2"><MewlinkAccessSettings users={users} onUsersChanged={loadUsers} /></div>
      </HoverTipLayer>
    </DialogFrame>
  )
}
