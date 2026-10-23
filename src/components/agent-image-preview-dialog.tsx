import { createPortal } from 'react-dom'
import { Xmark } from 'iconoir-react'
import { useOverlayDismiss } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'

export function AgentImagePreviewDialog({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  useUiLocale()
  useOverlayDismiss(onClose)

  return createPortal(
    <div className="fixed inset-0 z-[var(--layer-viewer)] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={uiText("{p0} 사진 미리보기", { p0: name })}
        className="relative flex max-h-full max-w-full items-center justify-center"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <img src={src} alt={name} className="max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] rounded object-contain shadow-2xl" />
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/80"
          aria-label={uiText("사진 미리보기 닫기")}
          title={uiText("닫기")}
        >
          <Xmark width={20} height={20} aria-hidden="true" />
        </button>
      </div>
    </div>, document.body,
  )
}
