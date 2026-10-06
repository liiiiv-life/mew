import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { parseDocument } from 'yaml'
import { projectDocsDir, safeProjectPath } from './project-agent-settings.ts'
import { workspacePaths } from './paths.ts'
import { FeatureError } from './feature-error.ts'
import type { Feature, FeatureCommit, FeatureReport } from '../shared/features.ts'
import { pageRepresentative, representativeName } from '../shared/document-pages.ts'

export const digest = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex')
export const documentVersion = (value: string) => Number.parseInt(digest(value).slice(0, 13), 16)
export const requirementsHash = (feature: Pick<Feature, 'id' | 'title' | 'parentId' | 'content'>) => digest(JSON.stringify([feature.id, feature.title, feature.parentId, feature.content.replaceAll('\r\n', '\n').trim()]))
export type FeatureDocument = { feature: Feature; raw: string; yaml: ReturnType<typeof parseDocument>; body: string }
export type DocumentWrite = { path: string; before: string | null; content: string | null; moveFrom?: string }
const persistedStatuses = new Set(['changed', 'implemented', 'verified', 'needs-fix'])
const validId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/

export function featureDocsDir(workspace: string, fallback?: string) {
  const current = workspace === workspacePaths.root ? path.relative(workspace, workspacePaths.docsRoot) : undefined
  try { return projectDocsDir(workspace, fallback ?? current) }
  catch (error) { fail('.mew/agent-context.json', error instanceof Error ? error.message : String(error)) }
}
function fail(file: string, message: string): never { throw new FeatureError(`${file}: ${message}`, 409) }
function documentPath(workspace: string, relative: string) {
  try { return safeProjectPath(workspace, relative) }
  catch (error) { fail(relative, error instanceof Error ? error.message : String(error)) }
}
function relative(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !path.isAbsolute(value) && !value.includes('\\') && !value.includes('\0') && !value.split('/').includes('..')
}
/** Managed result headings outside fenced code; all other Markdown remains requirements. */
function sections(body: string) {
  const lines = body.split(/(?<=\n)/), headings: { name: string; start: number; end: number }[] = []
  let offset = 0, fence = ''
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = '' }
    if (!fence) {
      const heading = /^## ([^\r\n]+)\r?\n?$/.exec(line)
      if (heading) headings.push({ name: heading[1], start: offset, end: offset + line.length })
    }
    offset += line.length
  }
  return headings.map((h, index) => ({ ...h, stop: headings[index + 1]?.start ?? body.length }))
}
function bodyParts(body: string) {
  const result = { content: body, summary: '', validation: '' }
  const managed = resultSections(body)
  for (const span of managed) {
    const key = span.name === '구현 내용' ? 'summary' : 'validation'
    result[key] = [result[key], span.value].filter(Boolean).join('\n\n')
  }
  for (const span of managed.toReversed()) result.content = result.content.slice(0, span.start) + result.content.slice(span.stop)
  result.content = result.content.replace(/^\s*## 요구사항\r?\n/, '').trim()
  return result
}
function resultSections(body: string) {
  // Marker examples in fenced code are ordinary document content.
  let fence = ''
  const outside = body.split(/(?<=\n)/).map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    const hidden = !!fence || !!marker
    if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = '' }
    return hidden ? line.replace(/[^\r\n]/g, ' ') : line
  }).join('')
  const marked = [...outside.matchAll(/^<!-- mew:(implementation|validation):start -->[^\S\r\n]*\r?\n([\s\S]*?)^<!-- mew:\1:end -->[ \t]*(?:\r?\n|$)/gm)].map(match => ({ name: match[1] === 'implementation' ? '구현 내용' : '검증', start: match.index, stop: match.index + match[0].length, value: body.slice(match.index + match[0].indexOf('\n') + 1, match.index + match[0].lastIndexOf('<!--')).replace(/^## (구현 내용|검증)\r?\n/m, '').trim() }))
  return [...marked, ...sections(body).filter(span => ['구현 내용', '검증'].includes(span.name) && !marked.some(mark => span.start >= mark.start && span.start < mark.stop)).map(span => ({ ...span, value: body.slice(span.end, span.stop).trim() }))].sort((a, b) => a.start - b.start)
}

export function featureDocumentTitle(file: string): string {
  const directory = path.posix.dirname(file), name = path.posix.basename(file)
  return name === representativeName(directory) || ['MOC.md', '_MOC.md'].includes(name) ? path.posix.basename(directory) : name.replace(/\.md$/i, '')
}

export function parseFeatureDocument(file: string, raw: string, modified: string): FeatureDocument {
  try {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw)
    const yaml = parseDocument(match?.[1] ?? '', { uniqueKeys: true })
    if (yaml.errors.length) fail(file, yaml.errors[0].message)
    const fields = (yaml.toJS({ maxAliasCount: 20 }) ?? {}) as Record<string, unknown>
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) fail(file, '프론트매터는 객체여야 합니다')
    if (fields.id !== undefined && (typeof fields.id !== 'string' || !validId.test(fields.id))) fail(file, '고정 id를 확인하세요 (영문·숫자·밑줄·하이픈)')
    const status = fields.status ?? 'changed'
    if (!persistedStatuses.has(String(status))) fail(file, 'status는 changed, implemented, verified, needs-fix 중 하나여야 합니다')
    for (const key of ['created', 'updated']) if (fields[key] !== undefined && (typeof fields[key] !== 'string' || !Number.isFinite(Date.parse(fields[key] as string)))) fail(file, `${key} 날짜를 확인하세요`)
    const body = match?.[2] ?? raw
    const { content, summary, validation } = bodyParts(body)
    const files = fields.files ?? [], commits = fields.commits ?? []
    if (!Array.isArray(files) || files.length > 500 || !files.every(relative)) fail(file, 'files에는 프로젝트 상대 파일 경로를 넣으세요')
    if (!Array.isArray(commits) || commits.length > 200) fail(file, 'commits 목록을 확인하세요')
    const links: FeatureCommit[] = commits.map(item => {
      if (!item || typeof item !== 'object' || !(item.repository === '' || item.repository === '.' || relative(item.repository)) || typeof item.hash !== 'string' || !/^[0-9a-f]{7,64}$/i.test(item.hash) || item.subject !== undefined && typeof item.subject !== 'string') fail(file, '커밋 repository·hash·subject를 확인하세요')
      return { repository: item.repository === '.' ? '' : item.repository, hash: item.hash, subject: item.subject ?? '' }
    })
    const feature: Feature = {
      id: typeof fields.id === 'string' ? fields.id : digest(file), title: featureDocumentTitle(file), parentId: typeof fields.parent === 'string' ? fields.parent : null, content,
      status: status as Feature['status'], version: documentVersion(JSON.stringify([file, raw])), createdAt: String(fields.created ?? modified), updatedAt: String(fields.updated ?? fields.created ?? modified),
      documentPath: file, report: summary || validation || files.length || links.length ? { summary, validation, files, commits: links } : null,
    }
    if (fields.status_hash !== requirementsHash(feature)) {
      feature.status = 'changed'
      feature.updatedAt = modified
    }
    return { feature, yaml, raw, body }
  } catch (error) {
    if (error instanceof FeatureError) throw error
    fail(file, error instanceof Error ? error.message : String(error))
  }
}

export function readFeatureDocuments(workspace: string, docsDir: string): Map<string, FeatureDocument> {
  const folder = documentPath(workspace, `${docsDir}/features`), docs = new Map<string, FeatureDocument>()
  if (!fs.existsSync(folder)) return docs
  if (fs.lstatSync(folder).isSymbolicLink()) fail(folder, '기능 문서에는 심볼릭 링크를 사용할 수 없습니다')
  const representatives = new Map<string, string>()
  const walk = (directory: string, depth: number) => {
    if (depth > 16) fail(directory, '기능 문서 폴더가 너무 깊습니다')
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    const dir = path.relative(workspace, directory).split(path.sep).join('/')
    const legacy = `${dir}.md`
    const rep = directory === folder ? undefined : pageRepresentative(dir, entries.map(entry => ({ name: entry.name, type: entry.isFile() ? 'file' : 'dir' })))
    const representative = rep?.name === representativeName(dir) ? `${dir}/${rep.name}` : fs.existsSync(documentPath(workspace, legacy)) ? legacy : rep ? `${dir}/${rep.name}` : null
    if (representative) representatives.set(dir, representative)
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name), relative = path.relative(workspace, absolute).split(path.sep).join('/')
      if (entry.name.startsWith('.')) continue
      if (entry.isSymbolicLink()) fail(relative, '기능 문서에는 심볼릭 링크를 사용할 수 없습니다')
      if (entry.isDirectory()) { walk(absolute, depth + 1); continue }
      if (!entry.isFile() || !/\.md$/i.test(entry.name) || entry.name === 'README.md' || ['MOC.md', '_MOC.md'].includes(entry.name) && relative !== representative) continue
      if (docs.size >= 2000 || fs.statSync(absolute).size > 512_000) fail(relative, '기능 개수 또는 파일 크기 제한을 초과했습니다')
      const doc = parseFeatureDocument(relative, fs.readFileSync(absolute, 'utf8'), fs.statSync(absolute).mtime.toISOString())
      if (docs.has(doc.feature.id)) fail(relative, `중복 ID ${doc.feature.id}: ${docs.get(doc.feature.id)!.feature.documentPath}`)
      docs.set(doc.feature.id, doc)
    }
  }
  walk(folder, 0)
  const byPath = new Map([...docs.values()].map(doc => [doc.feature.documentPath!, doc]))
  for (const doc of docs.values()) {
    let dir = path.posix.dirname(doc.feature.documentPath!)
    doc.feature.parentId = null
    while (dir.startsWith(`${docsDir}/features/`)) {
      const parent = byPath.get(representatives.get(dir) ?? '')
      if (parent && parent !== doc) { doc.feature.parentId = parent.feature.id; break }
      dir = path.posix.dirname(dir)
    }
    if (doc.yaml.get('status_hash') !== requirementsHash(doc.feature)) { doc.feature.status = 'changed'; doc.feature.updatedAt = fs.statSync(documentPath(workspace, doc.feature.documentPath!)).mtime.toISOString() }
    else doc.feature.status = String(doc.yaml.get('status') ?? 'changed') as Feature['status']
  }
  validateHierarchy([...docs.values()].map(doc => doc.feature))
  return docs
}
export function validateHierarchy(features: Feature[]) {
  const byId = new Map(features.map(feature => [feature.id, feature]))
  for (const feature of features) {
    const seen = new Set([feature.id]); let parent = feature.parentId
    while (parent) {
      if (seen.has(parent)) fail(feature.documentPath ?? feature.id, '상위 기능 순환을 제거하세요')
      seen.add(parent)
      const ancestor = byId.get(parent)
      if (!ancestor) fail(feature.documentPath ?? feature.id, `상위 기능 ${parent}을 찾을 수 없습니다`)
      parent = ancestor.parentId
    }
  }
}
export function serializeFeature(feature: Feature, old?: FeatureDocument): string {
  const yaml = old ? parseDocument(old.yaml.toString()) : parseDocument('')
  if (yaml.toJS() == null) yaml.contents = null
  yaml.set('id', feature.id); yaml.set('parent', feature.parentId); yaml.set('title', feature.title)
  if (!old) yaml.set('description', `기능: ${feature.title}`)
  yaml.set('status', feature.status === 'implementing' ? 'changed' : feature.status)
  yaml.set('created', feature.createdAt); yaml.set('updated', feature.updatedAt)
  yaml.set('status_hash', requirementsHash(feature))
  const report = feature.report
  if (report || !old) { yaml.set('files', report?.files ?? []); yaml.set('commits', report?.commits ?? []) }
  let body = old?.body ?? `\n## 요구사항\n\n${feature.content}\n`
  if (old && feature.content !== old.feature.content) {
    const reports = resultSections(body).map(span => body.slice(span.start, span.stop)).join('\n')
    body = `\n## 요구사항\n\n${feature.content}\n\n${reports}`
  }
  if (JSON.stringify(report ?? null) !== JSON.stringify(old?.feature.report ?? null)) {
    for (const span of resultSections(body).toReversed()) body = body.slice(0, span.start) + body.slice(span.stop)
    for (const [name, value] of [['구현 내용', report?.summary ?? ''], ['검증', report?.validation ?? '']]) {
      const key = name === '구현 내용' ? 'implementation' : 'validation'
      if (/<!-- mew:(implementation|validation):(start|end) -->/.test(value)) throw new FeatureError('구현 결과에 mew 섹션 구분자를 넣을 수 없습니다')
      const text = `<!-- mew:${key}:start -->\n## ${name}\n\n${value}\n\n<!-- mew:${key}:end -->\n\n`
      body = `${body.trimEnd()}\n\n${text}`
    }
  }
  return `---\n${yaml.toString({ lineWidth: 0 })}---\n${body}`
}

