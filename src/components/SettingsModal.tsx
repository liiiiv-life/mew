import { createPortal } from 'react-dom'
import { isRemoteMode } from '../utils/remote-transport.ts'
import { DockSettingsPanel } from './dock-settings-panel'
import type { MobileDockPanel } from '../utils/mobile-dock'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { lazy, Suspense, useEffect, useState } from 'react'
import { ColorPicker, SelectField, useOverlayDismiss } from '@mew/ui'
import { changePassword, fetchIgnoreList, logout, saveIgnoreList, updateProfile } from '../api/client'
import { DEFAULT_SHORTCUTS, formatKeyCombo, resetAllBindings, resetBinding, setBinding, useShortcutBindings } from '@mew/shortcuts'
import { LOCALES, LOCALE_NAMES, localizeShortcut, useI18n, type Locale, type TranslationKey } from '../i18n'
import { DEFAULT_FONT_PREFERENCES, type FontPreferences } from '../utils/fontPreferences'
import { DEFAULT_THEME_COLOR } from '../utils/theme-color'
import type { MewcatSkinSelection } from '../utils/mewcatSkin'
import { MewcatSkinSettings } from './mewcat-skin-settings'
import { MewcatNotificationSettings } from './mewcat-notifications'
import { MewcatBreakSettings } from './mewcat-break'

const DebuggerSettings = lazy(() => import('./debugger-settings'))

const PASSWORD_MIN_LENGTH = 10

type Section = 'debugger' | 'account' | 'appearance' | 'notifications' | 'dock' | 'mewcat' | 'shortcuts' | 'ignore'
type Theme = 'dark' | 'light'

interface SettingsModalProps {
  initialDebugger?: boolean
  debuggerRoot?: string
  onOpenDebugger?: () => void
  dockAvailable?: readonly MobileDockPanel[]
  /** 로그인한 사용자의 이메일 — 게스트면 null이라 계정 탭을 숨긴다 */
  email: string | null
  displayName: string | null
  avatarDataUrl: string | null
  /** owner·manager만 숨김 목록 탭을 본다 — 모두의 트리를 바꾸는 전역 설정이라 */
  canEditIgnore: boolean
  theme: Theme
  fontPreferences: FontPreferences
  themeColor: string
  mewcatHideDesktop: boolean
  onMewcatHideDesktopChange: (value: boolean) => void
  mewcatSkin: MewcatSkinSelection
  onToggleTheme: () => void
  onFontPreferencesChange: (fonts: FontPreferences) => void
  onThemeColorChange: (color: string) => void
  onMewcatSkinChange: (skin: MewcatSkinSelection) => void
  onClose: () => void
  onLoggedOut: () => void
  onProfileChanged: (profile: { displayName: string; avatarDataUrl: string | null }) => void
}

const SECTION_LABEL: Record<Section, TranslationKey> = {
  debugger: 'settings.debugger',
  account: 'settings.account',
  appearance: 'settings.appearance',
  dock: 'settings.dock',
  notifications: 'settings.notifications',
  mewcat: 'settings.mewcat',
  shortcuts: 'settings.shortcuts',
  ignore: 'settings.ignoreList',
}

