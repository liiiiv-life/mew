import { Extension, Mark, mergeAttributes, type Editor } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type MarkdownIt from 'markdown-it'
import { uiText } from '@mew/ui/i18n-core'

export const ANNOTATIONS_HEADING = '$Annotations$'
const configuredParsers = new WeakSet<MarkdownIt>()

/** The same inline schema and Markdown syntax are used by the browser and headless editor. */
export const AnnotationMarker = Mark.create({
  name: 'annotationMarker',
  inclusive: false,
  excludes: '_',

  addAttributes() {
    return {
      num: {
        default: 1,
        parseHTML: (element) => Math.max(1, Number(element.getAttribute('data-annotation-number')) || 1),
        renderHTML: (attributes) => ({ 'data-annotation-number': attributes.num }),
      },
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-annotation-id'),
        renderHTML: (attributes) => attributes.id ? { 'data-annotation-id': attributes.id } : {},
      },
      copiedFrom: { default: null, rendered: false },
    }
  },

  addGlobalAttributes() {
    return [{ types: ['listItem'], attributes: {
      annotationId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-annotation-id'),
        renderHTML: (attributes) => attributes.annotationId ? { 'data-annotation-id': attributes.annotationId } : {},
      },
    } }]
  },

  parseHTML() { return [{ tag: 'sup[data-annotation-number]' }] },
  renderHTML({ mark, HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, {
      class: 'mew-annotation-marker', contenteditable: 'false', tabindex: '0', role: 'button',
      'aria-label': `${uiText('주석')} ${mark.attrs.num})`,
    }), 0]
  },

  addStorage() {
    return {
      markdown: {
        serialize: { open: '^[', close: ']', mixable: false, expelEnclosingWhitespace: false },
        parse: {
          updateDOM(element: any) {
            let inSection = false
            for (const child of element.children) {
              if (/^H[1-6]$/.test(child.tagName)) inSection = child.tagName === 'H1' && child.textContent === ANNOTATIONS_HEADING
              if (!inSection || child.tagName !== 'OL') continue
              let num = Number(child.getAttribute('start')) || 1
              for (const item of child.children) {
                if (item.tagName === 'LI') {
                  if (!item.getAttribute('data-annotation-id')) item.setAttribute('data-annotation-id', legacyIdentity(num))
                  num++
                }
                if (item.tagName === 'LI') item.style.whiteSpace = 'pre-wrap'
                if (item.tagName === 'LI' && !Array.from(item.children).some((block: any) => /^(P|OL|UL|PRE|BLOCKQUOTE|TABLE|H[1-6])$/.test(block.tagName))) {
                  const paragraph = item.ownerDocument.createElement('p')
                  paragraph.style.whiteSpace = 'pre-wrap'
                  paragraph.append(...Array.from(item.childNodes))
                  item.append(paragraph)
                }
                for (const paragraph of item.querySelectorAll('p')) paragraph.setAttribute('data-mew-annotation-paragraph', '')
                if (item.tagName !== 'LI' || item.textContent.trim() || !Array.from(item.children).every((block: any) => block.tagName === 'P' || block.tagName === 'BR')) continue
                const breaks = item.querySelectorAll('br').length
                if (breaks) item.replaceChildren(...Array.from({ length: breaks }, () => item.ownerDocument.createElement('p')))
              }
            }
          },
          setup(markdown: MarkdownIt) {
            if (configuredParsers.has(markdown)) return
            configuredParsers.add(markdown)
            // An inline rule leaves escaped markers, code spans, and fenced code untouched.
            markdown.inline.ruler.before('emphasis', 'mew_annotation', (state, silent) => {
              if (state.src.charCodeAt(state.pos) !== 94) return false
              const match = /^\^\[([1-9]\d*)\]/.exec(state.src.slice(state.pos))
              if (!match || !Number.isSafeInteger(Number(match[1]))) return false
              if (!silent) {
                const token = state.push('html_inline', '', 0)
                token.content = `<sup data-annotation-number="${match[1]}">${match[1]}</sup>`
              }
              state.pos += match[0].length
              return true
            })
          },
        },
      },
    }
  },
})

