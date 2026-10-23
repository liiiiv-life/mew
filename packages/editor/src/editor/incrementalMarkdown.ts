import { Extension, type Editor } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'

type NativeState = {
  out: string
  closed: PMNode | null
  render(node: PMNode, parent: PMNode | Fragment, index: number): void
}

type NativeSerializer = {
  nodes: Record<string, (state: NativeState, node: PMNode, parent: PMNode, index: number) => void>
  marks: Record<string, unknown>
  serialize(content: PMNode | Fragment): string
}

type StateConstructor = new (
  nodes: NativeSerializer['nodes'], marks: NativeSerializer['marks'], options: { hardBreakNodeName: string },
) => NativeState

export type SerializedMarkdownBlock = {
  node: PMNode
  /** ProseMirror offset of this top-level node. */
  from: number
  /** Exact contribution to the document, including its preceding separator. */
  text: string
  /** One-based source line immediately before this contribution. */
  sourceStartLine: number
}

type CachedBlock = { text: string; closed: PMNode | null; newlines: number; hasNonWhitespace: boolean }
type BlockBoundary = { prefix: string; closed: PMNode | null; sourceStartLine: number }
type SerializedDocument = {
  text: string
  blocks: readonly SerializedMarkdownBlock[]
  boundaries: readonly BlockBoundary[] | null
}

function implicitEmptyTail(node: PMNode): boolean {
  return node.type.name === 'paragraph'
    && (node.content.size === 0 || (node.childCount === 1 && node.firstChild?.type.name === 'hardBreak'))
}

function newlineCount(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++
  return count
}

/**
 * Keep tiptap-markdown's own renderers and CommonMark delimiter handling, but
 * never let a renderer rescan the accumulated document. Immutable PM nodes are
 * cached with the boundary state that affects separators and trailing paragraphs.
 */
export class IncrementalMarkdownSerializer {
  readonly native: NativeSerializer
  private stateConstructor: StateConstructor | null = null
  private nodes: NativeSerializer['nodes'] | null = null
  private marks: NativeSerializer['marks'] | null = null
  private nodeCache = new WeakMap<PMNode, Map<string, CachedBlock>>()
  // Undo history retains old docs. Keeping a full Markdown string for every old
  // doc would multiply memory by the history depth; node-level reuse is enough.
  private lastDoc: PMNode | null = null
  private lastResult: SerializedDocument | null = null

  constructor(native: NativeSerializer | IncrementalMarkdownSerializer) {
    this.native = native instanceof IncrementalMarkdownSerializer ? native.native : native
  }

  private makeState(first: PMNode): NativeState {
    if (!this.stateConstructor) {
      // The package does not export its state subclass. Capture its constructor
      // through the public node-renderer dispatch, preserving its delimiter fixes
      // without importing private package paths or copying the implementation.
      const probe = Object.create(this.native) as NativeSerializer
      Object.defineProperty(probe, 'nodes', { value: {
        [first.type.name]: (state: NativeState) => {
          this.stateConstructor = state.constructor as StateConstructor
        },
      } })
      probe.serialize(Fragment.from(first))
      this.nodes = this.native.nodes
      this.marks = this.native.marks
    }
    return new this.stateConstructor!(this.nodes!, this.marks!, { hardBreakNodeName: 'hardBreak' })
  }

  serialize(content: PMNode | Fragment): string {
    // Clipboard slices have a Fragment parent and intentionally use different
    // trailing-paragraph/list/HTML rules. Keep that native contract unchanged.
    if (content instanceof Fragment || content.type !== content.type.schema.topNodeType) {
      return this.native.serialize(content)
    }
    return this.serializeDocument(content).text
  }

  blocks(doc: PMNode): readonly SerializedMarkdownBlock[] {
    return this.serializeDocument(doc).blocks
  }

