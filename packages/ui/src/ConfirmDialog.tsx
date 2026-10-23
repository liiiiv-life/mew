import { uiText } from './i18n-core.ts'
import { useUiLocale } from './i18n.ts'
import { useId } from 'react'
import { DialogFrame } from './dialog-frame'

// App-owned confirmation/alert; destructive actions initially focus Cancel.
export function ConfirmDialog({ message, detail, confirmLabel = uiText("확인"), cancelLabel = uiText("취소"), danger = false, onConfirm, onCancel }: {
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel?: () => void
}) {
  useUiLocale()
  const id = useId()
  return <DialogFrame labelledBy={id} describedBy={detail ? `${id}-detail` : undefined} onClose={onCancel ?? onConfirm}>
    <div className="p-5 sm:p-6">
      <h2 id={id} className={`${onCancel ? '' : 'select-text'} whitespace-pre-wrap break-words text-base font-semibold text-ink-bright`}>{message}</h2>
      {detail && <p id={`${id}-detail`} className={`${onCancel ? '' : 'select-text'} mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-secondary`}>{detail}</p>}
      <div className="mt-6 flex justify-end gap-2">
        {onCancel && <button type="button" data-dialog-autofocus={danger || undefined} onClick={onCancel} className="min-h-10 rounded-lg px-4 text-sm text-ink-secondary hover:bg-surface-hover">{cancelLabel}</button>}
        <button type="button" data-dialog-autofocus={!danger || !onCancel || undefined} onClick={onConfirm} className={`min-h-10 rounded-lg px-4 text-sm font-medium ${danger ? 'bg-danger-strong text-ink-on-danger hover:bg-danger' : 'bg-accent text-ink-on-accent hover:bg-accent-strong'}`}>{confirmLabel}</button>
      </div>
    </div>
  </DialogFrame>
}
