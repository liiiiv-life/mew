import fs from 'node:fs/promises'
import path from 'node:path'
import MarkdownIt from 'markdown-it'
import { parseTitle } from './frontmatter.ts'
import type { DocumentGraphData, DocumentGraphNode } from '../shared/document-graph.ts'

const markdown = new MarkdownIt({ html: false, linkify: false })
const MAX_BYTES = 8 * 1024 * 1024

/** Parse Markdown, including reference links; code and images never create edges. */
export function documentLinks(content: string): { title: string | null; links: string[] } {
  const links = new Set<string>()
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  for (const block of markdown.parse(body, {})) {
    for (const token of block.children ?? []) {
      if (token.type === 'link_open') {
        const href = token.attrGet('href')
        if (href) links.add(href)
      }
      // Wiki-style links are optional syntax; only ordinary text is scanned.
      if (token.type === 'text') for (const match of token.content.matchAll(/\[\[([^\]\n]+)\]\]/g)) links.add(`wiki:${match[1].split('|')[0]}`)
    }
  }
  return { title: parseTitle(content), links: [...links] }
}

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

type Entry = { stamp: string; node: DocumentGraphNode; links: string[] }

/** One bounded, incremental cache per active docs root. Contents are never returned. */
export class DocumentGraphIndex {
  private root = ''
  private cache = new Map<string, Entry>()
  private dirty = new Set<string>()
  invalidate(paths: string[]): void { for (const rel of paths) this.dirty.add(rel) }

  async read(root: string, files: string[], mayRead: (rel: string) => boolean): Promise<DocumentGraphData> {
    if (this.root !== root) { this.root = root; this.cache = new Map(); this.dirty = new Set() }
    // Capture each request's root/cache so a workspace handoff cannot mix graphs.
    const cache = this.cache, dirty = this.dirty
    const visible = files.filter(rel => /\.md$/i.test(rel) && mayRead(rel)).sort()
    const existing = new Set(files)
    for (const rel of cache.keys()) if (!existing.has(rel)) cache.delete(rel)
    const result: (Entry | null)[] = new Array(visible.length).fill(null)
    const realRoot = await fs.realpath(root)
    let cursor = 0, skipped = 0
    await Promise.all(Array.from({ length: Math.min(12, visible.length) }, async () => {
      while (cursor < visible.length) {
        const index = cursor++, rel = visible[index]
        try {
          const absolute = path.resolve(root, rel)
          if (!absolute.startsWith(path.resolve(root) + path.sep)) continue
          const real = await fs.realpath(absolute)
          if (!real.startsWith(realRoot + path.sep)) continue
          const stat = await fs.stat(real)
          if (!stat.isFile() || stat.size > MAX_BYTES) { skipped++; continue }
          const stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`
          let entry = cache.get(rel)
          if (!entry || entry.stamp !== stamp || dirty.has(rel)) {
            dirty.delete(rel)
            const content = await fs.readFile(real, 'utf8')
            const parsed = documentLinks(content)
            entry = { stamp, node: { path: rel, title: parsed.title || path.posix.basename(rel, '.md'), group: rel.includes('/') ? rel.split('/')[0] : '' }, links: parsed.links }
            cache.set(rel, entry)
          }
          if (mayRead(rel)) result[index] = entry
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') skipped++
          cache.delete(rel)
        }
      }
    }))
    return connectDocuments(result.filter((doc): doc is Entry => doc !== null && mayRead(doc.node.path)), skipped)
  }
}