  /** Match serialization of doc.cut(0, pos).content without serializing its completed blocks again. */
  sourceLineOfPos(doc: PMNode, pos: number): number {
    if (pos === 0 || !doc.firstChild) return 1
    const result = this.serializeDocument(doc)
    if (!result.boundaries) return newlineCount(this.native.serialize(doc.cut(0, pos).content)) + 1
    let low = 0
    let high = result.blocks.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (result.blocks[middle].from < pos) low = middle + 1
      else high = middle
    }
    const index = Math.max(0, low - 1)
    const { node, from } = result.blocks[index]
    const relative = pos - from
    const partial = relative >= node.nodeSize ? node : node.cut(0, Math.min(node.content.size, relative - 1))
    const boundary = result.boundaries[index]
    const state = this.makeState(partial)
    state.out = boundary.prefix
    state.closed = boundary.closed
    // Fragment parents do not apply the document's implicit trailing paragraph.
    // The preceding siblings used by ordered-list numbering are unchanged.
    state.render(partial, doc.content, index)
    return boundary.sourceStartLine + newlineCount(state.out) - newlineCount(boundary.prefix)
  }

  private serializeDocument(doc: PMNode): SerializedDocument {
    if (doc === this.lastDoc) return this.lastResult!
    if (!doc.firstChild) {
      const empty = { text: '', blocks: [], boundaries: [] }
      this.lastDoc = doc
      this.lastResult = empty
      return empty
    }

    const blocks: SerializedMarkdownBlock[] = []
    const boundaries: BlockBoundary[] = []
    let previous: PMNode | null = null
    let lastCharacter = ''
    let hasNonWhitespace = false
    let orderedRun = 0
    let sourceLine = 1
    let needsNativeFallback = false

    doc.forEach((node, from, index) => {
      const last = index === doc.childCount - 1
      orderedRun = node.type.name === 'orderedList' ? orderedRun + 1 : 0
      // Only the immediate output boundary is observable by the native block
      // renderers. Keep a nonblank sentinel for EmptyParagraph.trimEnd().
      const prefix = lastCharacter && /\s/.test(lastCharacter) && hasNonWhitespace
        ? `x${lastCharacter}` : lastCharacter
      const key = JSON.stringify([prefix, previous?.type.name ?? '', last, orderedRun % 2])
      boundaries.push({ prefix, closed: previous, sourceStartLine: sourceLine })
      let variants = this.nodeCache.get(node)
      let block = variants?.get(key)

      if (!block) {
        // Each block starts outside lists/tables/inline marks. A fresh state also
        // avoids retaining the native state subclass's completed inline records.
        const local = this.makeState(node)
        local.out = prefix
        local.closed = previous
        local.render(node, doc, index)
        if (!local.out.startsWith(prefix)) needsNativeFallback = true
        const text = local.out.slice(prefix.length)
        block = { text, closed: local.closed, newlines: newlineCount(text), hasNonWhitespace: /\S/.test(text) }
        if (!variants) this.nodeCache.set(node, variants = new Map())
        // Editing a preceding block's last character changes this boundary key.
        // Bound retained variants even while undo history keeps this node alive.
        if (variants.size >= 8) variants.delete(variants.keys().next().value!)
        variants.set(key, block)
      }

      blocks.push({ node, from, text: block.text, sourceStartLine: sourceLine })
      sourceLine += block.newlines
      if (block.text) lastCharacter = block.text.charAt(block.text.length - 1)
      hasNonWhitespace ||= block.hasNonWhitespace
      previous = block.closed
    })

    // An implicit final empty paragraph normalizes all trailing LF characters.
    // Apply that once to the assembled text, rather than scanning every prefix.
    const tail = blocks[blocks.length - 1]
    let text = blocks.map(block => block.text).join('')
    if (tail && implicitEmptyTail(tail.node) && text.trimEnd()) {
      const normalized = text.replace(/\n*$/, '\n')
      if (normalized !== text) {
        let remove = text.length - normalized.length
        if (remove < 0) tail.text += '\n'
        else for (let i = blocks.length - 1; remove > 0 && i >= 0; i--) {
          const count = Math.min(remove, blocks[i].text.length)
          blocks[i].text = blocks[i].text.slice(0, blocks[i].text.length - count)
          remove -= count
        }
        text = normalized
        sourceLine = 1
        for (const block of blocks) {
          block.sourceStartLine = sourceLine
          sourceLine += newlineCount(block.text)
        }
      }
    }

    // Protect custom serializers that rewrite earlier output. The current Mew
    // renderers only rewrite the explicit trailing paragraph handled above.
    if (needsNativeFallback) {
      this.nodeCache = new WeakMap()
      return this.serializeNativeDocument(doc)
    }
    const result = { text, blocks, boundaries }
    this.lastDoc = doc
    this.lastResult = result
    return result
  }

  private serializeNativeDocument(doc: PMNode): SerializedDocument {
    const state = this.makeState(doc.firstChild!)
    const blocks: SerializedMarkdownBlock[] = []
    doc.forEach((node, from, index) => {
      const before = state.out
      state.render(node, doc, index)
      let shared = before.length
      if (!state.out.startsWith(before)) {
        shared = 0
        while (shared < before.length && before[shared] === state.out[shared]) shared++
        let remove = before.length - shared
        for (let i = blocks.length - 1; remove > 0 && i >= 0; i--) {
          const count = Math.min(remove, blocks[i].text.length)
          blocks[i].text = blocks[i].text.slice(0, blocks[i].text.length - count)
          remove -= count
        }
      }
      blocks.push({ node, from, text: state.out.slice(shared), sourceStartLine: 1 })
    })
    let line = 1
    for (const block of blocks) {
      block.sourceStartLine = line
      line += newlineCount(block.text)
    }
    this.lastDoc = doc
    this.lastResult = { text: state.out, blocks, boundaries: null }
    return this.lastResult
  }
}

const editorSerializers = new WeakMap<Editor, IncrementalMarkdownSerializer>()

export function getIncrementalMarkdown(editor: Editor): IncrementalMarkdownSerializer | null {
  return editorSerializers.get(editor) ?? null
}

export const IncrementalMarkdown = Extension.create({
  name: 'incrementalMarkdown',
  // Markdown (priority 50) initializes storage in onBeforeCreate first.
  priority: 40,
  onBeforeCreate() {
    const storage = (this.editor.storage as unknown as {
      markdown?: { serializer: NativeSerializer },
    }).markdown
    if (!storage?.serializer) return
    const serializer = new IncrementalMarkdownSerializer(storage.serializer)
    editorSerializers.set(this.editor, serializer)
    storage.serializer = serializer as unknown as NativeSerializer
  },
  onDestroy() {
    editorSerializers.delete(this.editor)
  },
})
