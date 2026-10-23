import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { captureCommitChanges, type CommitSnapshot } from './git-ai-commit.ts'

const exec = promisify(execFile)
const TTL = 30 * 24 * 60 * 60_000
interface Intent { version: 1; createdAt: number; purpose: string; verification: string; files: string[]; objects: [string, string][] }
async function git(cwd: string, args: string[]) {
  return (await exec('git', args, { cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 4_000_000 })).stdout
}
async function location(cwd: string): Promise<string> {
  return path.join((await git(cwd, ['rev-parse', '--absolute-git-dir'])).trim(), 'mew-change-intents')
}
async function objects(cwd: string, snapshot: CommitSnapshot, paths = snapshot.paths): Promise<[string, string][]> {
  const entries = async (tree: string): Promise<Map<string, string>> => {
    if (!tree) return new Map()
    const raw = await git(cwd, ['ls-tree', '-rz', tree, '--', ...paths])
    return new Map(raw.split('\0').filter(Boolean).map(entry => [entry.slice(entry.indexOf('\t') + 1), entry]))
  }
  // Two batched Git reads, independent of the number of hints/files.
  const [before, after] = await Promise.all([entries(snapshot.head), entries(snapshot.tree)])
  return paths.map(literal => {
    const file = literal.slice(':(literal)'.length)
    return [literal, JSON.stringify([before.get(file) ?? '', after.get(file) ?? ''])]
  })
}

/** Advisory task intent; no source comments, index writes, commits or private transcripts. */
export async function recordChangeIntent(cwd: string, input: unknown): Promise<string> {
  const value = input as { purpose?: unknown; verification?: unknown; files?: unknown }
  if (!value || typeof value.purpose !== 'string' || !value.purpose.trim() || value.purpose.length > 2000
    || (value.verification !== undefined && (typeof value.verification !== 'string' || value.verification.length > 1000))
    || !Array.isArray(value.files) || !value.files.length || value.files.length > 200
    || value.files.some(file => typeof file !== 'string' || !file || path.isAbsolute(file) || file.split(/[\\/]/).includes('..') || file.includes('\0'))
    || new Set(value.files).size !== value.files.length) throw new Error('변경 목적·파일 목록 형식이 올바르지 않습니다')
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
  const snapshot = await captureCommitChanges(root, value.files, false)
  const intent: Intent = { version: 1, createdAt: Date.now(), purpose: value.purpose.trim(), verification: (value.verification as string | undefined) ?? '', files: snapshot.files, objects: await objects(root, snapshot) }
  const serialized = JSON.stringify(intent)
  if (Buffer.byteLength(serialized) > 128_000) throw new Error('변경 목적 기록이 너무 큽니다')
  const directory = await location(root)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw new Error('변경 목적 저장 경로가 올바르지 않습니다')
  const file = path.join(directory, `${intent.createdAt}-${crypto.randomUUID()}.json`)
  const temporary = `${file}.tmp`
  try { fs.writeFileSync(temporary, serialized, { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, file) }
  finally { fs.rmSync(temporary, { force: true }) }
  // Retain a bounded recent ledger; it is disposable project metadata, not canonical documentation.
  const records = fs.readdirSync(directory).filter(name => /^\d+-[a-f0-9-]{36}\.json$/.test(name)).sort().reverse()
  for (const name of records.slice(100)) fs.rmSync(path.join(directory, name), { force: true })
  return file
}

export async function readMatchingChangeIntents(cwd: string, snapshot: CommitSnapshot): Promise<{ purpose: string; verification: string; files: string[] }[]> {
  const directory = await location(cwd)
  try { if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) return [] }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  const names = fs.readdirSync(directory).filter(name => /^\d+-[a-f0-9-]{36}\.json$/.test(name)).sort().reverse().slice(0, 50)
  const selected = new Set(snapshot.files), paths = new Set(snapshot.paths)
  const candidates: Intent[] = []
  for (const name of names) {
    try {
      const file = path.join(directory, name), stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.size > 128_000) continue
      const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Intent
      if (value.version !== 1 || !Number.isFinite(value.createdAt) || Date.now() - value.createdAt > TTL || value.createdAt > Date.now()
        || typeof value.purpose !== 'string' || !value.purpose.trim() || value.purpose.length > 2000 || typeof value.verification !== 'string' || value.verification.length > 1000
        || !Array.isArray(value.files) || !value.files.length || value.files.some(file => !selected.has(file))
        || !Array.isArray(value.objects) || !value.objects.length || value.objects.some(entry => !Array.isArray(entry) || entry.length !== 2 || !paths.has(entry[0]) || typeof entry[1] !== 'string')
        || value.files.some(file => !value.objects.some(entry => entry[0] === `:(literal)${file}`))) continue
      candidates.push(value)
    } catch { /* Malformed or concurrently removed hints cannot break a commit. */ }
  }
  if (!candidates.length) return []
  const current = new Map(await objects(cwd, snapshot, [...new Set(candidates.flatMap(intent => intent.objects.map(([literal]) => literal)))]))
  const result = [], covered = new Set<string>()
  for (const intent of candidates) {
    if (intent.files.some(file => covered.has(file)) || intent.objects.some(([literal, value]) => current.get(literal) !== value)) continue
    result.push({ purpose: intent.purpose, verification: intent.verification, files: intent.files })
    intent.files.forEach(file => covered.add(file))
    if (JSON.stringify(result).length > 12_000) { result.pop(); break }
  }
  return result
}
