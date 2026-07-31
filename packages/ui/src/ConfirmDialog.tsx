import { useEffect, useRef } from 'react'
import { useOverlayDismiss } from './useOverlayDismiss'

// window.confirm/alert 대체 모달 — 네이티브 다이얼로그는 전체화면 모드를 해제해 버려서
// 앱 안에서 그리는 컴포넌트로 대신한다. onCancel을 주지 않으면 확인 버튼만 있는 알림 모드.
export function ConfirmDialog({
  message,
  detail,
  confirmLabel = '확인',
  cancelLabel = '취소',
  danger = false,
  onConfirm,
  onCancel,
}: {
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 삭제·종료처럼 되돌릴 수 없는 동작이면 확인 버튼을 빨갛게 */
  danger?: boolean
  onConfirm: () => void
  onCancel?: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const dismiss = onCancel ?? onConfirm

  useEffect(() => {
    confirmRef.current?.focus()
  }, [])

  // Esc·뒤로가기는 공용 스택이 처리한다(겹친 오버레이 중 맨 위만 닫히도록)
  useOverlayDismiss(dismiss)

  // Enter는 이 다이얼로그만의 것 — capture + stopPropagation으로 앱 전역 단축키와 터미널 입력보다
  // 먼저 가로챈다
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter') return
      e.preventDefault()
      e.stopPropagation()
      onConfirm()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onConfirm])

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) dismiss()
      }}
    >
      <div className="w-full max-w-sm rounded-lg border border-edge-bright bg-surface-raised p-4 shadow-xl">
        <div className="text-sm break-all text-ink">{message}</div>
        {detail && <div className="mt-1.5 text-xs text-ink-secondary">{detail}</div>}
        <div className="mt-4 flex justify-end gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded border border-edge-strong px-3 py-1.5 text-sm text-ink hover:bg-surface-hover"
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`rounded px-3 py-1.5 text-sm text-ink-on-accent ${
              danger ? 'bg-danger hover:bg-danger-strong' : 'bg-accent hover:bg-accent-strong'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
