import { writeBrowserStorage } from '@mew/ui/browser-storage'
import type { InkStroke } from './pdf-geometry'

type Snapshot = { revision: string; strokes: InkStroke[]; undo: InkStroke[][]; redo: InkStroke[][]; storageFailed: boolean; saving: boolean; generation: number }
const drafts = new Map<string, PdfDraft>()
const EMPTY: InkStroke[] = []

export class PdfDraft {
  private key: string
  private state: Snapshot = { revision: '', strokes: EMPTY, undo: [], redo: [], storageFailed: false, saving: false, generation: 0 }
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(key: string) {
    this.key = key
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? 'null')
      if (stored && typeof stored.revision === 'string' && Array.isArray(stored.strokes) && stored.strokes.every((s: InkStroke) => typeof s.id === 'string' && Number.isInteger(s.page) && s.page > 0 && /^#[\da-f]{6}$/i.test(s.color) && Number.isFinite(s.width) && s.width > 0 && Number.isFinite(s.opacity) && s.opacity > 0 && s.opacity <= 1 && Array.isArray(s.points) && s.points.length && s.points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)))) {
        this.state = { ...this.state, revision: stored.revision, strokes: stored.strokes }
      }
    } catch { /* A blocked browser store does not prevent reading a PDF. */ }
  }
  get = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); this.flush() } }
  private emit() { for (const listener of this.listeners) listener() }
  private set(state: Snapshot) {
    this.state = state; this.emit()
    clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 250)
  }
  bind(revision: string) { this.set({ ...this.state, revision }) }
  saving(value: boolean) { this.state = { ...this.state, saving: value }; this.emit() }
  saved(revision: string, strokes: InkStroke[]) {
    const ids = new Set(strokes.map(stroke => stroke.id))
    this.set({ ...this.state, revision, strokes: this.state.strokes.filter(stroke => !ids.has(stroke.id)), undo: [], redo: [], generation: this.state.generation + 1 })
    this.flush()
  }
  change(strokes: InkStroke[]) { this.set({ ...this.state, strokes, undo: [...this.state.undo.slice(-49), this.state.strokes], redo: [] }) }
  undo = () => {
    const previous = this.state.undo.at(-1)
    if (previous) this.set({ ...this.state, strokes: previous, undo: this.state.undo.slice(0, -1), redo: [...this.state.redo, this.state.strokes] })
  }
  redo = () => {
    const next = this.state.redo.at(-1)
    if (next) this.set({ ...this.state, strokes: next, undo: [...this.state.undo, this.state.strokes], redo: this.state.redo.slice(0, -1) })
  }
  clear = () => { this.set({ ...this.state, revision: '', strokes: EMPTY, undo: [], redo: [] }); this.flush() }
  flush = () => {
    clearTimeout(this.timer)
    let success = true
    if (this.state.strokes.length) success = writeBrowserStorage(this.key, JSON.stringify({ revision: this.state.revision, strokes: this.state.strokes }))
    else { try { localStorage.removeItem(this.key) } catch { success = false } }
    if (this.state.storageFailed !== !success) { this.state = { ...this.state, storageFailed: !success }; this.emit() }
  }
}

export function pdfDraft(key: string): PdfDraft {
  const storageKey = `mew:pdf-draft:${key}`
  let draft = drafts.get(storageKey)
  if (!draft) { draft = new PdfDraft(storageKey); drafts.set(storageKey, draft) }
  return draft
}

window.addEventListener('pagehide', () => { for (const draft of drafts.values()) draft.flush() })
window.addEventListener('beforeunload', event => {
  if ([...drafts.values()].some(draft => draft.get().strokes.length)) { event.preventDefault(); event.returnValue = '' }
})
