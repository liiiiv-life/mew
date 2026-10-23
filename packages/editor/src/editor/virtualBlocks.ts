import { Extension, type Editor } from '@tiptap/core'
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView, type NodeView, type NodeViewConstructor } from '@tiptap/pm/view'
import { clearCache, layout, prepare, type PreparedText } from '@chenglou/pretext'
import { isFileLinkHref } from './file-link.ts'
import { measureRichInlineStats, prepareRichInline, type PreparedRichInline, type RichInlineBox, type RichInlineItem } from '@chenglou/pretext/rich-inline'

export type VirtualBlocksOptions = {
  minBlocks: number
  overscan: number
  initialViewportHeight: number
}

type BlockSize = { height: number; before: number; after: number }
type Block = BlockSize & { node: PMNode; pos: number; top: number }
type Typography = {
  width: number
  font: string
  family: string
  mono: string
  fontSize: number
  lineHeight: number
  letterSpacing: number
  wordBreak: 'normal' | 'keep-all'
}
type Prepared = { key: string; text?: PreparedText; rich?: PreparedRichInline }
type WindowRange = { top: number; bottom: number }
type Refresh = { window?: WindowRange; force?: number }
type VirtualState = {
  active: boolean
  blocks: Block[]
  visible: Set<number>
  decorations: DecorationSet
  factoryGeneration: number
}

export const virtualBlocksKey = new PluginKey<VirtualState>('mewVirtualBlocks')
const controllers = new WeakMap<EditorView, VirtualController>()
const defaults: VirtualBlocksOptions = { minBlocks: 120, overscan: 700, initialViewportHeight: 900 }
const baseTypography: Typography = {
  width: 704, font: "400 15px 'Noto Serif KR', serif", family: "'Noto Serif KR', serif",
  mono: 'monospace', fontSize: 15, lineHeight: 25.5, letterSpacing: 0, wordBreak: 'normal',
}

function firstBlockAt(blocks: Block[], position: number): number {
  let low = 0, high = blocks.length - 1
  while (low <= high) {
    const mid = (low + high) >>> 1
    if (blocks[mid].pos <= position) low = mid + 1
    else high = mid - 1
  }
  return Math.max(0, Math.min(blocks.length - 1, high))
}

function firstBlockBelow(blocks: Block[], y: number): number {
  let low = 0, high = blocks.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (blocks[mid].top + blocks[mid].height < y) low = mid + 1
    else high = mid
  }
  return Math.min(low, Math.max(0, blocks.length - 1))
}

function placeBlocks(blocks: Block[]): void {
  let top = 0, previousAfter = 0
  for (const block of blocks) {
    top += Math.max(previousAfter, block.before)
    block.top = top
    top += block.height
    previousAfter = block.after
  }
}

function plainNodeView(node: PMNode, view: EditorView): NodeView {
  const spec = node.type.spec.toDOM?.(node)
  if (!spec) return { dom: view.dom.ownerDocument.createElement('div') }
  const rendered = DOMSerializer.renderSpec(view.dom.ownerDocument, spec)
  let current = node
  return {
    ...rendered,
    update(next) {
      if (!next.sameMarkup(current)) return false
      current = next
      return true
    },
  }
}

function blockMargins(dom: HTMLElement): { before: number; after: number } {
  const window = dom.ownerDocument.defaultView!
  const computed = window.getComputedStyle(dom)
  let before = Number.parseFloat(computed.marginTop) || 0
  let after = Number.parseFloat(computed.marginBottom) || 0
  // A custom node view can wrap its flow content (for example the copy-button code view).
  // Its first/last child's margins collapse through an unbordered wrapper even though the
  // wrapper's computed margin itself is zero. Preserve that footprint when it is unmounted.
  if (['block', 'list-item', ''].includes(computed.display) && (computed.overflowY === 'visible' || !computed.overflowY)) {
    const flowChildren = Array.from(dom.children).filter(child => {
      const style = window.getComputedStyle(child)
      return !['absolute', 'fixed'].includes(style.position) && style.display !== 'none'
    }) as HTMLElement[]
    const first = flowChildren[0], last = flowChildren.at(-1)
    if (first && !(Number.parseFloat(computed.paddingTop) || Number.parseFloat(computed.borderTopWidth))) before = Math.max(before, blockMargins(first).before)
    if (last && !(Number.parseFloat(computed.paddingBottom) || Number.parseFloat(computed.borderBottomWidth))) after = Math.max(after, blockMargins(last).after)
  }
  return { before, after }
}

