import { representativeName } from '../shared/document-pages.ts'
import fs from 'node:fs'
import path from 'node:path'
import { DOCS_ROOT } from './paths.ts'

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

/**
 * MOC 커버리지는 docs 트리를 통째로 훑고 MOC들을 다 읽는다(현재 ~13ms). 파일을 열 때마다 한 번씩
 * 도는데(`GET /rules`), 새로고침하면 복원되는 탭 수만큼 연달아 돈다 — 그동안 서버는 **동기**로
 * 묶여 본문·협업 sync 요청을 처리하지 못한다. 짧게 재사용한다: 문서를 고쳐도 몇 초 뒤 배지가
 * 따라잡으면 되는 값이다(라이브가 아니라 열 때 한 번 받는 값이다).
 */
const COVERAGE_TTL_MS = 3000
let coverageCache: { at: number; value: MocCoverage } | null = null

export function computeMocCoverage(): MocCoverage {
  const now = Date.now()
  if (coverageCache && now - coverageCache.at < COVERAGE_TTL_MS) return coverageCache.value
  const value = walkMocCoverage()
  coverageCache = { at: now, value }
  return value
}

function walkMocCoverage(): MocCoverage {
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
      const name = path.basename(target)
      if (/^_?MOC\.md$/i.test(name) || name === representativeName(path.basename(path.dirname(target)))) queue.push(target)
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
