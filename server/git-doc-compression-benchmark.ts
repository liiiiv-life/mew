/** Offline research tool. Never changes the index, creates commits, or calls a model. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { diffChars } from 'diff'
import MarkdownIt from 'markdown-it'
import { parseDocument } from 'yaml'
import assert from 'node:assert/strict'

import { encodeEdit, decodeEdit, type Edit } from './git-diff-codec.ts'
export { encodeEdit, decodeEdit } from './git-diff-codec.ts'
interface Hunk { oldStart: number; oldCount: number; newStart: number; newCount: number; edit: Edit }
interface DocumentChange { path: string; before: string; after: string; oldMode: string; newMode: string; hunks: Hunk[] }
interface PackedFile { path: string; mode: [string, string]; hunks: (Omit<Hunk, 'edit'> & { edit: Edit | number })[] }
export interface PackedChanges { format: string; definitions: Edit[]; files: PackedFile[] }
const json = (value: unknown) => JSON.stringify(value)
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? []
const markdown = new MarkdownIt({ html: true, linkify: false, typographer: false })

export function editOperations(before: string, after: string): { at: number; old: string; new: string }[] {
  const parts = diffChars(before, after, { timeout: 15 })
  if (!parts) return [{ at: 0, old: before, new: after }]
  const operations: { at: number; old: string; new: string }[] = []
  let at = 0, old = '', added = ''
  const flush = () => {
    if (old || added) operations.push({ at, old, new: added })
    at += old.length; old = ''; added = ''
  }
  for (const part of parts) {
    if (part.removed) old += part.value
    else if (part.added) added += part.value
    else { flush(); at += part.value.length }
  }
  flush()
  return operations
}

export function restoreOperations(before: string, operations: ReturnType<typeof editOperations>): string {
  let cursor = 0, restored = ''
  for (const operation of operations) {
    assert.ok(operation.at >= cursor)
    assert.equal(before.slice(operation.at, operation.at + operation.old.length), operation.old)
    restored += before.slice(cursor, operation.at) + operation.new
    cursor = operation.at + operation.old.length
  }
  return restored + before.slice(cursor)
}

/** Full edit coverage, but omitted unchanged context is explicitly NOT semantically lossless. */
function windowedChanges(changes: DocumentChange[], window: number): string {
  const headings = (text: string) => {
    const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text)
    const shift = lines(frontmatter?.[0] ?? '').length
    const stack: string[] = [], result: { line: number; section: string[] }[] = []
    const tokens = markdown.parse(text.slice(frontmatter?.[0].length ?? 0), {})
    tokens.forEach((token, index) => {
      if (token.type !== 'heading_open' || !token.map) return
      const level = +token.tag.slice(1)
      stack.length = level - 1; stack[level - 1] = tokens[index + 1].content
      result.push({ line: token.map[0] + shift, section: stack.filter(Boolean) })
    })
    return result
  }
  const files = changes.map(change => {
    const sections = headings(change.before)
    return {
      path: change.path, mode: [change.oldMode, change.newMode],
      hunks: change.hunks.map(hunk => {
        const [before, after] = decodeEdit(hunk.edit)
        const operations = editOperations(before, after)
        const restored = restoreOperations(before, operations)
        assert.equal(restored, after)
        const section = sections.findLast(s => s.line < hunk.oldStart)?.section ?? []
        return { oldStart: hunk.oldStart, oldCount: hunk.oldCount, newStart: hunk.newStart, newCount: hunk.newCount, section,
          edits: operations.map(operation => ({ ...operation,
            prefix: before.slice(Math.max(0, operation.at - window), operation.at),
            suffix: before.slice(operation.at + operation.old.length, operation.at + operation.old.length + window),
          })) }
      }),
    }
  })
  return json({ format: 'Every character edit is present: at is its UTF-16 offset inside the original hunk. old/new are complete changed runs. prefix/suffix and section provide partial unchanged context. This is NOT full semantic context. Original hunk retrieval remains necessary for ambiguous intent.', files })
}

