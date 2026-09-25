import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useId } from 'react'
import { NavArrowLeft, NavArrowRight, Minus, Plus, Download, FloppyDisk, EditPencil, Erase, Undo, Redo, Text } from 'iconoir-react'
import { SelectField } from '@mew/ui'
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist'
import { useI18n, type TranslationKey } from '../i18n'
import { loadPdf, exportPdf } from '../utils/pdf-runtime'
import { pdfDraft } from '../utils/pdf-drafts'
import { MAX_VIEW_PIXELS, PAGE_GAP, pageAt, pageLayout, PdfRenderQueue, type InkStroke, type PageSize } from '../utils/pdf-geometry'
import { PdfPage, type PdfTool } from './pdf-page'
import { DownloadLink } from './DownloadLink'
import { usePdfFullscreen } from '../hooks/use-pdf-fullscreen'
import './pdf-viewer.css'

const EMPTY_INK: InkStroke[] = []
const DEFAULT_SIZE = { width: 612, height: 792 }
const COLORS = ['#202124', '#c5221f', '#185abc', '#137333']

export default function PdfViewer({ src, download, name, identity, onEdit }: { src: string; download: string; name: string; identity: string; onEdit?: () => void }) {
  const { t } = useI18n()
  const url = src.replace('/raw?', '/pdf?')
  const draft = useMemo(() => pdfDraft(`${identity}:${url}`), [identity, url])
  const ink = useSyncExternalStore(draft.subscribe, draft.get)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [editable, setEditable] = useState(false)
  const [error, setError] = useState<TranslationKey | null>(null)
  const [saveError, setSaveError] = useState<TranslationKey | null>(null)
  const [retry, setRetry] = useState(0)
  const busy = ink.saving
  const [saved, setSaved] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordNeeded, setPasswordNeeded] = useState(false)
  const passwordCallback = useRef<((password: string) => void) | null>(null)
  const passwordId = useId()
  const [progress, setProgress] = useState<number | null>(null)
  const revision = useRef('')
  const [known, setKnown] = useState<Map<number, PageSize>>(new Map())
  const [fallback, setFallback] = useState(DEFAULT_SIZE)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [inverted, setInverted] = useState(false)
  const [tool, setTool] = useState<PdfTool>('select')
  const [color, setColor] = useState(COLORS[0])
  const [width, setWidth] = useState(2)
  const [view, setView] = useState({ width: 800, height: 600, top: 0 })
  const [pageInput, setPageInput] = useState('1')
  const scrollRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDialogElement>(null)
  const { fullscreen, toggle: toggleFullscreen } = usePdfFullscreen(viewerRef, stageRef)
  const frame = useRef(0)
  const saveController = useRef<AbortController | null>(null)
  const savedScroll = useRef(0)
  const queue = useMemo(() => new PdfRenderQueue(), [])
  const scale = zoom === 'fit' ? Math.max(0.1, Math.min(2, (view.width - 32) / fallback.width)) : zoom
  const offsets = useMemo(() => pageLayout(pdf?.numPages ?? 1, known, fallback, scale), [pdf, known, fallback, scale])
  const previousLayout = useRef<{ pdf: PDFDocumentProxy | null; offsets: Float64Array; scale: number } | null>(null)
  const current = pageAt(offsets, view.top + Math.min(100, view.height / 3)) + 1
  const first = Math.max(0, pageAt(offsets, view.top) - 1)
  const last = Math.min((pdf?.numPages ?? 1) - 1, pageAt(offsets, view.top + view.height) + 1)
  const budget = MAX_VIEW_PIXELS / ((last - first + 1) * 3)
  const byPage = useMemo(() => {
    const grouped = new Map<number, InkStroke[]>()
    for (const stroke of ink.strokes) { const list = grouped.get(stroke.page) ?? []; list.push(stroke); grouped.set(stroke.page, list) }
    return grouped
  }, [ink.strokes])

  useEffect(() => {
    let cancelled = false, task: PDFDocumentLoadingTask | null = null
    const controller = new AbortController()
    setPdf(null); setError(null); setPasswordNeeded(false); setProgress(null); setKnown(new Map())
    void (async () => {
      try {
        const response = await fetch(url, { method: 'HEAD', cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const nextRevision = response.headers.get('X-Mew-Pdf-Revision')
        if (!nextRevision) throw new Error('Missing PDF revision')
        if (cancelled) return
        if (draft.get().strokes.length && draft.get().revision !== nextRevision) { setError('pdf.staleDraft'); return }
        revision.current = nextRevision
        setEditable(response.headers.get('X-Mew-Pdf-Editable') === 'true')
        draft.bind(nextRevision)
        task = loadPdf(`${url}&revision=${encodeURIComponent(nextRevision)}`)
        task.onPassword = (callback: (password: string) => void) => { if (!cancelled) { passwordCallback.current = callback; setPasswordNeeded(true) } }
        task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => { if (!cancelled && total) setProgress(Math.min(100, Math.round(100 * loaded / total))) }
        const document = await task.promise
        if (cancelled) return
        const firstPage = await document.getPage(1)
        if (cancelled) return
        const size = firstPage.getViewport({ scale: 1 })
        setFallback({ width: size.width, height: size.height })
        setKnown(new Map([[1, { width: size.width, height: size.height }]]))
        setPdf(document); setPasswordNeeded(false)
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message === 'HTTP 403' ? 'pdf.forbidden' : 'pdf.loadFailed')
      }
    })()
    return () => { cancelled = true; controller.abort(); passwordCallback.current = null; void task?.destroy().catch(() => {}) }
  }, [url, retry, draft, ink.generation])

  useEffect(() => () => { saveController.current?.abort(); draft.flush(); cancelAnimationFrame(frame.current) }, [draft])
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTop = savedScroll.current
    const update = () => {
      if (frame.current) return
      frame.current = requestAnimationFrame(() => { frame.current = 0; savedScroll.current = element.scrollTop; setView({ width: element.clientWidth, height: element.clientHeight, top: element.scrollTop }) })
    }
    const resize = new ResizeObserver(update)
    resize.observe(element); element.addEventListener('scroll', update, { passive: true }); update()
    return () => { resize.disconnect(); element.removeEventListener('scroll', update) }
  }, [pdf])
  useEffect(() => { setPageInput(String(current)) }, [current])

  // Keep the same page under the reader when an estimated preceding page acquires its real size,
  // or when fit-width changes with a split-pane resize. Do this before paint, without animation.
  useLayoutEffect(() => {
    const previous = previousLayout.current, element = scrollRef.current
    previousLayout.current = { pdf, offsets, scale }
    if (!element || !previous || previous.pdf !== pdf) return
    const anchor = pageAt(previous.offsets, element.scrollTop)
    const within = element.scrollTop - previous.offsets[anchor]
    const nextWithin = previous.scale === scale ? within : within * (offsets[anchor + 1] - offsets[anchor]) / (previous.offsets[anchor + 1] - previous.offsets[anchor])
    const nextTop = offsets[anchor] + nextWithin
    if (Math.abs(nextTop - element.scrollTop) < 1) return
    element.scrollTop = nextTop
    savedScroll.current = element.scrollTop
    setView(view => ({ ...view, top: element.scrollTop }))
  }, [pdf, offsets, scale])

  const onSize = useCallback((number: number, size: PageSize) => {
    setKnown(previous => {
      const old = previous.get(number)
      if (old?.width === size.width && old.height === size.height) return previous
      return new Map(previous).set(number, size)
    })
  }, [])
  const onInk = useCallback((stroke: InkStroke) => { draft.change([...draft.get().strokes, stroke]); setSaved(false); onEdit?.() }, [draft, onEdit])
  const onErase = useCallback((ids: Set<string>) => { draft.change(draft.get().strokes.filter(stroke => !ids.has(stroke.id))); setSaved(false) }, [draft])

  function jump(page: number) {
    const target = Math.max(1, Math.min(pdf?.numPages ?? 1, Math.round(page) || 1))
    scrollRef.current?.scrollTo({ top: offsets[target - 1] })
    setPageInput(String(target))
  }
  function zoomTo(next: number | 'fit') {
    const nextScale = next === 'fit' ? Math.max(0.1, Math.min(2, (view.width - 32) / fallback.width)) : Math.max(0.25, Math.min(4, next))
    setZoom(next === 'fit' ? next : nextScale)
  }

  async function save(copy: boolean) {
    if (!pdf || busy || saveController.current) return
    const controller = new AbortController()
    saveController.current = controller
    draft.saving(true); setSaveError(null)
    const snapshot = draft.get().strokes
    try {
      const data = await pdf.getData()
      const bytes = await exportPdf(data, snapshot, controller.signal)
      if (copy) {
        const href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
        const link = document.createElement('a')
        link.href = href; link.download = name.replace(/\.pdf$/i, '-annotated.pdf'); link.click()
        setTimeout(() => URL.revokeObjectURL(href), 60_000)
      } else {
        const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'If-Match': revision.current }, body: bytes, signal: controller.signal })
        if (!response.ok) { setSaveError(response.status === 409 ? 'pdf.conflict' : response.status === 403 ? 'pdf.forbidden' : response.status === 413 ? 'pdf.tooLarge' : 'pdf.saveFailed'); return }
        const result = await response.json() as { revision: string }
        draft.saved(result.revision, snapshot); setSaved(true)
      }
    } catch (cause) { if (!controller.signal.aborted) setSaveError((cause as Error).message.includes('encrypt') || (cause as Error).message.includes('certified') ? 'pdf.protected' : 'pdf.saveFailed') }
    finally { draft.saving(false); saveController.current = null }
  }

  function button(label: TranslationKey, icon: React.ReactNode, onClick: () => void, disabled = false, pressed?: boolean) {
    return <button type="button" title={t(label)} aria-label={t(label)} disabled={disabled} aria-pressed={pressed} onClick={onClick}>{icon}</button>
  }
  const ready = !!pdf && !busy
  return <dialog open ref={stageRef} className="pdf-stage" role={fullscreen ? 'dialog' : 'region'} aria-label={name} aria-modal={fullscreen || undefined}>
  <div ref={viewerRef} className={`pdf-viewer${fullscreen ? ' pdf-fullscreen' : ''}`} onKeyDown={event => {
    if (fullscreen) event.stopPropagation()
    if (!(event.ctrlKey || event.metaKey) || event.target instanceof HTMLInputElement || (event.target as HTMLElement).closest('[role="combobox"]')) return
    const key = event.key.toLowerCase()
    if (['s', 'z', 'y'].includes(key)) { event.preventDefault(); event.stopPropagation() }
    if (key === 's' && ready && editable && ink.strokes.length) void save(false)
    if (key === 'z' && ready) { if (event.shiftKey) draft.redo(); else draft.undo() }
    if (key === 'y' && ready) draft.redo()
  }}>
    <div className="pdf-floating-bar" role="group" aria-label={t('pdf.tools')}>
    <div className="pdf-toolbar" role="group" aria-label={t('pdf.navigation')}>
      <div className="pdf-controls">
        {button('pdf.previous', <NavArrowLeft />, () => jump(current - 1), !ready || current === 1)}
        <form onSubmit={event => { event.preventDefault(); jump(Number(pageInput)) }}><input aria-label={t('pdf.page')} inputMode="numeric" value={pageInput} disabled={!ready} onChange={event => setPageInput(event.target.value)} onBlur={() => jump(Number(pageInput))} /><span>/ {pdf?.numPages ?? '—'}</span></form>
        {button('pdf.next', <NavArrowRight />, () => jump(current + 1), !ready || current === pdf?.numPages)}
      </div>
      <div className="pdf-controls pdf-zoom">
        {button('pdf.zoomOut', <Minus />, () => zoomTo(scale / 1.2), !ready || scale <= 0.25)}
        <SelectField compact className="pdf-zoom-field" label={t('pdf.zoom')} value={String(zoom)} disabled={!ready}
          portalContainer={fullscreen ? viewerRef.current : undefined} onChange={value => zoomTo(value === 'fit' ? 'fit' : Number(value))}
          options={[{ value: 'fit', label: t('pdf.fit') }, ...[...new Set([0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, ...(typeof zoom === 'number' ? [zoom] : [])])].sort((a, b) => a - b).map(value => ({ value: String(value), label: `${Math.round(value * 100)}%` }))]} />
        {button('pdf.zoomIn', <Plus />, () => zoomTo(scale * 1.2), !ready || scale >= 4)}
      </div>
      <div className="pdf-controls pdf-file-actions">
        {ink.strokes.length > 0 ? button('pdf.downloadCopy', <Download />, () => void save(true), !ready) : <DownloadLink href={download} name={name} className="pdf-download" overlayContainer={viewerRef.current}><Download /><span className="pdf-sr-only">{t('media.download')}</span></DownloadLink>}
        {editable && <button type="button" className="pdf-save" onClick={() => void save(false)} disabled={!ready || !ink.strokes.length}><FloppyDisk /><span>{t(busy ? 'pdf.saving' : 'pdf.save')}</span></button>}
        {button(fullscreen ? 'pdf.exitFullscreen' : 'pdf.fullscreen', <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">{fullscreen ? <path d="M8 3v5H3m18 0h-5V3M3 16h5v5m8 0v-5h5" /> : <path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5" />}</svg>, () => void toggleFullscreen(), false, fullscreen)}
      </div>
    </div>
    <div className="pdf-tools" role="group" aria-label={t('pdf.tools')}>
      {button('pdf.invertColors', <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" /></svg>, () => setInverted(value => !value), !pdf, inverted)}
      <span className="pdf-divider" />
      {button('pdf.select', <Text />, () => setTool('select'), !ready, tool === 'select')}
      {editable && <>
        {button('pdf.pen', <EditPencil />, () => setTool('pen'), !ready, tool === 'pen')}
        {button('pdf.highlight', <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="m14 3 7 7-9 9-7-7zM5 12l-2 6 3 3 6-2M3 21h7M12 5l7 7" /></svg>, () => setTool('highlight'), !ready, tool === 'highlight')}
        {button('pdf.erase', <Erase />, () => setTool('erase'), !ready, tool === 'erase')}
        <span className="pdf-divider" />
        <div className="pdf-colors" role="group" aria-label={t('pdf.color')}>{COLORS.map((value, index) => <button type="button" key={value} aria-label={t(['pdf.black', 'pdf.red', 'pdf.blue', 'pdf.green'][index] as TranslationKey)} title={t(['pdf.black', 'pdf.red', 'pdf.blue', 'pdf.green'][index] as TranslationKey)} aria-pressed={color === value} disabled={!ready} style={{ '--pdf-swatch': value } as React.CSSProperties} onClick={() => { setColor(value); setTool('pen') }}><span /></button>)}</div>
        <SelectField compact className="pdf-width-field" label={t('pdf.width')} value={String(width)} onChange={value => setWidth(Number(value))} disabled={!ready}
          portalContainer={fullscreen ? viewerRef.current : undefined}
          options={[{ value: '1', label: t('pdf.thin') }, { value: '2', label: t('pdf.medium') }, { value: '4', label: t('pdf.thick') }]} />
        <span className="pdf-divider" />
        {button('pdf.undo', <Undo />, draft.undo, !ready || !ink.undo.length)}
        {button('pdf.redo', <Redo />, draft.redo, !ready || !ink.redo.length)}
      </>}
    </div>
    <div className={busy || ink.strokes.length || saved ? 'pdf-state' : 'pdf-sr-only'} role="status">{t(busy ? 'pdf.saving' : ink.strokes.length ? 'pdf.unsaved' : saved ? 'pdf.saved' : editable ? 'pdf.ready' : 'pdf.readOnly')}</div>
    {(saveError || ink.storageFailed) && <div className="pdf-notice" role="alert">{t(saveError ?? 'pdf.draftFailed')}</div>}
    </div>
    {error ? <div className="pdf-empty" role="alert"><strong>{t(error)}</strong><span>{name}</span>{error === 'pdf.staleDraft' ? <button onClick={() => { draft.clear(); setRetry(n => n + 1) }}>{t('pdf.discardDraft')}</button> : <button onClick={() => setRetry(n => n + 1)}>{t('pdf.retry')}</button>}<DownloadLink href={download} name={name}>{t('media.download')}</DownloadLink></div>
      : passwordNeeded ? <form className="pdf-empty" onSubmit={event => { event.preventDefault(); passwordCallback.current?.(password); setPassword(''); setPasswordNeeded(false) }}><label htmlFor={passwordId}>{t('pdf.password')}</label><input id={passwordId} type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} autoFocus /><button type="submit">{t('pdf.open')}</button></form>
      : !pdf ? <div className="pdf-empty" role="status"><span>{t('pdf.loading')}</span>{progress !== null && <progress max={100} value={progress} aria-label={t('pdf.loading')} />}</div>
      : <div ref={scrollRef} className="pdf-scroll" tabIndex={0} aria-label={t('pdf.document')}>
        <div className={`pdf-pages${inverted ? ' pdf-inverted' : ''}`} style={{ height: offsets[offsets.length - 1] + PAGE_GAP, minWidth: Math.max(view.width - 32, ...Array.from({ length: last - first + 1 }, (_, i) => (known.get(first + i + 1) ?? fallback).width * scale)) }}>
          {Array.from({ length: last - first + 1 }, (_, index) => {
            const number = first + index + 1
            return <PdfPage key={number} pdf={pdf} number={number} size={known.get(number) ?? fallback} top={offsets[number - 1]} scale={scale} budget={budget} queue={queue} onSize={onSize} strokes={byPage.get(number) ?? EMPTY_INK} tool={busy || !editable ? 'select' : tool} color={color} width={width} onInk={onInk} onErase={onErase} />
          })}
        </div>
      </div>}
  </div>
  </dialog>
}
