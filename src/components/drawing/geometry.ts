import { selectionSet } from './model.ts'
import type { Bounds, DrawingObject, DrawingPoint, DrawingViewport, Point, SelectionIds } from './model.ts'

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export interface ResizeOptions { snap?: number; preserveAspect?: boolean; fromCenter?: boolean }
const radians = (degrees: number) => degrees * Math.PI / 180
export const objectCenter = (object: Bounds): Point => ({ x: object.x + object.width / 2, y: object.y + object.height / 2 })
export const screenToWorld = (point: Point, viewport: DrawingViewport): Point => ({ x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom })
export const worldToScreen = (point: Point, viewport: DrawingViewport): Point => ({ x: point.x * viewport.zoom + viewport.x, y: point.y * viewport.zoom + viewport.y })
export const snapPoint = (point: Point, size: number): Point => size > 0 ? ({ x: Math.round(point.x / size) * size, y: Math.round(point.y / size) * size }) : { ...point }

export function rotatePoint(point: Point, center: Point, degrees: number): Point {
  const cos = Math.cos(radians(degrees)), sin = Math.sin(radians(degrees))
  const x = point.x - center.x, y = point.y - center.y
  return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos }
}

export function objectLocalToWorld(object: DrawingObject, point: Point): Point {
  return rotatePoint({ x: object.x + point.x, y: object.y + point.y }, objectCenter(object), object.rotation)
}

export function objectWorldToLocal(object: DrawingObject, point: Point): Point {
  const unrotated = rotatePoint(point, objectCenter(object), -object.rotation)
  return { x: unrotated.x - object.x, y: unrotated.y - object.y }
}

export function boundsFromPoints(points: readonly Point[]): Bounds {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 }
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity
  for (const point of points) { x = Math.min(x, point.x); y = Math.min(y, point.y); right = Math.max(right, point.x); bottom = Math.max(bottom, point.y) }
  return { x, y, width: right - x, height: bottom - y }
}

function cubicValue(a: number, b: number, c: number, d: number, t: number): number {
  const s = 1 - t
  return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d
}

function extrema(a: number, b: number, c: number, d: number): number[] {
  const qa = -a + 3 * b - 3 * c + d, qb = 2 * (a - 2 * b + c), qc = b - a
  if (Math.abs(qa) < 1e-12) return Math.abs(qb) < 1e-12 ? [] : [-qc / qb].filter(t => t > 0 && t < 1)
  const discriminant = qb * qb - 4 * qa * qc
  if (discriminant < 0) return []
  const root = Math.sqrt(discriminant)
  return [(-qb + root) / (2 * qa), (-qb - root) / (2 * qa)].filter(t => t > 0 && t < 1)
}

function pathSegments(object: DrawingObject): [Point, Point, Point, Point][] {
  const points = object.points?.length ? object.points : [{ x: 0, y: 0 }, { x: object.width, y: object.height }]
  const segments: [Point, Point, Point, Point][] = []
  const count = points.length - 1 + (object.closed && points.length > 1 ? 1 : 0)
  for (let index = 0; index < count; index++) {
    const a = points[index % points.length], b = points[(index + 1) % points.length]
    segments.push([a, a.out ?? a, b.in ?? b, b].map(point => objectLocalToWorld(object, point)) as [Point, Point, Point, Point])
  }
  return segments
}

export function objectBounds(object: DrawingObject): Bounds {
  const center = objectCenter(object)
  if (object.type === 'ellipse') {
    const cos = Math.cos(radians(object.rotation)), sin = Math.sin(radians(object.rotation))
    const rx = Math.hypot(object.width / 2 * cos, object.height / 2 * sin)
    const ry = Math.hypot(object.width / 2 * sin, object.height / 2 * cos)
    return { x: center.x - rx, y: center.y - ry, width: rx * 2, height: ry * 2 }
  }
  if (object.type === 'path' || object.type === 'line') {
    const points: Point[] = []
    for (const [a, b, c, d] of pathSegments(object)) {
      points.push(a, d)
      for (const t of [...extrema(a.x, b.x, c.x, d.x), ...extrema(a.y, b.y, c.y, d.y)]) points.push({ x: cubicValue(a.x, b.x, c.x, d.x, t), y: cubicValue(a.y, b.y, c.y, d.y, t) })
    }
    return points.length ? boundsFromPoints(points) : boundsFromPoints([objectLocalToWorld(object, object.points?.[0] ?? { x: 0, y: 0 })])
  }
  return boundsFromPoints([{ x: 0, y: 0 }, { x: object.width, y: 0 }, { x: object.width, y: object.height }, { x: 0, y: object.height }].map(point => objectLocalToWorld(object, point)))
}