/** Merge overlapping context windows; choose complete evidence when the windows cost more. */
function adaptiveWindows(changes: DocumentChange[], window: number): string {
  return json({ format: 'All changed characters are included. context=complete includes the full changed hunk; context=local omits unchanged text outside the supplied windows. Shared strings and [old,new] have the exact-delta meanings. Local context may require original hunk retrieval.',
    files: changes.map(change => ({ path: change.path, mode: [change.oldMode, change.newMode],
      hunks: change.hunks.map(hunk => {
        const [before, after] = decodeEdit(hunk.edit)
        const groups: ReturnType<typeof editOperations>[] = []
        for (const operation of editOperations(before, after)) {
          const group = groups.at(-1), last = group?.at(-1)
          if (!last || operation.at - last.at - last.old.length > window * 2) groups.push([operation])
          else group!.push(operation)
        }
        const windows = groups.map(group => {
          const at = Math.max(0, group[0].at - window)
          const last = group.at(-1)!
          const end = Math.min(before.length, last.at + last.old.length + window)
          const old = before.slice(at, end)
          const next = restoreOperations(old, group.map(operation => ({ ...operation, at: operation.at - at })))
          return { at, edit: encodeEdit(old, next) }
        })
        assert.equal(restoreOperations(before, windows.map(record => {
          const [old, next] = decodeEdit(record.edit)
          return { at: record.at, old, new: next }
        })), after)
        const complete = { context: 'complete', edit: encodeEdit(before, after) }
        const local = { context: 'local', windows }
        const payload = json(local).length < json(complete).length ? local : complete
        const { edit: _edit, ...range } = hunk
        return { ...range, ...payload }
      }),
    })),
  })
}

/** Parse Git U0 patches, retaining the no-final-newline markers on either side. */
export function parseHunks(patch: string): Hunk[] {
  const hunks: Hunk[] = []
  let current: Hunk | undefined, before = '', after = '', previous = ''
  const finish = () => {
    if (!current) return
    current.edit = { before, after }; hunks.push(current)
    current = undefined; before = ''; after = ''
  }
  for (const line of lines(patch)) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (match) {
      finish()
      current = { oldStart: +match[1], oldCount: match[2] === undefined ? 1 : +match[2], newStart: +match[3], newCount: match[4] === undefined ? 1 : +match[4], edit: { before: '', after: '' } }
    } else if (current) {
      if (line.startsWith('-')) before += line.slice(1)
      else if (line.startsWith('+')) after += line.slice(1)
      else if (line.startsWith('\\ No newline')) {
        if (previous === '-') before = before.slice(0, -1)
        else if (previous === '+') after = after.slice(0, -1)
      } else throw new Error('Unexpected context in U0 patch')
    }
    previous = line[0]
  }
  finish()
  return hunks
}

/** Validate the packed changes against full immutable before/after contents. */
export function restoreDocument(before: string, hunks: Hunk[]): string {
  const original = lines(before)
  let cursor = 0, restored = ''
  for (const hunk of hunks) {
    const offset = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1
    assert.ok(offset >= cursor)
    const [old, changed] = decodeEdit(hunk.edit)
    assert.equal(original.slice(offset, offset + hunk.oldCount).join(''), old)
    restored += original.slice(cursor, offset).join('') + changed
    cursor = offset + hunk.oldCount
  }
  return restored + original.slice(cursor).join('')
}