/** 헤더의 계정 버튼(게스트는 톱니 버튼)으로 여는 설정 창 — 계정·화면(테마)·단축키·숨김 목록을 한곳에서 관리한다 */
export function SettingsModal({ initialDebugger, debuggerRoot, onOpenDebugger, dockAvailable, email, displayName, avatarDataUrl, canEditIgnore, theme, fontPreferences, themeColor, mewcatSkin, mewcatHideDesktop, onMewcatHideDesktopChange, onToggleTheme, onFontPreferencesChange, onThemeColorChange, onMewcatSkinChange, onClose, onLoggedOut, onProfileChanged }: SettingsModalProps) {
  useUiLocale()
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null)
  const [section, setSection] = useState<Section>(debuggerRoot && initialDebugger ? 'debugger' : email ? 'account' : 'appearance')
  // Mobile begins with the category list; the selected panel is a second screen.
  const [mobileSection, setMobileSection] = useState<Section | null>(section === 'debugger' ? 'debugger' : null)
  const { t } = useI18n()

  // Esc·모바일 뒤로가기로 이 창만 닫는다 (뒤의 사이드바·터미널은 그대로)
  useOverlayDismiss(onClose)

  const sections: Section[] = [
    ...(email ? (['account'] as Section[]) : []),
    'appearance',
    'notifications',
    'dock',
    ...(debuggerRoot ? (['debugger'] as Section[]) : []),
    'mewcat',
    'shortcuts',
    ...(canEditIgnore ? (['ignore'] as Section[]) : []),
  ]

  return createPortal(
    <div ref={setPortalContainer} role="dialog" aria-modal="true" aria-label={t('settings.title')} style={{ zIndex: 2147483647 }} className="fixed inset-0 flex items-center justify-center bg-black/50 max-md:px-0 md:px-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-lg border border-edge bg-surface-deep max-md:h-full max-md:max-h-none max-md:rounded-none"
        onClick={(e) => e.stopPropagation()}
      >
        <nav className={`${mobileSection ? 'hidden md:flex' : 'flex'} w-28 shrink-0 flex-col gap-1 border-r border-edge p-3 sm:w-40 max-md:w-full max-md:border-r-0 max-md:p-4`}>
          <div className="mb-2 flex items-center justify-between gap-2 px-2 text-sm font-semibold text-ink-bright">
            {t('settings.title')}
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink md:hidden"
              aria-label={t('settings.close')}
            >
              ×
            </button>
          </div>
          {sections.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setSection(id)
                setMobileSection(id)
              }}
              className={`rounded px-2 py-1.5 text-left text-sm max-md:px-3 max-md:py-3 max-md:text-base ${
                section === id ? 'bg-surface-raised font-medium text-ink' : 'text-ink-secondary hover:bg-surface-raised hover:text-ink'
              }`}
            >
              {t(SECTION_LABEL[id])}
            </button>
          ))}
        </nav>

        <div className={`${mobileSection ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-1 flex-col`}>
          <div className="flex items-center justify-between gap-2 border-b border-edge px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileSection(null)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-lg text-ink-secondary hover:bg-surface-raised hover:text-ink md:hidden"
                aria-label={t('settings.back')}
              >
                ←
              </button>
              <div className="truncate text-sm font-semibold text-ink-bright">{t(SECTION_LABEL[section])}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
              aria-label={t('settings.close')}
            >
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {section === 'account' && email && <AccountPanel email={email} displayName={displayName} avatarDataUrl={avatarDataUrl} onLoggedOut={onLoggedOut} onProfileChanged={onProfileChanged} />}
            {section === 'appearance' && (
              <AppearancePanel
                portalContainer={portalContainer}
                theme={theme}
                fonts={fontPreferences}
                themeColor={themeColor}
                onToggleTheme={onToggleTheme}
                onFontsChange={onFontPreferencesChange}
                onThemeColorChange={onThemeColorChange}
              />
            )}
            {section === 'notifications' && <MewcatNotificationSettings hasCat={mewcatSkin !== null} />}
            {section === 'debugger' && debuggerRoot && <Suspense fallback={<div role="status">…</div>}><DebuggerSettings key={debuggerRoot} root={debuggerRoot} portalContainer={portalContainer} onOpen={onOpenDebugger ?? onClose} /></Suspense>}
            {section === 'dock' && <DockSettingsPanel available={dockAvailable} />}
            {section === 'mewcat' && <><MewcatSkinSettings skin={mewcatSkin} onChange={onMewcatSkinChange} /><label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink"><input type="checkbox" checked={mewcatHideDesktop} onChange={event => onMewcatHideDesktopChange(event.target.checked)} className="accent-accent" />{uiText("원격 데스크톱에서 뮤캣 숨기기")}</label><MewcatBreakSettings /></>}
            {section === 'shortcuts' && <ShortcutsPanel />}
            {section === 'ignore' && <IgnorePanel />}
          </div>
        </div>
      </div>
    </div>, document.body
  )
}

