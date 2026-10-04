import fs from 'node:fs'
import assert from 'node:assert/strict'
import { encodeEdit, decodeEdit, type Edit } from './git-diff-codec.ts'
import type { AnalysisChunk } from './git-commit-analysis.ts'

type Part = string | { repeat: string; count: number } | { replacement: Edit }
interface Source { id: number; paths: string[]; parts: (Part | number)[] }
export interface DiffPacket { definitions: Part[]; sources: Source[] }
export const PACKET_BUDGET = 96_000
export const PACKET_FORMAT = 'COMPLETE DIFF, lossless encoding. Concatenate each source parts in order. A string is literal patch text. {repeat,count} repeats literal text count times. {replacement:{shared}} expands shared strings on BOTH sides and [old,new] pairs on their respective sides, then prefixes each old line with - and each new line with +. replacement:{before,after} uses those literal sides. Numeric parts reference definitions. All changed text, diff metadata, EOF markers and supplied context are present; source IDs are fragments, not separate files. Do not skip a file merely because its diff is large or encoded. This is commit-message planning, not a request to audit every dependency.'

const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? []
export function decodeParts(parts: Part[]): string {
  return parts.map(part => {
    if (typeof part === 'string') return part
    if ('repeat' in part) return part.repeat.repeat(part.count)
    const [before, after] = decodeEdit(part.replacement)
    return lines(before).map(line => `-${line}`).join('') + lines(after).map(line => `+${line}`).join('')
  }).join('')
}

/** Exact patch compression, never truncation; slow character matching has a 15ms fallback. */
export function encodePatch(text: string): Part[] {
  const input = lines(text), parts: Part[] = []
  let literal = ''
  const flush = () => { if (literal) parts.push(literal); literal = '' }
  for (let i = 0; i < input.length;) {
    if (input[i].startsWith('@@ ')) {
      // Separate metadata from payload so identical additions in different files can share a definition.
      flush(); parts.push(input[i++]); continue
    }
    let end = i + 1
    while (end < input.length && input[end] === input[i]) end++
    if (end - i > 2 && input[i].length * (end - i - 1) > 60) {
      flush(); parts.push({ repeat: input[i], count: end - i }); i = end; continue
    }
    // Header lines and split/EOF lines remain literal. Only whole removed/added runs pair.
    if (input[i].startsWith('-') && !input[i].startsWith('--- ') && input[i].endsWith('\n')) {
      end = i
      while (end < input.length && input[end].startsWith('-') && !input[end].startsWith('--- ') && input[end].endsWith('\n')) end++
      let addedEnd = end
      while (addedEnd < input.length && input[addedEnd].startsWith('+') && !input[addedEnd].startsWith('+++ ') && input[addedEnd].endsWith('\n')) addedEnd++
      if (addedEnd > end) {
        const before = input.slice(i, end).map(line => line.slice(1)).join(''), after = input.slice(end, addedEnd).map(line => line.slice(1)).join('')
        // Very unbalanced runs are additions/deletions; keep their line repetition available to RLE.
        if (Math.max(before.length, after.length) > Math.min(before.length, after.length) * 4) { literal += input[i++]; continue }
        const replacement = encodeEdit(before, after)
        const part = { replacement }
        if (JSON.stringify(part).length < JSON.stringify(input.slice(i, addedEnd).join('')).length) {
          flush(); parts.push(part); i = addedEnd; continue
        }
      }
    }
    literal += input[i++]
  }
  flush()
  assert.equal(decodeParts(parts), text)
  // Keep block boundaries until packet-level factoring: identical additions may occur in other files.
  return parts
}

function factor(sources: Source[]): DiffPacket {
  const counts = new Map<string, number>()
  for (const source of sources) for (const part of source.parts) {
    const key = JSON.stringify(part); counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const definitions: Part[] = [], ids = new Map<string, number>()
  const compact = { definitions, sources: sources.map(source => ({ ...source, parts: source.parts.map(part => {
    const key = JSON.stringify(part), count = counts.get(key)!
    if (count < 2 || (count - 1) * key.length < 32 + count * 8) return part
    let id = ids.get(key)
    if (id === undefined) { id = definitions.length; ids.set(key, id); definitions.push(part as Part) }
    return id
  }) })) }
  const plain = { definitions: [], sources: sources.map(source => ({ ...source, parts: [decodeParts(source.parts as Part[])] })) }
  return JSON.stringify(compact).length < JSON.stringify(plain).length ? compact : plain
}

/** Every source appears exactly once. Capacity causes another packet, never skipped evidence. */
export function packDiffChunks(chunks: AnalysisChunk[], budget = PACKET_BUDGET): DiffPacket[] {
  const packets: DiffPacket[] = []
  let pending: Source[] = []
  for (const chunk of chunks) {
    const text = fs.readFileSync(chunk.file, 'utf8')
    const source = { id: chunk.id, paths: chunk.paths, parts: encodePatch(text) }
    let packet = factor([...pending, source])
    if (JSON.stringify(packet).length > budget && pending.length) {
      packets.push(factor(pending)); pending = []; packet = factor([source])
    }
    if (JSON.stringify(packet).length > budget) throw new Error('원본 조각의 인코딩이 입력 한도를 초과했습니다')
    pending.push(source)
  }
  if (pending.length) packets.push(factor(pending))
  return packets
}

export interface CoverageNote { sources: number[]; summary: string; uncertainties: string[] }
export function parseCoverageNotes(output: string, ids: number[]): CoverageNote[] {
  const value = JSON.parse(output.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1'))
  const remaining = new Set(ids)
  if (!value || !Array.isArray(value.changes) || !value.changes.length) throw new Error('변경 근거 응답 형식이 올바르지 않습니다')
  for (const note of value.changes) {
    if (!note || !Array.isArray(note.sources) || !note.sources.length || typeof note.summary !== 'string' || !note.summary.trim()
      || !Array.isArray(note.uncertainties) || note.uncertainties.some((text: unknown) => typeof text !== 'string')) throw new Error('변경 근거 응답 형식이 올바르지 않습니다')
    for (const id of note.sources) if (!Number.isInteger(id) || !remaining.delete(id)) throw new Error('변경 근거에 원본 누락·중복·범위 밖 조각이 있습니다')
  }
  if (remaining.size) throw new Error('변경 근거에서 일부 원본 조각이 누락되었습니다')
  return value.changes.map((note: CoverageNote) => ({ sources: note.sources, summary: note.summary, uncertainties: note.uncertainties }))
}
