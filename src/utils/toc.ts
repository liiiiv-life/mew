export interface TocNode {
  id: string
  level: number
  text: string
  index: number
  children: TocNode[]
}

interface FlatHeading {
  level: number
  text: string
  index: number
}

/** Parses ATX headings (#..######) from markdown, skipping anything inside fenced code blocks. */
function flattenHeadings(markdown: string): FlatHeading[] {
  const out: FlatHeading[] = []
  let inFence = false
  let fenceMarker = ''
  let index = 0
  for (const line of markdown.split('\n')) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1][0].repeat(fence[1].length)
      } else if (line.trim().startsWith(fenceMarker)) {
        inFence = false
      }
      continue
    }
    if (inFence) continue
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!heading) continue
    out.push({ level: heading[1].length, text: heading[2].trim(), index: index++ })
  }
  return out
}

function buildTree(flat: FlatHeading[]): TocNode[] {
  const root: TocNode[] = []
  const stack: TocNode[] = []
  for (const h of flat) {
    const node: TocNode = { id: `h-${h.index}`, level: h.level, text: h.text, index: h.index, children: [] }
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop()
    if (stack.length === 0) root.push(node)
    else stack[stack.length - 1].children.push(node)
    stack.push(node)
  }
  return root
}

export function parseHeadings(markdown: string): TocNode[] {
  return buildTree(flattenHeadings(markdown))
}
