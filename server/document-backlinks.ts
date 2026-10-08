import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DocumentLinkIndex, documentLinks, type DocumentLinkEntry } from './document-link-index.ts'

export type DocumentBacklink = { path: string; title: string }
export type DocumentBacklinks = { documents: DocumentBacklink[]; skipped: number }
const EXCLUDED = new Set(['.git', 'node_modules', '.data', 'dist', 'build', '.next', '.venv', 'venv'])

function linkTarget(source: string, href: string): string | null {
  if (!href || href.startsWith('#') || href.startsWith('//')) return null
  try {
    if (href.startsWith('file:')) return fileURLToPath(new URL(href))
    if (/^[a-z][a-z\d+.-]*:/i.test(href)) return null
    const clean = decodeURIComponent(href.split(/[?#]/)[0])
    return clean ? path.resolve(path.dirname(source), clean) : null
  } catch { return null }
}

type Network = {
  entries: Map<string, DocumentLinkEntry>
  outgoing: Map<string, Set<string>>
  incoming: Map<string, Set<string>>
}

/** Incrementally maintain reverse edges using the same parsed index as the graph. */
export class DocumentBacklinkIndex {
  private networks = new Map<string, Network>()
  private index: DocumentLinkIndex
  constructor(index = new DocumentLinkIndex()) { this.index = index }

  async read(target: string, roots: string[], mayRead: (absolute: string) => boolean): Promise<DocumentBacklinks> {
    const wanted = await fs.realpath(target)
    const files = new Set<string>(), seen = new Set<string>()
    let skipped = 0
    const walk = async (directory: string): Promise<void> => {
      let real: string
      try { real = await fs.realpath(directory) } catch { return }
      if (seen.has(real)) return
      seen.add(real)
      let children
      try { children = await fs.readdir(real, { withFileTypes: true }) } catch { skipped++; return }
      for (const child of children) {
        const absolute = path.join(real, child.name)
        if (child.isDirectory() && !EXCLUDED.has(child.name)) await walk(absolute)
        else if (child.isFile() && /\.md$/i.test(child.name) && mayRead(absolute)) files.add(absolute)
      }
    }
    for (const root of roots) await walk(root)
    const visible = [...files], entries = new Map<string, DocumentLinkEntry>()
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(12, visible.length) }, async () => {
      while (cursor < visible.length) {
        const absolute = visible[cursor++]
        try {
          if (!mayRead(absolute)) continue
          const entry = await this.index.read(absolute)
          if (entry) entries.set(absolute, entry)
          else skipped++
        } catch { skipped++; this.index.remove(absolute) }
      }
    }))
    const key = JSON.stringify([...new Set(roots.map(root => path.resolve(root)))].sort())
    const previous = this.networks.get(key)
    const fileSetChanged = !previous || entries.size !== previous.entries.size || [...entries.keys()].some(file => !previous.entries.has(file))
    const outgoing = new Map(fileSetChanged ? [] : previous.outgoing)
    const incoming = new Map(fileSetChanged ? [] : previous.incoming)
    const names = new Map<string, string | null>()
    for (const absolute of entries.keys()) {
      const name = path.basename(absolute, path.extname(absolute))
      names.set(name, names.has(name) ? null : absolute)
    }
    const resolved = new Map<string, Promise<string | null>>()
    const resolve = (absolute: string): Promise<string | null> => {
      if (entries.has(absolute) || absolute === wanted) return Promise.resolve(absolute)
      let request = resolved.get(absolute)
      if (!request) { request = fs.realpath(absolute).catch(() => null); resolved.set(absolute, request) }
      return request
    }
    const destinations = async (source: string, rawLinks: string[]): Promise<Set<string>> => {
      const targets = new Set<string>()
      for (const raw of rawLinks) {
        const wiki = raw.startsWith('wiki:'), href = wiki ? raw.slice(5) : raw
        const candidate = linkTarget(source, href)
        if (!candidate) continue
        let linked = await resolve(candidate)
        if (!linked && !path.extname(candidate)) linked = await resolve(candidate + '.md')
        if (!linked && wiki && !href.includes('/')) linked = names.get(href.split('#')[0].replace(/\.md$/i, '')) ?? null
        if (linked && linked !== source) targets.add(linked)
      }
      return targets
    }
    for (const [absolute, entry] of entries) {
      if (!fileSetChanged && previous.entries.get(absolute) === entry) continue
      for (const oldTarget of outgoing.get(absolute) ?? []) {
        const sources = new Set(incoming.get(oldTarget)); sources.delete(absolute)
        if (sources.size) incoming.set(oldTarget, sources); else incoming.delete(oldTarget)
      }
      const targets = await destinations(absolute, entry.links)
      outgoing.set(absolute, targets)
      for (const newTarget of targets) incoming.set(newTarget, new Set([...(incoming.get(newTarget) ?? []), absolute]))
    }
    if (this.networks.size >= 4 && !this.networks.has(key)) this.networks.delete(this.networks.keys().next().value!)
    this.networks.set(key, { entries, outgoing, incoming })
    const targetEntry = entries.get(wanted) ?? await this.index.read(wanted)
    const parentLinks = targetEntry?.parents.flatMap(value => documentLinks(value).links.length ? documentLinks(value).links : [value]) ?? []
    const parents = await destinations(wanted, parentLinks)
    const documents = [...(incoming.get(wanted) ?? [])]
      .filter(source => !parents.has(source) && mayRead(source))
      .map(source => ({ path: source, title: entries.get(source)!.title }))
      .sort((a, b) => a.title.localeCompare(b.title) || a.path.localeCompare(b.path))
    return { documents, skipped }
  }
}