function scrollParent(dom: HTMLElement): HTMLElement | null {
  const window = dom.ownerDocument.defaultView
  for (let parent = dom.parentElement; parent; parent = parent.parentElement) {
    const overflow = window?.getComputedStyle(parent).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return parent
  }
  return null
}

class VirtualController {
  options: VirtualBlocksOptions
  pluginNodeViews = new Map<string, NodeViewConstructor>()
  factoryGeneration = 0
  typography = { ...baseTypography }
  window: WindowRange
  blocks: Block[] = []
  byNode = new WeakMap<PMNode, Block>()
  byPosition = new Map<number, Block>()
  rendered = new Map<number, HTMLElement>()
  domPositions = new WeakMap<HTMLElement, number>()
  focusedPosition: number | undefined
  playing = new Map<HTMLElement, number>()
  placeholdersDirty = false
  document: PMNode | undefined
  snapshot: VirtualState | undefined
  prepared = new WeakMap<PMNode, Prepared>()
  sizes = new WeakMap<PMNode, Map<string, BlockSize>>()
  measured = new WeakMap<PMNode, BlockSize>()
  placeholders = new Map<HTMLElement, PMNode>()
  forced = new Set<number>()
  composingPosition: number | undefined
  view?: EditorView
  scroller: HTMLElement | null = null
  raf = 0
  dirtyStyle = true
  dirtyHeights = false
  destroyed = false
  cleanup: (() => void)[] = []
  pretextAvailable: boolean | undefined

  constructor(options: VirtualBlocksOptions) {
    this.options = options
    this.window = { top: 0, bottom: options.initialViewportHeight }
  }

  textHeight(node: PMNode, width: number, fontSize: number, weight: number): number {
    const style = this.typography
    const font = `${weight} ${fontSize}px ${style.family}`
    const key = `${font}|${style.mono}|${style.letterSpacing}|${style.wordBreak}`
    if (this.pretextAvailable === undefined) {
      try {
        const document = this.view?.dom.ownerDocument ?? globalThis.document
        this.pretextAvailable = !!document?.createElement('canvas').getContext('2d')
      } catch { this.pretextAvailable = false }
    }
    if (!this.pretextAvailable) {
      return Math.max(1, Math.ceil(node.textContent.length * fontSize * 0.6 / Math.max(1, width))) * style.lineHeight
    }
    let cached = this.prepared.get(node)
    if (cached?.key !== key) {
      if (node.childCount === 1 && node.firstChild?.isText && !node.firstChild.marks.length) {
        cached = { key, text: prepare(node.textContent, font, { whiteSpace: 'pre-wrap', letterSpacing: style.letterSpacing, wordBreak: style.wordBreak }) }
      } else {
        const items: (RichInlineItem | RichInlineBox)[] = []
        node.forEach(child => {
          if (child.type.name === 'hardBreak') {
            items.push({ text: '\n', font })
          } else if (child.isText) {
            const code = child.marks.some(mark => mark.type.name === 'code')
            const bold = child.marks.some(mark => mark.type.name === 'bold')
            const italic = child.marks.some(mark => mark.type.name === 'italic')
            const size = code ? fontSize * 0.9 : fontSize
            const fileLink = child.marks.some(mark => mark.type.name === 'link' && isFileLinkHref(mark.attrs.href ?? ''))
            items.push({
              text: child.text ?? '',
              font: `${italic ? 'italic ' : ''}${bold ? 700 : weight} ${size}px ${code ? style.mono : style.family}`,
              letterSpacing: style.letterSpacing,
              extraWidth: code ? size * 0.8 : fileLink ? size * 1.7 + 2 : 0,
            })
          } else {
            items.push({ width: Number(child.attrs.width) || style.lineHeight })
          }
        })
        cached = { key, rich: prepareRichInline(items, { whiteSpace: 'pre-wrap', wordBreak: style.wordBreak }) }
      }
      this.prepared.set(node, cached)
    }
    if (cached.text) return Math.max(style.lineHeight, layout(cached.text, Math.max(1, width), style.lineHeight).height)
    return Math.max(1, measureRichInlineStats(cached.rich!, Math.max(1, width)).lineCount) * style.lineHeight
  }

