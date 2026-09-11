import { useEffect, useRef, useState } from 'react'
import { mountDomBrowser, type DomBrowserController, type DomBrowserStatus } from '../utils/browser-dom-view'
import '@rrweb/replay/dist/style.css'
import './server-dom-browser.css'

export function ServerDomBrowser({ streamUrl, reopen, onStatus, onController }: { streamUrl: string; reopen: () => Promise<string>; onStatus?: (status: DomBrowserStatus) => void; onController?: (controller: DomBrowserController | null) => void }) {
  const callbacks = useRef({ onStatus, onController })
  callbacks.current = { onStatus, onController }
  const controller = useRef<DomBrowserController | null>(null)
  const [dialog, setDialog] = useState<DomBrowserStatus['dialog']>()
  const [fileChooser, setFileChooser] = useState<DomBrowserStatus['fileChooser']>()
  const [downloads, setDownloads] = useState<NonNullable<DomBrowserStatus['download']>[]>([])
  const [uploading, setUploading] = useState(false)
  const [dialogValue, setDialogValue] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<DomBrowserStatus>({ state: 'connecting' })
  const [attempt, setAttempt] = useState(0)
  const [currentUrl, setCurrentUrl] = useState(streamUrl)
  const [reopening, setReopening] = useState(false)
  useEffect(() => {
    if (!root.current) return
    setStatus({ state: 'connecting' })
    const mounted = mountDomBrowser(root.current, currentUrl, (value) => {
      setStatus(value)
      if (value.fileChooser) setFileChooser(value.fileChooser)
      if (value.download) setDownloads((current) => [...current.filter((item) => item.id !== value.download!.id), value.download!])
      if (value.dialog) { setDialog(value.dialog); setDialogValue(value.dialog.defaultValue) }
      callbacks.current.onStatus?.(value)
    })
    controller.current = mounted
    callbacks.current.onController?.(mounted)
    return () => { mounted(); controller.current = null; callbacks.current.onController?.(null) }
  }, [currentUrl, attempt])
  const reconnect = async () => {
    setReopening(true)
    try { setCurrentUrl(await reopen()); setAttempt((value) => value + 1) }
    catch { setStatus({ state: 'error', message: '다시 연결하지 못했습니다. 주소를 확인하고 다시 시도해 주세요.' }) }
    finally { setReopening(false) }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      {(status.state !== 'ready' || status.message) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-edge bg-surface px-3 py-2 text-xs text-ink-secondary" role={status.state === 'error' ? 'alert' : 'status'}>
          <span className="min-w-0 flex-1 break-words">{status.message ?? '페이지 여는 중…'}</span>
          {status.state === 'error' && <button type="button" disabled={reopening} className="shrink-0 rounded px-2 py-1 hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 disabled:opacity-50" onClick={() => { void reconnect() }}>{reopening ? '연결 중…' : '다시 연결'}</button>}
        </div>
      )}
      {fileChooser && <label className="shrink-0 border-b border-edge bg-surface p-3 text-xs text-ink">
        파일 선택 (파일당 8 MB, 최대 4개)
        <input type="file" multiple={fileChooser.multiple} disabled={uploading} className="mt-2 block w-full" onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (!files.length) return
          if (files.length > 4 || files.some((file) => file.size > 8 * 1024 * 1024)) { setStatus({ state: 'ready', message: '파일당 8 MB, 최대 4개까지 선택할 수 있습니다.' }); return }
          const data = new FormData(); files.forEach((file) => data.append('files', file))
          const session = new URL(currentUrl, location.href).searchParams.get('session')
          setUploading(true)
          void fetch(`/api/browser-dom/${encodeURIComponent(session ?? '')}/upload/${encodeURIComponent(fileChooser.id)}`, { method: 'POST', body: data }).then((response) => {
            if (!response.ok) throw new Error('파일을 보내지 못했습니다. 다시 선택해 주세요.')
            setFileChooser(undefined)
          }).catch((error: unknown) => setStatus({ state: 'ready', message: String(error) })).finally(() => setUploading(false))
        }} />
      </label>}
      {downloads.length > 0 && <div className="flex max-h-24 shrink-0 flex-wrap gap-2 overflow-auto border-b border-edge bg-surface p-2 text-xs">
        {downloads.map((download) => <a key={download.id} href={download.url} download={download.name} className="text-accent underline">{download.name} ↓</a>)}
      </div>}
      {dialog && <form className="shrink-0 border-b border-edge bg-surface p-3 text-sm text-ink" onSubmit={(event) => { event.preventDefault(); controller.current?.command('dialog', { accept: true, value: dialogValue }); setDialog(undefined) }}>
        <p className="break-words whitespace-pre-wrap">{dialog.message}</p>
        {dialog.dialogType === 'prompt' && <input aria-label={dialog.message} value={dialogValue} onChange={(event) => setDialogValue(event.target.value)} className="my-2 w-full rounded border border-edge bg-surface-deep p-2" />}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1 hover:bg-surface-raised" onClick={() => { controller.current?.command('dialog', { accept: false }); setDialog(undefined) }}>취소</button>
          <button type="submit" className="rounded bg-accent px-3 py-1 text-ink-on-accent">확인</button>
        </div>
      </form>}
      <div ref={root} className="mew-dom-browser min-h-0 flex-1 overflow-hidden" aria-label="서버 브라우저" />
    </div>
  )
}

