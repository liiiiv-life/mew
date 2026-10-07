import path from 'node:path'
import { DEFAULT_PROJECT, projectRoot, WORKSPACE_PROJECT } from './paths.ts'
import { fileCatalogStatus, listCatalogChildren, listCatalogFiles } from './fileCatalog.ts'
import { measureSync } from './perfMarks.ts'

export interface FileNameSearchOptions {
  caseSensitive: boolean
  scopes: string[]
  allowed?: (project: string, path: string) => boolean
  showAll: boolean
}

export interface FileNameSearchResult {
  path: string
  project: string
  scope: { id: string; label: string; icon: string }
}

function fuzzyScore(query: string, targetPath: string, caseSensitive: boolean): number | null {
  const target = caseSensitive ? targetPath : targetPath.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  const basename = target.slice(target.lastIndexOf('/') + 1)
  if (basename === needle) return 0
  if (basename.startsWith(needle)) return 10 + basename.length - needle.length
  const segments = target.split('/')
  const segment = segments.findIndex((part) => part.startsWith(needle))
  if (segment >= 0) return 100 + segment * 10 + segments[segment].length - needle.length

  let offset = 0
  let first = -1
  let gaps = 0
  for (const char of needle) {
    const next = target.indexOf(char, offset)
    if (next < 0) return null
    if (first < 0) first = next
    if (offset && next > offset) gaps += next - offset
    offset = next + 1
  }
  return 1_000 + gaps * 100 + (offset - first) * 10 + first
}

function fileNameScorer(query: string, caseSensitive: boolean): (targetPath: string) => number | null {
  if (!/[*?]/.test(query)) return targetPath => fuzzyScore(query, targetPath, caseSensitive)
  const pattern = Array.from(caseSensitive ? query : query.toLowerCase())
  const matches = (value: string): boolean => {
    const characters = Array.from(value)
    let index = 0
    let token = 0
    let star = -1
    let retry = 0
    while (index < characters.length) {
      if (pattern[token] === '*') {
        star = token++
        retry = index
      } else if (pattern[token] === '?' || pattern[token] === characters[index]) {
        index++
        token++
      } else if (star !== -1) {
        token = star + 1
        index = ++retry
      } else return false
    }
    while (pattern[token] === '*') token++
    return token === pattern.length
  }
  return targetPath => {
    const target = caseSensitive ? targetPath : targetPath.toLowerCase()
    const basename = target.slice(target.lastIndexOf('/') + 1)
    return matches(basename) ? 0 : matches(target) ? 1 : null
  }
}

export function rankFileNamePaths(
  query: string,
  paths: string[],
  opts: Pick<FileNameSearchOptions, 'caseSensitive'>,
  limit = 50,
): string[] {
  if (!query) return []
  const score = fileNameScorer(query, opts.caseSensitive)
  return measureSync('filename.rank', { candidates: paths.length }, () => paths
    .map((candidate) => ({
      candidate,
      score: score(candidate),
    }))
    .filter((row): row is { candidate: string; score: number } => row.score !== null)
    .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
    .slice(0, limit)
    .map((row) => row.candidate))
}

export async function searchFileNames(query: string, opts: FileNameSearchOptions): Promise<{
  state: 'ready' | 'building' | 'stale'
  version: number
  results: FileNameSearchResult[]
}> {
  const requested = new Set(opts.scopes)
  const all = requested.size === 0
  const [workspaceFiles, docsFiles, workspaceRoot] = await Promise.all([
    listCatalogFiles(WORKSPACE_PROJECT, { showAll: opts.showAll }),
    all || requested.has('docs') ? listCatalogFiles(DEFAULT_PROJECT, { showAll: opts.showAll }) : Promise.resolve([]),
    listCatalogChildren(WORKSPACE_PROJECT, '', { showAll: opts.showAll }),
  ])
  const subprojects = workspaceRoot.entries.filter((node) => node.type === 'dir' && node.project)
  const candidates: FileNameSearchResult[] = []
  for (const file of workspaceFiles) {
    const subproject = subprojects.find((node) => file.path.startsWith(`${node.path}/`))
    if (!all && (!subproject || !requested.has(`subproject:${subproject.path}`))) continue
    candidates.push({
      path: file.path,
      project: WORKSPACE_PROJECT,
      scope: subproject
        ? { id: `subproject:${subproject.path}`, label: subproject.name, icon: 'i:folder' }
        : { id: 'root', label: path.basename(projectRoot(WORKSPACE_PROJECT)), icon: 'i:folder' },
    })
  }
  if (all || requested.has('docs')) {
    for (const file of docsFiles) {
      candidates.push({ path: file.path, project: DEFAULT_PROJECT, scope: { id: 'docs', label: 'Documents', icon: 'i:notes' } })
    }
  }
  const score = fileNameScorer(query, opts.caseSensitive)
  const ranked = measureSync('filename.rank', { candidates: candidates.length }, () => candidates
    .filter(item => !opts.allowed || opts.allowed(item.project, item.path))
    .map((item) => ({
      item,
      score: score(item.path),
    }))
    .filter((row): row is { item: FileNameSearchResult; score: number } => row.score !== null)
    .sort((a, b) => a.score - b.score || a.item.path.localeCompare(b.item.path) || a.item.project.localeCompare(b.item.project))
    .slice(0, 50)
    .map((row) => row.item))
  const workspaceStatus = fileCatalogStatus(WORKSPACE_PROJECT)
  const docsStatus = fileCatalogStatus(DEFAULT_PROJECT)
  const state = workspaceStatus.state === 'stale' || docsStatus.state === 'stale'
    ? 'stale'
    : workspaceStatus.state === 'building' || docsStatus.state === 'building' ? 'building' : 'ready'
  return { state, version: Math.max(workspaceStatus.version, docsStatus.version), results: ranked }
}
