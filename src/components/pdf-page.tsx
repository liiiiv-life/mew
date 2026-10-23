import { memo, useEffect, useRef, useState } from 'react'
import { TextLayer, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist'
import type { PageViewport } from 'pdfjs-dist/types/src/display/page_viewport'
import { canvasScale, distanceToSegment, simplifyInk, type InkPoint, type InkStroke, type PageSize, type PdfRenderQueue } from '../utils/pdf-geometry'
import { useI18n } from '../i18n'

export type PdfTool = 'select' | 'pen' | 'highlight' | 'erase'
type Props = {
  pdf: PDFDocumentProxy; number: number; scale: number; size: PageSize; top: number; budget: number
  queue: PdfRenderQueue; onSize: (number: number, size: PageSize) => void
  strokes: InkStroke[]; tool: PdfTool; color: string; width: number
  onInk: (stroke: InkStroke) => void; onErase: (ids: Set<string>) => void
}

function drawStroke(context: CanvasRenderingContext2D, stroke: InkStroke, viewport: PageViewport, ratio: number) {
  context.save()
  context.scale(ratio, ratio)
  context.transform(...viewport.transform as [number, number, number, number, number, number])
  context.strokeStyle = stroke.color; context.fillStyle = stroke.color
  context.globalAlpha = stroke.opacity; context.lineWidth = stroke.width
  context.lineCap = 'round'; context.lineJoin = 'round'
  context.beginPath()
  stroke.points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y))
  if (stroke.points.length === 1) {
    context.arc(stroke.points[0][0], stroke.points[0][1], stroke.width / 2, 0, Math.PI * 2)
    context.fill()
  } else context.stroke()
  context.restore()
}