  estimate(node: PMNode, width = this.typography.width): BlockSize {
    const measured = width === this.typography.width ? this.measured.get(node) : undefined
    if (measured) return measured
    const style = this.typography
    const key = `${width}|${style.font}|${style.mono}|${style.lineHeight}|${style.letterSpacing}|${style.wordBreak}`
    const cached = this.sizes.get(node)?.get(key)
    if (cached) return cached
    const name = node.type.name
    let size: BlockSize
    if (node.isTextblock && (name === 'paragraph' || name === 'heading')) {
      const ratio = name === 'heading' ? [1, 2, 1.5, 1.25, 1.1, 1, 0.9][Number(node.attrs.level) || 1] : 1
      const fontSize = style.fontSize * ratio
      size = {
        height: this.textHeight(node, width, fontSize, name === 'heading' ? Number(node.attrs.level) <= 2 ? 700 : 600 : 400),
        before: name === 'heading' ? fontSize + 6 : style.fontSize * 0.4,
        after: name === 'heading' ? fontSize * 0.5 : style.fontSize * 0.4,
      }
    } else if (name === 'codeBlock') {
      size = { height: Math.max(1, node.textContent.split('\n').length) * style.lineHeight + style.fontSize * 2 + 2, before: style.fontSize * 0.5, after: style.fontSize * 0.5 }
    } else if (name === 'horizontalRule') {
      size = { height: 1, before: style.fontSize * 1.5, after: style.fontSize * 1.5 }
    } else if (name === 'table') {
      size = { height: Math.max(1, node.childCount) * (style.lineHeight + 17), before: style.fontSize * 0.5, after: style.fontSize * 0.5 }
    } else if (node.childCount && !node.isTextblock) {
      let height = 0, after = 0
      node.forEach(child => {
        const childSize = this.estimate(child, Math.max(40, width - (name.includes('List') || name.includes('Item') ? 24 : style.fontSize)))
        height += Math.max(after, childSize.before) + childSize.height
        after = childSize.after
      })
      size = { height: Math.max(style.lineHeight, height + after), before: style.fontSize * 0.5, after: style.fontSize * 0.5 }
    } else {
      size = { height: Number(node.attrs.height) || (name === 'image' || name === 'video' || name === 'youtube' ? 240 : name === 'audio' ? 54 : 150), before: style.fontSize * 0.5, after: style.fontSize * 0.5 }
    }
    if (!this.sizes.has(node)) this.sizes.set(node, new Map())
    const sizes = this.sizes.get(node)!
    if (sizes.size >= 3) sizes.clear()
    sizes.set(key, size)
    return size
  }

  index(doc: PMNode): void {
    if (this.document === doc && !this.dirtyHeights) return
    this.blocks = []
    doc.forEach((node, pos) => this.blocks.push({ node, pos, top: 0, ...this.estimate(node) }))
    placeBlocks(this.blocks)
    this.byNode = new WeakMap(this.blocks.map(block => [block.node, block]))
    this.byPosition = new Map(this.blocks.map(block => [block.pos, block]))
    this.placeholdersDirty ||= this.dirtyHeights
    this.document = doc
    this.dirtyHeights = false
  }

  syncPluginFactories(state: EditorState): void {
    // Some plugins (including columnResizing) populate nodeViews inside their state.init,
    // after our own state.init may have run. Read the completed registry before decorations.
    const factories = new Map<string, NodeViewConstructor>()
    for (const plugin of state.plugins) for (const [name, factory] of Object.entries(plugin.props.nodeViews ?? {})) {
      if (!factories.has(name)) factories.set(name, factory)
    }
    if (factories.size !== this.pluginNodeViews.size || [...factories].some(([name, factory]) => this.pluginNodeViews.get(name) !== factory)) this.factoryGeneration++
    this.pluginNodeViews = factories
  }

