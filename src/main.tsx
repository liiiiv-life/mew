import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n.tsx'
import { applyFontPreferences, loadFontPreferences } from './utils/fontPreferences.ts'

// 저장한 글꼴을 첫 React 렌더 전에 적용해 기본 글꼴이 잠깐 보이는 것을 막는다.
applyFontPreferences(loadFontPreferences())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)
