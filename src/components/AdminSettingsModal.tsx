import { useEffect, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { addUser, fetchUsers, setUserRole, type AdminUser, type Role } from '../api/client'

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
      .catch((err) => setLoadError(err instanceof Error ? err.message : '사용자 목록을 불러오지 못했습니다'))
      .finally(() => setLoading(false))
  }, [])

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
      setAddError(err instanceof Error ? err.message : '계정 추가에 실패했습니다')
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
      setLoadError(err instanceof Error ? err.message : '역할 변경에 실패했습니다')
    }
  }

  const inputClass =
    'w-full rounded border border-edge-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright'
  const selectClass =
    'rounded border border-edge-strong bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-edge-bright'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-lg border border-edge bg-surface-deep p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-semibold text-ink-bright">계정 관리</div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleAddUser} className="mb-4 flex flex-col gap-2 border-b border-edge pb-4">
          <div className="text-sm font-medium">허용 이메일 추가</div>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="이메일"
            autoComplete="off"
            required
            className={inputClass}
          />
          <div className="flex items-center gap-2">
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)} className={selectClass}>
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
              {addBusy ? '추가 중…' : '추가'}
            </button>
          </div>
          {addError && <div className="text-sm text-danger">{addError}</div>}
          {tempPassword && (
            <div className="rounded border border-edge-strong bg-surface p-2 text-sm">
              <div className="text-ink-secondary">
                <span className="text-ink-bright">{tempPassword.email}</span> 임시 비밀번호
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <code className="text-ink-bright">{tempPassword.password}</code>
                <button
                  type="button"
                  onClick={() => setTempPassword(null)}
                  className="text-xs text-ink-muted hover:text-ink"
                >
                  닫기
                </button>
              </div>
              <div className="mt-1 text-xs text-ink-muted">안전한 채널로 본인에게 전달하세요 — 다시 표시되지 않습니다</div>
            </div>
          )}
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mb-2 text-sm font-medium">계정 목록</div>
          {loading && <div className="text-sm text-ink-muted">불러오는 중…</div>}
          {loadError && <div className="text-sm text-danger">{loadError}</div>}
          {!loading && users.length === 0 && <div className="text-sm text-ink-muted">등록된 계정이 없습니다</div>}
          <ul className="flex flex-col gap-1.5">
            {users.map((u) => (
              <li key={u.email} className="flex items-center justify-between gap-2 rounded border border-edge px-2 py-1.5">
                <div className="min-w-0">
                  <div className="truncate text-sm text-ink">{u.email}</div>
                  {u.mustChangePassword && <div className="text-xs text-ink-muted">임시 비밀번호 — 변경 대기</div>}
                </div>
                <select
                  value={u.role}
                  onChange={(e) => handleRoleChange(u.email, e.target.value as Role)}
                  className={selectClass}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