/** Recovery accepts either the old bytes or already-written new bytes, never an external edit. */
export function applyDocumentWrites(workspace: string, writes: DocumentWrite[]) {
  for (const write of writes) {
    const file = documentPath(workspace, write.path)
    if (write.moveFrom) {
      const source = documentPath(workspace, write.moveFrom)
      const from = fs.existsSync(source) ? digest(fs.readFileSync(source)) : null
      const to = fs.existsSync(file) ? digest(fs.readFileSync(file)) : null
      if (!(from === write.before && to === null || from === null && (to === write.before || write.content !== null && to === digest(write.content)))) fail(write.path, '다른 편집과 문서 이동이 충돌했습니다')
      continue
    }
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
    if (current !== write.content && (current === null ? null : digest(current)) !== write.before) fail(write.path, '다른 편집과 저장이 충돌했습니다. 원본과 서버의 pendingWrites를 확인하세요')
  }
  for (const write of [...writes.filter(write => write.content !== null), ...writes.filter(write => write.content === null)]) {
    const file = documentPath(workspace, write.path)
    if (write.moveFrom) {
      const source = documentPath(workspace, write.moveFrom)
      if (fs.existsSync(source)) {
        if (fs.existsSync(file) || digest(fs.readFileSync(source)) !== write.before) fail(write.path, '이동 직전 파일이 변경되었습니다')
        fs.mkdirSync(path.dirname(file), { recursive: true }); fs.renameSync(source, file)
      }
      if (write.content === null) {
        if (digest(fs.readFileSync(file)) !== write.before) fail(write.path, '이동한 파일이 변경되었습니다')
        continue
      }
    }
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
    if (current === write.content) continue
    if ((current === null ? null : digest(current)) !== write.before) fail(write.path, '저장 직전 파일이 변경되었습니다')
    if (write.content === null) { fs.unlinkSync(file); continue }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temporary = `${file}.${crypto.randomUUID()}.tmp`
    try {
      fs.writeFileSync(temporary, write.content, { flag: 'wx', mode: current === null ? 0o644 : fs.statSync(file).mode & 0o777 })
      if (current === null) { fs.linkSync(temporary, file); fs.unlinkSync(temporary) } else fs.renameSync(temporary, file)
    } finally { fs.rmSync(temporary, { force: true }) }
  }
  const directories = new Set<string>()
  for (const write of writes.filter(write => write.content === null || write.moveFrom)) {
    let dir = path.dirname(documentPath(workspace, write.moveFrom ?? write.path))
    while (dir !== path.resolve(workspace) && dir !== path.dirname(dir)) { directories.add(dir); dir = path.dirname(dir) }
  }
  for (const dir of [...directories].sort((a, b) => b.length - a.length)) if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
}

export function mergeFeatureReport(previous: FeatureReport | null | undefined, next: FeatureReport): FeatureReport {
  return { ...next, files: [...new Set([...(previous?.files ?? []), ...next.files])], commits: [...new Map([...(previous?.commits ?? []), ...next.commits].map(commit => [`${commit.repository}:${commit.hash}`, commit])).values()] }
}