export function packChanges(changes: DocumentChange[], compact: boolean, factor: boolean): PackedChanges {
  const files: PackedFile[] = changes.map(change => ({
    path: change.path, mode: [change.oldMode, change.newMode],
    hunks: change.hunks.map(hunk => {
      const [before, after] = decodeEdit(hunk.edit)
      return { ...hunk, edit: compact ? encodeEdit(before, after) : { before, after } }
    }),
  }))
  const definitions: Edit[] = []
  if (factor) {
    const counts = new Map<string, number>()
    for (const file of files) for (const hunk of file.hunks) {
      const key = json(hunk.edit); counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const indexes = new Map<string, number>()
    for (const file of files) for (const hunk of file.hunks) {
      const key = json(hunk.edit), count = counts.get(key)!
      if (count <= 1 || (count - 1) * key.length <= 16 + count * 5) continue
      let id = indexes.get(key)
      if (id === undefined) { id = definitions.length; definitions.push(hunk.edit as Edit); indexes.set(key, id) }
      hunk.edit = id
    }
  }
  for (const [index, file] of files.entries()) {
    const hunks = file.hunks.map(hunk => ({ ...hunk, edit: typeof hunk.edit === 'number' ? definitions[hunk.edit] : hunk.edit }))
    assert.equal(restoreDocument(changes[index].before, hunks), changes[index].after)
  }
  return { format: 'Exact document delta. A shared string occurs on both sides; [old,new] is a replacement. Numeric edit IDs refer to definitions. Every changed hunk is included; unchanged surrounding file content is omitted.', definitions, files }
}

function syntax(text: string): { metadata: string; body: string; valid: boolean } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  const doc = match ? parseDocument(match[1], { uniqueKeys: true }) : null
  const value = doc?.toJS() ?? null
  const normalize = (token: ReturnType<typeof markdown.parse>[number]): unknown => ({
    type: token.type, tag: token.tag, nesting: token.nesting, attrs: token.attrs,
    content: token.content, info: token.info, markup: token.markup, hidden: token.hidden,
    children: token.children?.map(normalize),
  })
  return { metadata: json(value), body: json(markdown.parse(text.slice(match?.[0].length ?? 0), {}).map(normalize)), valid: !doc?.errors.length }
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30_000 })
}
function treeEntries(cwd: string, tree: string, files: string[]) {
  return new Map(git(cwd, ['ls-tree', '-rz', tree, '--', ...files.map(file => `:(literal)${file}`)]).split('\0').filter(Boolean).map(entry => {
    const tab = entry.indexOf('\t'), [mode, type, blob] = entry.slice(0, tab).split(' ')
    if (type !== 'blob') throw new Error('Only text blobs are supported in this research tool')
    return [entry.slice(tab + 1), { mode, blob }]
  }))
}
function getChanges(cwd: string, head: string, tree: string, files: string[]): DocumentChange[] {
  const oldEntries = treeEntries(cwd, head, files), newEntries = treeEntries(cwd, tree, files)
  const readBlob = (blob: string) => {
    const bytes = execFileSync('git', ['cat-file', 'blob', blob], { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 30_000 })
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  }
  return files.map(file => {
    const old = oldEntries.get(file), next = newEntries.get(file)
    if (old?.mode === '120000' || next?.mode === '120000') throw new Error('Symlink changes need a separate representation')
    const before = old ? readBlob(old.blob) : ''
    const after = next ? readBlob(next.blob) : ''
    if (before.includes('\0') || after.includes('\0')) throw new Error('Binary input needs a separate representation')
    const patch = git(cwd, ['diff', '--no-renames', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=0', head, tree, '--', `:(literal)${file}`])
    const hunks = parseHunks(patch)
    assert.equal(restoreDocument(before, hunks), after)
    return { path: file, before, after, oldMode: old?.mode ?? '', newMode: next?.mode ?? '', hunks }
  })
}

function sampleChanges(repeated: boolean): DocumentChange[] {
  return Array.from({ length: 100 }, (_, id) => {
    const shared = repeated ? '공통 제품의 동일 안내를 유지하고 ' : `고유 항목 ${id}의 서로 다른 설명과 세부 링크 ${id}를 유지하고 `
    const before = `${shared.repeat(20)}접근을 허용한다.\n`
    const after = `${shared.repeat(20)}접근을 허용하지 않는다.\n`
    const edit = { before, after }
    return { path: `documents/${id}.md`, before, after, oldMode: '100644', newMode: '100644', hunks: [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, edit }] }
  })
}

/** Repeated vs unique *additions* expose when lossless compression has little to remove. */
function addedChanges(repeated: boolean): DocumentChange[] {
  return Array.from({ length: 100 }, (_, id) => {
    const after = Array.from({ length: 25 }, (_, line) => repeated ? `동일 제품의 공통 안내 문장 ${line}.\n` : `문서 ${id}의 고유 요구사항 ${line}은 ${id * 37 + line}값과 자료 ${id}-${line}를 설명한다.\n`).join('')
    return { path: `new-documents/${id}.md`, before: '', after, oldMode: '', newMode: '100644', hunks: [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 25, edit: { before: '', after } }] }
  })
}