// ── 계정: 비밀번호 변경 + 로그아웃 ───────────────────────────────────────────
function AccountPanel({
  email,
  displayName,
  avatarDataUrl,
  onLoggedOut,
  onProfileChanged,
}: {
  email: string
  displayName: string | null
  avatarDataUrl: string | null
  onLoggedOut: () => void
  onProfileChanged: (profile: { displayName: string; avatarDataUrl: string | null }) => void
}) {
  useUiLocale()
  const { t } = useI18n()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(displayName ?? email.split('@')[0] ?? email)
  const [avatar, setAvatar] = useState<string | null>(avatarDataUrl)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileBusy, setProfileBusy] = useState(false)

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setError(uiText("비밀번호는 {p0}자 이상이어야 합니다", { p0: PASSWORD_MIN_LENGTH }))
      return
    }
    if (newPassword !== confirmPassword) {
      setError(uiText("새 비밀번호가 서로 다릅니다"))
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
      setError(err instanceof Error ? err.message : uiText("비밀번호 변경에 실패했습니다"))
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

  async function handleAvatarChange(file: File | undefined) {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 512 * 1024) {
      setProfileError(uiText("프로필 사진은 512KB 이하의 JPG, PNG, WebP 또는 GIF만 사용할 수 있습니다"))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setAvatar(typeof reader.result === 'string' ? reader.result : null)
      setProfileError(null)
      setProfileSaved(false)
    }
    reader.onerror = () => setProfileError(uiText("사진을 읽지 못했습니다"))
    reader.readAsDataURL(file)
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    setProfileError(null)
    setProfileSaved(false)
    setProfileBusy(true)
    try {
      const result = await updateProfile(name, avatar)
      setName(result.profile.displayName)
      setAvatar(result.profile.avatarDataUrl)
      onProfileChanged(result.profile)
      setProfileSaved(true)
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : uiText("프로필 저장에 실패했습니다"))
    } finally {
      setProfileBusy(false)
    }
  }

  const inputClass =
    'w-full rounded border border-edge-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright'

  return (
    <div>
      <div className="mb-4">
        <div className="text-sm font-semibold text-ink-bright">{t('settings.myAccount')}</div>
        <div className="text-sm text-ink-secondary">{email}</div>
      </div>

      <form onSubmit={handleSaveProfile} className="mb-4 flex flex-col gap-3 border-t border-edge pt-4">
        <div className="text-sm font-medium">{uiText("프로필")}</div>
        <div className="flex items-center gap-3">
          {avatar ? (
            <img src={avatar} alt={uiText("프로필 사진 미리보기")} className="h-14 w-14 rounded-full border border-edge-strong object-cover" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-raised text-lg font-semibold text-ink-secondary">
              {(name.trim()[0] ?? email[0] ?? '?').toUpperCase()}
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => void handleAvatarChange(e.target.files?.[0])} className="block w-full text-xs text-ink-secondary file:mr-2 file:rounded file:border-0 file:bg-surface-raised file:px-2 file:py-1 file:text-xs file:text-ink hover:file:bg-surface-hover" />
            {avatar && <button type="button" onClick={() => { setAvatar(null); setProfileSaved(false) }} className="w-max text-xs text-ink-muted hover:text-danger">{uiText("사진 제거")}</button>}
          </div>
        </div>
        <label className="text-sm text-ink-secondary">
          {uiText("표시 이름")}<input value={name} onChange={(e) => { setName(e.target.value); setProfileSaved(false) }} maxLength={50} required className={`${inputClass} mt-1`} />
        </label>
        <div className="text-xs text-ink-muted">{uiText("JPG, PNG, WebP, GIF · 최대 512KB")}</div>
        {profileError && <div className="select-text text-sm text-danger">{profileError}</div>}
        {profileSaved && <div className="text-sm text-success">{uiText("프로필을 저장했습니다")}</div>}
        <button type="submit" disabled={profileBusy || !name.trim()} className="rounded bg-accent py-2 text-sm font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40">
          {profileBusy ? uiText("저장 중…") : uiText("프로필 저장")}
        </button>
      </form>

      {!isRemoteMode() && <form onSubmit={handleChangePassword} className="flex flex-col gap-3 border-t border-edge pt-4">
        <div className="text-sm font-medium">{t('settings.changePassword')}</div>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder={t('settings.currentPassword')}
          autoComplete="current-password"
          required
          className={inputClass}
        />
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder={`${t('settings.newPassword')} (${PASSWORD_MIN_LENGTH}+)`}
          autoComplete="new-password"
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
        {success && (
          <div className="text-sm text-success">{uiText("비밀번호 변경 완료 · 다른 기기에서 다시 로그인 필요")}</div>
        )}
        <button
          type="submit"
          disabled={busy || !currentPassword || !newPassword || !confirmPassword}
          className="rounded bg-accent py-2 text-sm font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
        >
          {busy ? t('settings.changing') : t('settings.change')}
        </button>
      </form>}

      <div className="mt-4 border-t border-edge pt-4">
        <button
          type="button"
          onClick={handleLogout}
          className="w-full rounded border border-edge-strong py-2 text-sm text-danger hover:bg-surface-raised"
        >
          {t('settings.logout')}
        </button>
      </div>
    </div>
  )
}