  state(state: EditorState, previous?: VirtualState, refresh?: Refresh): VirtualState {
    this.syncPluginFactories(state)
    this.index(state.doc)
    if (refresh?.window) this.window = refresh.window
    if (refresh?.force !== undefined) {
      const block = this.blocks[firstBlockAt(this.blocks, refresh.force)]
      if (block) this.forced.add(block.pos)
    }
    const active = state.doc.childCount >= this.options.minBlocks
    const visible = new Set<number>()
    if (active && this.blocks.length) {
      const first = firstBlockBelow(this.blocks, this.window.top - this.options.overscan)
      const last = firstBlockBelow(this.blocks, this.window.bottom + this.options.overscan)
      for (let i = first; i <= last; i++) visible.add(this.blocks[i].pos)
      // Browser selection, copy, composition and keyboard navigation require the complete selected interval.
      const selectedFirst = firstBlockAt(this.blocks, state.selection.from)
      const selectedLast = firstBlockAt(this.blocks, Math.max(state.selection.from, state.selection.to - 1))
      for (let i = selectedFirst; i <= selectedLast; i++) visible.add(this.blocks[i].pos)
      for (const position of this.forced) visible.add(this.blocks[firstBlockAt(this.blocks, position)].pos)
      if (this.composingPosition !== undefined) visible.add(this.blocks[firstBlockAt(this.blocks, this.composingPosition)].pos)
      if (this.focusedPosition !== undefined) visible.add(this.blocks[firstBlockAt(this.blocks, this.focusedPosition)].pos)
      for (const position of this.playing.values()) visible.add(this.blocks[firstBlockAt(this.blocks, position)].pos)
    }
    const blockDecorations = (pos: number): Decoration[] => {
      const block = this.byPosition.get(pos)!
      const decorations = [Decoration.node(pos, pos + block.node.nodeSize, { 'data-mew-virtual-visible': 'true' }, { mewVirtualVisible: true, mewVirtualOwner: pos })]
      const pluginViewDecoration = (node: PMNode, position: number) => {
        if (this.pluginNodeViews.has(node.type.name)) decorations.push(Decoration.node(position, position + node.nodeSize, { 'data-mew-node-view-generation': String(this.factoryGeneration) }, { mewVirtualOwner: pos }))
      }
      pluginViewDecoration(block.node, pos)
      if (this.pluginNodeViews.size) block.node.descendants((node, offset) => { pluginViewDecoration(node, pos + 1 + offset) })
      return decorations
    }
    let decorations = previous?.decorations ?? DecorationSet.empty
    if (!previous || previous.blocks !== this.blocks || previous.active !== active || previous.factoryGeneration !== this.factoryGeneration) {
      decorations = active ? DecorationSet.create(state.doc, [...visible].flatMap(blockDecorations)) : DecorationSet.empty
    } else {
      const removed = decorations.find().filter(decoration => !visible.has(decoration.spec.mewVirtualOwner ?? decoration.from))
      if (removed.length) decorations = decorations.remove(removed)
      const added = [...visible].filter(pos => !previous.visible.has(pos)).flatMap(blockDecorations)
      if (added.length) decorations = decorations.add(state.doc, added)
    }
    const snapshot = { active, blocks: this.blocks, visible, decorations, factoryGeneration: this.factoryGeneration }
    this.snapshot = snapshot
    return snapshot
  }

  hidden(topLevel: boolean, view: EditorView, decorations: readonly Decoration[]): boolean {
    return topLevel && !!virtualBlocksKey.getState(view.state)?.active && !decorations.some(decoration => decoration.spec.mewVirtualVisible)
  }

  placeholderSize(dom: HTMLElement, node: PMNode): void {
    const size = this.byNode.get(node) ?? this.estimate(node)
    const height = `${size.height}px`, before = `${size.before}px`, after = `${size.after}px`
    if (dom.style.height !== height) dom.style.height = height
    if (dom.style.marginBlockStart !== before) dom.style.marginBlockStart = before
    if (dom.style.marginBlockEnd !== after) dom.style.marginBlockEnd = after
  }

