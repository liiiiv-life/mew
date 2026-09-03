import { useEffect, useState } from 'react'
import { fetchAuthStatus } from '../api/client'
import { BrowserPanel } from './BrowserPanel'

/** `/browser` 전용의 가벼운 진입점 — 전체 EditorApp을 띄우지 않고 권한만 확인한다. */
export function BrowserPopupPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  useEffect(() => {
    fetchAuthStatus()
      .then((auth) => {
        if (!auth.mustChangePassword && (auth.role === 'owner' || auth.role === 'manager')) setAllowed(true)
        else location.replace('/')
      })
      .catch(() => location.replace('/'))
  }, [])
  if (!allowed) return <div className="flex h-dvh items-center justify-center bg-surface-deep text-sm text-ink-muted">브라우저 권한을 확인하는 중…</div>
  return (
    <div className="h-dvh w-screen overflow-hidden">
      <BrowserPanel standalone onClose={() => {
        window.close()
        if (!window.closed) location.assign('/')
      }} />
    </div>
  )
}
