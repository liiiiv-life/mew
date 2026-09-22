import { useLayoutEffect, useRef } from 'react'
import { useI18n } from '../i18n'

export function ProjectLoadingOverlay() {
  const { t } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)

  useLayoutEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])

  return <dialog ref={ref} aria-label={t('common.loading')}
    onCancel={event => event.preventDefault()}
    onKeyDown={event => { event.preventDefault(); event.stopPropagation() }}
    className="fixed inset-0 m-0 flex h-dvh max-h-none w-screen max-w-none cursor-wait items-center justify-center border-0 bg-surface/90 p-0 text-ink outline-none backdrop:bg-transparent">
    <div role="status">
      <span aria-hidden="true" className="block h-9 w-9 rounded-full border-2 border-edge-strong border-t-accent motion-safe:animate-spin" />
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  </dialog>
}