  wrap(original: Record<string, NodeViewConstructor>, editor: Editor): Record<string, NodeViewConstructor> {
    const views = { ...original }
    for (const type of Object.values(editor.schema.nodes)) {
      if (!type.isBlock || type.name === 'doc') continue
      const incumbent = original[type.name]
      views[type.name] = (node, view, getPos, decorations, innerDecorations) => {
        controllers.set(view, this)
        // During NodeView construction ProseMirror provides the position directly. Calling
        // getPos() after construction scans preceding siblings, so never use it in updates.
        const pos = getPos()
        const snapshot = virtualBlocksKey.getState(view.state) ?? (this.document === view.state.doc ? this.snapshot : undefined) ?? this.state(view.state)
        const topLevel = pos !== undefined && this.byPosition.get(pos)?.node === node
        const hidden = topLevel && snapshot.active && !snapshot.visible.has(pos!)
        if (hidden) {
          const dom = view.dom.ownerDocument.createElement('div')
          dom.className = 'mew-virtual-block'
          dom.setAttribute('data-mew-virtual-hidden', 'true')
          dom.setAttribute('aria-hidden', 'true')
          dom.setAttribute('contenteditable', 'false')
          this.placeholderSize(dom, node)
          this.placeholders.set(dom, node)
          let current = node
          return {
            dom,
            update: (next, nextDecorations) => {
              if (!this.hidden(topLevel, view, nextDecorations) || next.type !== current.type) return false
              current = next
              this.placeholders.set(dom, next)
              this.placeholderSize(dom, next)
              return true
            },
            ignoreMutation: mutation => mutation.type !== 'selection',
            destroy: () => { this.placeholders.delete(dom) },
          }
        }
        const factory = incumbent ?? this.pluginNodeViews.get(type.name)
        const rendered = factory?.(node, view, getPos, decorations, innerDecorations) ?? plainNodeView(node, view)
        const update = rendered.update?.bind(rendered)
        const destroy = rendered.destroy?.bind(rendered)
        const dom = rendered.dom as HTMLElement
        let currentPosition = pos
        if (topLevel) { this.rendered.set(currentPosition!, dom); this.domPositions.set(dom, currentPosition!) }
        let current = node
        const wrapper = Object.create(rendered) as NodeView
        wrapper.update = (next, nextDecorations, nextInnerDecorations) => {
          if (this.hidden(topLevel, view, nextDecorations) || (incumbent ?? this.pluginNodeViews.get(type.name)) !== factory) return false
          if (update ? !update(next, nextDecorations, nextInnerDecorations) : !next.sameMarkup(current)) return false
          current = next
          if (topLevel) {
            const nextPosition = nextDecorations.find(decoration => decoration.spec.mewVirtualVisible)?.spec.mewVirtualOwner as number | undefined
            if (nextPosition !== undefined) {
              if (this.rendered.get(currentPosition!) === dom) this.rendered.delete(currentPosition!)
              currentPosition = nextPosition
              this.rendered.set(currentPosition, dom)
              this.domPositions.set(dom, currentPosition)
            }
          }
          return true
        }
        wrapper.destroy = () => {
          if (topLevel && this.rendered.get(currentPosition!) === dom) this.rendered.delete(currentPosition!)
          this.domPositions.delete(dom)
          for (const media of this.playing.keys()) if (dom.contains(media)) this.playing.delete(media)
          destroy?.()
        }
        return wrapper
      }
    }
    return views
  }

  ownerPosition(target: EventTarget | null): number | undefined {
    const root = this.view?.dom
    for (let element = target as HTMLElement | null; element && element !== root; element = element.parentElement) {
      const position = this.domPositions.get(element)
      if (position !== undefined) return position
    }
  }

