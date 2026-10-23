import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ActionMenuItem, useToast } from '@mew/ui'
import { getAppRuntime, prepareAppResourceUrl } from '../runtime/app-runtime.ts'
import { createPortal } from 'react-dom'
import { downloadSize, formatDownloadSize, isLargeDownload, isMobileCellularConnection } from '../utils/largeDownload'
import { useI18n } from '../i18n'
import { isRemoteMode } from '../utils/remote-transport.ts'

interface PendingDownload {
  href: string
  name: string
  size: number
}

/** 모바일 셀룰러에서만, 100MiB 초과 파일을 실제 내려받기 전에 확인한다. */
export function DownloadLink({ href, name, className, children, onStarted, overlayContainer, menuIcon }: { href: string; name: string; className?: string; children: ReactNode; onStarted?: () => void; overlayContainer?: HTMLElement | null; menuIcon?: ReactNode }) {
  const [pending, setPending] = useState<PendingDownload | null>(null)
  const { t } = useI18n()
  const { toast, showToast } = useToast()
  const [busy, setBusy] = useState(false)
  const preparation = useRef<AbortController | null>(null)
  useEffect(() => () => preparation.current?.abort(), [])
  const overlay = (content: ReactNode) => overlayContainer ? createPortal(content, overlayContainer) : content

  async function startDownload(target: string, filename: string) {
    if (!getAppRuntime().prepareResourceUrl) { beginDownload(target, filename, onStarted); return }
    if (preparation.current) return
    const controller = new AbortController()
    preparation.current = controller; setBusy(true)
    try {
      const prepared = await prepareAppResourceUrl(target, controller.signal)
      controller.signal.throwIfAborted()
      beginDownload(prepared, filename, onStarted)
      const release = getAppRuntime().releaseResourceUrl
      if (release) setTimeout(() => release(prepared), 1000)
    } catch (error) {
      if (!controller.signal.aborted) showToast(error instanceof Error ? error.message : String(error))
    } finally {
      if (preparation.current === controller) preparation.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  async function requestDownload() {
    if (!isMobileCellularConnection()) {
      await startDownload(href, name)
      return
    }
    try {
      const size = await downloadSize(href)
      if (size !== null && isLargeDownload(size)) {
        setPending({ href, name, size })
        return
      }
    } catch {
      // 네트워크·HEAD 제한은 다운로드 자체를 막을 이유가 아니다.
    }
    await startDownload(href, name)
  }

  return (
    <>
      {toast}
      {menuIcon ? <ActionMenuItem icon={menuIcon} closeOnSelect={false} disabled={busy} aria-busy={busy} onClick={() => void requestDownload()}>{children}</ActionMenuItem>
        : <button type="button" disabled={busy} aria-busy={busy} onClick={() => void requestDownload()} className={className}>{children}</button>}
      {pending && overlay(
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="large-download-title" className="w-full max-w-sm rounded-lg border border-edge-bright bg-surface-raised p-5 shadow-xl">
            <h2 id="large-download-title" className="text-base font-semibold text-ink">{t('download.largeTitle')}</h2>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">
              {t('download.largeDescription')} ({formatDownloadSize(pending.size)})
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPending(null)} className="rounded px-3 py-2 text-sm text-ink-secondary hover:bg-surface-hover">{t('common.cancel')}</button>
              <button type="button" onClick={() => { void startDownload(pending.href, pending.name); setPending(null) }} className="rounded bg-accent px-3 py-2 text-sm text-ink-on-accent hover:opacity-90">{t('download.continue')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function beginDownload(href: string, name: string, onStarted?: () => void) {
  const link = document.createElement('a')
  link.href = href
  if (!isRemoteMode()) link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  onStarted?.()
}
