import { StateEffect, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { isolateHistory } from '@codemirror/commands'
import { createRoot, type Root } from 'react-dom/client'
import { uiText } from '@mew/ui/i18n-core'
import { AgentAttachmentIcon } from './agent-attachment-icon'

export type ComposerAttachment = {
  name: string
  mimeType: string
  pending?: boolean
  preview?: () => void
  href?: string
}

export const refreshComposerAttachments = StateEffect.define<null>()
export const composerAttachmentPattern = /\[\[(?:[^:\]\n]+:\.mew\/(?:assets|files)\/[^\]\n]+|mew-upload:[^\]\n]+)\]\]/g

class AttachmentWidget extends WidgetType {
  root?: Root
  readonly token: string
  readonly file: ComposerAttachment
  readonly resolve: (token: string) => ComposerAttachment | undefined
  constructor(token: string, file: ComposerAttachment, resolve: (token: string) => ComposerAttachment | undefined) {
    super()
    this.token = token
    this.file = file
    this.resolve = resolve
  }
  eq(other: AttachmentWidget) {
    return this.token === other.token && this.file.name === other.file.name && this.file.mimeType === other.file.mimeType && this.file.pending === other.file.pending && this.file.href === other.file.href
  }
  toDOM(view: EditorView) {
    const dom = view.dom.ownerDocument.createElement('span')
    dom.className = 'mew-composer-attachment'
    dom.dataset.attachmentToken = this.token
    dom.contentEditable = 'false'
    dom.title = this.file.name
    this.root = createRoot(dom)
    const remove = () => {
      const from = view.posAtDOM(dom)
      view.dispatch({ changes: { from, to: from + this.token.length }, selection: { anchor: from }, userEvent: 'delete', annotations: isolateHistory.of('full') })
      view.focus()
    }
    const label = uiText('{p0} 사진 미리보기', { p0: this.file.name })
    this.root.render(<>
      {this.file.pending ? <span role="status" aria-label={uiText('첨부 중…')} className="mew-composer-upload" />
        : this.file.href ? <a href={this.file.href} target="_blank" rel="noreferrer" aria-label={this.file.name}>
          <AgentAttachmentIcon mimeType={this.file.mimeType} path={this.file.name} />
        </a> : <button type="button" aria-label={label} title={uiText('사진 미리보기')} onClick={() => this.resolve(this.token)?.preview?.()}>
          <AgentAttachmentIcon mimeType={this.file.mimeType} path={this.file.name} />
        </button>}
      <button type="button" data-attachment-remove aria-label={uiText('{p0} 첨부 제거', { p0: this.file.name.split('.').at(-1) ?? this.file.name })} title={uiText('첨부 제거')} onClick={remove}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </>)
    return dom
  }
  destroy() {
    const root = this.root
    queueMicrotask(() => root?.unmount())
  }
  ignoreEvent() { return true }
}

