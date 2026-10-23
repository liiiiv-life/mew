import { ActionMenu, ActionMenuItem, ActionMenuSeparator, DialogFrame, HoverTipLayer, useOverlayDismiss } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { ArrowDown, ArrowUp, Circle, ClockRotateRight, Copy, CursorPointer, DesignNib, DragHandGesture, Group, HelpCircle, Maximize, Minus, Plus, Redo, Square, Text, Trash, Undo, ViewGrid, Xmark, OnePointCircle } from 'iconoir-react'
import { useCallback, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createDocument, createObject, drawingId, DRAWING_MIME, DrawingHistory, expandSelection, normalizeDocument, reorderObjects, type Bounds, type DrawingDocument, type DrawingObject, type DrawingViewport, type LayerAction, type Point } from './model'
import { hitTestObject, normalizePathObject, objectBounds, objectLocalToWorld, resizeObject, resizeObjectFromHandle, resizeSelection, rotateSelection, selectionBounds, translateSelection, type ResizeHandle } from './geometry'
import { parseSvgDocument, rasterizeSvg, serializeSvg } from './svg'
import { embeddedDrawingFontCss, loadDrawingFont } from './fonts'
import { getDrawingScope, loadDrawing, saveDrawing, type DrawingSummary } from './storage'
import { DrawingObjectView } from './DrawingObjectView'
import { DrawingInspector, DrawingPaintPopover, NumberField, PaintButtons, type PaintTarget } from './DrawingInspector'
import './drawing.css'

type Tool = 'select' | 'hand' | 'rect' | 'ellipse' | 'line' | 'path' | 'text'
type Gesture = {
  mode: 'pan' | 'move' | 'draw' | 'marquee' | 'resize' | 'rotate' | 'pen' | 'pinch'
  start: Point; screen: Point; base: DrawingDocument; ids: string[]; view: DrawingViewport
  object?: DrawingObject; handle?: ResizeHandle; bounds?: Bounds; angle?: number
  distance?: number; midpoint?: Point
}
let copiedObjects: DrawingObject[] = []
const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const HANDLE_POSITIONS: Point[] = [{ x: 0, y: 0 }, { x: .5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .5 }, { x: 1, y: 1 }, { x: .5, y: 1 }, { x: 0, y: 1 }, { x: 0, y: .5 }]
const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'hand', r: 'rect', o: 'ellipse', l: 'line', p: 'path', t: 'text' }
const editable = (target: EventTarget | null) => target instanceof Element && !!target.closest('input, textarea, [contenteditable="true"]')
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const boundedZoom = (zoom: number) => Math.max(.05, Math.min(16, zoom))
const round = (n: number, step: number) => Math.round(n / step) * step

