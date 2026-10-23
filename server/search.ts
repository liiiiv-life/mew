import fs from 'node:fs'
import path from 'node:path'
import { resolveProjectPath } from './paths.ts'
import { DOWNLOAD_EXTENSIONS, MEDIA_EXTENSIONS, type TreeNode } from './tree.ts'
import { compileSearchPattern, nonEmptySearchMatches } from './search-pattern.ts'

// 프로젝트 전체(파일 내용) 검색 — Ctrl+Shift+F. 트리(가시성·게스트 필터를 이미 거친 것)에서
// 텍스트 파일만 골라 줄 단위로 훑는다. rg 대신 Node로 도는 이유는 tree.ts가 정한 노출 규칙과
// 게스트 접근 필터를 그대로 재사용하기 위해서다 (레포 규모에선 충분히 빠르다).

export interface SearchMatch {
  /** 1부터 시작하는 줄번호 */
  line: number
  /** 줄 안에서의 매치 시작 문자 오프셋(0부터) */
  column: number
  /** 미리보기용 줄 텍스트(과도하게 길면 잘라낸다) */
  text: string
  matchStart: number
  matchEnd: number
}

export interface SearchFileResult {
  path: string
  matches: SearchMatch[]
}

export interface SearchOptions {
  regex: boolean
  caseSensitive: boolean
}

const MAX_FILES = 4000
const MAX_TOTAL_MATCHES = 2000
const MAX_MATCHES_PER_FILE = 300
const MAX_LINE_LEN = 400

/** 트리에서 검색 가능한 텍스트 파일의 상대경로만 평탄화한다 — 미디어·다운로드(바이너리)는 제외 */
export function flattenTextFiles(nodes: TreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === 'dir') {
      if (node.children) flattenTextFiles(node.children, out)
    } else {
      const ext = path.extname(node.name).toLowerCase()
      if (MEDIA_EXTENSIONS.has(ext) || DOWNLOAD_EXTENSIONS.has(ext)) continue
      out.push(node.path)
    }
  }
  return out
}

export function searchInProject(
  project: string,
  relPaths: string[],
  query: string,
  opts: SearchOptions,
): { results: SearchFileResult[]; truncated: boolean } {
  if (!query) return { results: [], truncated: false }
  const regex = compileSearchPattern(query, opts)
  const results: SearchFileResult[] = []
  let total = 0
  let truncated = relPaths.length > MAX_FILES

  for (const rel of relPaths.slice(0, MAX_FILES)) {
    if (total >= MAX_TOTAL_MATCHES) {
      truncated = true
      break
    }
    let content: string
    try {
      content = fs.readFileSync(resolveProjectPath(project, rel), 'utf-8')
    } catch {
      continue
    }
    // NUL 바이트가 있으면 바이너리로 보고 건너뛴다
    if (content.includes('\u0000')) continue

    const lines = content.split('\n')
    const matches: SearchMatch[] = []
    for (let li = 0; li < lines.length && matches.length < MAX_MATCHES_PER_FILE; li++) {
      const line = lines[li]
      for (const m of nonEmptySearchMatches(regex, line)) {
        matches.push({
          line: li + 1,
          column: m.index,
          text: line.length > MAX_LINE_LEN ? line.slice(0, MAX_LINE_LEN) + '…' : line,
          matchStart: m.index,
          matchEnd: m.index + m[0].length,
        })
        total++
        if (matches.length >= MAX_MATCHES_PER_FILE || total >= MAX_TOTAL_MATCHES) break
      }
      if (total >= MAX_TOTAL_MATCHES) {
        truncated = true
        break
      }
    }
    if (matches.length) results.push({ path: rel, matches })
  }
  return { results, truncated }
}

/** 파일 하나씩 비동기로 읽고 매치 파일을 즉시 내보낸다 — SSE 검색 응답용. */
export async function searchInProjectProgressively(
  project: string,
  relPaths: string[],
  query: string,
  opts: SearchOptions,
  onResult: (result: SearchFileResult) => void,
  shouldStop: () => boolean = () => false,
): Promise<{ truncated: boolean }> {
  const regex = compileSearchPattern(query, opts)
  let total = 0
  let truncated = relPaths.length > MAX_FILES
  for (const [index, rel] of relPaths.slice(0, MAX_FILES).entries()) {
    if (shouldStop()) break
    if (total >= MAX_TOTAL_MATCHES) { truncated = true; break }
    let content: string
    try { content = await fs.promises.readFile(resolveProjectPath(project, rel), 'utf-8') } catch { continue }
    if (content.includes('\u0000')) continue
    const matches: SearchMatch[] = []
    for (const [lineIndex, line] of content.split('\n').entries()) {
      if (matches.length >= MAX_MATCHES_PER_FILE) break
      for (const match of nonEmptySearchMatches(regex, line)) {
        matches.push({ line: lineIndex + 1, column: match.index, text: line.length > MAX_LINE_LEN ? `${line.slice(0, MAX_LINE_LEN)}…` : line, matchStart: match.index, matchEnd: match.index + match[0].length })
        total++
        if (matches.length >= MAX_MATCHES_PER_FILE || total >= MAX_TOTAL_MATCHES) break
      }
      if (total >= MAX_TOTAL_MATCHES) { truncated = true; break }
    }
    if (matches.length) onResult({ path: rel, matches })
    // 수천 파일 탐색 중에도 다른 요청·SSE flush가 끼어들 수 있게 양보한다.
    if (index % 12 === 11) await new Promise<void>((resolve) => setImmediate(resolve))
  }
  return { truncated }
}

/** 한 파일 안의 모든 매치를 치환한 새 내용과 치환 건수를 돌려준다 (디스크 쓰기는 호출자가 담당).
 * 기본 와일드카드 모드는 치환 문자열을 그대로 사용하고, 정규식 모드는 캡처 그룹을 확장한다. */
export function replaceInFile(
  project: string,
  relPath: string,
  query: string,
  replace: string,
  opts: SearchOptions,
): { content: string; count: number } {
  const abs = resolveProjectPath(project, relPath)
  const content = fs.readFileSync(abs, 'utf-8')
  const regex = compileSearchPattern(query, opts)
  let count = 0
  let offset = 0
  const chunks: string[] = []
  for (const match of nonEmptySearchMatches(regex, content)) {
    count++
    chunks.push(content.slice(offset, match.index), opts.regex ? expandSearchReplacement(replace, match) : replace)
    offset = match.index + match[0].length
  }
  chunks.push(content.slice(offset))
  return { content: chunks.join(''), count }
}

/** Preserve the existing per-match $ substitutions without evaluating the user pattern a second time. */
function expandSearchReplacement(replacement: string, match: RegExpExecArray): string {
  return replacement.replace(/\$(\$|&|`|'|[1-9]\d?|<[^>]*>)/g, (token, reference: string) => {
    if (reference === '$') return '$'
    if (reference === '&') return match[0]
    if (reference === '`' || reference === "'") return ''
    if (reference.startsWith('<')) return match.groups ? match.groups[reference.slice(1, -1)] ?? '' : token
    const group = Number(reference)
    if (group < match.length) return match[group] ?? ''
    const first = Number(reference[0])
    return reference.length === 2 && first < match.length ? (match[first] ?? '') + reference[1] : token
  })
}