export function composerAttachments(resolve: (token: string) => ComposerAttachment | undefined): Extension {
  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet = Decoration.none
    drag: { id: number; from: number; to: number; token: string; x: number; y: number; originX: number; originY: number; active: boolean; moved: boolean; target: number | null; dom: HTMLElement } | null = null
    timer?: ReturnType<typeof setTimeout>
    frame = 0
    marker: HTMLElement
    ghost: HTMLElement | null = null
    suppressClick = false
    readonly view: EditorView
    constructor(view: EditorView) {
      this.view = view
      this.marker = view.dom.ownerDocument.createElement('div')
      this.marker.dataset.attachmentDropCaret = ''
      Object.assign(this.marker.style, { position: 'fixed', width: '2px', background: 'var(--color-accent)', pointerEvents: 'none', zIndex: '1202' })
      this.marker.setAttribute('aria-hidden', 'true')
      this.rebuild()
      view.dom.addEventListener('pointerdown', this.down)
      view.dom.addEventListener('click', this.click, true)
      view.dom.addEventListener('contextmenu', this.context)
      view.dom.addEventListener('lostpointercapture', this.cancel)
    }
    rebuild() {
      const ranges = []
      for (const match of this.view.state.doc.toString().matchAll(composerAttachmentPattern)) {
        const file = resolve(match[0])
        if (file) ranges.push(Decoration.replace({ widget: new AttachmentWidget(match[0], file, resolve) }).range(match.index, match.index + match[0].length))
      }
      this.decorations = Decoration.set(ranges)
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.finish()
      if (update.docChanged || update.transactions.some(tr => tr.effects.some(effect => effect.is(refreshComposerAttachments)))) this.rebuild()
    }
    click = (event: MouseEvent) => {
      if (!this.suppressClick || event.detail === 0) return
      this.suppressClick = false
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    context = (event: Event) => { if (this.drag) event.preventDefault() }
    down = (event: PointerEvent) => {
      if (event.button !== 0 || this.drag) return
      this.suppressClick = false
      const target = event.target as HTMLElement
      const dom = target.closest<HTMLElement>('[data-attachment-token]')
      if (!dom || target.closest('[data-attachment-remove]')) return
      const token = dom.dataset.attachmentToken!
      if (resolve(token)?.pending) return
      event.preventDefault()
      const from = this.view.posAtDOM(dom)
      this.drag = { id: event.pointerId, from, to: from + token.length, token, x: event.clientX, y: event.clientY, originX: event.clientX, originY: event.clientY, active: false, moved: false, target: null, dom }
      const doc = this.view.dom.ownerDocument
      doc.addEventListener('pointermove', this.move, { passive: false })
      doc.addEventListener('pointerup', this.up)
      doc.addEventListener('pointercancel', this.cancel)
      doc.addEventListener('keydown', this.key, true)
      doc.defaultView!.addEventListener('blur', this.cancel)
      this.view.dom.setPointerCapture(event.pointerId)
      this.timer = setTimeout(() => {
        const drag = this.drag
        if (!drag) return
        drag.active = true
        this.suppressClick = true
        drag.dom.dataset.attachmentDragging = ''
        this.ghost = doc.createElement('div')
        this.ghost.className = this.view.dom.className
        Object.assign(this.ghost.style, { position: 'fixed', pointerEvents: 'none', zIndex: '1202', opacity: '0.85', width: 'max-content', background: 'transparent', cursor: 'grabbing' })
        const clone = drag.dom.cloneNode(true) as HTMLElement
        clone.removeAttribute('data-attachment-token')
        clone.removeAttribute('data-attachment-dragging')
        this.ghost.append(clone)
        this.ghost.setAttribute('aria-hidden', 'true')
        this.ghost.inert = true
        const overlay = this.view.dom.closest('dialog, [role="dialog"]') ?? doc.fullscreenElement ?? doc.body
        overlay.append(this.ghost, this.marker)
        this.track()
      }, 350)
    }
    move = (event: PointerEvent) => {
      const drag = this.drag
      if (!drag || event.pointerId !== drag.id) return
      if (!drag.active && Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY) > 8) {
        this.suppressClick = true
        this.finish()
        return
      }
      event.preventDefault()
      if (drag.active && Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY) > 3) drag.moved = true
      drag.x = event.clientX
      drag.y = event.clientY
    }
    track = () => {
      const drag = this.drag
      if (!drag?.active) return
      const bounds = this.view.scrollDOM.getBoundingClientRect()
      const inside = drag.x >= bounds.left && drag.x <= bounds.right && drag.y >= bounds.top && drag.y <= bounds.bottom
      if (inside) {
        if (drag.y < bounds.top + 24) this.view.scrollDOM.scrollTop -= 8
        if (drag.y > bounds.bottom - 24) this.view.scrollDOM.scrollTop += 8
      }
      let pos = inside ? this.view.posAtCoords({ x: drag.x, y: drag.y }) : null
      if (pos !== null) this.decorations.between(pos, pos, (from, to) => { if (pos! > from && pos! < to) pos = pos! - from < to - pos! ? from : to })
      drag.target = pos
      const coords = pos === null ? null : this.view.coordsAtPos(pos)
      this.marker.style.display = coords ? 'block' : 'none'
      if (coords) Object.assign(this.marker.style, { left: `${coords.left}px`, top: `${coords.top}px`, height: `${coords.bottom - coords.top}px` })
      if (this.ghost) Object.assign(this.ghost.style, { left: `${drag.x + 12}px`, top: `${drag.y + 12}px` })
      this.frame = requestAnimationFrame(this.track)
    }
    up = (event: PointerEvent) => {
      const drag = this.drag
      if (!drag || drag.id !== event.pointerId) return
      if (drag.active) {
        drag.x = event.clientX
        drag.y = event.clientY
        cancelAnimationFrame(this.frame)
        this.track()
      }
      const { from, to, token, target, active, moved, dom } = drag
      this.finish()
      if (!active) {
        // Pointer capture ends over the editor; preserve the tag's ordinary click action.
        this.suppressClick = true
        ;(dom.querySelector('button, a') as HTMLElement | null)?.click()
        return
      }
      if (!moved || target === null || target >= from && target <= to) return
      const anchor = target < from ? target + token.length : target
      this.view.dispatch({
        changes: target < from ? [{ from: target, insert: token }, { from, to }] : [{ from, to }, { from: target, insert: token }],
        selection: { anchor }, scrollIntoView: true, userEvent: 'move', annotations: isolateHistory.of('full'),
      })
      this.view.focus()
    }
    cancel = () => { if (this.drag) this.suppressClick = true; this.finish() }
    key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      this.cancel()
    }
    finish() {
      clearTimeout(this.timer)
      cancelAnimationFrame(this.frame)
      const drag = this.drag
      this.drag = null
      if (drag) {
        delete drag.dom.dataset.attachmentDragging
        if (this.view.dom.hasPointerCapture(drag.id)) this.view.dom.releasePointerCapture(drag.id)
      }
      this.ghost?.remove()
      this.ghost = null
      this.marker.remove()
      const doc = this.view.dom.ownerDocument
      doc.removeEventListener('pointermove', this.move)
      doc.removeEventListener('pointerup', this.up)
      doc.removeEventListener('pointercancel', this.cancel)
      doc.removeEventListener('keydown', this.key, true)
      doc.defaultView!.removeEventListener('blur', this.cancel)
    }
    destroy() {
      this.finish()
      this.view.dom.removeEventListener('pointerdown', this.down)
      this.view.dom.removeEventListener('click', this.click, true)
      this.view.dom.removeEventListener('contextmenu', this.context)
      this.view.dom.removeEventListener('lostpointercapture', this.cancel)
    }
  }, { decorations: value => value.decorations, provide: plugin => EditorView.atomicRanges.of(view => view.plugin(plugin)?.decorations ?? Decoration.none) })
  return [plugin, EditorView.baseTheme({
    '.mew-composer-attachment': { display: 'inline-flex', height: '24px', boxSizing: 'border-box', verticalAlign: 'middle', alignItems: 'center', gap: '2px', margin: '0 2px', padding: '4px', borderRadius: '6px', background: 'var(--color-surface-raised)', color: 'var(--color-ink-secondary)', userSelect: 'none', touchAction: 'none', cursor: 'grab' },
    '.mew-composer-attachment button, .mew-composer-attachment a': { display: 'inline-flex', width: '16px', height: '16px', padding: '0', alignItems: 'center', justifyContent: 'center', color: 'inherit', borderRadius: '3px', cursor: 'inherit' },
    '.mew-composer-attachment button:hover, .mew-composer-attachment a:hover': { color: 'var(--color-ink)', background: 'var(--color-surface-hover)' },
    '.mew-composer-attachment button:focus-visible, .mew-composer-attachment a:focus-visible': { outline: '2px solid var(--color-accent)', outlineOffset: '1px' },
    '[data-attachment-dragging]': { opacity: '0.4' },
    '.mew-composer-upload': { width: '12px', height: '12px', border: '2px solid var(--color-ink-muted)', borderTopColor: 'var(--color-accent)', borderRadius: '50%', animation: 'mew-composer-spin 1s linear infinite' },
    '@keyframes mew-composer-spin': { to: { transform: 'rotate(360deg)' } },
    '@media (prefers-reduced-motion: reduce)': { '.mew-composer-upload': { animation: 'none' } },
  })]
}
