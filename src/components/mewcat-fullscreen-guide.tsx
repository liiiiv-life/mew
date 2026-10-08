import { useState, type RefObject } from 'react'
import { Expand, Xmark } from 'iconoir-react'
import { useShortcutBindings } from '@mew/shortcuts'
import { useMewcatBubble } from '../hooks/use-mewcat-bubble'
import { useI18n } from '../i18n'

export function MewcatFullscreenGuide({ anchorRef, onClose }: { anchorRef?: RefObject<HTMLDivElement | null>; onClose: () => void }) {
  const { t } = useI18n()
  const bindings = useShortcutBindings()
  const shortcut = /Mac/i.test(navigator.platform || navigator.userAgent)
    ? bindings.fullscreen.replace(/\bAlt\b/g, 'Option').replace(/\bCtrl\b/g, 'Cmd') : bindings.fullscreen
  const bubbleRef = useMewcatBubble(anchorRef, !!anchorRef, 300, false)
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState(false)
  const enter = async () => {
    setFailed(false)
    setPending(true)
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
      onClose()
    } catch { setFailed(true) }
    finally { setPending(false) }
  }
  return <aside ref={bubbleRef} className={`mewcat-notifications mewcat-notifications-auto${anchorRef ? ' mewcat-notifications-with-cat' : ''}`} aria-label={t('settings.mewcat')}>
    <div className="mewcat-notifications-content p-3">
      <div className="flex items-start gap-2">
        <p role="status" className="min-w-0 flex-1 text-[13px] leading-5 text-ink">{t('mewcat.fullscreenGuide')}</p>
        <button type="button" className="mewcat-notification-button shrink-0 text-ink-secondary" aria-label={t('mewcat.dismiss')} onClick={onClose}><Xmark width={16} height={16} /></button>
      </div>
      <button type="button" disabled={pending} onClick={() => { void enter() }} className="mt-2 flex min-h-9 w-full items-center justify-center gap-1.5 rounded bg-accent px-2 text-xs text-ink-on-accent hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50">
        <Expand width={15} height={15} aria-hidden="true" /><span>{t('mewcat.fullscreenEnter')} ({shortcut})</span>
      </button>
      {failed && <p role="alert" className="mt-2 text-xs leading-4 text-danger">{t('mewcat.fullscreenFailed')}</p>}
    </div>
  </aside>
}
