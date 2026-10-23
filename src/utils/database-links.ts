import { syntaxTree } from '@codemirror/language'
import { htmlLanguage } from '@codemirror/lang-html'
import type { Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { parseDbId, parseReadonly } from '../../packages/editor/src/database/databaseMarkdown.ts'

export type DatabaseLink = { id: string; readonly: boolean }

function decorations(view: EditorView): DecorationSet {
  const marks: Range<Decoration>[] = []
  const seen = new Set<number>()
  for (const range of view.visibleRanges) {
    syntaxTree(view.state).iterate({ from: range.from, to: range.to, enter(node) {
      if (node.name !== 'HTMLBlock' || seen.has(node.from)) return
      seen.add(node.from)
      const html = view.state.sliceDoc(node.from, node.to)
      htmlLanguage.parser.parse(html).iterate({ enter(element) {
        if (element.name !== 'Element') return
        const tag = element.node.getChild('OpenTag'), name = tag?.getChild('TagName')
        if (!name || html.slice(name.from, name.to).toLowerCase() !== 'div' || !element.node.getChild('CloseTag')) return
        const attributes = new Map(tag!.getChildren('Attribute').map(attribute => {
          const key = attribute.getChild('AttributeName')!, value = attribute.getChild('AttributeValue')
          const text = value ? html.slice(value.from, value.to) : ''
          return [html.slice(key.from, key.to).toLowerCase(), /^(['"])[\s\S]*\1$/.test(text) ? text.slice(1, -1) : text]
        }))
        const id = parseDbId(attributes.get('data-mew-db'))
        if (!id) return
        marks.push(Decoration.mark({ class: 'cm-database-link', attributes: {
          'data-database-link': id,
          'data-database-readonly': String(parseReadonly(attributes.get('data-mew-db-readonly'))),
        } }).range(node.from + element.from, node.from + element.to))
        return false
      } })
      return false
    } })
  }
  return Decoration.set(marks, true)
}

export function databaseLinks(open: (reference: DatabaseLink) => void) {
  const target = (event: MouseEvent) => event.button === 0 && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
    ? (event.target as Element | null)?.closest<HTMLElement>('[data-database-link]') : null
  return [
    ViewPlugin.fromClass(class {
      decorations: DecorationSet
      constructor(view: EditorView) { this.decorations = decorations(view) }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = decorations(update.view)
      }
    }, { decorations: value => value.decorations }),
    EditorView.theme({ '.cm-database-link': { color: 'var(--color-link)', textDecoration: 'underline', textUnderlineOffset: '2px' } }),
    EditorView.domEventHandlers({
      mousedown(event) {
        if (!target(event)) return false
        event.preventDefault()
        return true
      },
      click(event) {
        const link = target(event)
        if (!link) return false
        event.preventDefault()
        open({ id: link.dataset.databaseLink!, readonly: link.dataset.databaseReadonly === 'true' })
        return true
      },
    }),
  ]
}