export interface AnnotationMarkerHit { from: number; to: number; num: number; id: string | null; copiedFrom: string | null }
export interface AnnotationEntry { pos: number; nodeSize: number; num: number; content: string; id: string | null }
interface AnnotationSection { from: number; to: number; entriesStart: number }
interface AnnotationList { pos: number; nodeSize: number }
export interface AnnotationScan {
  markers: AnnotationMarkerHit[]
  entries: AnnotationEntry[]
  sectionFrom: number
  sectionTo: number
  list: { pos: number; nodeSize: number } | null
  entriesStart: number | null
  sections: AnnotationSection[]
  lists: AnnotationList[]
}

const scanCache = new WeakMap<PMNode, AnnotationScan>()

function annotationBlockText(block: PMNode): string {
  if (block.childCount && Array.from({ length: block.childCount }, (_, index) => block.child(index)).every((node) => node.type.name === 'hardBreak')) {
    // Markdown's DOM parser combines consecutive empty <br/> paragraphs into one block.
    return '\n'.repeat(block.childCount - 1)
  }
  let text = ''
  block.descendants((node) => {
    if (node.isText) {
      const marker = node.marks.find((mark) => mark.type.name === 'annotationMarker')
      text += marker ? `^[${marker.attrs.num}]` : node.text
    } else if (node.type.name === 'hardBreak') text += '\n'
  })
  return text
}

export function scanAnnotations(doc: PMNode): AnnotationScan {
  const cached = scanCache.get(doc)
  if (cached) return cached
  const sections: AnnotationSection[] = []
  let active: AnnotationSection | null = null
  doc.forEach((node, offset) => {
    if (node.type.name !== 'heading') return
    if (active) { active.to = offset; active = null }
    if (node.attrs.level === 1 && node.textContent === ANNOTATIONS_HEADING) {
      active = { from: offset, to: doc.content.size, entriesStart: offset + node.nodeSize }
      sections.push(active)
    }
  })
  const lists: AnnotationList[] = []
  const entries: AnnotationEntry[] = []
  doc.forEach((node, offset) => {
    if (!sections.some((section) => offset >= section.entriesStart && offset < section.to) || node.type.name !== 'orderedList') return
    lists.push({ pos: offset, nodeSize: node.nodeSize })
    const start = Number(node.attrs.start) || 1
    node.forEach((item, itemOffset, index) => {
      entries.push({
        pos: offset + 1 + itemOffset, nodeSize: item.nodeSize, num: start + index,
        id: item.attrs.annotationId ?? null,
        // textBetween omits separators between empty blocks. Explicitly joining the children
        // preserves input consisting only of blank lines as well as trailing blank paragraphs.
        content: Array.from({ length: item.childCount }, (_, child) => {
          const block = item.child(child)
          return annotationBlockText(block)
        }).join('\n'),
      })
    })
  })
  const markers: AnnotationMarkerHit[] = []
  doc.descendants((node, pos) => {
    if (sections.some((section) => pos >= section.from && pos < section.to)) return false
    const marker = node.isText && node.marks.find((mark) => mark.type.name === 'annotationMarker')
    if (marker) markers.push({ from: pos, to: pos + node.nodeSize, num: Number(marker.attrs.num), id: marker.attrs.id ?? null, copiedFrom: marker.attrs.copiedFrom ?? null })
    return true
  })
  const scan = {
    markers, entries, sections, lists,
    sectionFrom: sections[0]?.from ?? Infinity,
    sectionTo: sections[0]?.to ?? Infinity,
    entriesStart: sections[0]?.entriesStart ?? null,
    list: lists[0] ?? null,
  }
  scanCache.set(doc, scan)
  return scan
}

