import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({ html: false, linkify: true })
markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrSet('target', '_blank')
  tokens[index].attrSet('rel', 'noopener noreferrer')
  return renderer.renderToken(tokens, index, options)
}
/** Source ranges, not a Markdown rewrite: editing one item preserves every other byte. */
export function specificationItems(source: string): Array<{ start: number; end: number; text: string; heading: boolean }> {
  if (!source.trim()) return []
  const offsets = [0]
  for (let index = 0; index < source.length; index++) if (source[index] === '\n') offsets.push(index + 1)
  const starts = new Map<number, boolean>([[0, false]])
  for (const token of markdown.parse(source, {})) {
    if (!token.map || token.type === 'inline') continue
    if (token.level === 0 && !['bullet_list_open', 'ordered_list_open'].includes(token.type) || token.type === 'list_item_open') {
      starts.set(offsets[token.map[0]], token.type === 'heading_open')
    }
  }
  const points = [...starts.keys()].sort((a, b) => a - b)
  return points.flatMap((start, index) => {
    const end = points[index + 1] ?? source.length, text = source.slice(start, end)
    return text.trim() ? [{ start, end, text, heading: starts.get(start)! }] : []
  })
}

export function replaceSpecificationItem(source: string, start: number, end: number, value: string): string {
  if (start === end && start === source.length) return source + (source.trim() ? '\n\n' : '') + value.trimEnd()
  const original = source.slice(start, end)
  const trailing = original.match(/\s*$/)?.[0] ?? ''
  return source.slice(0, start) + value.trimEnd() + trailing + source.slice(end)
}

type PresentedItem = ReturnType<typeof specificationItems>[number] & { html: string; label: string; indent: number; navigation: boolean; linkHref: string | null }
const presentations = new Map<string, PresentedItem[]>()

/** Render for reading; retain the original ranges and Markdown for editing. */
export function presentedSpecificationItems(source: string, omittedHeadings: string[] = []): PresentedItem[] {
  let items = presentations.get(source)
  if (!items) {
    items = specificationItems(source).map(item => {
      const leading = /^( *)(?:[-+*]|\d+[.)])\s/.exec(item.text)?.[1] ?? ''
      const text = item.text.split('\n').map(line => line.startsWith(leading) ? line.slice(leading.length) : line).join('\n')
      const tokens = markdown.parse(text, {})
      const label = tokens.flatMap(token => token.type === 'inline'
        ? (token.children ?? []).map(child => ['text', 'code_inline', 'image'].includes(child.type) ? child.content : ['softbreak', 'hardbreak'].includes(child.type) ? ' ' : '')
        : ['fence', 'code_block'].includes(token.type) ? [token.content] : []).join('').trim()
      const navigation = /^(?:[-+*]\s+)?(?:상위(?: 기능)?|Parent(?: feature)?):\s*\[/i.test(text.trim())
      const inline = tokens.find(token => token.type === 'inline')?.children ?? []
      const linkHref = tokens.some(token => token.type === 'list_item_open') && inline[0]?.type === 'link_open' && inline.at(-1)?.type === 'link_close' && inline.filter(token => token.type === 'link_open').length === 1
        ? inline[0].attrGet('href') : null
      return { ...item, html: markdown.render(text), label, indent: Math.min(leading.length / 2, 4), navigation, linkHref }
    })
    if (presentations.size >= 200) presentations.clear()
    presentations.set(source, items)
  }
  return items.filter(item => !item.navigation && !(item.heading && omittedHeadings.includes(item.label)))
}

export function featureDocumentHref(documentPath: string | undefined, href: string): string | null {
  if (!documentPath || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return null
  try { return decodeURIComponent(new URL(href, `https://mew.invalid/${documentPath}`).pathname).slice(1) }
  catch { return null }
}
