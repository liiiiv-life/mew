import type { DocumentGraphData } from '../../shared/document-graph'

type Camera = { x: number; y: number; scale: number }
type Drag = { id: number; startX: number; startY: number; lastX: number; lastY: number; node: number; moved: boolean }

/** Canvas scene: a single draw per animation frame, spatial picking, no React node tree. */
export class DocumentGraphCanvas {
  private context: CanvasRenderingContext2D
  private positions: Float32Array = new Float32Array()
  private camera: Camera = { x: 0, y: 0, scale: 1 }
  private width = 1
  private height = 1
  private frame = 0
  private selected = -1
  private hover = -1
  private neighbors: Set<number>[]
  private degree: Uint32Array
  private labelOrder: number[]
  private grid = new Map<string, number[]>()
  private drag: Drag | null = null
  private touches = new Map<number, [number, number]>()
  private pinchDistance = 0
  private interacted = false
  private resize: ResizeObserver
  private theme: MutationObserver
  private controller = new AbortController()
  private colors = { ink: '', muted: '', edge: '', accent: '' }

  private canvas: HTMLCanvasElement
  private graph: DocumentGraphData
  private worker: Worker
  private onSelect: (index: number) => void

  constructor(canvas: HTMLCanvasElement, graph: DocumentGraphData, worker: Worker,
    onSelect: (index: number) => void, onOpen: (index: number) => void) {
    this.canvas = canvas; this.graph = graph; this.worker = worker; this.onSelect = onSelect
    this.context = canvas.getContext('2d')!
    this.degree = new Uint32Array(graph.nodes.length)
    this.neighbors = graph.nodes.map(() => new Set<number>())
    for (const [a, b] of graph.edges) { this.neighbors[a].add(b); this.neighbors[b].add(a); this.degree[a]++; this.degree[b]++ }
    this.labelOrder = graph.nodes.map((_, i) => i).sort((a, b) => this.degree[b] - this.degree[a])
    this.resize = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2)
      this.width = rect.width; this.height = rect.height
      canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio)
      this.requestDraw()
    })
    this.resize.observe(canvas)
    const readColors = () => {
      const style = getComputedStyle(canvas)
      this.colors = { ink: style.getPropertyValue('--color-ink').trim() || '#ddd', muted: style.getPropertyValue('--color-ink-secondary').trim() || '#999', edge: style.getPropertyValue('--color-edge-strong').trim() || '#888', accent: style.getPropertyValue('--color-accent').trim() || '#72cbb0' }
      this.requestDraw()
    }
    readColors()
    this.theme = new MutationObserver(readColors)
    this.theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    const options = { signal: this.controller.signal }
    canvas.addEventListener('pointerdown', event => this.down(event), options)
    canvas.addEventListener('pointermove', event => this.move(event), options)
    canvas.addEventListener('pointerup', event => this.up(event), options)
    canvas.addEventListener('pointercancel', event => this.up(event, true), options)
    canvas.addEventListener('lostpointercapture', event => this.up(event, true), options)
    canvas.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = -1; this.requestDraw() } }, options)
    canvas.addEventListener('dblclick', event => { const point = this.point(event); const index = this.pick(...point); if (index >= 0) onOpen(index) }, options)
    canvas.addEventListener('wheel', event => { event.preventDefault(); this.zoom(Math.exp(-event.deltaY * 0.001), ...this.point(event)) }, { ...options, passive: false })
    canvas.addEventListener('keydown', event => {
      if (['+', '=', '-'].includes(event.key)) this.zoom(event.key === '-' ? 0.8 : 1.25)
      else if (event.key === 'Home') this.fit()
      else if (event.key === 'Enter' && this.selected >= 0) onOpen(this.selected)
      else if (event.key.startsWith('Arrow')) { this.camera.x += event.key === 'ArrowLeft' ? -40 / this.camera.scale : event.key === 'ArrowRight' ? 40 / this.camera.scale : 0; this.camera.y += event.key === 'ArrowUp' ? -40 / this.camera.scale : event.key === 'ArrowDown' ? 40 / this.camera.scale : 0; this.interacted = true; this.requestDraw() }
      else return
      event.preventDefault()
    }, options)
  }

  update(positions: Float32Array, settled: boolean): void {
    this.positions = positions
    this.grid.clear()
    for (let i = 0; i < positions.length; i += 2) {
      const key = `${Math.floor(positions[i] / 80)},${Math.floor(positions[i + 1] / 80)}`
      const bucket = this.grid.get(key) ?? []
      bucket.push(i / 2); this.grid.set(key, bucket)
    }
    if (!this.interacted && (this.camera.scale === 1 || settled)) this.fit(false)
    this.requestDraw()
  }

  select(index: number): void {
    this.selected = index; this.onSelect(index); this.requestDraw()
  }

  focus(index: number): void {
    this.select(index)
    this.camera.x = this.positions[index * 2] ?? 0; this.camera.y = this.positions[index * 2 + 1] ?? 0
    this.camera.scale = Math.max(this.camera.scale, 1)
    this.interacted = true; this.requestDraw()
  }

  fit(manual = true): void {
    if (!this.positions.length) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < this.positions.length; i += 2) { minX = Math.min(minX, this.positions[i]); maxX = Math.max(maxX, this.positions[i]); minY = Math.min(minY, this.positions[i + 1]); maxY = Math.max(maxY, this.positions[i + 1]) }
    this.camera = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, scale: Math.min(2, Math.max(0.025, Math.min((this.width - 80) / Math.max(maxX - minX, 80), (this.height - 80) / Math.max(maxY - minY, 80)))) }
    if (manual) this.interacted = true
    this.requestDraw()
  }

  zoom(factor: number, x = this.width / 2, y = this.height / 2): void {
    const [wx, wy] = this.world(x, y), scale = Math.max(0.025, Math.min(8, this.camera.scale * factor))
    this.camera = { x: wx - (x - this.width / 2) / scale, y: wy - (y - this.height / 2) / scale, scale }
    this.interacted = true; this.requestDraw()
  }

  private point(event: MouseEvent | PointerEvent): [number, number] { const rect = this.canvas.getBoundingClientRect(); return [event.clientX - rect.left, event.clientY - rect.top] }
  private world(x: number, y: number): [number, number] { return [(x - this.width / 2) / this.camera.scale + this.camera.x, (y - this.height / 2) / this.camera.scale + this.camera.y] }
  private pick(x: number, y: number): number {
    const [wx, wy] = this.world(x, y), radius = 12 / this.camera.scale
    let best = -1, distance = radius * radius
    for (let gx = Math.floor((wx - radius) / 80); gx <= Math.floor((wx + radius) / 80); gx++) for (let gy = Math.floor((wy - radius) / 80); gy <= Math.floor((wy + radius) / 80); gy++) {
      for (const i of this.grid.get(`${gx},${gy}`) ?? []) { const dx = wx - this.positions[i * 2], dy = wy - this.positions[i * 2 + 1], next = dx * dx + dy * dy; if (next < distance) { best = i; distance = next } }
    }
    return best
  }

  private down(event: PointerEvent): void {
    if (event.button !== 0) return
    this.canvas.focus(); this.canvas.setPointerCapture(event.pointerId)
    const [x, y] = this.point(event)
    this.touches.set(event.pointerId, [x, y])
    if (this.touches.size === 2) {
      if (this.drag?.moved && this.drag.node >= 0) this.worker.postMessage({ type: 'pin', index: this.drag.node, point: null })
      this.drag = null
      const points = [...this.touches.values()]; this.pinchDistance = Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]); return
    }
    this.drag = { id: event.pointerId, startX: x, startY: y, lastX: x, lastY: y, node: this.pick(x, y), moved: false }
  }

  private move(event: PointerEvent): void {
    const [x, y] = this.point(event)
    if (this.touches.has(event.pointerId)) this.touches.set(event.pointerId, [x, y])
    if (this.touches.size >= 2) {
      const [a, b] = [...this.touches.values()], distance = Math.hypot(a[0] - b[0], a[1] - b[1])
      if (this.pinchDistance > 0) this.zoom(distance / this.pinchDistance, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
      this.pinchDistance = distance; return
    }
    const drag = this.drag
    if (!drag) { const hover = this.pick(x, y); if (hover !== this.hover) { this.hover = hover; this.canvas.style.cursor = hover >= 0 ? 'pointer' : 'grab'; this.requestDraw() }; return }
    if (drag.id !== event.pointerId) return
    if (Math.hypot(x - drag.startX, y - drag.startY) > 4) drag.moved = true
    if (drag.moved) {
      this.interacted = true
      if (drag.node >= 0) this.worker.postMessage({ type: 'pin', index: drag.node, point: this.world(x, y) })
      else { this.camera.x -= (x - drag.lastX) / this.camera.scale; this.camera.y -= (y - drag.lastY) / this.camera.scale }
      this.requestDraw()
    }
    drag.lastX = x; drag.lastY = y
  }

  private up(event: PointerEvent, cancelled = false): void {
    this.touches.delete(event.pointerId); this.pinchDistance = 0
    const drag = this.drag
    if (!drag || drag.id !== event.pointerId) return
    if (drag.node >= 0) { if (drag.moved) this.worker.postMessage({ type: 'pin', index: drag.node, point: null }); if (!drag.moved && !cancelled) this.select(drag.node) }
    else if (!drag.moved && !cancelled) this.select(-1)
    this.drag = null
  }

  private requestDraw(): void { if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw() }) }
  private draw(): void {
    const ctx = this.context, { scale, x, y } = this.camera, pos = this.positions
    const ratio = this.canvas.width / this.width
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, this.width, this.height)
    if (!pos.length) return
    const sx = (i: number) => (pos[i * 2] - x) * scale + this.width / 2
    const sy = (i: number) => (pos[i * 2 + 1] - y) * scale + this.height / 2
    const active = this.hover >= 0 ? this.hover : this.selected
    const near = active >= 0 ? this.neighbors[active] : null
    for (const highlighted of [false, true]) {
      ctx.beginPath(); ctx.strokeStyle = highlighted ? this.colors.accent : this.colors.edge; ctx.globalAlpha = highlighted ? 0.85 : active >= 0 ? 0.12 : 0.4; ctx.lineWidth = highlighted ? 1.4 : 0.6
      for (const [a, b] of this.graph.edges) {
        if (((a === active || b === active) && active >= 0) !== highlighted) continue
        const ax = sx(a), ay = sy(a), bx = sx(b), by = sy(b)
        if ((ax < -20 && bx < -20) || (ax > this.width + 20 && bx > this.width + 20) || (ay < -20 && by < -20) || (ay > this.height + 20 && by > this.height + 20)) continue
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by)
      }
      ctx.stroke()
    }
    for (let i = 0; i < this.graph.nodes.length; i++) {
      const px = sx(i), py = sy(i)
      if (px < -20 || py < -20 || px > this.width + 20 || py > this.height + 20) continue
      const connected = i === active || near?.has(i)
      ctx.globalAlpha = active >= 0 && !connected ? 0.3 : 1; ctx.fillStyle = connected ? this.colors.accent : this.colors.muted
      ctx.beginPath(); ctx.arc(px, py, Math.max(2.4, Math.min(8, (3 + Math.sqrt(this.degree[i])) * Math.sqrt(scale))), 0, Math.PI * 2); ctx.fill()
    }
    ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    const labels = active >= 0 ? [active, ...near!] : this.labelOrder
    const boxes: [number, number, number][] = []
    for (const i of labels) {
      if (boxes.length >= 65 || (active < 0 && scale < 0.35 && this.degree[i] < 3)) break
      const px = sx(i), py = sy(i) + 10
      if (px < 10 || py < 10 || px > this.width - 10 || py > this.height - 25) continue
      const title = this.graph.nodes[i].title, label = title.length > 34 ? title.slice(0, 33) + '…' : title, half = ctx.measureText(label).width / 2 + 4
      if (boxes.some(([bx, by, bw]) => Math.abs(by - py) < 16 && Math.abs(bx - px) < bw + half)) continue
      boxes.push([px, py, half]); ctx.globalAlpha = 1; ctx.fillStyle = i === active ? this.colors.accent : this.colors.ink; ctx.fillText(label, px, py)
    }
    ctx.globalAlpha = 1
  }

  destroy(): void { this.controller.abort(); this.resize.disconnect(); this.theme.disconnect(); cancelAnimationFrame(this.frame) }
}
