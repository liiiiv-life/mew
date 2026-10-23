import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { isDeepStrictEqual } from 'node:util'
import { isMap, isNode, isSeq, parseDocument, type Document } from 'yaml'
import { isDeniedSegment, projectRoot, resolveProjectPath } from '../paths.ts'
import { noteFileContentChanged } from '../fileCatalog.ts'
import type { DatabaseView } from './databaseService.ts'
import type { Exec } from './pool.ts'
import { documentPageTarget, representativeName, remapPagePath, rewritePageLinks, type DocumentPageMove, type DocumentPageMutation } from '../../shared/document-pages.ts'

type Baseline = { columns: Array<{ id: string; name: string; type: string }>; cells: Record<string, unknown> }
type PageRecord = { row_id: string; path: string; baseline: Baseline }
export type PageEdit = { rowId: string; columnId: string; value: unknown }
export class RowPageError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status } }

const drafts = new AsyncLocalStorage<Map<string, { content: string; expected?: string }>>()
export function withRowPageDraft<T>(project: string, relative: string, content: string, run: () => Promise<T>, expected?: string): Promise<T> {
  return drafts.run(new Map([[resolveProjectPath(project, relative), { content, expected }]]), run)
}

function absolute(project: string, relative: string): string {
  if (!relative || relative.includes('\\') || path.posix.isAbsolute(relative) || relative.split('/').some(part => part === '..' || part === 'archives')) {
    throw new RowPageError('데이터베이스 페이지 경로를 사용할 수 없습니다')
  }
  const resolved = resolveProjectPath(project, relative)
  let ancestor = resolved
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor)
  const root = fs.realpathSync(projectRoot(project)), real = fs.realpathSync(ancestor)
  if (real !== root && !real.startsWith(root + path.sep)) throw new RowPageError('프로젝트 밖의 페이지에는 연결할 수 없습니다')
  return resolved
}

function read(project: string, relative: string): string | null {
  const file = absolute(project, relative)
  const draft = drafts.getStore()?.get(file)
  if (draft !== undefined) return draft.content
  try { return fs.readFileSync(file, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}

function frontmatter(content: string | null): { doc: Document; body: string } {
  if (content === null) return { doc: parseDocument(''), body: '\n' }
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (!match) throw new RowPageError('연결된 페이지의 프론트매터가 필요합니다')
  const doc = parseDocument(match[1])
  if (doc.errors.length || !doc.toJS() || Array.isArray(doc.toJS()) || typeof doc.toJS() !== 'object') {
    throw new RowPageError('페이지 프론트매터를 올바른 YAML 필드로 입력하세요')
  }
  if (isMap(doc.contents)) doc.contents.flow = false
  return { doc, body: content.slice(match[0].length) }
}

export function hasDatabasePageBinding(content: string): boolean {
  try { return typeof frontmatter(content).doc.get('_mew_database') === 'string' }
  catch { return false }
}

function field(column: { id: string; name: string }, primary: string): string { return column.id === primary ? 'title' : column.name }
function assertBinding(doc: Document, dbId: string, rowId?: string): void {
  if (doc.get('_mew_database') !== dbId || (rowId !== undefined && doc.get('_mew_row') !== rowId)) {
    throw new RowPageError('페이지의 데이터베이스 연결 정보가 일치하지 않습니다')
  }
}
async function records(q: Exec, dbId: string): Promise<PageRecord[]> {
  return (await q<PageRecord>('SELECT row_id, path, baseline FROM mew.row_pages WHERE database_id = $1', [dbId])).rows
}

// Rebind moved pages only when the recorded file is missing. Never follow symlinks
// or adopt a copy whose original still exists.
function movedPage(project: string, dbId: string, rowId: string): string | null {
  const matches: string[] = [], root = projectRoot(project)
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'archives' || isDeniedSegment(entry.name)) continue
      const relative = path.posix.join(directory, entry.name)
      if (entry.isDirectory()) visit(relative)
      else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        const content = fs.readFileSync(path.join(root, relative), 'utf8')
        if (!content.includes(dbId) || !content.includes(rowId)) continue
        try {
          const { doc } = frontmatter(content)
          if (doc.get('_mew_database') === dbId && doc.get('_mew_row') === rowId) matches.push(relative)
        } catch { /* Unrelated invalid Markdown cannot take over a row binding. */ }
      }
    }
  }
  visit('')
  if (matches.length > 1) throw new RowPageError('같은 행에 연결된 페이지가 여러 개입니다. 연결 정보를 확인하세요')
  return matches[0] ?? null
}

