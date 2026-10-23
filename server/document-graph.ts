import fs from 'node:fs/promises'
import path from 'node:path'
import { DocumentLinkIndex } from './document-link-index.ts'
export { documentLinks } from './document-link-index.ts'
import type { DocumentGraphData, DocumentGraphNode } from '../shared/document-graph.ts'

function localTarget(source: string, raw: string): string | null {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(raw) || raw.includes('\\')) return null
  let clean: string
  try { clean = decodeURIComponent(raw.split(/[?#]/)[0]) } catch { return null }
  if (!clean) return null
  const target = path.posix.normalize(clean.startsWith('/') ? clean.slice(1) : path.posix.join(path.posix.dirname(source), clean))
  return target === '..' || target.startsWith('../') ? null : target
}

export function connectDocuments(documents: { node: DocumentGraphNode; links: string[] }[], skipped = 0): DocumentGraphData {
  const paths = new Map(documents.map((doc, index) => [doc.node.path, index]))
  const names = new Map<string, number | null>()
  documents.forEach((doc, index) => {
    const name = path.posix.basename(doc.node.path).replace(/\.md$/i, '')
    names.set(name, names.has(name) ? null : index)
  })
  const edges: [number, number][] = []
  documents.forEach((doc, source) => {
    const targets = new Set<number>()
    for (const raw of doc.links) {
      const wiki = raw.startsWith('wiki:')
      const href = wiki ? raw.slice(5) : raw
      const relative = localTarget(doc.node.path, href)
      if (!relative) continue
      let target = paths.get(relative) ?? paths.get(`${relative}.md`)
      if (wiki && target === undefined) {
        const rootTarget = localTarget('', `/${href}`)
        target = rootTarget ? paths.get(rootTarget) ?? paths.get(`${rootTarget}.md`) : undefined
        if (target === undefined && !href.includes('/')) target = names.get(href.split('#')[0].replace(/\.md$/i, '')) ?? undefined
      }
      if (target !== undefined && target !== source) targets.add(target)
    }
    for (const target of targets) edges.push([source, target])
  })
  return { nodes: documents.map(doc => doc.node), edges, skipped }
}

/** Docs graph projects the shared absolute-path link index into relative nodes. */
export class DocumentGraphIndex {
  private root = ''
  private index: DocumentLinkIndex
  constructor(index = new DocumentLinkIndex()) { this.index = index }
  invalidate(paths: string[]): void { this.index.invalidate(paths.map(rel => path.resolve(this.root || '.', rel))) }

  async read(root: string, files: string[], mayRead: (rel: string) => boolean): Promise<DocumentGraphData> {
    this.root = root
    const visible = files.filter(rel => /\.md$/i.test(rel) && mayRead(rel)).sort()
    const result: ({ node: DocumentGraphNode; links: string[] } | null)[] = new Array(visible.length).fill(null)
    const realRoot = await fs.realpath(root)
    let cursor = 0, skipped = 0
    await Promise.all(Array.from({ length: Math.min(12, visible.length) }, async () => {
      while (cursor < visible.length) {
        const i = cursor++, rel = visible[i]
        try {
          const absolute = path.resolve(root, rel)
          if (!absolute.startsWith(path.resolve(root) + path.sep)) continue
          const real = await fs.realpath(absolute)
          if (!real.startsWith(realRoot + path.sep)) continue
          const entry = await this.index.read(real)
          if (!entry) { skipped++; continue }
          if (mayRead(rel)) result[i] = { node: { path: rel, title: entry.title, group: rel.includes('/') ? rel.split('/')[0] : '' }, links: entry.links }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') skipped++
          this.index.remove(path.resolve(root, rel))
        }
      }
    }))
    return connectDocuments(result.filter((doc): doc is { node: DocumentGraphNode; links: string[] } => doc !== null && mayRead(doc.node.path)), skipped)
  }
}