export const PdfPage = memo(function PdfPage({ pdf, number, scale, size, top, budget, queue, onSize, strokes, tool, color, width, onInk, onErase }: Props) {
  const { t } = useI18n()
  const paperRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const inkRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLCanvasElement>(null)
  const live = useRef<{ pointer: number; stroke: InkStroke; rect: DOMRect; erased: Set<string> } | null>(null)
  const frame = useRef(0)
  const [viewport, setViewport] = useState<PageViewport | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const ratio = canvasScale(size.width * scale, size.height * scale, window.devicePixelRatio || 1, budget)

  useEffect(() => {
    let cancelled = false, page: PDFPageProxy | undefined, render: RenderTask | undefined, text: TextLayer | undefined
    const host = paperRef.current!, textHost = textRef.current!
    setError(false)
    queue.run(async () => {
      if (cancelled) return
      const canvas = document.createElement('canvas')
      try {
        page = await pdf.getPage(number)
        if (cancelled) return
        const natural = page.getViewport({ scale: 1 })
        onSize(number, { width: natural.width, height: natural.height })
        const view = page.getViewport({ scale })
        setViewport(view)
        const resolution = canvasScale(view.width, view.height, window.devicePixelRatio || 1, budget)
        canvas.width = Math.max(1, Math.floor(view.width * resolution)); canvas.height = Math.max(1, Math.floor(view.height * resolution))
        render = page.render({ canvas, viewport: view, transform: [resolution, 0, 0, resolution, 0, 0] })
        // PDF.js yields expensive display operations; don't monopolize a frame while the user writes.
        render.onContinue = (continuation: () => void) => { if (!cancelled) requestAnimationFrame(() => { if (!cancelled) continuation() }) }
        await render.promise
        if (cancelled) return
        for (const old of host.querySelectorAll('canvas')) { old.width = old.height = 0 }
        host.replaceChildren(canvas)
        textHost.replaceChildren()
        textHost.style.setProperty('--total-scale-factor', String(view.scale * page.userUnit))
        text = new TextLayer({ textContentSource: page.streamTextContent(), container: textHost, viewport: view })
        await text.render()
      } catch (cause) {
        if (!cancelled && (cause as Error).name !== 'RenderingCancelledException') setError(true)
      } finally {
        if (cancelled || canvas.parentElement !== host) canvas.width = canvas.height = 0
        if (cancelled) page?.cleanup()
      }
    })
    return () => { cancelled = true; render?.cancel(); text?.cancel(); page?.cleanup() }
  }, [pdf, number, scale, budget, queue, onSize, attempt])

  useEffect(() => {
    // React clears refs before passive unmount cleanup; retain the nodes to release their buffers.
    const inkCanvas = inkRef.current, liveCanvas = liveRef.current, paper = paperRef.current
    return () => {
      cancelAnimationFrame(frame.current)
      for (const canvas of [inkCanvas, liveCanvas, ...Array.from(paper?.querySelectorAll('canvas') ?? [])]) if (canvas) canvas.width = canvas.height = 0
    }
  }, [])

  useEffect(() => {
    if (!viewport) return
    for (const canvas of [inkRef.current!, liveRef.current!]) {
      canvas.width = Math.max(1, Math.floor(viewport.width * ratio)); canvas.height = Math.max(1, Math.floor(viewport.height * ratio))
    }
    const context = inkRef.current!.getContext('2d')!
    for (const stroke of strokes) drawStroke(context, stroke, viewport, ratio)
  }, [strokes, viewport, ratio])

  function point(clientX: number, clientY: number, rect: DOMRect): InkPoint {
    const x = Math.max(0, Math.min(viewport!.width, (clientX - rect.left) * viewport!.width / rect.width))
    const y = Math.max(0, Math.min(viewport!.height, (clientY - rect.top) * viewport!.height / rect.height))
    return viewport!.convertToPdfPoint(x, y) as InkPoint
  }
  function paintLive() {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const canvas = liveRef.current, active = live.current
      if (!canvas || !active || !viewport) return
      const context = canvas.getContext('2d')!
      context.clearRect(0, 0, canvas.width, canvas.height)
      if (tool !== 'erase') drawStroke(context, active.stroke, viewport, ratio)
    })
  }
  function collect(event: React.PointerEvent<HTMLCanvasElement>) {
    const active = live.current
    if (!active || active.pointer !== event.pointerId || !viewport) return
    const events = event.nativeEvent.getCoalescedEvents?.() ?? []
    for (const e of events.length ? events : [event]) {
      const p = point(e.clientX, e.clientY, active.rect)
      if (tool === 'erase') {
        const tolerance = 10 / Math.hypot(viewport.transform[0], viewport.transform[1])
        for (const stroke of strokes) {
          if (stroke.points.some((a, index) => distanceToSegment(p, a, stroke.points[Math.max(0, index - 1)]) <= tolerance + stroke.width / 2)) active.erased.add(stroke.id)
        }
      } else {
        const previous = active.stroke.points.at(-1)!
        if (Math.hypot(p[0] - previous[0], p[1] - previous[1]) > 0.15 / scale) active.stroke.points.push(p)
      }
    }
    if (tool === 'erase' && active.erased.size) {
      const context = inkRef.current!.getContext('2d')!
      context.clearRect(0, 0, inkRef.current!.width, inkRef.current!.height)
      for (const stroke of strokes) if (!active.erased.has(stroke.id)) drawStroke(context, stroke, viewport, ratio)
    }
    paintLive()
  }
  function finish(event: React.PointerEvent<HTMLCanvasElement>, cancel = false) {
    const active = live.current
    if (!active || event.pointerId !== active.pointer) return
    if (!cancel) collect(event)
    live.current = null
    cancelAnimationFrame(frame.current); frame.current = 0
    liveRef.current!.getContext('2d')!.clearRect(0, 0, liveRef.current!.width, liveRef.current!.height)
    // A system interruption commits the points already received instead of losing the stroke.
    if (tool === 'erase') { if (active.erased.size) onErase(active.erased) }
    else onInk({ ...active.stroke, points: simplifyInk(active.stroke.points, 0.25 / scale) })
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return <section className="pdf-page" aria-label={t('pdf.pageNumber', { page: number })} data-page={number} style={{ top, width: size.width * scale, height: size.height * scale }}>
    <div className="pdf-paper" ref={paperRef} />
    <div className="pdf-text-layer" ref={textRef} style={{ pointerEvents: tool === 'select' ? 'auto' : 'none' }} />
    <canvas className="pdf-ink" ref={inkRef} aria-hidden="true" />
    <canvas className={`pdf-live pdf-tool-${tool}`} ref={liveRef} aria-hidden="true" style={{ pointerEvents: tool === 'select' || !viewport ? 'none' : 'auto' }}
      onPointerDown={event => {
        if (!viewport || live.current || event.button !== 0 || event.pointerType === 'touch' && !event.isPrimary) return
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
        const rect = event.currentTarget.getBoundingClientRect()
        const factor = Math.hypot(viewport.transform[0], viewport.transform[1]) / scale
        live.current = { pointer: event.pointerId, rect, erased: new Set(), stroke: { id: crypto.randomUUID(), page: number, points: [point(event.clientX, event.clientY, rect)], color: tool === 'highlight' ? '#f2c94c' : color, width: (tool === 'highlight' ? width * 7 : width) / factor, opacity: tool === 'highlight' ? 0.32 : 1 } }
        collect(event); paintLive()
      }} onPointerMove={collect} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)} />
    {error && <div className="pdf-page-error" role="alert"><span>{t('pdf.pageFailed')}</span><button onClick={() => setAttempt(n => n + 1)}>{t('pdf.retry')}</button></div>}
  </section>
})
