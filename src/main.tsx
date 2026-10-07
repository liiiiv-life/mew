import { RemoteDashboard } from './components/remote-dashboard'
import { startBrowserStorageMaintenance } from '@mew/ui/browser-storage'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n.tsx'
import { applyFontPreferences, loadFontPreferences } from './utils/fontPreferences.ts'
import { applyThemeColor, loadThemeColor } from './utils/theme-color.ts'
import { BrowserPopupPage } from './components/BrowserPopupPage.tsx'
import { startNetworkTracking } from './utils/network-tracking.ts'

const stopNetworkTracking = startNetworkTracking()
if (import.meta.hot) import.meta.hot.dispose(stopNetworkTracking)

// Migrate old disposable caches before any React effect persists workspace state.
const stopStorageMaintenance = startBrowserStorageMaintenance()
if (import.meta.hot) import.meta.hot.dispose(stopStorageMaintenance)

// 저장한 글꼴을 첫 React 렌더 전에 적용해 기본 글꼴이 잠깐 보이는 것을 막는다.
applyFontPreferences(loadFontPreferences())
applyThemeColor(loadThemeColor(), document.documentElement.classList.contains('dark') ? 'dark' : 'light')

const centralPage = !!document.querySelector('meta[name="mew-central"]')
const browserPopup = location.pathname === '/browser'
if (browserPopup) document.title = 'Browser · mew'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      {centralPage ? <RemoteDashboard /> : browserPopup ? <BrowserPopupPage /> : <App />}
    </I18nProvider>
  </StrictMode>,
)
