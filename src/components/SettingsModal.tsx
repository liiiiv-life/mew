import { useEffect, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { changePassword, fetchIgnoreList, logout, saveIgnoreList } from '../api/client'
import { DEFAULT_SHORTCUTS, formatKeyCombo, resetAllBindings, resetBinding, setBinding, useShortcutBindings } from '@mew/shortcuts'

const PASSWORD_MIN_LENGTH = 10

type Section = 'account' | 'appearance' | 'shortcuts' | 'ignore'
type Theme = 'dark' | 'light'

interface SettingsModalProps {
  /** 로그인한 사용자의 이메일 — 게스트면 null이라 계정 탭을 숨긴다 */
  email: string | null
  /** owner·manager만 숨김 목록 탭을 본다 — 모두의 트리를 바꾸는 전역 설정이라 */
  canEditIgnore: boolean
  theme: Theme
  onToggleTheme: () => void
  onClose: () => void
  onLoggedOut: () => void
}

const SECTION_LABEL: Record<Section, string> = {
  account: '계정',
  appearance: '화면',
  shortcuts: '단축키',
  ignore: '숨김 목록',
}

/** 헤더의 계정 버튼(게스트는 톱니 버튼)으로 여는 설정 창 — 계정·화면(테마)·단축키·숨김 목록을 한곳에서 관리한다 */
export function SettingsModal({ email, canEditIgnore, theme, onToggleTheme, onClose, onLoggedOut }: SettingsModalProps) {
  const [section, setSection] = useState<Section>(email ? 'account' : 'appearance')

  // Esc·모바일 뒤로가기로 이 창만 닫는다 (뒤의 사이드바·터미널은 그대로)
  useOverlayDismiss(onClose)

  const sections: Section[] = [
    ...(email ? (['account'] as Section[]) : []),
    'appearance',
    'shortcuts',
    ...(canEditIgnore ? (['ignore'] as Section[]) : []),
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-lg border border-edge bg-surface-deep"
        onClick={(e) => e.stopPropagation()}
      >
        <nav className="flex w-28 shrink-0 flex-col gap-1 border-r border-edge p-3 sm:w-40">
          <div className="mb-2 px-2 text-sm font-semibold text-ink-bright">설정</div>
          {sections.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={`rounded px-2 py-1.5 text-left text-sm ${
                section === id ? 'bg-surface-raised font-medium text-ink' : 'text-ink-secondary hover:bg-surface-raised hover:text-ink'
              }`}
            >
              {SECTION_LABEL[id]}
            </button>
          ))}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-edge px-4 py-3">
            <div className="text-sm font-semibold text-ink-bright">{SECTION_LABEL[section]}</div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
              aria-label="닫기"
            >
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {section === 'account' && email && <AccountPanel email={email} onLoggedOut={onLoggedOut} />}
            {section === 'appearance' && <AppearancePanel theme={theme} onToggleTheme={onToggleTheme} />}
            {section === 'shortcuts' && <ShortcutsPanel />}
            {section === 'ignore' && <IgnorePanel />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 계정: 비밀번호 변경 + 로그아웃 ───────────────────────────────────────────
function AccountPanel({ email, onLoggedOut }: { email: string; onLoggedOut: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
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
      await changePassword(currentPassword, newPassword)
      setSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '비밀번호 변경에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  async function handleLogout() {
    try {
      await logout()
    } catch {
      // 서버에 못 알려도 클라이언트 상태는 로그아웃으로 전환한다
    }
    onLoggedOut()
  }

  const inputClass =
    'w-full rounded border border-edge-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright'

  return (
    <div>
      <div className="mb-4">
        <div className="text-sm font-semibold text-ink-bright">내 계정</div>
        <div className="text-sm text-ink-secondary">{email}</div>
      </div>

      <form onSubmit={handleChangePassword} className="flex flex-col gap-3 border-t border-edge pt-4">
        <div className="text-sm font-medium">비밀번호 변경</div>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="현재 비밀번호"
          autoComplete="current-password"
          required
          className={inputClass}
        />
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder={`새 비밀번호 (${PASSWORD_MIN_LENGTH}자 이상)`}
          autoComplete="new-password"
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
        {success && (
          <div className="text-sm text-success">비밀번호가 변경되었습니다 — 다른 기기의 로그인은 모두 끊깁니다</div>
        )}
        <button
          type="submit"
          disabled={busy || !currentPassword || !newPassword || !confirmPassword}
          className="rounded bg-accent py-2 text-sm font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
        >
          {busy ? '변경 중…' : '변경'}
        </button>
      </form>

      <div className="mt-4 border-t border-edge pt-4">
        <button
          type="button"
          onClick={handleLogout}
          className="w-full rounded border border-edge-strong py-2 text-sm text-danger hover:bg-surface-raised"
        >
          로그아웃
        </button>
      </div>
    </div>
  )
}

// ── 화면: 다크/라이트 테마 ───────────────────────────────────────────────────
function AppearancePanel({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  function select(next: Theme) {
    if (theme !== next) onToggleTheme()
  }
  const optionClass = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 ${active ? 'bg-accent text-ink-on-accent' : 'bg-surface-raised text-ink-secondary hover:bg-surface-hover'}`

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium">테마</div>
      <div className="flex w-max overflow-hidden rounded border border-edge-strong text-sm">
        <button type="button" onClick={() => select('light')} className={optionClass(theme === 'light')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </svg>
          라이트
        </button>
        <button type="button" onClick={() => select('dark')} className={optionClass(theme === 'dark')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
          다크
        </button>
      </div>
      <div className="text-xs text-ink-muted">밝은 화면과 어두운 화면 중에서 고르세요.</div>
    </div>
  )
}

// ── 숨김 목록: 트리·검색에서 건너뛸 폴더·파일 이름 (전역, owner/manager 전용) ──
function IgnorePanel() {
  const [names, setNames] = useState<string[] | null>(null)
  const [defaults, setDefaults] = useState<string[]>([])
  const [locked, setLocked] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetchIgnoreList()
      .then((state) => {
        if (!alive) return
        setNames(state.names)
        setDefaults(state.defaults)
        setLocked(state.locked)
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : '숨김 목록을 불러오지 못했습니다'))
    return () => {
      alive = false
    }
  }, [])

  // 서버가 정규화한 결과(고정 항목 되넣기·중복 제거)를 그대로 화면에 반영한다 — 보낸 값이 아니라 저장된 값
  async function commit(next: string[]) {
    setBusy(true)
    setError(null)
    try {
      const state = await saveIgnoreList(next)
      setNames(state.names)
      setDefaults(state.defaults)
      setLocked(state.locked)
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장하지 못했습니다')
    } finally {
      setBusy(false)
    }
  }

  function add(e: React.FormEvent) {
    e.preventDefault()
    const name = draft.trim()
    if (!name || !names) return
    if (names.includes(name)) {
      setError(`이미 목록에 있습니다: ${name}`)
      return
    }
    setDraft('')
    void commit([...names, name])
  }

  if (!names) {
    return <div className="text-sm text-ink-muted">{error ?? '불러오는 중…'}</div>
  }

  const isLocked = (name: string) => locked.includes(name)
  const isDefault = names.length === defaults.length && names.every((n, i) => n === defaults[i])

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-ink-muted">
        여기 적힌 <strong className="font-medium text-ink-secondary">이름</strong>은 경로가 아니라 이름이라, 어느 폴더 안에 있든
        파일 목록·검색에서 보이지 않습니다. 모든 프로젝트에 함께 적용되고, 저장하면 열려 있는 모든 화면의 트리가 바로 다시 그려집니다.
      </div>

      <ul className="flex flex-col gap-1">
        {names.map((name) => (
          <li key={name} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-surface-raised">
            <span className="min-w-0 flex-1 truncate font-mono text-sm text-ink">{name}</span>
            {isLocked(name) ? (
              <span
                className="rounded border border-edge-strong px-1.5 py-0.5 text-xs text-ink-muted"
                title="시크릿·저장소 내부라 목록에서 빼도 서버가 계속 막습니다"
              >
                고정
              </span>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void commit(names.filter((n) => n !== name))}
                className="rounded px-1.5 py-0.5 text-xs text-ink-muted hover:bg-surface-hover hover:text-danger disabled:opacity-40"
              >
                지우기
              </button>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="flex items-center gap-2 border-t border-edge pt-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="숨길 폴더·파일 이름 (예: coverage)"
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-edge-strong bg-surface px-3 py-1.5 font-mono text-sm text-ink outline-none placeholder:font-sans placeholder:text-ink-faint focus:border-edge-bright"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="shrink-0 rounded bg-accent px-3 py-1.5 text-sm font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
        >
          추가
        </button>
      </form>

      {error && <div className="text-sm text-danger">{error}</div>}

      <div className="flex justify-end border-t border-edge pt-3">
        <button
          type="button"
          disabled={busy || isDefault}
          onClick={() => void commit(defaults)}
          className="rounded border border-edge-strong px-2.5 py-1 text-xs text-ink-secondary hover:bg-surface-hover disabled:opacity-40"
        >
          기본값으로
        </button>
      </div>
    </div>
  )
}

// ── 단축키: 전체 목록 + 키 재지정 ───────────────────────────────────────────
function ShortcutsPanel() {
  const bindings = useShortcutBindings()
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const categories = [...new Set(DEFAULT_SHORTCUTS.map((s) => s.category))]

  function startRecording(id: string) {
    setError(null)
    setRecordingId(id)
  }

  function handleRecordKeyDown(id: string, e: React.KeyboardEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
    if (e.key === 'Escape') {
      setRecordingId(null)
      return
    }
    const combo = formatKeyCombo(e)
    const result = setBinding(id, combo)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    setRecordingId(null)
  }

  return (
    <div>
      {error && <div className="mb-3 text-sm text-danger">{error}</div>}
      {categories.map((category) => (
        <div key={category} className="mb-4 last:mb-0">
          <div className="mb-1.5 text-xs font-semibold text-ink-muted">{category}</div>
          <ul className="flex flex-col gap-1">
            {DEFAULT_SHORTCUTS.filter((s) => s.category === category).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-surface-raised">
                <span className="text-sm text-ink">{s.label}</span>
                <div className="flex items-center gap-1.5">
                  {recordingId === s.id ? (
                    <div
                      tabIndex={0}
                      ref={(el) => el?.focus()}
                      onKeyDown={(e) => handleRecordKeyDown(s.id, e)}
                      onBlur={() => setRecordingId(null)}
                      className="rounded border border-accent px-2 py-0.5 font-mono text-xs text-accent outline-none"
                    >
                      키를 누르세요…
                    </div>
                  ) : (
                    <kbd className="rounded border border-edge-strong bg-surface px-1.5 py-0.5 font-mono text-xs text-ink-secondary">
                      {bindings[s.id]}
                    </kbd>
                  )}
                  {s.editable && recordingId !== s.id && (
                    <button
                      type="button"
                      onClick={() => startRecording(s.id)}
                      className="rounded px-1.5 py-0.5 text-xs text-ink-muted hover:bg-surface-hover hover:text-ink"
                    >
                      재지정
                    </button>
                  )}
                  {s.editable && bindings[s.id] !== s.keys && recordingId !== s.id && (
                    <button
                      type="button"
                      onClick={() => resetBinding(s.id)}
                      className="rounded px-1.5 py-0.5 text-xs text-ink-muted hover:bg-surface-hover hover:text-ink"
                      title="기본값으로 되돌리기"
                    >
                      초기화
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="mt-4 flex justify-end border-t border-edge pt-3">
        <button
          type="button"
          onClick={resetAllBindings}
          className="rounded border border-edge-strong px-2.5 py-1 text-xs text-ink-secondary hover:bg-surface-hover"
        >
          전체 초기화
        </button>
      </div>
    </div>
  )
}
