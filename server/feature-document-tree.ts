import fs from 'node:fs'
import path from 'node:path'
import { representativeName, remapPagePath, rewritePageLinks, type DocumentPageMove } from '../shared/document-pages.ts'
import type { Feature } from '../shared/features.ts'
import { safeProjectPath } from './project-agent-settings.ts'
import { taskFilename } from './task-markdown.ts'
import { digest, type DocumentWrite, type FeatureDocument } from './feature-documents.ts'
import { FeatureError } from './feature-error.ts'

/** Plan the same leaf/representative layout as Documents before touching disk. */
export function featureDocumentPaths(workspace: string, docsDir: string, features: Feature[], old: Map<string, FeatureDocument>): Map<string, string> {
  const paths = new Map<string, string>(), used = new Set<string>(), visiting = new Set<string>()
  const byId = new Map(features.map(feature => [feature.id, feature]))
  const childIds = new Set(features.flatMap(feature => feature.parentId ? [feature.parentId] : []))
  const oldPaths = new Set([...old.values()].map(doc => doc.feature.documentPath!))
  const retainedDirectory = (feature: Feature) => {
    const file = old.get(feature.id)?.feature.documentPath
    if (!file || path.posix.basename(file) !== representativeName(path.posix.dirname(file)) && !['MOC.md', '_MOC.md'].includes(path.posix.basename(file))) return false
    const dir = path.posix.dirname(file)
    return fs.readdirSync(safeProjectPath(workspace, dir)).some(name => {
      const relative = `${dir}/${name}`
      return relative !== file && !oldPaths.has(relative) && ![...oldPaths].some(file => file.startsWith(`${relative}/`))
    })
  }
  const locate = (feature: Feature): string => {
    if (paths.has(feature.id)) return paths.get(feature.id)!
    if (visiting.has(feature.id)) throw new FeatureError('상위 기능 순환을 제거하세요', 409)
    visiting.add(feature.id)
    const parent = feature.parentId ? byId.get(feature.parentId) : null
    if (feature.parentId && !parent) throw new FeatureError('상위 기능을 찾을 수 없습니다', 409)
    const directory = parent ? path.posix.dirname(locate(parent)) : `${docsDir}/features`
    const name = taskFilename(feature.title.replace(/\.md$/i, ''))
    if (name.startsWith('_') || ['MOC', 'README'].includes(name)) throw new FeatureError('밑줄 접두사와 MOC·README는 대표·안내 문서의 예약 이름입니다')
    feature.title = name
    const logical = `${directory}/${name}`, key = logical.normalize('NFC').toLowerCase()
    if (used.has(key)) throw new FeatureError(`같은 이름의 기능 문서가 이미 있습니다: ${name}`, 409)
    used.add(key)
    const next = childIds.has(feature.id) || retainedDirectory(feature) ? `${logical}/${representativeName(logical)}` : `${logical}.md`
    paths.set(feature.id, next); visiting.delete(feature.id)
    return next
  }
  features.forEach(locate)
  return paths
}

/** Include source deletions and relative-link updates in the recoverable write batch. */
export function featureTreeWrites(workspace: string, docsDir: string, old: Map<string, FeatureDocument>, contents: Map<string, { path: string; content: string }>): DocumentWrite[] {
  const writes = new Map<string, DocumentWrite>(), moves: DocumentPageMove[] = []
  const original = new Map([...old.values()].map(doc => [doc.feature.documentPath!, doc.raw]))
  const put = (file: string, content: string | null) => {
    const absolute = safeProjectPath(workspace, file)
    const before = original.get(file) ?? (fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null)
    if (content !== before) writes.set(file, { path: file, before: before === null ? null : digest(before), content })
  }
  const sources = new Set([...old.values()].map(doc => doc.feature.documentPath!))
  for (const [id, next] of contents) {
    const source = old.get(id)?.feature.documentPath
    if (source && source !== next.path) { moves.push({ from: source, to: next.path }); put(source, null) }
    if (source && (path.posix.basename(source) === representativeName(path.posix.dirname(source)) || ['MOC.md', '_MOC.md'].includes(path.posix.basename(source))) && path.posix.dirname(source) !== path.posix.dirname(next.path) && path.posix.basename(next.path) === representativeName(path.posix.dirname(next.path))) moves.push({ from: path.posix.dirname(source), to: path.posix.dirname(next.path), directory: true })
    if (!sources.has(next.path) && fs.existsSync(safeProjectPath(workspace, next.path))) throw new FeatureError(`같은 이름의 문서가 이미 있습니다: ${next.path}`, 409)
    const logical = path.posix.basename(next.path) === representativeName(path.posix.dirname(next.path)) ? path.posix.dirname(next.path) : next.path.slice(0, -3)
    const opposite = next.path === `${logical}.md` ? logical : `${logical}.md`
    const managedDirectory = old.get(id)?.feature.documentPath === `${opposite}/${representativeName(opposite)}` || old.get(id)?.feature.documentPath === `${opposite}/MOC.md` || old.get(id)?.feature.documentPath === `${opposite}/_MOC.md`
    const legacyDirectory = next.path.startsWith(`${opposite}/`) && source === `${opposite}.md` && [...sources].some(file => file.startsWith(`${opposite}/`))
    if (!sources.has(opposite) && fs.existsSync(safeProjectPath(workspace, opposite)) && !managedDirectory && !legacyDirectory) throw new FeatureError(`같은 이름의 문서가 이미 있습니다: ${opposite}`, 409)
  }
  for (const [id, next] of contents) {
    const source = old.get(id)?.feature.documentPath ?? next.path
    next.content = rewritePageLinks(next.content, source, next.path, moves)
    put(next.path, next.content)
    if (writes.get(next.path)?.content === null) writes.delete(next.path)
  }
  if (moves.length) {
    const visit = (dir: string) => {
      const absolute = safeProjectPath(workspace, dir)
      if (!fs.existsSync(absolute)) return
      for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        const file = `${dir}/${entry.name}`
        const moved = moves.some(move => move.directory && file.startsWith(`${move.from}/`))
        if (entry.name === 'archives' || entry.isSymbolicLink() || entry.name.startsWith('.') && !moved) continue
        if (entry.isDirectory()) visit(file)
        else if (entry.isFile() && !sources.has(file)) {
          const next = remapPagePath(file, moves)
          if (next === file && !/\.md$/i.test(entry.name)) continue
          if (next !== file && fs.existsSync(safeProjectPath(workspace, next))) throw new FeatureError(`같은 이름의 파일이 이미 있습니다: ${next}`, 409)
          const bytes = fs.readFileSync(safeProjectPath(workspace, file))
          const raw = /\.md$/i.test(entry.name) ? bytes.toString('utf8') : null
          const content = raw === null ? null : rewritePageLinks(raw, file, next, moves)
          if (next !== file) writes.set(next, { path: next, moveFrom: file, before: digest(bytes), content })
          else if (raw !== null && content !== raw) put(file, content)
        }
      }
    }
    visit(docsDir)
  }
  return [...writes.values()]
}