/** Keep OAuth popups connected to their real opener while staying inside the auth pane. */
export function ServerDomBrowserTabs({ streamUrl, reopen, onPopup, onReady }: { streamUrl: string; reopen: () => Promise<string>; onPopup?: (id: string) => void; onReady?: () => void }) {
  const [tabs, setTabs] = useState([{ id: streamUrl, streamUrl, title: '로그인' }])
  const [active, setActive] = useState(streamUrl)
  const controls = useRef(new Map<string, DomBrowserController>())
  return <div className="flex min-h-0 flex-1 flex-col">
    {tabs.length > 1 && <div className="flex shrink-0 overflow-x-auto border-b border-edge bg-surface" role="tablist" aria-label="로그인 창">
      {tabs.map((tab) => <div key={tab.id} className="flex min-w-0 shrink-0 items-center">
        <button type="button" role="tab" aria-selected={active === tab.id} className={`max-w-48 truncate px-3 py-2 text-xs ${active === tab.id ? 'bg-surface-raised text-ink' : 'text-ink-secondary'}`} onClick={() => setActive(tab.id)}>{tab.title}</button>
        {tab.id !== streamUrl && <button type="button" aria-label={`${tab.title} 닫기`} className="px-2 py-1 text-ink-secondary" onClick={() => controls.current.get(tab.id)?.command('close')}>×</button>}
      </div>)}
    </div>}
    {tabs.map((tab) => <div key={tab.id} className={`min-h-0 flex-1 flex-col ${active === tab.id ? 'flex' : 'hidden'}`} role="tabpanel">
      <ServerDomBrowser streamUrl={tab.streamUrl} reopen={tab.id === streamUrl ? reopen : async () => tab.streamUrl}
        onController={(controller) => { if (controller) controls.current.set(tab.id, controller); else controls.current.delete(tab.id) }}
        onStatus={(status) => {
          if (status.state === 'ready') onReady?.()
          if (status.popup) {
            const popup = status.popup
            onPopup?.(popup.id)
            setTabs((current) => current.some((item) => item.id === popup.id) ? current : [...current, { id: popup.id, streamUrl: popup.streamUrl, title: popup.title || '로그인 창' }])
            setActive(popup.id)
          }
          if (status.title) setTabs((current) => current.map((item) => item.id === tab.id ? { ...item, title: status.title! } : item))
          if (status.closed && tab.id !== streamUrl) {
            setTabs((current) => current.filter((item) => item.id !== tab.id))
            setActive((current) => current === tab.id ? streamUrl : current)
          }
        }} />
    </div>)}
  </div>
}
