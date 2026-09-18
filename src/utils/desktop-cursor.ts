import type { DesktopCursor } from '../../native/remote-desktop/cursor-protocol.mjs'

/** DOM/native cursor updates never pass through React's render queue. */
export function desktopCursor(stage: HTMLElement, layer: HTMLImageElement, surface: () => HTMLVideoElement | HTMLCanvasElement | null, project?: (x: number, y: number) => { x: number; y: number }) {
  let enabled = false, visible = true, joystick = true, x = .5, y = .5, shapeId = -1, hotX = 0, hotY = 0, url = '', frame = 0
  const draw = () => {
    frame = 0
    const element = surface(), rect = element?.getBoundingClientRect(), area = stage.getBoundingClientRect()
    const width = element instanceof HTMLVideoElement ? element.videoWidth : element?.width
    const height = element instanceof HTMLVideoElement ? element.videoHeight : element?.height
    layer.hidden = !enabled || !visible || !joystick || !url || !rect || !width || !height || x < 0 || x > 1 || y < 0 || y > 1
    if (layer.hidden || !rect || !width || !height) return
    if (project) {
      const point = project(x, y)
      layer.style.transform = `translate(${point.x - hotX}px, ${point.y - hotY}px)`
      return
    }
    const ratio = Math.min(rect.width / width, rect.height / height), w = width * ratio, h = height * ratio
    layer.style.transform = `translate(${rect.left - area.left + (rect.width - w) / 2 + x * w - hotX}px, ${rect.top - area.top + (rect.height - h) / 2 + y * h - hotY}px)`
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(draw) }
  const updateStyle = () => { stage.style.cursor = enabled ? visible ? url ? `url("${url}") ${hotX} ${hotY}, default` : 'default' : 'none' : ''; schedule() }
  const observer = new ResizeObserver(schedule); observer.observe(stage)
  return {
    enable(value: boolean) { enabled = value; updateStyle() },
    shape(value: DesktopCursor) {
      visible = value.visible
      if (value.shape && value.shapeId !== shapeId) {
        const shape = value.shape
        const next = URL.createObjectURL(new Blob([Uint8Array.from(atob(shape.png), c => c.charCodeAt(0))], { type: 'image/png' }))
        const previous = url; url = next; shapeId = value.shapeId; hotX = shape.hotX; hotY = shape.hotY
        layer.src = url; layer.width = shape.width; layer.height = shape.height
        if (previous) URL.revokeObjectURL(previous)
      }
      updateStyle()
    },
    point(px: number, py: number, fromJoystick: boolean | undefined) { x = px; y = py; if (fromJoystick !== undefined) joystick = fromJoystick; schedule() },
    mouse() { joystick = false; schedule() },
    refresh: schedule,
    close() { observer.disconnect(); cancelAnimationFrame(frame); stage.style.cursor = ''; layer.hidden = true; layer.removeAttribute('src'); if (url) URL.revokeObjectURL(url) },
  }
}
