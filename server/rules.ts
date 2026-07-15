import fs from 'node:fs'
import path from 'node:path'
import { DOCS_ROOT } from './paths'

/** Mirrors docs/.github/scripts/moc_coverage.py exactly — keep both in sync. */
const HUB = new Set(['README.md', 'CLAUDE.md', 'MOC.md'])
const EXCLUDE_TOP = new Set(['archives'])
const EXCLUDE_PATHS = ['products/_template']
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g

function norm(abs: string): string {
  return path.relative(DOCS_ROOT, abs).split(path.sep).join('/')
}

export function isArchived(relPath: string): boolean {
  return relPath === 'archives' || relPath.startsWith('archives/')
}

function isExcluded(rel: string): boolean {
  const top = rel.split('/')[0]
  if (EXCLUDE_TOP.has(top) || top.startsWith('.')) return true
  return EXCLUDE_PATHS.some((e) => rel === e || rel.startsWith(e + '/'))
}

function walkMarkdownFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkMarkdownFiles(abs, out)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(abs)
    }
  }
  return out
}

/** Extracts local link targets (resolved to absolute paths) from a markdown file; skips external/mailto/anchor-only links. */
function linksOf(absMdPath: string): string[] {
  const content = fs.readFileSync(absMdPath, 'utf-8')
  const dir = path.dirname(absMdPath)
  const targets: string[] = []
  for (const match of content.matchAll(LINK_RE)) {
    let target = match[1]
    if (/^(https?:|mailto:|#)/.test(target)) continue
    target = target.split('#')[0]
    if (target) targets.push(path.resolve(dir, target))
  }
  return targets
}

export interface MocCoverage {
  allDocs: Set<string>
  reachable: Set<string>
  broken: string[]
}

export function computeMocCoverage(): MocCoverage {
  const allDocs = new Set<string>()
  for (const abs of walkMarkdownFiles(DOCS_ROOT)) {
    const rel = norm(abs)
    if (isExcluded(rel) || HUB.has(rel)) continue
    allDocs.add(rel)
  }

  const reachable = new Set<string>()
  const broken: string[] = []
  const seen = new Set<string>()
  const queue = [path.join(DOCS_ROOT, 'MOC.md')]

  while (queue.length) {
    const moc = queue.pop()!
    const key = norm(moc)
    if (seen.has(key)) continue
    seen.add(key)
    if (!fs.existsSync(moc)) continue

    for (const target of linksOf(moc)) {
      const relToRoot = path.relative(DOCS_ROOT, target)
      if (relToRoot.startsWith('..')) {
        broken.push(`${key} -> ${target} (저장소 밖)`)
        continue
      }
      const rel = relToRoot.split(path.sep).join('/')
      if (!fs.existsSync(target)) {
        broken.push(`${key} -> ${rel}`)
        continue
      }
      const stat = fs.statSync(target)
      if (stat.isDirectory() || path.extname(target) !== '.md') continue
      reachable.add(rel)
      if (path.basename(target) === 'MOC.md') queue.push(target)
    }
  }

  return { allDocs, reachable, broken }
}

/** Checks a single document's own local links for existence (lychee-lite). */
export function checkOwnLinks(relPath: string): string[] {
  const abs = path.join(DOCS_ROOT, relPath)
  if (!fs.existsSync(abs)) return []
  const broken: string[] = []
  for (const target of linksOf(abs)) {
    if (!fs.existsSync(target)) {
      broken.push(path.relative(DOCS_ROOT, target).split(path.sep).join('/'))
    }
  }
  return broken
}

export interface DocRules {
  archived: boolean
  mocApplicable: boolean
  mocRegistered: boolean
  brokenLinks: string[]
}

export function evaluateRules(relPath: string): DocRules {
  const { allDocs, reachable } = computeMocCoverage()
  const mocApplicable = allDocs.has(relPath)
  return {
    archived: isArchived(relPath),
    mocApplicable,
    mocRegistered: !mocApplicable || reachable.has(relPath),
    brokenLinks: checkOwnLinks(relPath),
  }
}