  schedule = (): void => {
    if (this.raf || this.destroyed || !this.view || !virtualBlocksKey.getState(this.view.state)?.active) return
    this.raf = this.view.dom.ownerDocument.defaultView!.requestAnimationFrame(() => {
      this.raf = 0
      if (!this.destroyed) this.refresh()
    })
  }

  invalidateStyle = (): void => { this.dirtyStyle = true; this.schedule() }

  readTypography(): void {
    const view = this.view!
    const style = view.dom.ownerDocument.defaultView!.getComputedStyle(view.dom)
    const fontSize = Number.parseFloat(style.fontSize) || 15
    const next: Typography = {
      width: Math.max(40, (view.dom.clientWidth || view.dom.getBoundingClientRect().width || 768) - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0)),
      family: style.fontFamily || baseTypography.family,
      font: `${style.fontWeight || 400} ${fontSize}px ${style.fontFamily || baseTypography.family}`,
      mono: style.getPropertyValue('--font-mono').trim() || 'monospace',
      fontSize, lineHeight: Number.parseFloat(style.lineHeight) || 25.5,
      letterSpacing: Number.parseFloat(style.letterSpacing) || 0,
      wordBreak: style.wordBreak === 'keep-all' ? 'keep-all' : 'normal',
    }
    if (JSON.stringify(next) !== JSON.stringify(this.typography)) {
      this.measured = new WeakMap()
      this.typography = next
      this.dirtyHeights = true
    }
    this.dirtyStyle = false
  }

  anchor(): { dom: HTMLElement; top: number; pos: number } | undefined {
    if (!this.view) return
    const viewportTop = this.scroller?.getBoundingClientRect().top ?? 0
    for (const pos of this.snapshot?.visible ?? []) {
      const block = this.byPosition.get(pos)
      const child = block ? this.rendered.get(pos) : undefined
      if (!child?.getBoundingClientRect || child.hasAttribute('data-mew-virtual-hidden')) continue
      const rect = child.getBoundingClientRect()
      if (rect.height > 0 && rect.bottom > viewportTop) return { dom: child, top: rect.top, pos }
    }
  }

  refresh(): void {
    const view = this.view
    if (!view || view.isDestroyed || !virtualBlocksKey.getState(view.state)?.active) return
    // EditorContent moves the initially detached Tiptap DOM into its scroll container.
    // Resolve the current ancestor here rather than retaining the construction-time parent.
    this.scroller = scrollParent(view.dom)
    this.focusedPosition = this.ownerPosition(view.dom.ownerDocument.activeElement)
    for (const media of this.playing.keys()) if (!view.dom.contains(media)) this.playing.delete(media)
    const anchor = this.anchor()
    if (anchor && (this.dirtyStyle || this.dirtyHeights)) this.forced.add(anchor.pos)
    if (this.dirtyStyle) this.readTypography()
    this.index(view.state.doc)
    const rect = view.dom.getBoundingClientRect()
    const scrollerRect = this.scroller?.getBoundingClientRect()
    const viewportTop = scrollerRect?.top ?? 0
    const viewportHeight = this.scroller?.clientHeight || view.dom.ownerDocument.defaultView!.innerHeight || this.options.initialViewportHeight
    const style = view.dom.ownerDocument.defaultView!.getComputedStyle(view.dom)
    const top = viewportTop - rect.top - (Number.parseFloat(style.paddingTop) || 0)
    const window = { top: Math.max(0, top), bottom: Math.max(0, top) + viewportHeight }
    view.dispatch(view.state.tr.setMeta(virtualBlocksKey, { window } satisfies Refresh).setMeta('addToHistory', false))
    if (this.placeholdersDirty) {
      for (const [dom, node] of this.placeholders) this.placeholderSize(dom, node)
      this.placeholdersDirty = false
    }
    let changed = false
    for (const pos of this.snapshot?.visible ?? []) {
      const block = this.byPosition.get(pos)
      const dom = block ? this.rendered.get(pos) : undefined
      if (!block || !dom) continue
      const height = dom.getBoundingClientRect().height
      if (!(height > 0)) continue
      const size = { height, ...blockMargins(dom) }
      if (Math.abs(block.height - size.height) > 0.5 || Math.abs(block.before - size.before) > 0.5 || Math.abs(block.after - size.after) > 0.5) {
        this.measured.set(block.node, size)
        changed = true
      }
    }
    if (changed) {
      this.dirtyHeights = true
      this.schedule()
    }
    if (anchor?.dom.isConnected) {
      const delta = anchor.dom.getBoundingClientRect().top - anchor.top
      if (Math.abs(delta) > 0.5) {
        if (this.scroller) this.scroller.scrollTop += delta
        else view.dom.ownerDocument.defaultView!.scrollBy(0, delta)
        this.schedule()
      }
    }
    this.forced.clear()
  }

  attach(view: EditorView): void {
    this.view = view
    controllers.set(view, this)
    this.scroller = scrollParent(view.dom)
    const window = view.dom.ownerDocument.defaultView!
    const onScroll = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (target?.nodeType === 1 && !target.contains(view.dom)) return
      this.schedule()
    }
    const document = view.dom.ownerDocument
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', this.invalidateStyle)
    this.cleanup.push(() => document.removeEventListener('scroll', onScroll, true), () => window.removeEventListener('scroll', onScroll), () => window.removeEventListener('resize', this.invalidateStyle))
    if (typeof window.ResizeObserver === 'function') {
      const observer = new window.ResizeObserver(this.invalidateStyle)
      observer.observe(view.dom)
      if (this.scroller) observer.observe(this.scroller)
      this.cleanup.push(() => observer.disconnect())
    }
    const themeObserver = new window.MutationObserver(this.invalidateStyle)
    for (let element: HTMLElement | null = view.dom; element; element = element.parentElement) {
      themeObserver.observe(element, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    }
    this.cleanup.push(() => themeObserver.disconnect())
    const fonts = view.dom.ownerDocument.fonts
    const fontsLoaded = () => {
      clearCache()
      this.prepared = new WeakMap()
      this.sizes = new WeakMap()
      this.measured = new WeakMap()
      this.dirtyHeights = true
      this.invalidateStyle()
    }
    fonts?.addEventListener?.('loadingdone', fontsLoaded)
    this.cleanup.push(() => fonts?.removeEventListener?.('loadingdone', fontsLoaded))
    const compositionStart = () => {
      const block = this.blocks[firstBlockAt(this.blocks, view.state.selection.head)]
      if (block) this.composingPosition = block.pos
    }
    const compositionEnd = () => { this.composingPosition = undefined; this.schedule() }
    const focusChanged = (event: FocusEvent) => {
      if (event.type === 'focusin') this.focusedPosition = this.ownerPosition(event.target)
      this.schedule()
    }
    const mediaChanged = (event: Event) => {
      const media = event.target as HTMLElement
      if (media.tagName !== 'AUDIO' && media.tagName !== 'VIDEO') return
      const position = this.ownerPosition(media)
      if (event.type === 'play' && position !== undefined) this.playing.set(media, position)
      else this.playing.delete(media)
      this.schedule()
    }
    view.dom.addEventListener('focusin', focusChanged, true)
    view.dom.addEventListener('focusout', focusChanged, true)
    for (const event of ['play', 'pause', 'ended']) view.dom.addEventListener(event, mediaChanged, true)
    this.cleanup.push(() => {
      view.dom.removeEventListener('focusin', focusChanged, true)
      view.dom.removeEventListener('focusout', focusChanged, true)
      for (const event of ['play', 'pause', 'ended']) view.dom.removeEventListener(event, mediaChanged, true)
    })
    view.dom.addEventListener('compositionstart', compositionStart)
    view.dom.addEventListener('compositionend', compositionEnd)
    this.cleanup.push(() => view.dom.removeEventListener('compositionstart', compositionStart), () => view.dom.removeEventListener('compositionend', compositionEnd))
    this.schedule()
  }

  destroy(): void {
    this.destroyed = true
    if (this.raf) this.view?.dom.ownerDocument.defaultView!.cancelAnimationFrame(this.raf)
    this.raf = 0
    this.cleanup.splice(0).forEach(cleanup => cleanup())
    if (this.view) controllers.delete(this.view)
    this.placeholders.clear()
    this.forced.clear()
    this.composingPosition = undefined
    this.focusedPosition = undefined
    this.playing.clear()
    this.rendered.clear()
  }
}

