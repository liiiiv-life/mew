export type DrawingObjectType = 'rect' | 'ellipse' | 'line' | 'path' | 'text' | 'image'
export interface Point { x: number; y: number }
export interface DrawingPoint extends Point { in?: Point; out?: Point }
export interface Bounds extends Point { width: number; height: number }
export interface DrawingObject extends Bounds {
  id: string
  type: DrawingObjectType
  rotation: number
  fill: string
  stroke: string
  strokeWidth: number
  groupId?: string
  text?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  textScaleX?: number
  textScaleY?: number
  src?: string
  points?: DrawingPoint[]
  closed?: boolean
}
export interface DrawingGrid { size: number; visible: boolean; snap: boolean }
export interface DrawingDocument { version: 1; objects: DrawingObject[]; grid: DrawingGrid }
export interface DrawingViewport extends Point { zoom: number }
export type Viewport = DrawingViewport
export type SelectionIds = readonly string[] | ReadonlySet<string>
export type LayerAction = 'forward' | 'backward' | 'front' | 'back'

export const DRAWING_PALETTE = ['#1f2937', '#ffffff', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7'] as const
export const DRAWING_MIME = 'application/x-mew-drawing+json'

function number(value: unknown, fallback: number, min = -10_000_000, max = 10_000_000): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export function drawingId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `drawing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function createObject(type: DrawingObjectType, overrides: Partial<DrawingObject> = {}): DrawingObject {
  return {
    id: drawingId(), type, x: 0, y: 0, width: 120, height: type === 'line' ? 0 : 80,
    rotation: 0, fill: type === 'line' || type === 'path' ? 'none' : type === 'text' ? '#1f2937' : '#dbeafe',
    stroke: type === 'text' || type === 'image' ? 'none' : '#3b82f6', strokeWidth: 2,
    ...(type === 'text' ? { text: '', fontFamily: 'Inter', fontSize: 24, fontWeight: 400, textScaleX: 1, textScaleY: 1 } : {}),
    ...overrides,
  }
}

export function createDocument(): DrawingDocument {
  return { version: 1, objects: [], grid: { size: 20, visible: true, snap: true } }
}

export function cloneObject(object: DrawingObject): DrawingObject {
  return { ...object, ...(object.points ? { points: object.points.map(p => ({ ...p, ...(p.in ? { in: { ...p.in } } : {}), ...(p.out ? { out: { ...p.out } } : {}) })) } : {}) }
}

export function cloneDocument(document: DrawingDocument): DrawingDocument {
  return { version: 1, grid: { ...document.grid }, objects: document.objects.map(cloneObject) }
}

function paint(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length > 100) return fallback
  return /^(?:none|transparent|#[\da-f]{3,8}|[a-z]+|(?:rgba?|hsla?|oklch|oklab)\([\d\s.,%+\-/a-z]+\))$/i.test(value) ? value : fallback
}

/** Embedded raster images keep saved drawings portable and safe to render. */
export function isEmbeddedImage(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/(?:png|jpe?g|webp|gif|avif);base64,[a-z\d+/=\s]+$/i.test(value)
}

export function normalizeDocument(value: unknown): DrawingDocument | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.version !== 1 || !Array.isArray(raw.objects) || raw.objects.length > 5000) return null
  const seen = new Set<string>()
  const objects: DrawingObject[] = []
  for (const entry of raw.objects) {
    if (!entry || typeof entry !== 'object') return null
    const item = entry as Record<string, unknown>
    if (!['rect', 'ellipse', 'line', 'path', 'text', 'image'].includes(String(item.type))) return null
    const id = typeof item.id === 'string' && item.id.length <= 200 && !seen.has(item.id) ? item.id : drawingId()
    seen.add(id)
    const object = createObject(item.type as DrawingObjectType, {
      id, x: number(item.x, 0), y: number(item.y, 0), width: number(item.width, 1, 0, 1_000_000), height: number(item.height, 1, 0, 1_000_000),
      rotation: number(item.rotation, 0) % 360, fill: paint(item.fill, 'none'), stroke: paint(item.stroke, 'none'), strokeWidth: number(item.strokeWidth, 2, 0, 1000),
    })
    if (typeof item.groupId === 'string' && item.groupId.length <= 200) object.groupId = item.groupId
    if (object.type === 'text') {
      object.text = typeof item.text === 'string' ? item.text.slice(0, 100_000) : ''
      object.fontFamily = typeof item.fontFamily === 'string' ? item.fontFamily.slice(0, 200) : 'Inter'
      object.fontSize = number(item.fontSize, 24, 1, 2000)
      object.fontWeight = number(item.fontWeight, 400, 100, 900)
      object.textScaleX = number(item.textScaleX, 1, .01, 1000)
      object.textScaleY = number(item.textScaleY, 1, .01, 1000)
    }
    if (object.type === 'image') {
      if (!isEmbeddedImage(item.src)) return null
      object.src = item.src
    }
    if (Array.isArray(item.points)) {
      if (item.points.length > 10_000) return null
      object.points = item.points.map((value): DrawingPoint => {
        const point = value && typeof value === 'object' ? value as Record<string, unknown> : {}
        const result: DrawingPoint = { x: number(point.x, 0), y: number(point.y, 0) }
        for (const key of ['in', 'out'] as const) {
          if (point[key] && typeof point[key] === 'object') {
            const handle = point[key] as Record<string, unknown>
            result[key] = { x: number(handle.x, 0), y: number(handle.y, 0) }
          }
        }
        return result
      })
    }
    if (item.closed === true) object.closed = true
    objects.push(object)
  }
  const grid = raw.grid && typeof raw.grid === 'object' ? raw.grid as Record<string, unknown> : {}
  return { version: 1, objects, grid: { size: number(grid.size, 20, 2, 1000), visible: grid.visible !== false, snap: grid.snap !== false } }
}

export function selectionSet(ids: SelectionIds): ReadonlySet<string> { return ids instanceof Set ? ids : new Set(ids) }

export function expandSelection(objects: readonly DrawingObject[], ids: SelectionIds): string[] {
  const selected = selectionSet(ids)
  const groups = new Set(objects.filter(object => selected.has(object.id) && object.groupId).map(object => object.groupId))
  return objects.filter(object => selected.has(object.id) || (object.groupId && groups.has(object.groupId))).map(object => object.id)
}

/** Groups move as stable blocks, retaining the relative order of selected objects. */
export function reorderObjects(objects: readonly DrawingObject[], ids: SelectionIds, action: LayerAction): DrawingObject[] {
  const selected = new Set(expandSelection(objects, ids))
  if (!selected.size) return [...objects]
  const blocks: DrawingObject[][] = []
  const grouped = new Map<string, DrawingObject[]>()
  for (const object of objects) {
    if (object.groupId) {
      let block = grouped.get(object.groupId)
      if (!block) { block = []; grouped.set(object.groupId, block); blocks.push(block) }
      block.push(object)
    } else blocks.push([object])
  }
  const isSelected = (block: DrawingObject[]) => block.some(object => selected.has(object.id))
  if (action === 'front' || action === 'back') {
    const picked = blocks.filter(isSelected)
    const rest = blocks.filter(block => !isSelected(block))
    return (action === 'front' ? [...rest, ...picked] : [...picked, ...rest]).flat()
  }
  if (action === 'forward') {
    for (let index = blocks.length - 2; index >= 0; index--) {
      if (isSelected(blocks[index]) && !isSelected(blocks[index + 1])) [blocks[index], blocks[index + 1]] = [blocks[index + 1], blocks[index]]
    }
  } else {
    for (let index = 1; index < blocks.length; index++) {
      if (isSelected(blocks[index]) && !isSelected(blocks[index - 1])) [blocks[index], blocks[index - 1]] = [blocks[index - 1], blocks[index]]
    }
  }
  return blocks.flat()
}

function sameDocument(a: DrawingDocument, b: DrawingDocument): boolean {
  if (a.objects.length !== b.objects.length || a.grid.size !== b.grid.size || a.grid.visible !== b.grid.visible || a.grid.snap !== b.grid.snap) return false
  for (let index = 0; index < a.objects.length; index++) {
    const left = a.objects[index], right = b.objects[index]
    for (const key of ['id', 'type', 'x', 'y', 'width', 'height', 'rotation', 'fill', 'stroke', 'strokeWidth', 'groupId', 'text', 'fontFamily', 'fontSize', 'fontWeight', 'textScaleX', 'textScaleY', 'src', 'closed'] as const) {
      if (left[key] !== right[key]) return false
    }
    if (left.points?.length !== right.points?.length) return false
    if (left.points && right.points) {
      for (let pointIndex = 0; pointIndex < left.points.length; pointIndex++) {
        const l = left.points[pointIndex], r = right.points[pointIndex]
        if (l.x !== r.x || l.y !== r.y || l.in?.x !== r.in?.x || l.in?.y !== r.in?.y || l.out?.x !== r.out?.x || l.out?.y !== r.out?.y) return false
      }
    }
  }
  return true
}

export class DrawingHistory {
  private states: DrawingDocument[]
  private cursor = 0
  private limit: number
  constructor(initial = createDocument(), limit = 80) { this.states = [cloneDocument(initial)]; this.limit = Math.max(2, limit) }
  get current(): DrawingDocument { return cloneDocument(this.states[this.cursor]) }
  get canUndo(): boolean { return this.cursor > 0 }
  get canRedo(): boolean { return this.cursor < this.states.length - 1 }
  commit(document: DrawingDocument): DrawingDocument {
    if (sameDocument(this.states[this.cursor], document)) return this.current
    this.states = this.states.slice(0, this.cursor + 1)
    this.states.push(cloneDocument(document))
    if (this.states.length > this.limit) this.states.shift()
    this.cursor = this.states.length - 1
    return this.current
  }
  undo(): DrawingDocument { if (this.canUndo) this.cursor--; return this.current }
  redo(): DrawingDocument { if (this.canRedo) this.cursor++; return this.current }
  reset(document = createDocument()): DrawingDocument { this.states = [cloneDocument(document)]; this.cursor = 0; return this.current }
}
