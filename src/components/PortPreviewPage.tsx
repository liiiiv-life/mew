import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { isRemoteMode } from '../utils/remote-transport'
import type { PortPreviewEntry } from '../utils/port-preview-entry'

export default function PortPreviewPage({ entry }: { entry: PortPreviewEntry }) {
  const { t } = useI18n()
  const frame = useRef<HTMLIFrameElement>(null)
  const [error, setError] = useState('')
  const { port, path } = entry
  useEffect(() => {
    const options = { port, path }
    if (!isRemoteMode()) {
      window.location.replace(`/${port}${path}`)
      return
    }
    let disposed = false, release: (() => void) | undefined
    const target = frame.current!
    void import('../utils/port-preview-remote').then(async ({ mountRemotePortPreview }) => {
      if (disposed) return
      const cleanup = await mountRemotePortPreview(target, options)
      if (disposed) cleanup()
      else release = cleanup
    }).catch((cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { disposed = true; release?.() }
  }, [port, path])
  return <main className="fixed inset-0 flex flex-col bg-surface-deep text-ink">
    {error ? <p role="alert" className="p-3 text-sm text-danger">{error}</p> : <iframe ref={frame} title={`${t('access.portPreview')}: ${entry.port}`} className="min-h-0 w-full flex-1 border-0" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups" />}
  </main>
}