function summary(changes: DocumentChange[], inputs: Record<string, string>) {
  const categories = { sameMarkdownAndMetadata: 0, sameMarkdownChangedMetadata: 0, changedMarkdown: 0, invalidMetadata: 0 }
  for (const change of changes) {
    const old = syntax(change.before), next = syntax(change.after)
    if (!old.valid || !next.valid) categories.invalidMetadata++
    else if (old.body !== next.body) categories.changedMarkdown++
    else if (old.metadata !== next.metadata) categories.sameMarkdownChangedMetadata++
    else categories.sameMarkdownAndMetadata++
  }
  return { files: changes.length, hunks: changes.reduce((n, change) => n + change.hunks.length, 0), fullReconstructionVerified: true, categories, characters: Object.fromEntries(Object.entries(inputs).map(([key, text]) => [key, text.length])) }
}
function representations(changes: DocumentChange[]): Record<string, string> {
  return {
    completeChangedText: json(packChanges(changes, false, false)),
    sharedText: json(packChanges(changes, true, false)),
    sharedTextAndDictionary: json(packChanges(changes, true, true)),
    allEditsContext32: windowedChanges(changes, 32),
    allEditsContext80: windowedChanges(changes, 80),
    allEditsContext160: windowedChanges(changes, 160),
    adaptiveContext32: adaptiveWindows(changes, 32),
    adaptiveContext80: adaptiveWindows(changes, 80),
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
  const snapshotPath = option('--snapshot'), directory = option('--emit-directory')
  if (!snapshotPath) throw new Error('Usage: node server/git-doc-compression-benchmark.ts --snapshot <JSON with head,tree,files> [--emit-directory <private temporary directory>]')
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as { head: string; tree: string; files: string[] }
  if (!/^[a-f0-9]{40,64}$/.test(snapshot.head) || !/^[a-f0-9]{40,64}$/.test(snapshot.tree) || !snapshot.files.length || snapshot.files.some(file => !file.toLowerCase().endsWith('.md'))) throw new Error('An explicit immutable Markdown snapshot is required')
  const started = performance.now()
  const changes = getChanges(process.cwd(), snapshot.head, snapshot.tree, snapshot.files)
  const captureMs = performance.now() - started
  const raw = (context: number) => git(process.cwd(), ['diff', '--no-renames', '--no-ext-diff', '--no-textconv', '--no-color', `--unified=${context}`, snapshot.head, snapshot.tree, '--', ...snapshot.files.map(file => `:(literal)${file}`)])
  const inputs = { gitU3: raw(3), gitU0: raw(0), ...representations(changes) }
  const prepareMs = performance.now() - started
  const report: Record<string, unknown> = { scope: 'Offline representation experiment; no model quality or end-to-end latency measured', head: snapshot.head, tree: snapshot.tree, captureMs, prepareMs, real: summary(changes, inputs), synthetic: {} }
  const collections: Record<string, Record<string, string>> = { real: inputs }
  for (const [name, sample] of Object.entries({ repeatedReplacement: sampleChanges(true), uniqueReplacement: sampleChanges(false), repeatedAddition: addedChanges(true), uniqueAddition: addedChanges(false) })) {
    collections[name] = representations(sample)
    ;(report.synthetic as Record<string, unknown>)[name] = summary(sample, collections[name])
  }
  if (directory) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    for (const [corpus, values] of Object.entries(collections)) for (const [name, text] of Object.entries(values)) fs.writeFileSync(path.join(directory, `${corpus}-${name}.txt`), text, { mode: 0o600 })
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}