export const annotationKey = new PluginKey<DecorationSet>('mewAnnotations')
const normalizeMeta = 'mewNormalizeAnnotations'
const normalizedMeta = 'mewAnnotationsNormalized'

function sectionDecorations(doc: PMNode): DecorationSet {
  const scan = scanAnnotations(doc)
  if (scan.sectionFrom === Infinity) return DecorationSet.empty
  const decorations: Decoration[] = []
  doc.forEach((node, pos) => {
    if (scan.sections.some((section) => pos >= section.from && pos < section.to)) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'mew-annotation-section', 'aria-hidden': 'true' }))
    }
  })
  return DecorationSet.create(doc, decorations)
}

function legacyIdentity(num: number): string { return `source:${num}` }
function markerIdentity(marker: AnnotationMarkerHit): string { return marker.id ?? legacyIdentity(marker.num) }
function entryIdentity(entry: AnnotationEntry): string { return entry.id ?? legacyIdentity(entry.num) }
function newIdentity(): string {
  // randomUUID requires a secure context; getRandomValues also works on LAN HTTP.
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  const words = new Uint32Array(4)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(words)
  else for (let index = 0; index < words.length; index++) words[index] = Math.floor(Math.random() * 0x100000000)
  return Array.from(words, (word) => word.toString(16).padStart(8, '0')).join('-')
}

function itemWithIdentity(item: PMNode, id: string): PMNode {
  return item.attrs.annotationId === id ? item : item.type.create({ ...item.attrs, annotationId: id }, item.content, item.marks)
}

