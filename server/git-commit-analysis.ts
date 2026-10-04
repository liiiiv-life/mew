import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import type { CommitSnapshot } from './git-ai-commit.ts'

export const ANALYSIS_CHUNK_SIZE = 48_000
export interface AnalysisChunk { id: number; file: string; paths: string[] }

/** Stream immutable Git objects; even a single huge file is read to the end. */
export async function captureAnalysisChunks(cwd: string, snapshot: CommitSnapshot, directory: string, signal?: AbortSignal, options: { chunkSize?: number; context?: number } = {}): Promise<AnalysisChunk[]> {
  const chunkSize = options.chunkSize ?? ANALYSIS_CHUNK_SIZE
  if (!Number.isInteger(chunkSize) || chunkSize < 4096 || chunkSize > ANALYSIS_CHUNK_SIZE) throw new Error('diff 조각 크기가 올바르지 않습니다')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const base = snapshot.head || execFileSync('git', ['hash-object', '-t', 'tree', '/dev/null'], { cwd, encoding: 'utf8' }).trim()
  const chunks: AnalysisChunk[] = []
  let pending = ''
  let pendingPaths: string[] = []
  const save = () => {
    const id = chunks.length
    const file = path.join(directory, `${id}.txt`)
    fs.writeFileSync(file, pending, { mode: 0o600 })
    chunks.push({ id, file, paths: pendingPaths }); pending = ''; pendingPaths = []
  }
  // One path at a time makes fragments attributable, including quoted names and renames.
  // Disable rename detection here: old/new paths are both in the immutable snapshot.
  for (const literal of snapshot.paths) {
    signal?.throwIfAborted()
    const heading = `\nPath: ${JSON.stringify(literal.slice(':(literal)'.length))}\n`
    if (heading.length >= chunkSize) throw new Error('diff 경로가 조각 입력 한도를 초과했습니다')
    const child = spawn('git', ['diff', '--no-renames', '--no-ext-diff', '--no-textconv', '--no-color', `--unified=${options.context ?? 3}`, base, snapshot.tree, '--', literal], { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', text => { stderr = (stderr + text).slice(-4000) })
    const done = new Promise<void>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`Git diff failed (${code}): ${stderr}`)))
    })
    // Observe rejection immediately while stdout is being consumed.
    void done.catch(() => {})
    child.stdout.setEncoding('utf8')
    try {
      let fragment = heading
      for await (const value of child.stdout) {
        let text = value as string
        while (text.length) {
          const count = Math.min(text.length, chunkSize - fragment.length)
          fragment += text.slice(0, count); text = text.slice(count)
          if (fragment.length === chunkSize) {
            // Prefer complete lines and never split a UTF-16 surrogate pair on disk.
            const newline = fragment.lastIndexOf('\n')
            const last = fragment.charCodeAt(fragment.length - 1)
            const cut = newline >= heading.length ? newline + 1 : fragment.length - (last >= 0xD800 && last <= 0xDBFF ? 1 : 0)
            const carry = fragment.slice(cut)
            fragment = fragment.slice(0, cut)
            if (pending.length + fragment.length > chunkSize) save()
            pendingPaths.push(literal.slice(':(literal)'.length))
            pending += fragment; save(); fragment = heading + carry
          }
        }
      }
      await done
      if (fragment !== heading) {
        if (pending.length + fragment.length > chunkSize) save()
        pendingPaths.push(literal.slice(':(literal)'.length))
        pending += fragment
      }
    } catch (error) { child.kill(); await done.catch(() => {}); throw error }
  }
  if (pending) save()
  return chunks
}

export function requestedDetails(output: string, chunks: AnalysisChunk[], limit = 1): AnalysisChunk[] | null {
  let value: { needsDetails?: unknown }
  try { value = JSON.parse(output.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1')) } catch { return null }
  if (!value || value.needsDetails === undefined) return null
  const ids = value.needsDetails
  if (!Array.isArray(ids) || !ids.length || ids.length > limit || new Set(ids).size !== ids.length
    || ids.some(id => !Number.isInteger(id) || !chunks[id as number])) throw new Error('원본 diff 추가 분석 요청이 올바르지 않습니다')
  return ids.map(id => chunks[id as number])
}