/** Only fields changed since the last successful synchronization become DB edits. */
export async function readPageEdits(project: string, view: DatabaseView, q: Exec): Promise<PageEdit[]> {
  if (view.kind !== 'managed' || view.columns[0]?.type !== 'page') return []
  const edits: PageEdit[] = []
  for (const record of await records(q, view.id)) {
    if (!view.rows.some(row => row.id === record.row_id)) continue
    let content = read(project, record.path)
    if (content === null) {
      const recovered = movedPage(project, view.id, record.row_id)
      if (recovered) {
        record.path = recovered
        await q('UPDATE mew.row_pages SET path = $1 WHERE database_id = $2 AND row_id = $3', [recovered, view.id, record.row_id])
        content = read(project, recovered)
      }
    }
    if (content === null) continue
    const { doc } = frontmatter(content)
    assertBinding(doc, view.id, record.row_id)
    const values = doc.toJS() as Record<string, unknown>
    const draft = drafts.getStore()?.get(absolute(project, record.path))
    const expected = draft?.expected === undefined ? null : frontmatter(draft.expected).doc.toJS() as Record<string, unknown>
    for (const column of view.columns) {
      const oldColumn = record.baseline.columns?.find(c => c.id === column.id)
      if (!oldColumn) continue
      const key = field(oldColumn, view.columns[0].id)
      const raw = Object.hasOwn(values, key) ? values[key] : null
      const value = column.type === 'checkbox' && (raw === 'true' || raw === 'false') ? raw === 'true' : raw
      if (expected && isDeepStrictEqual(value, expected[key] ?? null)) continue
      if (expected && !isDeepStrictEqual(expected[key] ?? null, record.baseline.cells?.[column.id] ?? null)
        && !isDeepStrictEqual(value, record.baseline.cells?.[column.id] ?? null)) {
        throw new RowPageError('다른 곳에서 변경한 필드입니다. 페이지를 다시 연 뒤 저장하세요')
      }
      if (!isDeepStrictEqual(value, record.baseline.cells?.[column.id] ?? null)) edits.push({ rowId: record.row_id, columnId: column.id, value })
    }
  }
  return edits
}

function markdownFiles(project: string, directory = ''): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(path.join(projectRoot(project), directory), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'archives' || isDeniedSegment(entry.name)) continue
    const relative = path.posix.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...markdownFiles(project, relative))
    else if (entry.isFile() && /\.md$/i.test(entry.name)) files.push(relative)
  }
  return files
}

export function rowPageName(title: string): string {
  let name = Array.from(title.trim()).map(char => char.charCodeAt(0) < 32 ? ' ' : char).join('').replace(/\.md$/i, '').replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/, '')
  while (Buffer.byteLength(name) > 180) name = [...name].slice(0, -1).join('')
  if (!name) name = '페이지'
  if (/^[._]/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || name === 'archives' || isDeniedSegment(name) || /^MOC$/i.test(name)) name = `페이지 ${name}`
  return name
}

