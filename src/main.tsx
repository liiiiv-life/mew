import { initializeRemoteApp } from './utils/remote-app'
import { startBrowserStorageMaintenance } from '@mew/ui/browser-storage'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { I18nProvider } from './i18n.tsx'
import { applyFontPreferences, loadFontPreferences } from './utils/fontPreferences.ts'
import { applyThemePalette, loadThemeSettings } from './utils/theme-color.ts'
import { startNetworkTracking } from './utils/network-tracking.ts'
import { startScrollbarGradientTracking } from './utils/scrollbar-gradient.ts'
import { startScrollbarTouchDragging } from './utils/scrollbar-touch.ts'
import { StartupScreen } from './components/startup-screen.tsx'
import { getAppRuntime } from './runtime/app-runtime.ts'

const stopScrollbarGradientTracking = startScrollbarGradientTracking()
if (import.meta.hot) import.meta.hot.dispose(stopScrollbarGradientTracking)

const stopScrollbarTouchDragging = startScrollbarTouchDragging()
if (import.meta.hot) import.meta.hot.dispose(stopScrollbarTouchDragging)

const stopNetworkTracking = startNetworkTracking()
if (import.meta.hot) import.meta.hot.dispose(stopNetworkTracking)

async function startApp() {
  if (new URLSearchParams(location.search).get('viewport-debug') === '1') {
    const { installViewportDiagnostics } = await import('./utils/viewport-diagnostics.ts')
    const stop = installViewportDiagnostics()
    if (import.meta.hot) import.meta.hot.dispose(stop)
  }

  // 저장한 글꼴을 첫 React 렌더 전에 적용해 기본 글꼴이 잠깐 보이는 것을 막는다.
  applyFontPreferences(loadFontPreferences())
  applyThemePalette(loadThemeSettings().palette)

  const root = createRoot(document.getElementById('root')!)
  root.render(<StartupScreen />)

  // Download the selected entrypoint while the remote port and identity are prepared.
  const [pageModule, initialAuth] = await Promise.all([
    import('./AppBootstrap.tsx'),
    document.querySelector('meta[name="mew-p2p-app"]') ? initializeRemoteApp() : getAppRuntime().initialAuth,
  ])

  const { default: AppBootstrap } = pageModule
  const page = <AppBootstrap initialAuth={initialAuth} />

  // Migrate old disposable caches before any workspace effect persists state.
  const stopStorageMaintenance = startBrowserStorageMaintenance()
  if (import.meta.hot) import.meta.hot.dispose(stopStorageMaintenance)

  root.render(
    <StrictMode>
      <I18nProvider>
        {page}
      </I18nProvider>
    </StrictMode>,
  )
}

void startApp()
