import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'

const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 40

function touchPair(event: TouchEvent, scroller: HTMLElement) {
  if (event.touches.length !== 2) return null
  const [a, b] = Array.from(event.touches)
  if (!scroller.contains(a.target as Node) || !scroller.contains(b.target as Node)) return null
  const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  return distance > 0 ? { distance, x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 } : null
}

class PinchZoom {
  private gesture: {
    distance: number
    fontSize: number
    position: number | null
    offsetX: number
    offsetY: number
  } | null = null
  private active = false
  private frame = 0
  private previousFontSize: string
  private view: EditorView

  constructor(view: EditorView) {
    this.view = view
    const scroller = view.scrollDOM
    this.previousFontSize = scroller.style.fontSize
    const options = { passive: false }
    scroller.addEventListener('touchstart', this.start, options)
    scroller.addEventListener('touchmove', this.move, options)
    scroller.addEventListener('touchend', this.end, options)
    scroller.addEventListener('touchcancel', this.cancel, options)
  }

  private consume(event: TouchEvent) {
    if (event.cancelable) event.preventDefault()
    event.stopPropagation()
  }

  private start = (event: TouchEvent) => {
    if (this.active) {
      this.gesture = null
      this.consume(event)
      return
    }
    const view = this.view
    const pair = touchPair(event, view.scrollDOM)
    if (!pair) return
    const position = view.posAtCoords(pair, false)
    const coords = position === null ? null : view.coordsAtPos(position)
    this.gesture = {
      distance: pair.distance,
      fontSize: parseFloat(view.scrollDOM.ownerDocument.defaultView!.getComputedStyle(view.scrollDOM).fontSize),
      position,
      offsetX: coords ? pair.x - coords.left : 0,
      offsetY: coords ? pair.y - coords.top : 0,
    }
    this.active = true
    this.consume(event)
  }

  private move = (event: TouchEvent) => {
    if (!this.active) return
    this.consume(event)
    const gesture = this.gesture
    const view = this.view
    const scroller = view.scrollDOM
    const pair = touchPair(event, scroller)
    if (!gesture || !pair) return
    const fontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, gesture.fontSize * pair.distance / gesture.distance))
    scroller.style.fontSize = `${fontSize}px`
    // Reflow can move wrapped text out of the rendered viewport. Materialize the anchor first.
    if (gesture.position !== null) view.dispatch({ effects: EditorView.scrollIntoView(Math.min(gesture.position, view.state.doc.length)) })
    view.requestMeasure()
    const win = scroller.ownerDocument.defaultView!
    win.cancelAnimationFrame(this.frame)
    // CodeMirror adjusts its own scroll anchor during measurement. Apply ours after that pass.
    this.frame = win.requestAnimationFrame(() => {
      this.frame = 0
      if (gesture.position === null) return
      const coords = view.coordsAtPos(Math.min(gesture.position, view.state.doc.length))
      if (!coords) return
      const scale = fontSize / gesture.fontSize
      scroller.scrollTop += coords.top + gesture.offsetY * scale - pair.y
      scroller.scrollLeft += coords.left + gesture.offsetX * scale - pair.x
    })
  }

  private end = (event: TouchEvent) => {
    if (!this.active) return
    this.consume(event)
    this.gesture = null
    // Consume the remaining finger as well, so ending a pinch cannot place the caret.
    if (event.touches.length === 0) this.active = false
  }

  private cancel = (event: TouchEvent) => {
    if (this.active) this.consume(event)
    this.gesture = null
    this.active = false
  }

  destroy() {
    const scroller = this.view.scrollDOM
    scroller.ownerDocument.defaultView!.cancelAnimationFrame(this.frame)
    scroller.removeEventListener('touchstart', this.start)
    scroller.removeEventListener('touchmove', this.move)
    scroller.removeEventListener('touchend', this.end)
    scroller.removeEventListener('touchcancel', this.cancel)
    scroller.style.fontSize = this.previousFontSize
  }
}

const pinchZoom = ViewPlugin.fromClass(PinchZoom)

export function codePinchZoom(): Extension {
  return [
    EditorView.baseTheme({ '.cm-scroller': { touchAction: 'pan-x pan-y' } }),
    pinchZoom,
  ]
}
