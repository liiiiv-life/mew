import { useEffect, useRef } from 'react'
import { Xmark } from 'iconoir-react'
import { useI18n } from '../i18n'

/** Panel-local toast; deliberately does not consume Escape or mobile Back. */
export function BrowserNotice({ message, onDismiss, action }: {
  message: string
  onDismiss: () => void
  action?: { label: string; disabled?: boolean; run: () => void }
}) {
  const { t } = useI18n()
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  const actionable = !!action
  useEffect(() => {
    if (actionable) return
    const timer = window.setTimeout(() => dismiss.current(), 6000)
    return () => window.clearTimeout(timer)
  }, [message, actionable])

  return <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-3">
    <div role="status" aria-live="polite" aria-atomic="true" className="pointer-events-auto flex max-h-48 min-w-0 max-w-lg items-start gap-2 overflow-y-auto rounded-xl bg-surface-raised p-3 text-sm text-ink shadow-lg">
      <span className="min-w-0 flex-1 select-text break-words">{message}</span>
      {action && <button type="button" disabled={action.disabled} onClick={action.run} className="min-h-9 shrink-0 rounded px-2 py-1 text-xs font-medium text-ink underline underline-offset-4 hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 disabled:opacity-50">{action.label}</button>}
      {!action && <button type="button" aria-label={t('common.close')} onClick={onDismiss} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover focus-visible:outline focus-visible:outline-2"><Xmark width={16} height={16} aria-hidden="true" /></button>}
    </div>
  </div>
}
