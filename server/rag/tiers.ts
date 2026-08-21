import fs from 'node:fs'
import path from 'node:path'
import type { RagTier } from './types.ts'

const LINK = /\[[^\]]*\]\(([^)\s#]+)(?:#[^)]*)?\)/g
const HISTORY_HEADING = /(history|raw|역사|이력|과거|폐기)/i

function localMarkdownTarget(root: string, moc: string, raw: string): string | null {
  if (/^[a-z]+:/i.test(raw) || raw.startsWith('#')) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  const target = path.resolve(path.dirname(moc), decoded)
  if (target !== root && !target.startsWith(root + path.sep)) return null
  if (path.extname(target).toLowerCase() !== '.md') return null
  return path.relative(root, target).split(path.sep).join('/')
}

/** MOC의 Current/History 절을 파일 tier로 증류한다. Current 링크가 있으면 우선한다. */
export function docsTierMap(root: string, relPaths: string[]): Map<string, RagTier> {
  const tiers = new Map<string, RagTier>()
  const available = new Set(relPaths)
  for (const rel of relPaths) {
    if (!['MOC.md', '_MOC.md'].includes(path.basename(rel))) continue
    const abs = path.join(root, rel)
    let currentTier: RagTier = 'current'
    for (const line of fs.readFileSync(abs, 'utf-8').split(/\r?\n/)) {
      const heading = /^#{1,6}\s+(.+)$/.exec(line)
      if (heading) currentTier = HISTORY_HEADING.test(heading[1]) ? 'history' : 'current'
      LINK.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = LINK.exec(line)) !== null) {
        const target = localMarkdownTarget(root, abs, match[1])
        if (!target || !available.has(target)) continue
        const previous = tiers.get(target)
        if (previous !== 'current' || currentTier === 'current') tiers.set(target, currentTier)
      }
    }
  }
  return tiers
}

export function tierForFile(relPath: string, content: string, mapped?: RagTier): RagTier {
  if (relPath.split('/').includes('archives')) return 'history'
  if (/^\s*- 상태: (?:폐기|대체됨:)/m.test(content)) return 'history'
  if (mapped) return mapped
  return 'current'
}
