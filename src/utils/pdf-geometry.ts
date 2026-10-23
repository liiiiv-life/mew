export type InkPoint = [number, number]
export type InkStroke = { id: string; page: number; points: InkPoint[]; color: string; width: number; opacity: number }
export type PageSize = { width: number; height: number }
export const PAGE_GAP = 18
export const MAX_PAGE_PIXELS = 4_000_000
export const MAX_VIEW_PIXELS = 16_000_000

export function canvasScale(width: number, height: number, dpr: number, budget = MAX_PAGE_PIXELS): number {
  return Math.min(dpr, 2, Math.sqrt(budget / Math.max(1, width * height)), 8192 / Math.max(width, height))
}

export function pageLayout(count: number, known: ReadonlyMap<number, PageSize>, fallback: PageSize, scale: number) {
  const offsets = new Float64Array(count + 1)
  for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + (known.get(i + 1) ?? fallback).height * scale + PAGE_GAP
  return offsets
}

export function pageAt(offsets: Float64Array, position: number): number {
  let lo = 0, hi = offsets.length - 2
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (offsets[mid] <= position) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function distanceToSegment(p: InkPoint, a: InkPoint, b: InkPoint): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const fraction = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(p[0] - a[0] - fraction * dx, p[1] - a[1] - fraction * dy)
}

/** Iterative RDP avoids a call-stack limit on long pen strokes. */
export function simplifyInk(points: InkPoint[], tolerance: number): InkPoint[] {
  if (points.length < 3) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [0, points.length - 1]
  while (stack.length) {
    const end = stack.pop()!, start = stack.pop()!
    let distance = tolerance, split = -1
    for (let i = start + 1; i < end; i++) {
      const next = distanceToSegment(points[i], points[start], points[end])
      if (next > distance) { distance = next; split = i }
    }
    if (split !== -1) { keep[split] = 1; stack.push(start, split, split, end) }
  }
  return points.filter((_, index) => keep[index])
}

/** One document render at a time; obsolete queued work is skipped before acquiring a page. */
export class PdfRenderQueue {
  private tail: Promise<unknown> = Promise.resolve()
  run(task: () => Promise<void>): void { this.tail = this.tail.then(task, task).catch(() => {}) }
}