/** Mount a document position before querying its DOM, without changing the editor selection. */
export function materializeVirtualPosition(view: EditorView, pos: number): void {
  const controller = controllers.get(view)
  if (!controller || view.isDestroyed || !virtualBlocksKey.getState(view.state)?.active) return
  view.dispatch(view.state.tr.setMeta(virtualBlocksKey, { force: Math.max(0, Math.min(pos, view.state.doc.content.size)) } satisfies Refresh).setMeta('addToHistory', false))
  controller.schedule()
}

export function scrollVirtualPositionIntoView(view: EditorView, pos: number, options: ScrollIntoViewOptions = { block: 'center' }): void {
  materializeVirtualPosition(view, pos)
  const state = virtualBlocksKey.getState(view.state)
  const block = state?.blocks[firstBlockAt(state.blocks, pos)]
  const dom = view.nodeDOM(block?.pos ?? pos)
  if (dom?.nodeType === 1) (dom as HTMLElement).scrollIntoView(options)
}

export function virtualBlockState(view: EditorView): { active: boolean; total: number; rendered: number } {
  const state = virtualBlocksKey.getState(view.state)
  return { active: state?.active ?? false, total: state?.blocks.length ?? 0, rendered: state?.active ? state.visible.size : state?.blocks.length ?? 0 }
}