export function DrawingEditor({ onClose, onSave }: { onClose: () => void; onSave: (file: File) => Promise<void> }) {
  const titleId = useId(), gridId = useId()
  const history = useRef(new DrawingHistory())
  const [doc, setDoc] = useState<DrawingDocument>(() => history.current.current)
  const docRef = useRef(doc); docRef.current = doc
  const [selected, setSelected] = useState<string[]>([])
  const [tool, setTool] = useState<Tool>('select')
  const [view, setView] = useState<DrawingViewport>({ x: 0, y: 0, zoom: 1 })
  const viewRef = useRef(view); viewRef.current = view
  const [paint, setPaint] = useState<PaintTarget | null>(null)
  const [paintCustom, setPaintCustom] = useState(false)
  const [defaults, setDefaults] = useState({ fill: 'none', stroke: '#1f2937', strokeWidth: 2 })
  const [context, setContext] = useState<Point | null>(null)
  const [panel, setPanel] = useState<'grid' | 'history' | 'shortcuts' | null>(null)
  const [marquee, setMarquee] = useState<Bounds | null>(null)
  const [pen, setPen] = useState<DrawingObject | null>(null)
  const penRef = useRef(pen); penRef.current = pen
  const [textId, setTextId] = useState<string | null>(null)
  const textBase = useRef<DrawingDocument | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(busy); busyRef.current = busy
  const [confirmClose, setConfirmClose] = useState(false)
  const [name, setName] = useState('')
  const [records, setRecords] = useState<DrawingSummary[]>([])
  const [recordsLoading, setRecordsLoading] = useState(true)
  const projectRoot = useRef<string | null>(null)
  const scopePromise = useRef<ReturnType<typeof getDrawingScope> | null>(null)
  const saved = useRef(JSON.stringify(createDocument()))
  const savedExport = useRef<{ document: string; svgName: string; png: File } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null), stageRef = useRef<HTMLDivElement>(null)
  const frame = useRef<number | null>(null), queuedMove = useRef<(() => void) | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const space = useRef(false)
  const pointers = useRef(new Map<number, Point>())
  const [panning, setPanning] = useState(false)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const selectedObjects = doc.objects.filter(object => selected.includes(object.id))
  const bounds = selectionBounds(doc.objects, selected)
  const activeText = doc.objects.find(object => object.id === textId)

  const preview = (next: DrawingDocument) => { docRef.current = next; setDoc(next) }
  const commit = (next: DrawingDocument) => { preview(history.current.commit(next)) }
  const updateObjects = (objects: DrawingObject[]) => commit({ ...docRef.current, objects })
  const focusCanvas = () => svgRef.current?.focus({ preventScroll: true })
  const requestClose = () => {
    if (busy) return
    settleGesture(true)
    if (JSON.stringify(docRef.current) !== saved.current || penRef.current) setConfirmClose(true)
    else onClose()
  }
  useOverlayDismiss(() => {
    if (busy) return
    settleGesture(false)
    if (textId) { finishText(); return }
    if (penRef.current) { setPen(null); return }
    if (paint) { setPaint(null); return }
    if (panel) { setPanel(null); return }
    if (selected.length) { setSelected([]); return }
    requestClose()
  })

  useEffect(() => {
    let active = true
    const pending = getDrawingScope(); scopePromise.current = pending
    void pending.then(result => {
      if (!active) return
      projectRoot.current = result.projectRoot; setRecords(result.drawings)
    }).catch(error => { scopePromise.current = null; if (active) setError(String(error instanceof Error ? error.message : error)) }).finally(() => { if (active) setRecordsLoading(false) })
    return () => { active = false; if (frame.current !== null) cancelAnimationFrame(frame.current) }
  }, [])

  useEffect(() => {
    const stage = stageRef.current!
    let previous = { width: 0, height: 0 }
    const observer = new ResizeObserver(() => {
      const width = stage.clientWidth, height = stage.clientHeight
      setSize({ width, height })
      setView(current => ({ ...current, x: current.x + (width - previous.width) / 2, y: current.y + (height - previous.height) / 2 }))
      previous = { width, height }
    })
    observer.observe(stage)
    const release = () => { space.current = false; setPanning(false) }
    window.addEventListener('keyup', release)
    window.addEventListener('blur', release)
    return () => { observer.disconnect(); window.removeEventListener('keyup', release); window.removeEventListener('blur', release) }
  }, [])

  const zoomAt = useCallback((zoom: number, point?: Point) => {
    setView(current => {
      const at = point ?? { x: stageRef.current!.clientWidth / 2, y: stageRef.current!.clientHeight / 2 }
      const next = boundedZoom(zoom), ratio = next / current.zoom
      return { zoom: next, x: at.x - (at.x - current.x) * ratio, y: at.y - (at.y - current.y) * ratio }
    })
  }, [])
  useEffect(() => {
    const stage = stageRef.current!
    const wheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest('button,input,[data-drawing-panel]')) return
      event.preventDefault()
      if (event.ctrlKey || event.metaKey || event.altKey) {
        const rect = stage.getBoundingClientRect()
        zoomAt(viewRef.current.zoom * Math.exp(-event.deltaY * .008), { x: event.clientX - rect.left, y: event.clientY - rect.top })
      } else setView(current => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }))
    }
    stage.addEventListener('wheel', wheel, { passive: false })
    return () => stage.removeEventListener('wheel', wheel)
  }, [zoomAt])

  function pointOf(event: { clientX: number; clientY: number }): Point {
    const rect = stageRef.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  function worldAt(point: Point, viewport = viewRef.current): Point { return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom } }
  function snapped(point: Point, skip = false): Point {
    const grid = docRef.current.grid
    return grid.snap && !skip ? { x: round(point.x, grid.size), y: round(point.y, grid.size) } : point
  }
  function hit(point: Point) { return [...docRef.current.objects].reverse().find(object => hitTestObject(object, point, 6 / viewRef.current.zoom)) }
  function fit(objects = docRef.current.objects) {
    const b = selectionBounds(objects, objects.map(object => object.id))
    if (!b) { setView({ x: size.width / 2, y: size.height / 2, zoom: 1 }); return }
    const zoom = boundedZoom(Math.min((size.width - 96) / Math.max(1, b.width), (size.height - 96) / Math.max(1, b.height), 2))
    setView({ zoom, x: size.width / 2 - (b.x + b.width / 2) * zoom, y: size.height / 2 - (b.y + b.height / 2) * zoom })
  }
  function finishText() {
    if (!textId) return
    const next = { ...docRef.current, objects: docRef.current.objects.filter(object => object.id !== textId || object.text?.trim()) }
    commit(next); setTextId(null); textBase.current = null; focusCanvas()
    const text = next.objects.find(object => object.id === textId)
    if (text) void refreshTextFont(text)
  }
  function startText(object: DrawingObject) {
    textBase.current = history.current.current
    setTextId(object.id); setSelected([object.id]); setTool('select')
  }
  function finishPen(closed = false) {
    const object = penRef.current
    if (object && (object.points?.length ?? 0) >= 2) {
      const next = normalizePathObject({ ...object, closed })
      updateObjects([...docRef.current.objects, next]); setSelected([object.id])
    }
    penRef.current = null; setPen(null); gesture.current = null; setTool('select')
  }
  function settleGesture(keep: boolean) {
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    if (keep) queuedMove.current?.()
    queuedMove.current = null
    const active = gesture.current
    const changed = !!active && ['draw', 'move', 'resize', 'rotate'].includes(active.mode) && docRef.current !== active.base
    if (active && ['draw', 'move', 'resize', 'rotate'].includes(active.mode)) {
      if (keep) commit(docRef.current)
      else preview(active.base)
    }
    gesture.current = null; setMarquee(null); setPanning(false)
    for (const id of pointers.current.keys()) if (svgRef.current?.hasPointerCapture(id)) svgRef.current.releasePointerCapture(id)
    pointers.current.clear()
    return changed
  }
  function chooseTool(next: Tool) { settleGesture(true); finishText(); if (penRef.current) finishPen(); setTool(next); setPaint(null); setPanel(null); focusCanvas() }

  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (busy || (event.button !== 0 && event.button !== 1)) return
    event.preventDefault(); focusCanvas()
    if (textId) finishText()
    const screen = pointOf(event), start = worldAt(screen), base = docRef.current
    pointers.current.set(event.pointerId, screen)
    event.currentTarget.setPointerCapture(event.pointerId)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      if (gesture.current?.mode !== 'pan') preview(history.current.current)
      gesture.current = { mode: 'pinch', start, screen, base: history.current.current, ids: [], view: viewRef.current, distance: distance(a, b), midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
      setMarquee(null); return
    }
    if (space.current || tool === 'hand' || event.button === 1) {
      gesture.current = { mode: 'pan', start, screen, base, ids: [], view: viewRef.current }; setPanning(true); return
    }
    const target = event.target as Element
    const handle = target.getAttribute('data-resize-handle') as ResizeHandle | null
    if (handle && bounds) { gesture.current = { mode: 'resize', start, screen, base, ids: selected, view, bounds, handle, object: selectedObjects.length === 1 ? selectedObjects[0] : undefined }; return }
    if (target.closest('[data-rotate-handle]') && bounds) {
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      gesture.current = { mode: 'rotate', start, screen, base, ids: selected, view, bounds, angle: Math.atan2(start.y - center.y, start.x - center.x) }; return
    }
    setContext(null); setPaint(null); setPanel(null)
    if (tool === 'path') {
      const previous = penRef.current
      if (previous && (previous.points?.length ?? 0) > 2 && distance(start, objectLocalToWorld(previous, previous.points![0])) < 10 / view.zoom) { finishPen(true); return }
      const at = snapped(start, event.altKey)
      const next = previous ? { ...previous, points: [...previous.points!, at] } : createObject('path', { ...defaults, x: 0, y: 0, width: 0, height: 0, points: [at] })
      penRef.current = next; setPen(next)
      gesture.current = { mode: 'pen', start: at, screen, base, ids: [], view }; return
    }
    if (tool === 'text') {
      const at = snapped(start, event.altKey)
      const object = createObject('text', { x: at.x, y: at.y, width: 200, height: 32, fill: defaults.fill === 'none' ? defaults.stroke : defaults.fill, stroke: 'none', fontFamily: 'Arial' })
      preview({ ...base, objects: [...base.objects, object] }); startText(object); return
    }
    if (tool !== 'select') {
      const at = snapped(start, event.altKey)
      const object = createObject(tool, { ...defaults, x: at.x, y: at.y, width: 0, height: 0, ...(tool === 'line' ? { fill: 'none', points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] } : {}) })
      preview({ ...base, objects: [...base.objects, object] }); setSelected([object.id])
      gesture.current = { mode: 'draw', start: at, screen, base, ids: [object.id], object, view }; return
    }
    const object = hit(start)
    if (object) {
      const group = expandSelection(base.objects, [object.id])
      const ids = event.shiftKey ? selected.includes(object.id) ? selected.filter(id => !group.includes(id)) : [...new Set([...selected, ...group])] : selected.includes(object.id) ? selected : group
      setSelected(ids)
      gesture.current = { mode: 'move', start, screen, base, ids, view }; return
    }
    const ids = event.shiftKey ? selected : []
    setSelected(ids); setMarquee({ x: start.x, y: start.y, width: 0, height: 0 })
    gesture.current = { mode: 'marquee', start, screen, base, ids, view }
  }

  function movePointer(event: { pointerId: number; clientX: number; clientY: number; shiftKey: boolean; altKey: boolean }) {
    const screen = pointOf(event)
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, screen)
    const g = gesture.current
    if (!g) return
    if (g.mode === 'pinch') {
      const [a, b] = [...pointers.current.values()]
      if (!a || !b) return
      const zoom = boundedZoom(g.view.zoom * distance(a, b) / Math.max(1, g.distance!))
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, anchor = worldAt(g.midpoint!, g.view)
      setView({ zoom, x: mid.x - anchor.x * zoom, y: mid.y - anchor.y * zoom }); return
    }
    if (g.mode === 'pan') { setView({ ...g.view, x: g.view.x + screen.x - g.screen.x, y: g.view.y + screen.y - g.screen.y }); return }
    const world = worldAt(screen)
    if (g.mode === 'pen') {
      const current = penRef.current
      if (!current || distance(screen, g.screen) < 3) return
      const points = [...current.points!], last = points.at(-1)!
      points[points.length - 1] = { ...last, out: world, in: { x: 2 * last.x - world.x, y: 2 * last.y - world.y } }
      const next = { ...current, points }; penRef.current = next; setPen(next); return
    }
    if (g.mode === 'marquee') {
      const box = { x: Math.min(g.start.x, world.x), y: Math.min(g.start.y, world.y), width: Math.abs(world.x - g.start.x), height: Math.abs(world.y - g.start.y) }
      setMarquee(box)
      const ids = g.base.objects.filter(object => { const b = objectBounds(object); return b.x >= box.x && b.y >= box.y && b.x + b.width <= box.x + box.width && b.y + b.height <= box.y + box.height }).map(object => object.id)
      setSelected(expandSelection(g.base.objects, [...new Set([...g.ids, ...ids])]))
      return
    }
    let objects = g.base.objects
    if (g.mode === 'draw') {
      const at = snapped(world, event.altKey)
      let dx = at.x - g.start.x, dy = at.y - g.start.y
      if (event.shiftKey) {
        if (g.object!.type === 'line') { const angle = round(Math.atan2(dy, dx), Math.PI / 4), length = Math.hypot(dx, dy); dx = Math.cos(angle) * length; dy = Math.sin(angle) * length }
        else { const side = Math.max(Math.abs(dx), Math.abs(dy)); dx = (Math.sign(dx) || 1) * side; dy = (Math.sign(dy) || 1) * side }
      }
      const x = Math.min(g.start.x, g.start.x + dx), y = Math.min(g.start.y, g.start.y + dy)
      const object: DrawingObject = { ...g.object!, x, y, width: Math.abs(dx), height: Math.abs(dy), ...(g.object!.type === 'line' ? { points: [{ x: g.start.x - x, y: g.start.y - y }, { x: g.start.x + dx - x, y: g.start.y + dy - y }] } : {}) }
      objects = [...g.base.objects, object]
    } else if (g.mode === 'move') {
      let delta = { x: world.x - g.start.x, y: world.y - g.start.y }
      const b = selectionBounds(g.base.objects, g.ids)
      if (b && docRef.current.grid.snap && !event.altKey) { const at = snapped({ x: b.x + delta.x, y: b.y + delta.y }); delta = { x: at.x - b.x, y: at.y - b.y } }
      if (event.shiftKey) { if (Math.abs(delta.x) >= Math.abs(delta.y)) delta.y = 0; else delta.x = 0 }
      objects = translateSelection(g.base.objects, g.ids, delta)
    } else if (g.mode === 'resize') {
      if (g.object) {
        const resized = resizeObjectFromHandle(g.object, g.handle!, world, { snap: docRef.current.grid.snap && !event.altKey ? docRef.current.grid.size : undefined, preserveAspect: event.shiftKey })
        objects = objects.map(object => object.id === resized.id ? resized : object)
      } else {
        const b = g.bounds!, at = snapped(world, event.altKey), h = g.handle!
        let x = h.includes('w') ? Math.min(at.x, b.x + b.width - 1) : b.x
        let y = h.includes('n') ? Math.min(at.y, b.y + b.height - 1) : b.y
        let width = h.includes('w') ? b.x + b.width - x : h.includes('e') ? Math.max(1, at.x - x) : b.width
        let height = h.includes('n') ? b.y + b.height - y : h.includes('s') ? Math.max(1, at.y - y) : b.height
        if (event.shiftKey) { const scale = Math.max(width / Math.max(1, b.width), height / Math.max(1, b.height)); width = b.width * scale; height = b.height * scale; if (h.includes('w')) x = b.x + b.width - width; if (h.includes('n')) y = b.y + b.height - height }
        objects = resizeSelection(objects, g.ids, b, { x, y, width, height })
      }
    } else if (g.mode === 'rotate') {
      const center = { x: g.bounds!.x + g.bounds!.width / 2, y: g.bounds!.y + g.bounds!.height / 2 }
      let angle = (Math.atan2(world.y - center.y, world.x - center.x) - g.angle!) * 180 / Math.PI
      if (event.shiftKey) angle = round(angle, 15)
      objects = rotateSelection(objects, g.ids, angle, center)
    }
    preview({ ...g.base, objects })
  }
  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const snapshot = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey, altKey: event.altKey }
    queuedMove.current = () => movePointer(snapshot)
    if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; queuedMove.current?.(); queuedMove.current = null })
  }
  function pointerUp(event: ReactPointerEvent<SVGSVGElement>, cancelled = false) {
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    queuedMove.current?.(); queuedMove.current = null
    const g = gesture.current
    pointers.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!g) return
    if (cancelled) { preview(g.base); setMarquee(null) }
    else if (['draw', 'move', 'resize', 'rotate'].includes(g.mode)) {
      let next = docRef.current
      if (g.mode === 'draw') {
        const object = next.objects.find(object => object.id === g.object!.id)!
        if (object && object.width < 2 && object.height < 2) {
          const width = object.type === 'line' ? 120 : 120, height = object.type === 'line' ? 0 : 80
          next = { ...next, objects: next.objects.map(item => item.id === object.id ? { ...item, width, height, ...(item.type === 'line' ? { points: [{ x: 0, y: 0 }, { x: width, y: height }] } : {}) } : item) }
        }
        setTool('select')
      }
      commit(next)
    }
    if (g.mode === 'marquee') setMarquee(null)
    gesture.current = null; setPanning(false)
    if (pointers.current.size === 1 && g.mode === 'pinch') {
      const remaining = [...pointers.current.values()][0]
      gesture.current = { mode: 'pan', start: worldAt(remaining), screen: remaining, base: docRef.current, ids: [], view: viewRef.current }
    }
  }

  function patch(patch: Partial<DrawingObject>) {
    const ids = new Set(selected)
    updateObjects(docRef.current.objects.map(object => ids.has(object.id) ? measureText({ ...object, ...patch }) : object))
    if (patch.fontWeight || patch.fontFamily) for (const object of docRef.current.objects.filter(object => ids.has(object.id) && object.type === 'text')) void refreshTextFont(object)
  }
  function measureText(object: DrawingObject): DrawingObject {
    if (object.type !== 'text') return object
    const ctx = document.createElement('canvas').getContext('2d')!
    const fontSize = object.fontSize ?? 24
    ctx.font = `${object.fontWeight ?? 400} ${fontSize}px ${JSON.stringify(object.fontFamily ?? 'Arial')}`
    const lines = (object.text ?? '').split('\n')
    return { ...object, width: (Math.max(20, ...lines.map(line => ctx.measureText(line).width)) + 2) * (object.textScaleX ?? 1), height: Math.max(1, lines.length) * fontSize * 1.2 * (object.textScaleY ?? 1) }
  }
  async function refreshTextFont(object: DrawingObject) {
    try {
      await loadDrawingFont(object.fontFamily ?? 'Arial', object.text)
      if (gesture.current || busyRef.current) return
      const current = docRef.current.objects.find(item => item.id === object.id)
      if (!current || current.fontFamily !== object.fontFamily || current.text !== object.text) return
      const measured = measureText(current)
      if (Math.abs(measured.width - current.width) > .1 || Math.abs(measured.height - current.height) > .1) updateObjects(docRef.current.objects.map(item => item.id === measured.id ? measured : item))
    } catch (err) { setError(err instanceof Error ? err.message : uiText('글꼴을 불러오지 못했습니다.')) }
  }
  function changePaint(color: string) {
    const target = paint ?? 'fill'
    setDefaults(current => ({ ...current, [target]: color }))
    if (selected.length) patch({ [target]: color })
  }
  function changeGeometry(field: 'x' | 'y' | 'width' | 'height' | 'rotation', value: number) {
    if (!bounds) return
    const objects = docRef.current.objects
    if (field === 'x' || field === 'y') { const delta = value - bounds[field] - bounds[field === 'x' ? 'width' : 'height'] / 2; updateObjects(translateSelection(objects, selected, { x: field === 'x' ? delta : 0, y: field === 'y' ? delta : 0 })); return }
    if (field === 'rotation') { updateObjects(rotateSelection(objects, selected, value - (selectedObjects.length === 1 ? selectedObjects[0].rotation : 0))); return }
    if (selectedObjects.length === 1) {
      const object = objects.find(object => object.id === selected[0])!
      const next = resizeObject(object, field === 'width' ? value : object.width, field === 'height' ? value : object.height)
      updateObjects(objects.map(object => object.id === next.id ? next : object)); return
    }
    const next = { ...bounds, [field]: value, x: bounds.x - (field === 'width' ? (value - bounds.width) / 2 : 0), y: bounds.y - (field === 'height' ? (value - bounds.height) / 2 : 0) }
    updateObjects(resizeSelection(objects, selected, bounds, next))
  }
  function layer(action: LayerAction) { updateObjects(reorderObjects(docRef.current.objects, selected, action)) }
  function remove() { updateObjects(docRef.current.objects.filter(object => !selected.includes(object.id))); setSelected([]) }
  function group(ungroup = false) {
    const id = drawingId()
    updateObjects(docRef.current.objects.map(object => selected.includes(object.id) ? { ...object, groupId: ungroup ? undefined : id } : object))
  }
  function undo(redo = false) { const cancelled = settleGesture(false); if (textId) finishText(); setPen(null); if (!cancelled) preview(redo ? history.current.redo() : history.current.undo()); setSelected([]); setContext(null) }
  function duplicate(objects = selectedObjects, offset = { x: 20, y: 20 }) {
    const groups = new Map<string, string>()
    const copies = objects.map(object => {
      if (object.groupId && !groups.has(object.groupId)) groups.set(object.groupId, drawingId())
      return { ...object, id: drawingId(), x: object.x + offset.x, y: object.y + offset.y, groupId: object.groupId ? groups.get(object.groupId) : undefined }
    })
    updateObjects([...docRef.current.objects, ...copies]); setSelected(copies.map(object => object.id)); setTool('select')
  }
  function copy(cut = false) {
    copiedObjects = selectedObjects
    if (!copiedObjects.length) return
    void navigator.clipboard?.writeText(JSON.stringify({ type: DRAWING_MIME, document: { ...createDocument(), objects: copiedObjects } })).catch(() => {})
    if (cut) remove()
  }
  function pasteString(value: string): boolean {
    try {
      const parsed = JSON.parse(value)
      if (parsed.type !== DRAWING_MIME) return false
      const drawing = normalizeDocument(parsed.document)
      if (!drawing?.objects.length) return false
      duplicate(drawing.objects); return true
    } catch { return false }
  }
  async function paste() {
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read()
        for (const item of items) {
          const image = item.types.find(type => /^image\/(png|jpeg|webp)$/.test(type))
          if (image) { await insertImages([new File([await item.getType(image)], 'image', { type: image })]); return }
          if (item.types.includes('text/plain') && pasteString(await (await item.getType('text/plain')).text())) return
        }
      } else if (navigator.clipboard?.readText && pasteString(await navigator.clipboard.readText())) return
    } catch { /* The in-app clipboard remains available when OS clipboard access is unavailable. */ }
    if (copiedObjects.length) duplicate(copiedObjects)
  }
  async function insertImages(files: File[], at?: Point) {
    if (busy) return
    setError('')
    try {
      const inserted: DrawingObject[] = []
      for (const file of files) {
        if (!/^image\/(png|jpe?g|webp|gif|avif)$/.test(file.type)) continue
        if (file.size > 20 * 1024 * 1024) throw new Error(uiText('이미지는 20MB 이하로 추가해 주세요.'))
        const src = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file) })
        const image = new Image(); image.src = src; await image.decode()
        const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight)), width = image.naturalWidth * scale, height = image.naturalHeight * scale
        const center = at ?? worldAt({ x: size.width / 2, y: size.height / 2 })
        const point = snapped({ x: center.x - width / 2 + inserted.length * 20, y: center.y - height / 2 + inserted.length * 20 })
        inserted.push(createObject('image', { ...point, width, height, src, fill: 'none', stroke: 'none' }))
      }
      if (inserted.length) { updateObjects([...docRef.current.objects, ...inserted]); setSelected(inserted.map(object => object.id)); setTool('select') }
    } catch (err) { setError(uiText('이미지를 추가하지 못했습니다.') + ' ' + (err instanceof Error ? err.message : '')) }
  }

  async function save() {
    if (busy) return
    settleGesture(true)
    finishText(); if (penRef.current) finishPen()
    if (!docRef.current.objects.length) return
    busyRef.current = true; setBusy(true); setError('')
    try {
      let current = docRef.current
      await Promise.all(current.objects.filter(object => object.type === 'text').map(object => loadDrawingFont(object.fontFamily ?? 'Arial', object.text)))
      const measured = { ...current, objects: current.objects.map(measureText) }
      if (measured.objects.some((object, index) => object.width !== current.objects[index].width || object.height !== current.objects[index].height)) commit(measured)
      current = docRef.current
      const serialized = JSON.stringify(current), svgName = name.trim() || uiText('그림')
      let cached = savedExport.current
      if (!cached || cached.document !== serialized || cached.svgName !== svgName) {
        const fontCss = await embeddedDrawingFontCss(current.objects.filter(object => object.type === 'text'))
        const svg = serializeSvg(current, { padding: 24, background: '#ffffff', fontCss })
        const blob = await rasterizeSvg(svg, { scale: 2 })
        const scope = projectRoot.current ?? (await (scopePromise.current ?? getDrawingScope())).projectRoot
        const record = await saveDrawing(svg, svgName, scope)
        setRecords(records => [record, ...records]); saved.current = serialized
        cached = { document: serialized, svgName, png: new File([blob], `${record.id}.png`, { type: 'image/png' }) }
        savedExport.current = cached
      }
      await onSave(cached.png)
      onClose()
    } catch (err) { setError(err instanceof Error ? err.message : uiText('그림을 저장하지 못했습니다. 다시 시도해 주세요.')) }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function reopen(record: DrawingSummary) {
    if (busy) return
    settleGesture(true); finishText()
    busyRef.current = true; setBusy(true); setError('')
    try {
      const stored = await loadDrawing(record.id, projectRoot.current ?? undefined), restored = parseSvgDocument(stored.svg)
      if (!restored) throw new Error(uiText('이 그림의 편집 데이터를 읽을 수 없습니다.'))
      commit(restored); saved.current = JSON.stringify(restored); setName(record.name); setSelected([]); setPanel(null); setPen(null); fit(restored.objects)
      for (const object of restored.objects.filter(object => object.type === 'text')) void loadDrawingFont(object.fontFamily ?? 'Arial', object.text).catch(() => {})
    } catch (err) { setError(err instanceof Error ? err.message : uiText('그림을 불러오지 못했습니다.')) }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function font(family: string) {
    patch({ fontFamily: family }); setError('')
    try { await loadDrawingFont(family, selectedObjects.map(object => object.text ?? '').join('')); for (const object of docRef.current.objects.filter(object => selected.includes(object.id) && object.type === 'text')) await refreshTextFont(object) }
    catch (err) { setError(err instanceof Error ? err.message : uiText('글꼴을 불러오지 못했습니다.')) }
  }
  function keyboard(event: ReactKeyboardEvent) {
    if (event.nativeEvent.isComposing || busy) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); return }
    if (editable(event.target) || (event.target as Element).closest('[role="menu"],[role="listbox"]')) return
    const mod = event.ctrlKey || event.metaKey
    const key = mod && event.code === 'BracketLeft' ? '[' : mod && event.code === 'BracketRight' ? ']' : event.code === 'Quote' ? "'" : event.key.toLowerCase()
    if (mod) {
      if (key === 'v') return
      if (!['a', 'c', 'x', 'd', 'z', 'y', 'g', '[', ']', 's', '0'].includes(key)) return
      event.preventDefault()
      if (key === 'a') setSelected(doc.objects.map(object => object.id))
      if (key === 'c' || key === 'x') copy(key === 'x')
      if (key === 'd') duplicate()
      if (key === 'z' || key === 'y') undo(key === 'y' || event.shiftKey)
      if (key === 'g') group(event.shiftKey)
      if (key === '[' || key === ']') layer(key === '[' ? event.shiftKey ? 'back' : 'backward' : event.shiftKey ? 'front' : 'forward')
      if (key === 's') void save()
      if (key === '0') setView({ zoom: 1, x: size.width / 2, y: size.height / 2 })
      return
    }
    if (event.altKey) return
    if (paint && /^[0-9]$/.test(key)) { event.preventDefault(); if (key === '9') setPaintCustom(true); else changePaint(key === '0' ? 'none' : ['#1f2937', '#ffffff', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7'][Number(key) - 1]); return }
    if (TOOL_KEYS[key]) { event.preventDefault(); chooseTool(TOOL_KEYS[key]); return }
    if (key === ' ') { event.preventDefault(); space.current = true; setPanning(true); return }
    if (key === 'enter' && pen) { event.preventDefault(); finishPen(); return }
    if (key === 'delete' || key === 'backspace') { event.preventDefault(); remove(); return }
    if (key.startsWith('arrow') && selected.length) {
      event.preventDefault(); const amount = event.shiftKey ? 10 : 1
      updateObjects(translateSelection(doc.objects, selected, { x: key === 'arrowleft' ? -amount : key === 'arrowright' ? amount : 0, y: key === 'arrowup' ? -amount : key === 'arrowdown' ? amount : 0 })); return
    }
    if (key === '=' || key === '+' || key === '-') { event.preventDefault(); zoomAt(view.zoom * (key === '-' ? 1 / 1.2 : 1.2)); return }
    if (key === '0') { event.preventDefault(); setView({ ...view, x: size.width / 2, y: size.height / 2 }); return }
    if (key === '1') { event.preventDefault(); fit(); return }
    if (key === '2' && selected.length) { event.preventDefault(); fit(selectedObjects); return }
    if (key === "'") { event.preventDefault(); commit({ ...doc, grid: { ...doc.grid, ...(event.shiftKey ? { snap: !doc.grid.snap } : { visible: !doc.grid.visible }) } }); return }
    if (key === 'f' || key === 'x') { event.preventDefault(); setPaint(key === 'f' ? 'fill' : 'stroke'); setPaintCustom(false); return }
    if (key === '?') { event.preventDefault(); setPanel(panel === 'shortcuts' ? null : 'shortcuts') }
  }
  function iconButton(label: Parameters<typeof uiText>[0], icon: ReactNode, action: () => void, options: { shortcut?: string; active?: boolean; disabled?: boolean } = {}) {
    return <button type="button" className="drawing-icon" aria-label={uiText(label)} data-tip={uiText(label) + (options.shortcut ? ` · ${options.shortcut}` : '')} aria-pressed={options.active} disabled={busy || options.disabled} onClick={action}>{icon}</button>
  }
  const single = selectedObjects.length === 1 ? selectedObjects[0] : undefined
  const box = single ? { x: single.x, y: single.y, width: single.width, height: single.height } : bounds
  const rotation = single?.rotation ?? 0
  const gridScale = doc.grid.size * view.zoom
  const gridStep = doc.grid.size * Math.max(1, Math.ceil(8 / gridScale))
  const selectionTransform = box ? `translate(${box.x} ${box.y}) rotate(${rotation} ${box.width / 2} ${box.height / 2})` : ''

  return <DialogFrame labelledBy={titleId} onClose={requestClose} busy={busy} className="drawing-dialog">
    <HoverTipLayer className="drawing-editor" >
      <div className="drawing-editor-content" onKeyDown={keyboard} onPaste={event => {
        if (editable(event.target) || busy) return
        const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'))
        if (files.length) { event.preventDefault(); void insertImages(files) }
        else if (pasteString(event.clipboardData.getData('text/plain'))) event.preventDefault()
        else if (copiedObjects.length && !event.clipboardData.getData('text/plain')) { event.preventDefault(); duplicate(copiedObjects) }
      }}>
        <header className="drawing-header"><div className="drawing-heading"><DesignNib aria-hidden="true" /><h2 id={titleId}>{uiText('그림판')}</h2></div>
          <input className="drawing-name" aria-label={uiText('그림 이름')} placeholder={uiText('제목 없는 그림')} value={name} onChange={event => setName(event.target.value)} maxLength={120} disabled={busy} />
          <div className="drawing-header-actions">
            {iconButton('그림 기록', <ClockRotateRight />, () => setPanel(panel === 'history' ? null : 'history'), { active: panel === 'history' })}
            <button type="button" className="drawing-save" disabled={busy || !doc.objects.length && !pen} onClick={() => void save()}>{uiText(busy ? '저장 중…' : '저장')}</button>
            {iconButton('닫기', <Xmark />, requestClose)}
          </div>
        </header>
        {error && <div className="drawing-error" role="alert"><span>{error}</span><button type="button" aria-label={uiText('오류 닫기')} onClick={() => setError('')}><Xmark /></button></div>}
        <div ref={stageRef} className="drawing-stage" data-tool={tool} data-panning={panning || undefined} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }} onDrop={event => { event.preventDefault(); void insertImages([...event.dataTransfer.files], worldAt(pointOf(event))) }}>
          <svg ref={svgRef} data-drawing-canvas tabIndex={0} aria-label={uiText('그림 캔버스')} role="application" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event => pointerUp(event)} onPointerCancel={event => pointerUp(event, true)}
            onDoubleClick={event => {
              if (penRef.current) { finishPen(); return }
              const object = hit(worldAt(pointOf(event)))
              if (object?.type === 'text') startText(object)
            }} onContextMenu={event => {
              event.preventDefault()
              if (busy) return
              finishText()
              const object = hit(worldAt(pointOf(event)))
              if (object && !selected.includes(object.id)) setSelected(expandSelection(doc.objects, [object.id]))
              if (!object) setSelected([])
              setContext({ x: event.clientX, y: event.clientY }); setPaint(null)
            }} onKeyDown={event => {
              if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
                event.preventDefault(); const rect = svgRef.current!.getBoundingClientRect(); setContext({ x: rect.left + size.width / 2, y: rect.top + size.height / 2 })
              }
            }}>
            <defs><pattern id={gridId} width={gridStep * view.zoom} height={gridStep * view.zoom} patternUnits="userSpaceOnUse" x={view.x} y={view.y}><circle cx={0} cy={0} r={.8} fill="#a5adba" /></pattern></defs>
            {doc.grid.visible && <rect width="100%" height="100%" fill={`url(#${gridId})`} pointerEvents="none" />}
            <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
              {doc.objects.map(object => <DrawingObjectView key={object.id} object={object} />)}
              {pen && <><DrawingObjectView object={pen} />{pen.points?.map((point, index) => <g key={index}>
                {point.in && <path d={`M${point.in.x} ${point.in.y} L${point.x} ${point.y} L${point.out!.x} ${point.out!.y}`} fill="none" stroke="#3b82f6" strokeWidth={1 / view.zoom} />}
                <circle cx={point.x} cy={point.y} r={4 / view.zoom} fill="white" stroke="#2563eb" strokeWidth={1.5 / view.zoom} />
                {point.out && <circle cx={point.out.x} cy={point.out.y} r={2.5 / view.zoom} fill="#2563eb" />}
              </g>)}</>}
              {marquee && <rect {...marquee} fill="#3b82f622" stroke="#3b82f6" strokeWidth={1 / view.zoom} />}
              {box && !textId && <g transform={selectionTransform} className="drawing-selection">
                <rect width={Math.max(1, box.width)} height={Math.max(1, box.height)} fill="none" stroke="#2563eb" strokeWidth={1 / view.zoom} pointerEvents="none" />
                <line x1={box.width / 2} x2={box.width / 2} y1={0} y2={-27 / view.zoom} stroke="#2563eb" strokeWidth={1 / view.zoom} pointerEvents="none" />
                <g data-rotate-handle transform={`translate(${box.width / 2} ${-33 / view.zoom}) scale(${1 / view.zoom})`} role="button" aria-label={uiText('회전')}><circle r={11} fill="white" stroke="#2563eb" /><path d="M-4 2a5 5 0 1 1 7-5M3-6v4h4" fill="none" stroke="#2563eb" strokeWidth={1.5} /></g>
                {HANDLES.map((handle, index) => <rect key={handle} data-resize-handle={handle} x={box.width * HANDLE_POSITIONS[index].x - 4 / view.zoom} y={box.height * HANDLE_POSITIONS[index].y - 4 / view.zoom} width={8 / view.zoom} height={8 / view.zoom} fill="white" stroke="#2563eb" strokeWidth={1 / view.zoom} />)}
              </g>}
            </g>
            <g className="drawing-origin" transform={`translate(${view.x} ${view.y})`} pointerEvents="none"><path d="M-12 0H12M0-12V12" /><circle r={3} /><text x={8} y={-8}>0, 0</text></g>
          </svg>
          {activeText && <div className="drawing-text-frame" style={{ left: activeText.x * view.zoom + view.x, top: activeText.y * view.zoom + view.y, width: activeText.width * view.zoom, height: activeText.height * view.zoom, transform: `rotate(${activeText.rotation}deg)` }}><textarea className="drawing-text-editor" aria-label={uiText('그림 텍스트')} autoFocus value={activeText.text ?? ''} spellCheck={false}
            style={{ left: 0, top: 0, width: Math.max(180, activeText.width / (activeText.textScaleX ?? 1) * view.zoom), minHeight: Math.max(40, activeText.height / (activeText.textScaleY ?? 1) * view.zoom), fontFamily: activeText.fontFamily, fontSize: (activeText.fontSize ?? 24) * view.zoom, fontWeight: activeText.fontWeight, color: activeText.fill === 'none' ? '#1f2937' : activeText.fill, transform: `scale(${activeText.textScaleX ?? 1}, ${activeText.textScaleY ?? 1})`, transformOrigin: '0 0' }}
            onChange={event => {
              const text = event.target.value
              preview({ ...docRef.current, objects: docRef.current.objects.map(object => object.id === textId ? measureText({ ...object, text }) : object) })
            }} onBlur={finishText} onKeyDown={event => { event.stopPropagation(); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() } else if (event.key === 'Escape' || (event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); finishText() } }} /></div>}
          <div className="drawing-toolbar" role="toolbar" aria-label={uiText('그리기 도구')}>
            {iconButton('선택', <CursorPointer />, () => chooseTool('select'), { shortcut: 'V', active: tool === 'select' })}
            {iconButton('이동', <DragHandGesture />, () => chooseTool('hand'), { shortcut: 'H / Space', active: tool === 'hand' })}
            <span className="drawing-toolbar-separator" />
            {iconButton('직사각형', <Square />, () => chooseTool('rect'), { shortcut: 'R', active: tool === 'rect' })}
            {iconButton('타원', <Circle />, () => chooseTool('ellipse'), { shortcut: 'O', active: tool === 'ellipse' })}
            {iconButton('직선', <svg viewBox="0 0 24 24"><path d="M5 19L19 5" /></svg>, () => chooseTool('line'), { shortcut: 'L', active: tool === 'line' })}
            {iconButton('펜', <DesignNib />, () => chooseTool('path'), { shortcut: 'P', active: tool === 'path' })}
            {iconButton('텍스트', <Text />, () => chooseTool('text'), { shortcut: 'T', active: tool === 'text' })}
            <span className="drawing-toolbar-separator" />
            <PaintButtons fill={single?.fill ?? defaults.fill} stroke={single?.stroke ?? defaults.stroke} active={paint} onActive={target => { setPaint(paint === target ? null : target); setPaintCustom(false) }} />
            {paint && !context && <DrawingPaintPopover key={`${paint}-${paintCustom}`} target={paint} value={single?.[paint] ?? defaults[paint]} onChange={changePaint} onClose={() => setPaint(null)} custom={paintCustom} />}
          </div>
          <div className="drawing-bottom-left">{iconButton('실행 취소', <Undo />, () => undo(), { shortcut: '⌘/Ctrl Z', disabled: !history.current.canUndo })}{iconButton('다시 실행', <Redo />, () => undo(true), { shortcut: '⌘/Ctrl ⇧ Z', disabled: !history.current.canRedo })}</div>
          <div className="drawing-bottom-right">
            {iconButton('그리드 설정', <ViewGrid />, () => setPanel(panel === 'grid' ? null : 'grid'), { active: panel === 'grid' })}
            {iconButton('원점으로', <OnePointCircle />, () => setView({ ...view, x: size.width / 2, y: size.height / 2 }), { shortcut: '0' })}
            {iconButton('모두 보기', <Maximize />, () => fit(), { shortcut: '1' })}
            <span className="drawing-toolbar-separator" />
            {iconButton('축소', <Minus />, () => zoomAt(view.zoom / 1.2), { shortcut: '−' })}
            <button type="button" className="drawing-zoom" aria-label={uiText('확대 비율 초기화')} onClick={() => zoomAt(1)}>{Math.round(view.zoom * 100)}%</button>
            {iconButton('확대', <Plus />, () => zoomAt(view.zoom * 1.2), { shortcut: '+' })}
            {iconButton('단축키', <HelpCircle />, () => setPanel(panel === 'shortcuts' ? null : 'shortcuts'), { shortcut: '?' })}
          </div>
          {panel && <DrawingPanel onClose={() => setPanel(null)} type={panel}>
            <div className="drawing-panel-heading"><strong>{uiText(panel === 'grid' ? '그리드 설정' : panel === 'history' ? '그림 기록' : '단축키')}</strong><button type="button" className="drawing-icon" aria-label={uiText('닫기')} onClick={() => setPanel(null)}><Xmark /></button></div>
            {panel === 'grid' && <div className="drawing-grid-settings">
              <label><input type="checkbox" checked={doc.grid.visible} onChange={event => commit({ ...doc, grid: { ...doc.grid, visible: event.target.checked } })} />{uiText('격자 표시')}</label>
              <label><input type="checkbox" checked={doc.grid.snap} onChange={event => commit({ ...doc, grid: { ...doc.grid, snap: event.target.checked } })} />{uiText('격자에 맞추기')}</label>
              <NumberField label={uiText('격자 간격')} value={doc.grid.size} min={2} max={1000} suffix="px" onChange={size => commit({ ...doc, grid: { ...doc.grid, size } })} />
            </div>}
            {panel === 'history' && <div className="drawing-history-list">{recordsLoading ? <p role="status">{uiText('불러오는 중…')}</p> : records.length ? records.map(record => <button key={record.id} type="button" onClick={() => void reopen(record)} disabled={busy}><span>{record.name}</span><time>{new Date(record.createdAt).toLocaleString()}</time></button>) : <p>{uiText('저장한 그림이 없습니다.')}</p>}</div>}
            {panel === 'shortcuts' && <dl className="drawing-shortcuts">{[
              [uiText('선택 / 이동'), 'V / H · Space'], [uiText('직사각형 / 타원 / 직선'), 'R / O / L'], [uiText('텍스트 / 곡선 펜'), 'T / P'], [uiText('곡선 점 / 방향 조절'), uiText('클릭 / 드래그')], [uiText('곡선 완성'), 'Enter · ' + uiText('더블 클릭')], [uiText('다중 선택'), 'Shift + ' + uiText('클릭')], [uiText('비율 유지 / 15° 회전'), 'Shift + ' + uiText('드래그')], [uiText('스냅 일시 해제'), 'Alt'], [uiText('복사 / 잘라내기 / 붙여넣기'), '⌘/Ctrl C / X / V'], [uiText('복제 / 삭제'), '⌘/Ctrl D · Delete'], [uiText('그룹 / 그룹 해제'), '⌘/Ctrl G / ⇧ G'], [uiText('뒤로 / 앞으로'), '⌘/Ctrl [ / ]'], [uiText('맨 뒤로 / 맨 앞으로'), '⌘/Ctrl ⇧ [ / ]'], [uiText('실행 취소 / 다시 실행'), '⌘/Ctrl Z / ⇧ Z'], [uiText('채우기 / 선 팔레트'), 'F / X'], [uiText('색상 / 투명 / 사용자 색상'), '1–8 / 0 / 9'], [uiText('격자 표시 / 스냅'), "' / ⇧ '"], [uiText('원점 / 모두 보기 / 선택 보기'), '0 / 1 / 2'], [uiText('확대 / 축소'), '⌘/Ctrl + ' + uiText('휠') + ' · + / −'], [uiText('이동'), uiText('휠') + ' · Space + ' + uiText('드래그')], [uiText('저장'), '⌘/Ctrl S'],
            ].map(([label, shortcut]) => <div key={label}><dt>{label}</dt><dd>{shortcut}</dd></div>)}</dl>}
          </DrawingPanel>}
          {pen && <button type="button" className="drawing-pen-done" onClick={() => finishPen()}>{uiText('곡선 완성')}</button>}
        </div>
        {context && <ActionMenu x={context.x} y={context.y} onClose={() => { setContext(null); setPaint(null) }} label={uiText('개체 편집')} trigger={svgRef.current}>
          {!!selectedObjects.length && bounds && <><DrawingInspector objects={selectedObjects} bounds={bounds} onPatch={patch} onGeometry={changeGeometry} onFont={family => void font(family)} paint={paint} setPaint={setPaint} /><ActionMenuSeparator /></>}
          <ActionMenuItem icon={<Copy />} disabled={!selected.length} hint="⌘/Ctrl C" onClick={() => copy()}>{uiText('복사')}</ActionMenuItem>
          <ActionMenuItem icon={<Copy />} hint="⌘/Ctrl V" onClick={() => void paste()}>{uiText('붙여넣기')}</ActionMenuItem>
          <ActionMenuItem icon={<Copy />} disabled={!selected.length} hint="⌘/Ctrl D" onClick={() => duplicate()}>{uiText('복제')}</ActionMenuItem>
          <ActionMenuSeparator />
          <ActionMenuItem icon={<Group />} disabled={selected.length < 2} hint="⌘/Ctrl G" onClick={() => group()}>{uiText('그룹')}</ActionMenuItem>
          <ActionMenuItem icon={<Group />} disabled={!selectedObjects.some(object => object.groupId)} hint="⌘/Ctrl ⇧ G" onClick={() => group(true)}>{uiText('그룹 해제')}</ActionMenuItem>
          <ActionMenuSeparator />
          <ActionMenuItem icon={<ArrowUp />} disabled={!selected.length} hint="⌘/Ctrl ]" onClick={() => layer('forward')}>{uiText('앞으로')}</ActionMenuItem>
          <ActionMenuItem icon={<ArrowDown />} disabled={!selected.length} hint="⌘/Ctrl [" onClick={() => layer('backward')}>{uiText('뒤로')}</ActionMenuItem>
          <ActionMenuItem icon={<ArrowUp />} disabled={!selected.length} onClick={() => layer('front')}>{uiText('맨 앞으로')}</ActionMenuItem>
          <ActionMenuItem icon={<ArrowDown />} disabled={!selected.length} onClick={() => layer('back')}>{uiText('맨 뒤로')}</ActionMenuItem>
          <ActionMenuSeparator />
          <ActionMenuItem icon={<Trash />} danger disabled={!selected.length} hint="Delete" onClick={remove}>{uiText('삭제')}</ActionMenuItem>
        </ActionMenu>}
      </div>
    </HoverTipLayer>
    {confirmClose && <DialogFrame labelledBy={`${titleId}-discard`} onClose={() => setConfirmClose(false)} className="max-w-sm">
      <div className="drawing-discard"><h3 id={`${titleId}-discard`}>{uiText('저장하지 않은 그림을 닫을까요?')}</h3><div><button type="button" onClick={() => setConfirmClose(false)}>{uiText('계속 편집')}</button><button type="button" onClick={onClose}>{uiText('닫기')}</button></div></div>
    </DialogFrame>}
  </DialogFrame>
}

function DrawingPanel({ children, onClose, type }: { children: ReactNode; onClose: () => void; type: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlayDismiss(onClose, { outside: () => ref.current })
  return <div ref={ref} className={`drawing-panel drawing-panel-${type} mew-overlay-surface bg-surface`} data-drawing-panel>{children}</div>
}
