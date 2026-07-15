import { syntaxTree } from '@codemirror/language'
import type { Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'

const HEADING_LEVELS: Record<string, number> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
}

const headingLineDeco = [1, 2, 3, 4, 5, 6].map((level) => Decoration.line({ attributes: { class: `cm-live-h${level}` } }))
const boldMark = Decoration.mark({ class: 'cm-live-bold' })
const italicMark = Decoration.mark({ class: 'cm-live-italic' })
const strikeMark = Decoration.mark({ class: 'cm-live-strike' })
const codeMark = Decoration.mark({ class: 'cm-live-code' })
const quoteLineDeco = Decoration.line({ attributes: { class: 'cm-live-quote' } })
/** Zero-width replace used to hide markup characters (e.g. "# ", "**") once a line is no longer being edited. */
const hiddenMark = Decoration.replace({})

class BulletWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-live-bullet'
    span.textContent = '•'
    return span
  }
}
const bulletWidget = Decoration.replace({ widget: new BulletWidget() })

class ImageWidget extends WidgetType {
  url: string
  alt: string
  constructor(url: string, alt: string) {
    super()
    this.url = url
    this.alt = alt
  }
  eq(other: ImageWidget) {
    return other.url === this.url && other.alt === this.alt
  }
  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-live-media cm-live-image'
    const img = document.createElement('img')
    img.src = this.url
    img.alt = this.alt
    wrap.appendChild(img)
    return wrap
  }
}

class AudioWidget extends WidgetType {
  url: string
  constructor(url: string) {
    super()
    this.url = url
  }
  eq(other: AudioWidget) {
    return other.url === this.url
  }
  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-live-media cm-live-audio'
    const audio = document.createElement('audio')
    audio.src = this.url
    audio.controls = true
    wrap.appendChild(audio)
    return wrap
  }
}

class VideoWidget extends WidgetType {
  url: string
  constructor(url: string) {
    super()
    this.url = url
  }
  eq(other: VideoWidget) {
    return other.url === this.url
  }
  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-live-media cm-live-video'
    const video = document.createElement('video')
    video.src = this.url
    video.controls = true
    wrap.appendChild(video)
    return wrap
  }
}

/** Live-preview marks reveal their raw markdown while the cursor is anywhere on their line — same rule Obsidian/Typora use. */
function cursorTouchesLine(view: EditorView, from: number, to: number): boolean {
  for (const range of view.state.selection.ranges) {
    if (range.from <= to && range.to >= from) return true
  }
  return false
}

function buildDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc
  const tree = syntaxTree(view.state)
  const ranges: Range<Decoration>[] = []

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const level = HEADING_LEVELS[node.name]
        if (level) {
          const line = doc.lineAt(node.from)
          ranges.push(headingLineDeco[level - 1].range(line.from))
          if (!cursorTouchesLine(view, line.from, line.to)) {
            const mark = node.node.getChild('HeaderMark')
            if (mark) {
              const rest = doc.sliceString(mark.to, line.to)
              const wsLength = /^\s*/.exec(rest)?.[0].length ?? 0
              ranges.push(hiddenMark.range(mark.from, mark.to + wsLength))
            }
          }
          return
        }

        if (node.name === 'StrongEmphasis' || node.name === 'Emphasis' || node.name === 'Strikethrough') {
          const deco = node.name === 'StrongEmphasis' ? boldMark : node.name === 'Emphasis' ? italicMark : strikeMark
          ranges.push(deco.range(node.from, node.to))
          const line = doc.lineAt(node.from)
          if (!cursorTouchesLine(view, line.from, line.to)) {
            const markName = node.name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark'
            for (const mark of node.node.getChildren(markName)) {
              ranges.push(hiddenMark.range(mark.from, mark.to))
            }
          }
          return
        }

        if (node.name === 'InlineCode') {
          ranges.push(codeMark.range(node.from, node.to))
          return
        }

        if (node.name === 'Blockquote') {
          const startLine = doc.lineAt(node.from).number
          const endLine = doc.lineAt(node.to).number
          for (let ln = startLine; ln <= endLine; ln++) {
            ranges.push(quoteLineDeco.range(doc.line(ln).from))
          }
          return
        }

        if (node.name === 'ListMark') {
          const text = doc.sliceString(node.from, node.to)
          if (text === '-' || text === '*' || text === '+') {
            const line = doc.lineAt(node.from)
            if (!cursorTouchesLine(view, line.from, line.to)) {
              ranges.push(bulletWidget.range(node.from, node.to))
            }
          }
          return
        }

        if (node.name === 'Image') {
          const line = doc.lineAt(node.from)
          if (!cursorTouchesLine(view, line.from, line.to)) {
            const marks = node.node.getChildren('LinkMark')
            const urlNode = node.node.getChild('URL')
            if (marks.length >= 2 && urlNode) {
              const alt = doc.sliceString(marks[0].to, marks[1].from)
              const url = doc.sliceString(urlNode.from, urlNode.to)
              ranges.push(Decoration.replace({ widget: new ImageWidget(url, alt) }).range(node.from, node.to))
            }
          }
          return false
        }

        if (node.name === 'HTMLTag') {
          const text = doc.sliceString(node.from, node.to)
          const isAudio = /^<audio\b/i.test(text)
          const isVideo = !isAudio && /^<video\b/i.test(text)
          if (isAudio || isVideo) {
            const closing = node.node.nextSibling
            const closeTagText = isAudio ? '</audio>' : '</video>'
            if (closing?.name === 'HTMLTag' && doc.sliceString(closing.from, closing.to).toLowerCase() === closeTagText) {
              const line = doc.lineAt(node.from)
              if (!cursorTouchesLine(view, line.from, line.to)) {
                const srcMatch = /\ssrc=["']([^"']*)["']/i.exec(text)
                if (srcMatch) {
                  const widget = isAudio ? new AudioWidget(srcMatch[1]) : new VideoWidget(srcMatch[1])
                  ranges.push(Decoration.replace({ widget }).range(node.from, closing.to))
                }
              }
            }
          }
          return
        }

        return
      },
    })
  }

  return Decoration.set(ranges, true)
}

const liveMarkdownPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

const liveMarkdownTheme = EditorView.baseTheme({
  '.cm-live-h1': { fontSize: '1.85em', fontWeight: '700', lineHeight: '1.3' },
  '.cm-live-h2': { fontSize: '1.5em', fontWeight: '700', lineHeight: '1.3' },
  '.cm-live-h3': { fontSize: '1.25em', fontWeight: '650', lineHeight: '1.35' },
  '.cm-live-h4': { fontSize: '1.1em', fontWeight: '600', lineHeight: '1.4' },
  '.cm-live-h5': { fontSize: '1em', fontWeight: '600', lineHeight: '1.4' },
  '.cm-live-h6': { fontSize: '0.92em', fontWeight: '600', lineHeight: '1.4', opacity: '0.75' },
  '.cm-live-bold': { fontWeight: '700' },
  '.cm-live-italic': { fontStyle: 'italic' },
  '.cm-live-strike': { textDecoration: 'line-through', opacity: '0.7' },
  '.cm-live-code': {
    fontSize: '0.9em',
    padding: '0.05em 0.35em',
    borderRadius: '4px',
    backgroundColor: 'color-mix(in srgb, var(--color-ink-muted) 20%, transparent)',
  },
  '.cm-live-quote': {
    borderLeft: '3px solid color-mix(in srgb, var(--color-ink-muted) 45%, transparent)',
    paddingLeft: '0.75em',
    fontStyle: 'italic',
    opacity: '0.85',
  },
  '.cm-live-bullet': {
    display: 'inline-block',
    color: 'var(--color-ink-muted)',
    fontWeight: '700',
  },
  '.cm-live-media': { display: 'inline-block', width: '100%', margin: '4px 0' },
  '.cm-live-image img': { display: 'block', maxWidth: '100%', maxHeight: '420px', borderRadius: '6px', objectFit: 'contain' },
  '.cm-live-audio audio': { display: 'block', width: '100%', maxWidth: '480px' },
  '.cm-live-video video': { display: 'block', maxWidth: '100%', maxHeight: '420px', borderRadius: '6px' },
})

export function liveMarkdown() {
  return [liveMarkdownPlugin, liveMarkdownTheme]
}