export const VirtualBlocks = Extension.create<VirtualBlocksOptions>({
  name: 'virtualBlocks',
  priority: 1000,
  addOptions: () => ({ ...defaults }),
  onBeforeCreate() {
    const editor = this.editor
    const controller = new VirtualController(this.options)
    const manager = editor.extensionManager
    const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(manager), 'nodeViews')?.get
    if (!getter) return
    // Tiptap constructs its first EditorView before installing extension plugins. Wrap this getter
    // so its initial render already skips offscreen descendants, including custom React views.
    Object.defineProperty(manager, 'nodeViews', { configurable: true, get: () => {
      const original = getter.call(manager) as Record<string, NodeViewConstructor>
      return editor.state.doc.childCount >= controller.options.minBlocks ? controller.wrap(original, editor) : original
    } })
    ;(this.storage as { controller?: VirtualController }).controller = controller
  },
  addProseMirrorPlugins() {
    const controller = (this.storage as { controller: VirtualController }).controller
    const editor = this.editor
    return [new Plugin<VirtualState>({
      key: virtualBlocksKey,
      state: {
        init: (_config, state) => controller.state(state),
        apply: (transaction, previous, _old, state) => {
          if (transaction.docChanged) {
            controller.forced = new Set([...controller.forced].map(position => transaction.mapping.map(position, 1)))
            if (controller.composingPosition !== undefined) controller.composingPosition = transaction.mapping.map(controller.composingPosition, 1)
            if (controller.focusedPosition !== undefined) controller.focusedPosition = transaction.mapping.map(controller.focusedPosition, 1)
            for (const [media, position] of controller.playing) controller.playing.set(media, transaction.mapping.map(position, 1))
          }
          if (!transaction.docChanged && !transaction.selectionSet && !transaction.getMeta(virtualBlocksKey)) return previous
          return controller.state(state, previous, transaction.getMeta(virtualBlocksKey) as Refresh | undefined)
        },
      },
      props: {
        decorations: state => {
          const snapshot = virtualBlocksKey.getState(state)
          if (!snapshot) return null
          controller.syncPluginFactories(state)
          return snapshot.factoryGeneration === controller.factoryGeneration ? snapshot.decorations : controller.state(state, snapshot).decorations
        },
      },
      view(view) {
        controller.attach(view)
        return {
          update: (_view, previous) => {
            if (virtualBlocksKey.getState(previous)?.active !== virtualBlocksKey.getState(view.state)?.active) editor.createNodeViews()
            if (previous.doc !== view.state.doc) controller.schedule()
          },
          destroy: () => controller.destroy(),
        }
      },
    })]
  },
})