export function selectionBounds(objects: readonly DrawingObject[], ids?: SelectionIds): Bounds | null {
  const selected = ids ? selectionSet(ids) : null
  const points: Point[] = []
  for (const object of objects) {
    if (selected && !selected.has(object.id)) continue
    const bounds = objectBounds(object)
    points.push(bounds, { x: bounds.x + bounds.width, y: bounds.y + bounds.height })
  }
  return points.length ? boundsFromPoints(points) : null
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
}

export function translateSelection(objects: readonly DrawingObject[], ids: SelectionIds, delta: number | Point, dy = 0): DrawingObject[] {
  const selected = selectionSet(ids)
  const dx = typeof delta === 'number' ? delta : delta.x
  if (typeof delta !== 'number') dy = delta.y
  return objects.map(object => selected.has(object.id) ? { ...object, x: object.x + dx, y: object.y + dy } : object)
}

function scaledPoints(points: DrawingPoint[] | undefined, sx: number, sy: number): DrawingPoint[] | undefined {
  const scale = (p: Point): Point => ({ x: p.x * sx, y: p.y * sy })
  return points?.map(p => ({ ...scale(p), ...(p.in ? { in: scale(p.in) } : {}), ...(p.out ? { out: scale(p.out) } : {}) }))
}

export function resizeObject(object: DrawingObject, width: number, height: number, center = objectCenter(object)): DrawingObject {
  const sx = object.width > 0 ? width / object.width : 1, sy = object.height > 0 ? height / object.height : 1
  let points = scaledPoints(object.points, sx, sy)
  if (object.type === 'line' && points?.length === 2) {
    points = points.map((point, index) => ({ ...point, ...(object.width === 0 ? { x: index * width } : {}), ...(object.height === 0 ? { y: index * height } : {}) }))
  }
  return { ...object, x: center.x - width / 2, y: center.y - height / 2, width, height,
    ...(points ? { points } : {}),
    ...(object.type === 'text' ? { textScaleX: (object.textScaleX ?? 1) * sx, textScaleY: (object.textScaleY ?? 1) * sy } : {}),
  }
}

/** Rebase pen nodes into their geometry bounds without changing their world positions. */
export function normalizePathObject(object: DrawingObject): DrawingObject {
  if ((object.type !== 'path' && object.type !== 'line') || !object.points?.length) return object
  const localBounds = objectBounds({ ...object, x: 0, y: 0, rotation: 0 })
  const center = objectLocalToWorld(object, objectCenter(localBounds))
  const shift = (point: Point): Point => ({ x: point.x - localBounds.x, y: point.y - localBounds.y })
  const points = object.points.map(point => ({ ...shift(point), ...(point.in ? { in: shift(point.in) } : {}), ...(point.out ? { out: shift(point.out) } : {}) }))
  return { ...object, x: center.x - localBounds.width / 2, y: center.y - localBounds.height / 2, width: localBounds.width, height: localBounds.height, points }
}

export function resizeSelection(objects: readonly DrawingObject[], ids: SelectionIds, source: Bounds, target: Bounds): DrawingObject[] {
  const selected = selectionSet(ids)
  const only = objects.find(object => selected.has(object.id))
  if (selected.size === 1 && only && source.x === only.x && source.y === only.y && source.width === only.width && source.height === only.height) {
    return objects.map(object => object.id === only.id ? resizeObject(object, target.width, target.height, objectCenter(target)) : object)
  }
  const sx = source.width > 0.0001 ? target.width / source.width : 1
  const sy = source.height > 0.0001 ? target.height / source.height : 1
  return objects.map(object => {
    if (!selected.has(object.id)) return object
    const center = objectCenter(object)
    const nextCenter = { x: target.x + (center.x - source.x) * sx, y: target.y + (center.y - source.y) * sy }
    const cos = Math.cos(radians(object.rotation)), sin = Math.sin(radians(object.rotation))
    const localSx = Math.hypot(sx * cos, sy * sin), localSy = Math.hypot(sx * sin, sy * cos)
    const width = object.width * localSx, height = object.height * localSy
    return { ...object, x: nextCenter.x - width / 2, y: nextCenter.y - height / 2, width, height,
      rotation: Math.atan2(sy * sin, sx * cos) * 180 / Math.PI,
      ...(object.points ? { points: scaledPoints(object.points, localSx, localSy) } : {}),
      ...(object.type === 'text' ? { textScaleX: (object.textScaleX ?? 1) * localSx, textScaleY: (object.textScaleY ?? 1) * localSy } : {}),
    }
  })
}

export function rotateSelection(objects: readonly DrawingObject[], ids: SelectionIds, degrees: number, origin?: Point): DrawingObject[] {
  const selected = selectionSet(ids)
  const bounds = selectionBounds(objects, ids)
  if (!bounds) return [...objects]
  const pivot = origin ?? objectCenter(bounds)
  return objects.map(object => {
    if (!selected.has(object.id)) return object
    const center = rotatePoint(objectCenter(object), pivot, degrees)
    return { ...object, x: center.x - object.width / 2, y: center.y - object.height / 2, rotation: (object.rotation + degrees) % 360 }
  })
}