/** File writes participate in the caller's DB transaction through explicit undo/commit. */
export async function syncDatabasePages(project: string, view: DatabaseView, q: Exec): Promise<{ rollback(): void; commit(): void; mutation?: DocumentPageMutation }> {
  const pending = new Map<string, string>(), before = new Map<string, string | null>(), madeDirs: string[] = []
  const moves: DocumentPageMove[] = [], removals = new Set<string>()
  const previous = view.kind === 'managed' ? await records(q, view.id) : []
  const primary = view.columns[0]
  const rollback = () => {
    for (const [relative, original] of [...before].reverse()) {
      const file = absolute(project, relative)
      if (original === null) fs.rmSync(file, { force: true })
      else fs.writeFileSync(file, original, 'utf8')
    }
    for (const directory of madeDirs.reverse()) { try { fs.rmdirSync(directory) } catch { /* Existing content is preserved. */ } }
  }
  const commit = () => {
    for (const relative of removals) {
      let directory = path.dirname(absolute(project, relative))
      while (directory !== projectRoot(project)) {
        try { fs.rmdirSync(directory) } catch { break }
        directory = path.dirname(directory)
      }
    }
    for (const relative of new Set([...pending.keys(), ...removals])) noteFileContentChanged(project, relative)
  }
  if (view.kind !== 'managed') return { rollback, commit }
  try {
    // Detach instead of deleting page bodies when their row or page type is removed.
    for (const record of previous) {
      if (view.rows.some(row => row.id === record.row_id)) continue
      await q('DELETE FROM mew.row_pages WHERE database_id = $1 AND row_id = $2', [view.id, record.row_id])
    }
    if (primary?.type === 'page') {
      let ownerPath = view.ownerPath
      if (!ownerPath || read(project, ownerPath) === null) {
        const matches = markdownFiles(project).filter(relative => read(project, relative)?.includes(`data-mew-db="${view.id}"`))
        if (matches.length > 1 || ownerPath && !matches.length) throw new RowPageError('데이터베이스를 포함한 원본 문서를 확인하세요')
        ownerPath = matches[0] ?? null
      }
      let directory = ownerPath ? documentPageTarget(ownerPath) : ''
      if (ownerPath && directory === ownerPath && !drafts.getStore()) {
        directory = ownerPath.replace(/\.md$/i, '')
        if (!/\.md$/i.test(ownerPath) || fs.existsSync(absolute(project, directory))) throw new RowPageError('하위 페이지 폴더 이름이 기존 파일과 겹칩니다')
        const representative = `${directory}/${representativeName(directory)}`
        moves.push({ from: ownerPath, to: representative })
        pending.set(representative, read(project, ownerPath)!)
        removals.add(ownerPath)
        ownerPath = representative
      }
      if (ownerPath !== view.ownerPath) {
        await q('UPDATE mew.databases SET owner_path = $1 WHERE id = $2', [ownerPath, view.id])
        view.ownerPath = ownerPath
      }
      const legacyRepresentative = [
        ...previous.map(record => `${path.posix.dirname(record.path)}/_${view.id}.md`),
        path.posix.join('데이터베이스', view.id, `_${view.id}.md`),
        path.posix.join(ownerPath ? path.posix.dirname(ownerPath) : '', '데이터베이스', view.id, `_${view.id}.md`),
      ]
      for (const row of view.rows) {
        const record = previous.find(p => p.row_id === row.id)
        let relative = record?.path ?? ''
        let content = relative ? read(project, relative) : null
        if (record && content === null) {
          const recovered = movedPage(project, view.id, row.id)
          if (recovered) { relative = recovered; content = read(project, relative) }
        }
        const oldPath = relative
        const legacy = relative.endsWith(`/데이터베이스/${view.id}/${row.id}.md`) || relative === `데이터베이스/${view.id}/${row.id}.md`
        // Existing user-selected paths stay stable, including after a title edit.
        if (!relative || legacy && !drafts.getStore()) {
          const name = rowPageName(String(row.cells[primary.id]))
          let index = 1
          do {
            relative = path.posix.join(directory, `${name}${index === 1 ? '' : ` ${index}`}.md`)
            index++
          } while (pending.has(relative) || fs.existsSync(absolute(project, relative)) || fs.existsSync(absolute(project, relative.slice(0, -3))))
          if (oldPath && oldPath !== relative) { moves.push({ from: oldPath, to: relative }); removals.add(oldPath) }
        }
        const { doc, body } = frontmatter(content)
        if (content !== null) assertBinding(doc, view.id, row.id)
        const currentKeys = new Set(view.columns.map(col => field(col, primary.id)))
        for (const old of record?.baseline.columns ?? []) {
          const key = field(old, primary.id)
          if (!currentKeys.has(key)) doc.delete(key)
        }
        for (const column of view.columns) {
          const key = field(column, primary.id)
          const priorNode = doc.get(key, true)
          const valueNode = doc.createNode(row.cells[column.id] ?? null)
          if (isNode(priorNode)) { valueNode.comment = priorNode.comment; valueNode.commentBefore = priorNode.commentBefore }
          doc.set(key, valueNode)
          if (column.id !== primary.id) {
            const node = doc.get(key, true)
            if (isNode(node)) {
              if (isSeq(node)) node.flow = true
              const type = column.type === 'multi_select' ? 'multi-select' : column.type === 'checkbox' ? 'text' : column.type
              const settings = { type, ...(column.options ? { options: column.options, optionColors: column.optionColors ?? {} } : {}) }
              const comments = node.comment?.split('\n').filter(line => !line.trimStart().startsWith('mew:field ')).join('\n')
              node.comment = `${comments ? comments + '\n' : ''} mew:field ${JSON.stringify(settings)}`
            }
          }
        }
        doc.set('_mew_database', view.id)
        doc.set('_mew_row', row.id)
        if (ownerPath) doc.set('상위파일', path.posix.relative(path.posix.dirname(relative), ownerPath))
        else doc.delete('상위파일')
        if (!doc.has('description')) doc.set('description', String(row.cells[primary.id]))
        pending.set(relative, `---\n${doc.toString()}---\n${body}`)
        const baseline: Baseline = { columns: view.columns.map(({ id, name, type }) => ({ id, name, type })), cells: row.cells }
        await q(`INSERT INTO mew.row_pages (database_id, row_id, path, baseline) VALUES ($1, $2, $3, $4::jsonb)
          ON CONFLICT (database_id, row_id) DO UPDATE SET path = EXCLUDED.path, baseline = EXCLUDED.baseline`, [view.id, row.id, relative, JSON.stringify(baseline)])
      }
      for (const representative of new Set(legacyRepresentative)) {
        if (!representative.includes(`데이터베이스/${view.id}/`)) continue
        const content = read(project, representative)
        if (!content) continue
        const parent = frontmatter(content)
        if (parent.doc.get('_mew_database') === view.id && !parent.body.trim()
          && fs.readdirSync(path.dirname(absolute(project, representative))).every(name => {
            const relative = path.posix.join(path.posix.dirname(representative), name)
            return relative === representative || removals.has(relative)
          })) removals.add(representative)
      }
    }
    if (moves.length) {
      for (const relative of markdownFiles(project)) {
        if (removals.has(relative) && !moves.some(move => move.from === relative)) continue
        const next = remapPagePath(relative, moves)
        const original = read(project, relative)!
        const content = pending.get(next) ?? original
        const rewritten = rewritePageLinks(content, relative, next, moves)
        if (next !== relative || rewritten !== original) pending.set(next, rewritten)
      }
      for (const move of moves) {
        await q('UPDATE mew.databases SET owner_path = $1 WHERE project = $2 AND owner_path = $3', [move.to, project, move.from])
        await q(`UPDATE mew.row_pages p SET path = $1 FROM mew.databases d
          WHERE d.id = p.database_id AND d.project = $2 AND p.path = $3`, [move.to, project, move.from])
      }
    }
    for (const relative of removals) before.set(relative, fs.existsSync(absolute(project, relative)) ? fs.readFileSync(absolute(project, relative), 'utf8') : null)
    for (const [relative, content] of pending) {
      const file = absolute(project, relative), original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
      if (original === content) { pending.delete(relative); continue }
      // All changes are preflighted before opening any destination file.
      before.set(relative, original)
    }
    for (const relative of pending.keys()) {
      const file = absolute(project, relative), missing: string[] = []
      let directory = path.dirname(file)
      while (!fs.existsSync(directory)) { missing.push(directory); directory = path.dirname(directory) }
      for (const dir of missing.reverse()) { fs.mkdirSync(dir); madeDirs.push(dir) }
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        fs.writeFileSync(temporary, pending.get(relative)!, { flag: 'wx', mode: before.get(relative) === null ? 0o644 : fs.statSync(file).mode & 0o777 })
        fs.renameSync(temporary, file)
      } finally { fs.rmSync(temporary, { force: true }) }
    }
    for (const relative of removals) fs.rmSync(absolute(project, relative), { force: true })
    const changed = [...new Set([...pending.keys(), ...removals])]
    return { rollback, commit, ...(moves.length ? { mutation: { path: view.ownerPath ?? '', moves, changed } } : {}) }
  } catch (error) { rollback(); throw error }
}

export async function decoratePageRows(project: string, view: DatabaseView, q: Exec): Promise<DatabaseView> {
  if (view.columns[0]?.type !== 'page' || view.kind !== 'managed') return view
  const paths = new Map((await records(q, view.id)).map(record => [record.row_id, record.path]))
  return { ...view, rows: view.rows.map(row => {
    const pagePath = paths.get(row.id)
    if (pagePath) absolute(project, pagePath)
    return { ...row, ...(pagePath ? { pagePath } : {}) }
  }) }
}
