import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { scopedBrowserStorage } from '@mew/ui/browser-storage-scope'
import { useUiLocale } from '@mew/ui/i18n'
import { uiText } from '@mew/ui/i18n-core'
import { fetchAuthStatus, type AuthStatus } from './api/auth'
import { LoginPage } from './components/LoginPage'
import { useRefreshTasks } from './hooks/use-refresh-tasks'
import { clearFileContentCache, setContentIdentity } from './utils/contentCache'
import { isRemoteMode } from './utils/remote-transport'
import { reloadRemoteAppForIdentity } from './utils/remote-app'
import { StartupScreen } from './components/startup-screen'
import { getAppRuntime } from './runtime/app-runtime'
import { portPreviewEntry } from './utils/port-preview-entry'
import { defaultCapabilities } from '../shared/access-policy'

const Workspace = lazy(() => import('./App.tsx'))
const PortPreviewPage = lazy(() => import('./components/PortPreviewPage.tsx'))
const GUEST_AUTH: AuthStatus = { authenticated: false, email: null, role: 'guest', mustChangePassword: false, displayName: null, avatarDataUrl: null }
const startupScreen = <StartupScreen />

/** Remote login does not need the editor, terminal, or workspace modules. */
export default function AppBootstrap({ initialAuth }: { initialAuth?: AuthStatus }) {
  useUiLocale()
  const { pending: refreshing, track: trackRefresh } = useRefreshTasks()
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const preview = portPreviewEntry(window.location.search)

  // Prepare identity and permission-scoped caches before workspace effects restore tabs.
  const applyAuth = useCallback((status: AuthStatus) => {
    if (reloadRemoteAppForIdentity(status.authenticated ? status.email : null)) { clearFileContentCache(); setAuth(null); return }
    setContentIdentity(status.email)
    const permissionVersion = JSON.stringify([status.email, status.role, status.accessRevision, status.capabilities])
    try {
      if (scopedBrowserStorage().getItem('mew:access-version') !== permissionVersion) clearFileContentCache()
      scopedBrowserStorage().setItem('mew:access-version', permissionVersion)
    } catch { clearFileContentCache() }
    setAuth(status)
  }, [])

  useEffect(() => {
    if (initialAuth) { applyAuth(initialAuth); return }
    void trackRefresh(fetchAuthStatus()
      .then(applyAuth)
      .catch((err) => {
        console.error(err)
        applyAuth(GUEST_AUTH)
      }))
  }, [applyAuth, initialAuth, trackRefresh])

  useEffect(() => {
    const onExpired = () => applyAuth(GUEST_AUTH)
    window.addEventListener('mew:auth-expired', onExpired)
    return () => window.removeEventListener('mew:auth-expired', onExpired)
  }, [applyAuth])

  useEffect(() => {
    const refresh = () => { clearFileContentCache(); void trackRefresh(fetchAuthStatus().then(applyAuth).catch(() => {})) }
    window.addEventListener('mew:permissions-changed', refresh)
    return () => window.removeEventListener('mew:permissions-changed', refresh)
  }, [applyAuth, trackRefresh])

  if (!auth) return startupScreen
  if ((isRemoteMode() || preview) && (!auth.authenticated || auth.mustChangePassword)) {
    return <LoginPage dismissible={false} initialMustChangePassword={auth.mustChangePassword} onClose={() => {}} onSuccess={applyAuth} />
  }

  if (preview) {
    const allowed = auth.capabilities?.portPreview ?? defaultCapabilities(auth.role).portPreview
    return allowed ? <Suspense fallback={startupScreen}><PortPreviewPage entry={preview} /></Suspense> : <main role="alert" className="p-3 text-sm text-danger">{uiText('localhost 앱에 접근할 권한이 없습니다.')}</main>
  }

  return <>
    <Suspense fallback={startupScreen}>
      <Workspace
        auth={auth}
        refreshing={refreshing}
        onLoggedOut={() => {
          const onLoggedOut = getAppRuntime().onLoggedOut
          if (onLoggedOut) onLoggedOut()
          else applyAuth(GUEST_AUTH)
        }}
        onRequestLogin={() => setLoginOpen(true)}
        onProfileChanged={(profile) => setAuth((current) => current ? { ...current, ...profile } : current)}
      />
    </Suspense>
    {loginOpen && <LoginPage onClose={() => setLoginOpen(false)} onSuccess={(status) => { applyAuth(status); setLoginOpen(false) }} />}
  </>
}