/** Resize in an object's rotated frame while keeping the opposite handle fixed. */
export function resizeObjectFromHandle(object: DrawingObject, handle: ResizeHandle, pointer: Point, options: ResizeOptions = {}): DrawingObject {
  const target = options.snap ? snapPoint(pointer, options.snap) : pointer
  const local = objectWorldToLocal(object, target)
  const west = handle.includes('w'), east = handle.includes('e'), north = handle.includes('n'), south = handle.includes('s')
  const cx = object.width / 2, cy = object.height / 2
  let left = 0, top = 0, right = object.width, bottom = object.height
  if (west) left = Math.min(local.x, right - 0.5)
  if (east) right = Math.max(local.x, left + 0.5)
  if (north) top = Math.min(local.y, bottom - 0.5)
  if (south) bottom = Math.max(local.y, top + 0.5)
  if (options.fromCenter) {
    if (west || east) { const half = Math.max(0.25, Math.abs(local.x - cx)); left = cx - half; right = cx + half }
    if (north || south) { const half = Math.max(0.25, Math.abs(local.y - cy)); top = cy - half; bottom = cy + half }
  }
  if (options.preserveAspect && object.width > 0 && object.height > 0) {
    let width = right - left, height = bottom - top
    const scale = west || east ? (north || south ? Math.max(width / object.width, height / object.height) : width / object.width) : height / object.height
    width = object.width * scale; height = object.height * scale
    if (options.fromCenter || (!west && !east)) { left = cx - width / 2; right = cx + width / 2 }
    else if (west) left = right - width
    else right = left + width
    if (options.fromCenter || (!north && !south)) { top = cy - height / 2; bottom = cy + height / 2 }
    else if (north) top = bottom - height
    else bottom = top + height
  }
  const width = right - left, height = bottom - top
  const center = objectLocalToWorld(object, { x: left + width / 2, y: top + height / 2 })
  return resizeObject(object, width, height, center)
}

export function pathData(points: readonly DrawingPoint[], closed = false): string {
  if (!points.length) return ''
  const n = (value: number) => Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0'
  let path = `M ${n(points[0].x)} ${n(points[0].y)}`
  const count = points.length - 1 + (closed && points.length > 1 ? 1 : 0)
  for (let index = 0; index < count; index++) {
    const a = points[index % points.length], b = points[(index + 1) % points.length]
    if (a.out || b.in) { const c1 = a.out ?? a, c2 = b.in ?? b; path += ` C ${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(b.x)} ${n(b.y)}` }
    else path += ` L ${n(b.x)} ${n(b.y)}`
  }
  return path + (closed ? ' Z' : '')
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}

export function hitTestObject(object: DrawingObject, point: Point, tolerance = 5): boolean {
  const local = objectWorldToLocal(object, point)
  const pad = tolerance + object.strokeWidth / 2
  const filled = object.fill !== 'none' && object.fill !== 'transparent'
  if (object.type === 'path' || object.type === 'line') {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
    const include = (p: Point) => { left = Math.min(left, p.x); top = Math.min(top, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y) }
    if (object.points?.length) {
      for (const node of object.points) { include(node); if (node.in) include(node.in); if (node.out) include(node.out) }
    } else { include({ x: 0, y: 0 }); include({ x: object.width, y: object.height }) }
    // Every Bézier segment stays inside its control hull, including before pen rebasing.
    if (local.x < left - pad || local.x > right + pad || local.y < top - pad || local.y > bottom + pad) return false
    const polygon: Point[] = []
    for (const [a, b, c, d] of pathSegments(object)) {
      let previous = a
      polygon.push(a)
      for (let step = 1; step <= 32; step++) {
        const t = step / 32
        const current = { x: cubicValue(a.x, b.x, c.x, d.x, t), y: cubicValue(a.y, b.y, c.y, d.y, t) }
        if (distanceToSegment(point, previous, current) <= pad) return true
        polygon.push(current); previous = current
      }
    }
    if (object.closed && filled) {
      let inside = false
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j]
        if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
      }
      return inside
    }
    return false
  }
  if (object.type === 'ellipse') {
    const rx = Math.max(0.001, object.width / 2), ry = Math.max(0.001, object.height / 2)
    const radius = Math.hypot((local.x - rx) / rx, (local.y - ry) / ry)
    const edge = pad / Math.min(rx, ry)
    return radius <= 1 + edge && (filled || radius >= 1 - edge)
  }
  if (local.x < -pad || local.y < -pad || local.x > object.width + pad || local.y > object.height + pad) return false
  return filled || object.type === 'text' || object.type === 'image' || local.x <= pad || local.y <= pad || local.x >= object.width - pad || local.y >= object.height - pad
}
