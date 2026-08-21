import path from 'node:path'
import type { RagChunk, RagTier } from './types.ts'

const MAX_CHARS = 900
const HISTORY_HEADING = /(history|raw|역사|이력|과거|폐기)/i

function unquote(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function frontmatterEnd(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0
  const end = lines.slice(1).findIndex((line) => line.trim() === '---')
  return end < 0 ? 0 : end + 2
}

function titleOf(relPath: string, lines: string[], bodyStart: number): string {
  for (const line of lines.slice(1, Math.max(1, bodyStart - 1))) {
    const match = /^title:\s*(.+)$/.exec(line)
    if (match) return unquote(match[1])
  }
  for (const line of lines.slice(bodyStart)) {
    const match = /^#\s+(.+)$/.exec(line)
    if (match) return match[1].trim()
  }
  return path.basename(relPath)
}

/** Markdown·코드 공용 청커. 줄 범위를 보존하고 heading 경계에서 우선 분리한다. */
export function chunkText(relPath: string, content: string, tier: RagTier, maxChars = MAX_CHARS): RagChunk[] {
  if (!content.trim() || content.includes('\u0000')) return []
  const lines = content.split(/\r?\n/)
  const bodyStart = frontmatterEnd(lines)
  const title = titleOf(relPath, lines, bodyStart)
  const chunks: RagChunk[] = []
  let heading = ''
  let chunkTier = tier
  let buffer: string[] = []
  let start = bodyStart
  let size = 0

  const flush = (endExclusive: number) => {
    const text = buffer.join('\n').trim()
    if (text) {
      chunks.push({
        index: chunks.length,
        lineStart: start + 1,
        lineEnd: Math.max(start + 1, endExclusive),
        title,
        heading,
        content: text,
        tier: chunkTier,
      })
    }
    buffer = []
    size = 0
  }

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i]
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line)
    if (headingMatch) {
      flush(i)
      heading = headingMatch[2].trim()
      chunkTier = tier === 'history' || HISTORY_HEADING.test(heading) ? 'history' : 'current'
      start = i
    }

    // 생성물·CSV처럼 한 줄이 긴 파일도 모델 최대 길이를 넘기지 않는다.
    if (line.length > maxChars) {
      flush(i)
      for (let offset = 0; offset < line.length; offset += maxChars) {
        const part = line.slice(offset, offset + maxChars).trim()
        if (!part) continue
        chunks.push({
          index: chunks.length,
          lineStart: i + 1,
          lineEnd: i + 1,
          title,
          heading,
          content: part,
          tier: chunkTier,
        })
      }
      start = i + 1
      continue
    }

    const added = line.length + (buffer.length ? 1 : 0)
    if (buffer.length && size + added > maxChars) {
      flush(i)
      start = i
    }
    if (!buffer.length) start = i
    buffer.push(line)
    size += added
  }
  flush(lines.length)
  return chunks
}

export function passageText(chunk: RagChunk): string {
  const context = [chunk.title, chunk.heading].filter(Boolean).join(' · ')
  return `passage: ${context}\n${chunk.content}`
}
