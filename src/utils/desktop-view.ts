export type Rotation = 0 | 90 | 180 | 270
export type View = { x: number; y: number; scale: number }
export const DEFAULT_SENSITIVITY = 3
export const SENSITIVITY_KEY = 'mew.desktop.sensitivity'

export function sensitivity(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(.5, Math.min(6, value)) : DEFAULT_SENSITIVITY
}

export function readSensitivity() {
  try { return sensitivity(JSON.parse(localStorage.getItem(SENSITIVITY_KEY) ?? 'null')) } catch { return DEFAULT_SENSITIVITY }
}

/** Quarter turns stay exact, including the inverse used by pointer input. */
export function rotateDelta(x: number, y: number, rotation: Rotation) {
  if (rotation === 90) return { x: -y, y: x }
  if (rotation === 180) return { x: -x, y: -y }
  if (rotation === 270) return { x: y, y: -x }
  return { x, y }
}

export function desktopGeometry(width: number, height: number, nativeWidth: number, nativeHeight: number, rotation: Rotation, view: View) {
  const swapped = rotation === 90 || rotation === 270
  const fit = Math.min(width / (swapped ? nativeHeight : nativeWidth), height / (swapped ? nativeWidth : nativeHeight))
  const w = nativeWidth * fit, h = nativeHeight * fit
  return {
    width: w, height: h,
    content: { width: swapped ? h : w, height: swapped ? w : h },
    project(x: number, y: number) {
      const point = rotateDelta((x - .5) * w * view.scale, (y - .5) * h * view.scale, rotation)
      return { x: width / 2 + view.x + point.x, y: height / 2 + view.y + point.y }
    },
    unproject(x: number, y: number) {
      const point = rotateDelta(x - width / 2 - view.x, y - height / 2 - view.y, ((360 - rotation) % 360) as Rotation)
      return { x: point.x / (w * view.scale) + .5, y: point.y / (h * view.scale) + .5 }
    },
  }
}