const FONT_SUGGESTIONS = ['Noto Serif KR', 'IBM Plex Sans KR', 'IBM Plex Mono', 'Pretendard', 'Arial', 'Georgia', 'Menlo', 'Consolas']

// ── 화면: 테마·언어·글꼴 ─────────────────────────────────────────────────────
function AppearancePanel({
  theme,
  fonts,
  themeColor,
  portalContainer,
  onToggleTheme,
  onFontsChange,
  onThemeColorChange,
}: {
  theme: Theme
  fonts: FontPreferences
  portalContainer: HTMLElement | null
  themeColor: string
  onToggleTheme: () => void
  onFontsChange: (fonts: FontPreferences) => void
  onThemeColorChange: (color: string) => void
}) {
  useUiLocale()
  const { locale, setLocale, t } = useI18n()
  function select(next: Theme) {
    if (theme !== next) onToggleTheme()
  }
  const optionClass = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 ${active ? 'bg-accent text-ink-on-accent' : 'bg-surface-raised text-ink-secondary hover:bg-surface-hover'}`

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium">{t('settings.theme')}</div>
      <div className="flex w-max overflow-hidden rounded border border-edge-strong text-sm">
        <button type="button" onClick={() => select('light')} className={optionClass(theme === 'light')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </svg>
          {t('settings.light')}
        </button>
        <button type="button" onClick={() => select('dark')} className={optionClass(theme === 'dark')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
          {t('settings.dark')}
        </button>
      </div>
      <div className="mt-2 border-t border-edge pt-3">
        <div className="text-sm font-medium">
          {t('settings.language')}
        </div>
        <div className="mt-2 max-w-xs">
          <SelectField portalContainer={portalContainer} label={t('settings.language')} value={locale}
            options={LOCALES.map((value) => ({ value, label: LOCALE_NAMES[value] }))}
            onChange={(value) => setLocale(value as Locale)} />
        </div>
      </div>
      <div className="mt-2 border-t border-edge pt-3">
        <ColorPicker value={themeColor} onChange={onThemeColorChange} defaultValue={DEFAULT_THEME_COLOR}
          labels={{ color: t('settings.themeColor'), hex: t('settings.themeColorHex'),
            hue: t('settings.colorHue'), saturation: t('settings.colorSaturation'), brightness: t('settings.colorBrightness'),
            reset: t('common.reset'), close: t('common.close') }} />
      </div>
      <div className="mt-2 border-t border-edge pt-3">
        <div className="text-sm font-medium">{t('settings.fonts')}</div>
        <div className="mt-1 text-xs text-ink-secondary">{t('settings.fontsDescription')}</div>
        <div className="mt-3 flex flex-col gap-3">
          {(['ui', 'markdown', 'mono'] as const).map((kind) => (
            <div key={kind}>
              <span className="text-xs font-medium text-ink-secondary">{t(`settings.font.${kind}`)}</span>
              <div className="mt-1 flex gap-2">
                <div className="min-w-0 flex-1" style={{ fontFamily: kind === 'mono' ? 'var(--font-mono)' : kind === 'markdown' ? 'var(--mew-font-markdown)' : 'var(--font-sans)' }}>
                  <SelectField portalContainer={portalContainer} editable label={t(`settings.font.${kind}`)} value={fonts[kind]}
                    options={FONT_SUGGESTIONS.map((font) => ({ value: font, label: font }))}
                    onChange={(value) => onFontsChange({ ...fonts, [kind]: value })} />
                </div>
                <button
                  type="button"
                  onClick={() => onFontsChange({ ...fonts, [kind]: DEFAULT_FONT_PREFERENCES[kind] })}
                  disabled={fonts[kind] === DEFAULT_FONT_PREFERENCES[kind]}
                  className="shrink-0 rounded border border-edge-strong px-2 text-xs text-ink-secondary hover:bg-surface-hover disabled:opacity-40"
                >
                  {t('common.reset')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 숨김 목록: 트리·검색에서 건너뛸 폴더·파일 이름 (전역, owner/manager 전용) ──
function IgnorePanel() {
  useUiLocale()
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
      .catch((err) => alive && setError(err instanceof Error ? err.message : uiText("숨김 목록을 불러오지 못했습니다")))
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
      setError(err instanceof Error ? err.message : uiText("저장하지 못했습니다"))
    } finally {
      setBusy(false)
    }
  }

  function add(e: React.FormEvent) {
    e.preventDefault()
    const name = draft.trim()
    if (!name || !names) return
    if (names.includes(name)) {
      setError(uiText("이미 목록에 있습니다: {p0}", { p0: name }))
      return
    }
    setDraft('')
    void commit([...names, name])
  }

  if (!names) {
    return <div className={`${error ? 'select-text' : ''} text-sm text-ink-muted`}>{error ?? uiText("불러오는 중…")}</div>
  }

  const isLocked = (name: string) => locked.includes(name)
  const isDefault = names.length === defaults.length && names.every((n, i) => n === defaults[i])

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1">
        {names.map((name) => (
          <li key={name} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-surface-raised">
            <span className="min-w-0 flex-1 truncate font-mono text-sm text-ink">{name}</span>
            {isLocked(name) ? (
              <span
                className="rounded border border-edge-strong px-1.5 py-0.5 text-xs text-ink-muted"
                title={uiText("항상 숨김")}
              >
                {uiText("고정")}</span>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void commit(names.filter((n) => n !== name))}
                className="rounded px-1.5 py-0.5 text-xs text-ink-muted hover:bg-surface-hover hover:text-danger disabled:opacity-40"
              >
                {uiText("지우기")}</button>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="flex items-center gap-2 border-t border-edge pt-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={uiText("숨길 폴더·파일 이름 (예: coverage)")}
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-edge-strong bg-surface px-3 py-1.5 font-mono text-sm text-ink outline-none placeholder:font-sans placeholder:text-ink-faint focus:border-edge-bright"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="shrink-0 rounded bg-accent px-3 py-1.5 text-sm font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
        >
          {uiText("추가")}</button>
      </form>

      {error && <div className="select-text text-sm text-danger">{error}</div>}

      <div className="flex justify-end border-t border-edge pt-3">
        <button
          type="button"
          disabled={busy || isDefault}
          onClick={() => void commit(defaults)}
          className="rounded border border-edge-strong px-2.5 py-1 text-xs text-ink-secondary hover:bg-surface-hover disabled:opacity-40"
        >
          {uiText("기본값으로")}</button>
      </div>
    </div>
  )
}

// ── 단축키: 전체 목록 + 키 재지정 ───────────────────────────────────────────
function ShortcutsPanel() {
  useUiLocale()
  const { locale, t } = useI18n()
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
      {error && <div className="select-text mb-3 text-sm text-danger">{error}</div>}
      {categories.map((category) => (
        <div key={category} className="mb-4 last:mb-0">
          <div className="mb-1.5 text-xs font-semibold text-ink-muted">{localizeShortcut(locale, category, category)}</div>
          <ul className="flex flex-col gap-1">
            {DEFAULT_SHORTCUTS.filter((s) => s.category === category).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-surface-raised">
                <span className="text-sm text-ink">{localizeShortcut(locale, s.id, s.label)}</span>
                <div className="flex items-center gap-1.5">
                  {recordingId === s.id ? (
                    <div
                      tabIndex={0}
                      ref={(el) => el?.focus()}
                      onKeyDown={(e) => handleRecordKeyDown(s.id, e)}
                      onBlur={() => setRecordingId(null)}
                      className="rounded border border-accent px-2 py-0.5 font-mono text-xs text-accent outline-none"
                    >
                      {t('settings.pressKey')}
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
                      {t('settings.reassign')}
                    </button>
                  )}
                  {s.editable && bindings[s.id] !== s.keys && recordingId !== s.id && (
                    <button
                      type="button"
                      onClick={() => resetBinding(s.id)}
                      className="rounded px-1.5 py-0.5 text-xs text-ink-muted hover:bg-surface-hover hover:text-ink"
                      title={uiText("기본값으로 되돌리기")}
                    >
                      {t('common.reset')}
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
          {t('settings.resetAll')}
        </button>
      </div>
    </div>
  )
}