function contentIdentity(item: PMNode): string {
  let hash = 2166136261
  const content = JSON.stringify(item.content.toJSON())
  for (let index = 0; index < content.length; index++) hash = Math.imul(hash ^ content.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(36)
}

/** Keep item identity separate from its displayed number so offline edits can merge safely. */
function normalizeAnnotations(tr: Transaction, previousDoc: PMNode): void {
  const mappingStart = tr.mapping.maps.length
  const scan = scanAnnotations(tr.doc)
  const previous = scanAnnotations(previousDoc)
  const { heading, paragraph, listItem, orderedList } = tr.doc.type.schema.nodes
  if (!heading || !paragraph || !listItem || !orderedList) return
  const mapped = (pos: number, bias = 1) => tr.mapping.slice(mappingStart).map(pos, bias)
  const currentIds = new Set(scan.markers.map(markerIdentity))
  const removed = new Set(previous.markers.filter((marker) => {
    const id = markerIdentity(marker)
    if (currentIds.has(id)) return false
    const entry = scan.entries.find((entry) => entryIdentity(entry) === id)
    const oldEntry = previous.entries.find((entry) => entryIdentity(entry) === id)
    // Full Markdown replacements may introduce a different manually authored section.
    return entry && oldEntry && tr.doc.nodeAt(entry.pos) === previousDoc.nodeAt(oldEntry.pos)
  }).map(markerIdentity))

  const consumed = new Set<AnnotationEntry>()
  const usedIds = new Set<string>()
  const items: PMNode[] = []
  const markerIds: string[] = []
  for (const marker of scan.markers) {
    const originalId = markerIdentity(marker)
    let id = originalId
    // Copied markers get their own item; deterministic suffixes also converge when two
    // replicas normalize the same pasted duplicate before exchanging those changes.
    let copy = 1
    while (usedIds.has(id)) id = `${originalId}:copy:${copy++}`
    usedIds.add(id)
    markerIds.push(id)
    const entry = scan.entries.find((entry) => entryIdentity(entry) === (marker.copiedFrom ?? originalId))
      ?? scan.entries.find((entry) => entry.num === marker.num)
    const existing = entry && tr.doc.nodeAt(entry.pos)
    items.push(existing ? itemWithIdentity(existing, id) : listItem.create({ annotationId: id }, paragraph.create()))
    if (entry) consumed.add(entry)
  }
  // Preserve unmatched source entries. Duplicate CRDT copies with identical identity and
  // content are collapsed; differing contents remain visible as a separate recoverable item.
  for (const entry of scan.entries) {
    if (consumed.has(entry) || removed.has(entryIdentity(entry))) continue
    const item = tr.doc.nodeAt(entry.pos)
    if (!item) continue
    let id = entryIdentity(entry)
    if (usedIds.has(id)) {
      if (items.some((existing) => existing.attrs.annotationId === id && existing.content.eq(item.content))) continue
      id = `${id}:content:${contentIdentity(item)}`
      if (usedIds.has(id)) continue
    }
    usedIds.add(id)
    consumed.add(entry)
    items.push(itemWithIdentity(item, id))
  }

  // Give existing items identities with attribute steps, preserving their shared Yjs text.
  for (const entry of scan.entries) {
    const item = tr.doc.nodeAt(entry.pos)
    const id = entryIdentity(entry)
    if (item && item.attrs.annotationId !== id) tr.setNodeMarkup(entry.pos, undefined, { ...item.attrs, annotationId: id })
  }

  const primary = scan.sections[0]
  const primaryList = scan.lists.find((list) => primary && list.pos >= primary.entriesStart && list.pos < primary.to)
  let listPos: number | null = primaryList?.pos ?? null
  if (items.length && listPos === null) {
    if (primary) {
      listPos = primary.entriesStart
      tr.insert(listPos, orderedList.create({ start: 1 }, items))
    } else {
      const title = heading.create({ level: 1 }, tr.doc.type.schema.text(ANNOTATIONS_HEADING))
      const at = tr.doc.content.size
      tr.insert(at, [title, orderedList.create({ start: 1 }, items)])
      listPos = at + title.nodeSize
    }
  } else if (listPos !== null) {
    if (items.length === 0) tr.delete(listPos, listPos + tr.doc.nodeAt(listPos)!.nodeSize)
    else {
      // Reconcile in place. Replacing the entire list on every remote change would copy
      // both users' items concurrently and repeatedly duplicate their CRDT contents.
      let cursor = listPos + 1
      for (let index = 0; index < items.length; index++) {
        const desired = items[index]
        let current = tr.doc.nodeAt(listPos)!.maybeChild(index)
        while (current && !current.eq(desired)) {
          const currentId = current.attrs.annotationId
          const neededLater = items.slice(index + 1).some((item) => item.attrs.annotationId === currentId && item.content.eq(current!.content))
          if (neededLater) break
          if (tr.doc.nodeAt(listPos)!.childCount === index + 1) {
            // Replacing the last unmatched item keeps the required listItem+ container valid.
            tr.replaceWith(cursor, cursor + current.nodeSize, desired)
            current = desired
            break
          }
          tr.delete(cursor, cursor + current.nodeSize)
          current = tr.doc.nodeAt(listPos)?.maybeChild(index) ?? null
        }
        if (!current?.eq(desired)) {
          const list = tr.doc.nodeAt(listPos)!
          let later = cursor
          for (let child = index; child < list.childCount; child++) {
            const candidate = list.child(child)
            if (candidate.eq(desired)) { tr.delete(later, later + candidate.nodeSize); break }
            later += candidate.nodeSize
          }
          // The source may belong to another section, or this is a newly inserted marker.
          tr.insert(cursor, desired)
        }
        cursor += desired.nodeSize
      }
      const list = tr.doc.nodeAt(listPos)!
      const end = listPos + list.nodeSize - 1
      if (cursor < end) tr.delete(cursor, end)
      if (tr.doc.nodeAt(listPos)?.attrs.start !== 1) tr.setNodeMarkup(listPos, undefined, { ...tr.doc.nodeAt(listPos)!.attrs, start: 1 })
    }
  }

  // Merge every reserved section into the first. Non-list manual content is retained too.
  const extraContent: PMNode[] = []
  for (const section of scan.sections.slice(1)) {
    tr.doc.forEach((node, pos) => {
      if (pos >= mapped(section.entriesStart) && pos < mapped(section.to, -1) && node.type.name !== 'orderedList' && (node.type.name !== 'paragraph' || node.content.size > 0)) extraContent.push(node)
    })
  }
  for (let index = scan.sections.length - 1; index >= 1; index--) {
    const section = scan.sections[index]
    tr.delete(mapped(section.from), mapped(section.to, -1))
  }
  // Additional lists inside the primary section have already contributed their items.
  for (let index = scan.lists.length - 1; index >= 0; index--) {
    const list = scan.lists[index]
    if (!primary || list === primaryList || list.pos >= primary.to) continue
    const from = mapped(list.pos)
    const to = mapped(list.pos + list.nodeSize, -1)
    if (to > from) tr.delete(from, to)
  }
  if (extraContent.length && primary) {
    const updated = scanAnnotations(tr.doc)
    tr.insert(updated.sectionTo, extraContent)
  }
  for (let index = scan.markers.length - 1; index >= 0; index--) {
    const marker = scan.markers[index]
    const from = mapped(marker.from)
    const to = mapped(marker.to, -1)
    const label = String(index + 1)
    if (tr.doc.textBetween(from, to) !== label) tr.replaceWith(from, to, tr.doc.type.schema.text(label, [tr.doc.type.schema.marks.annotationMarker.create({ num: index + 1, id: markerIds[index] })]))
    else if (marker.num !== index + 1 || marker.id !== markerIds[index] || marker.copiedFrom) {
      tr.removeMark(from, to, tr.doc.type.schema.marks.annotationMarker)
      tr.addMark(from, to, tr.doc.type.schema.marks.annotationMarker.create({ num: index + 1, id: markerIds[index] }))
    }
  }
  const updated = scanAnnotations(tr.doc)
  if (updated.markers.length === 0 && updated.sectionFrom !== Infinity && updated.entries.length === 0) {
    let hasContent = false
    tr.doc.forEach((node, pos) => {
      if (pos <= updated.sectionFrom || pos >= updated.sectionTo) return
      if (node.type.name !== 'paragraph' || node.content.size > 0) hasContent = true
    })
    if (!hasContent) tr.delete(updated.sectionFrom, updated.sectionTo)
  }
}

/** Insert after the selected text, preserving the selection's contents. */
export function insertAnnotation(editor: Editor): number | null {
  if (!editor.isEditable) return null
  const { state } = editor
  const scan = scanAnnotations(state.doc)
  const at = state.selection.to
  if (at >= scan.sectionFrom && at < scan.sectionTo) return null
  const $at = state.doc.resolve(at)
  if (!$at.parent.inlineContent || $at.parent.type.spec.code || (state.storedMarks ?? $at.marks()).some((mark) => mark.type.spec.code)) return null
  const num = Math.max(0, ...scan.markers.map((marker) => marker.num), ...scan.entries.map((entry) => entry.num)) + 1
  const id = newIdentity()
  const tr = state.tr.insert(at, state.schema.text(String(num), [state.schema.marks.annotationMarker.create({ num, id })]))
  normalizeAnnotations(tr, state.doc)
  tr.setMeta(normalizedMeta, true)
  const inserted = scanAnnotations(tr.doc).markers.find((marker) => marker.id === id)
  tr.setSelection(TextSelection.near(tr.doc.resolve(inserted?.to ?? at + 1), -1)).scrollIntoView()
  editor.view.dispatch(tr)
  return scanAnnotations(editor.state.doc).markers.find((marker) => marker.from === at)?.num ?? null
}

export function updateAnnotation(editor: Editor, num: number, text: string): boolean {
  if (!editor.isEditable) return false
  const scan = scanAnnotations(editor.state.doc)
  const entry = scan.entries.find((entry) => entry.num === num)
  if (!entry) return false
  const { paragraph, listItem } = editor.state.schema.nodes
  // Newlines are real paragraphs; treating input as text prevents accidental Markdown/HTML execution.
  const paragraphs = text.split(/\r?\n/).map((line) => paragraph.create(null, line ? editor.state.schema.text(line) : null))
  const item = listItem.create({ ...editor.state.doc.nodeAt(entry.pos)!.attrs }, paragraphs)
  if (editor.state.doc.nodeAt(entry.pos)?.eq(item)) return true
  editor.view.dispatch(editor.state.tr.replaceWith(entry.pos, entry.pos + entry.nodeSize, item))
  return true
}

export function deleteAnnotation(editor: Editor, num: number): boolean {
  if (!editor.isEditable) return false
  const scan = scanAnnotations(editor.state.doc)
  const markers = scan.markers.filter((marker) => marker.num === num)
  const entry = scan.entries.find((entry) => entry.num === num)
  if (markers.length === 0 && !entry) return false
  const tr = editor.state.tr
  // Normalization removes each deleted marker's item using the original list numbering.
  // An unmatched source item has no marker, so it is removed explicitly instead.
  if (markers.length === 0 && entry && scan.list) {
    const items = scan.entries.filter((item) => item.num !== num).map((item) => editor.state.doc.nodeAt(item.pos)!)
    if (items.length) tr.replaceWith(scan.list.pos, scan.list.pos + scan.list.nodeSize, editor.state.schema.nodes.orderedList.create({ start: 1 }, items))
    else tr.delete(scan.list.pos, scan.list.pos + scan.list.nodeSize)
  }
  for (let index = markers.length - 1; index >= 0; index--) tr.delete(tr.mapping.map(markers[index].from), tr.mapping.map(markers[index].to))
  normalizeAnnotations(tr, editor.state.doc)
  tr.setMeta(normalizedMeta, true)
  editor.view.dispatch(tr)
  return true
}

export interface AnnotationOptions {
  onOpen: (num: number, x: number, y: number) => void
  canInsert: () => boolean
}

export const Annotations = Extension.create<AnnotationOptions>({
  name: 'mewAnnotations',
  addOptions() { return { onOpen: () => {}, canInsert: () => true } },
  onCreate() {
    if (!this.editor.isDestroyed) this.editor.view.dispatch(this.editor.state.tr.setMeta(normalizeMeta, true).setMeta('addToHistory', false).setMeta('preventUpdate', true))
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    const { onOpen, canInsert } = this.options
    return [new Plugin<DecorationSet>({
      key: annotationKey,
      state: {
        init: (_config, state) => sectionDecorations(state.doc),
        apply: (tr, previous, _old, state) => tr.docChanged ? sectionDecorations(state.doc) : previous,
      },
      appendTransaction(transactions, oldState, state) {
        const tr = state.tr
        if (transactions.some((transaction) => (transaction.docChanged && !transaction.getMeta(normalizedMeta)) || transaction.getMeta(normalizeMeta))) normalizeAnnotations(tr, oldState.doc)
        const scan = scanAnnotations(tr.doc)
        const markerAtFrom = scan.markers.find((marker) => tr.selection.from > marker.from && tr.selection.from < marker.to)
        const markerAtTo = scan.markers.find((marker) => tr.selection.to > marker.from && tr.selection.to < marker.to)
        if (tr.selection.empty && markerAtFrom) {
          const goingBackward = state.selection.head < oldState.selection.head
          tr.setSelection(TextSelection.create(tr.doc, goingBackward ? markerAtFrom.from : markerAtFrom.to))
        } else if (!tr.selection.empty && (markerAtFrom || markerAtTo)) {
          const from = markerAtFrom?.from ?? tr.selection.from
          const to = markerAtTo?.to ?? tr.selection.to
          const forward = tr.selection.anchor <= tr.selection.head
          tr.setSelection(TextSelection.create(tr.doc, forward ? from : to, forward ? to : from))
        }
        if (scan.sectionFrom !== Infinity && tr.selection.to >= scan.sectionFrom && scan.sectionFrom > 0) {
          const visibleEnd = TextSelection.near(tr.doc.resolve(scan.sectionFrom - 1), -1).from
          if (tr.selection.from >= scan.sectionFrom && tr.selection.from < scan.sectionTo) {
            tr.setSelection(TextSelection.create(tr.doc, visibleEnd))
          } else if (tr.selection.from < scan.sectionFrom && tr.selection.to <= scan.sectionTo) {
            const forward = tr.selection.anchor <= tr.selection.head
            const visibleStart = TextSelection.near(tr.doc.resolve(tr.selection.from), 1).from
            tr.setSelection(TextSelection.create(tr.doc, forward ? visibleStart : visibleEnd, forward ? visibleEnd : visibleStart))
          }
        }
        return tr.steps.length || tr.selectionSet ? tr.setMeta(normalizedMeta, true) : null
      },
      props: {
        decorations(state) { return this.getState(state) },
        transformPasted(slice) {
          const copy = (fragment: Fragment): Fragment => {
            const children: PMNode[] = []
            fragment.forEach((node) => {
              const marks = node.marks.map((mark) => mark.type.name === 'annotationMarker'
                ? mark.type.create({ ...mark.attrs, id: newIdentity(), copiedFrom: mark.attrs.id ?? legacyIdentity(mark.attrs.num) })
                : mark)
              children.push((node.isLeaf ? node : node.copy(copy(node.content))).mark(marks))
            })
            return Fragment.fromArray(children)
          }
          return new Slice(copy(slice.content), slice.openStart, slice.openEnd)
        },
        handleKeyDown(view, event) {
          const focused = (event.target as { closest?: (selector: string) => { getAttribute(name: string): string | null; getBoundingClientRect(): { left: number; bottom: number } } } | null)?.closest?.('[data-annotation-number]')
          if (focused && (event.key === 'Enter' || event.key === ' ')) {
            const rect = focused.getBoundingClientRect()
            onOpen(Number(focused.getAttribute('data-annotation-number')), rect.left, rect.bottom)
            return true
          }
          if (!event.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && editor.isEditable) {
            const selection = editor.state.selection
            if (selection.empty) {
              const scan = scanAnnotations(editor.state.doc)
              const left = scan.markers.find((marker) => marker.to === selection.from)
              const right = scan.markers.find((marker) => marker.from === selection.from)
              if (event.key === 'Backspace' && left) return deleteAnnotation(editor, left.num)
              if (event.key === 'Delete' && right) return deleteAnnotation(editor, right.num)
              if (!event.shiftKey && ((event.key === 'ArrowLeft' && left) || (event.key === 'ArrowRight' && right))) {
                view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, event.key === 'ArrowLeft' ? left!.from : right!.to)))
                return true
              }
            }
          }
          if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.repeat || event.isComposing || (event.key !== "'" && event.code !== 'Quote')) return false
          if (!canInsert()) return false
          const num = insertAnnotation(editor)
          if (num === null) return false
          const marker = scanAnnotations(editor.state.doc).markers.find((marker) => marker.num === num)
          const coords = view.coordsAtPos(marker?.to ?? editor.state.selection.to)
          onOpen(num, coords.left, coords.bottom)
          return true
        },
        handleClick(_view, _pos, event) {
          const element = (event.target as { closest?: (selector: string) => { getAttribute(name: string): string | null } } | null)?.closest?.('[data-annotation-number]')
          if (!element) return false
          onOpen(Number(element.getAttribute('data-annotation-number')), event.clientX, event.clientY)
          return true
        },
      },
    })]
  },
})
