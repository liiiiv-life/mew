import fs from 'node:fs'
import path from 'node:path'
import { resolveProjectPath } from './paths.ts'
import { DOWNLOAD_EXTENSIONS, MEDIA_EXTENSIONS, type TreeNode } from './tree.ts'

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

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 잘못된 정규식이면 SyntaxError를 던진다 (라우트가 400으로 매핑) */
function buildRegex(query: string, opts: SearchOptions): RegExp {
  const flags = opts.caseSensitive ? 'g' : 'gi'
  return new RegExp(opts.regex ? query : escapeRegExp(query), flags)
}

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
  const regex = buildRegex(query, opts)
  const results: SearchFileResult[] = []
  let total = 0
  let truncated = false

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
      regex.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = regex.exec(line)) !== null) {
        if (m[0].length === 0) {
          regex.lastIndex++
          continue
        }
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

/** 한 파일 안의 모든 매치를 치환한 새 내용과 치환 건수를 돌려준다 (디스크 쓰기는 호출자가 담당).
 * 정규식 모드면 $1 등 캡처 그룹 확장을 지원하고, 비정규식 모드는 리터럴로 치환한다. */
export function replaceInFile(
  project: string,
  relPath: string,
  query: string,
  replace: string,
  opts: SearchOptions,
): { content: string; count: number } {
  const abs = resolveProjectPath(project, relPath)
  const content = fs.readFileSync(abs, 'utf-8')
  const regex = buildRegex(query, opts)
  let count = 0
  const single = opts.regex ? new RegExp(query, opts.caseSensitive ? '' : 'i') : null
  const next = content.replace(regex, (matched: string) => {
    count++
    // 정규식 모드는 매치 하나에 대해 네이티브 문자열 치환에 위임해 $1 확장을 살린다.
    // 비정규식 모드는 replace를 리터럴로 취급한다(콜백 반환값이라 $ 특수해석이 없다).
    return single ? matched.replace(single, replace) : replace
  })
  return { content: next, count }
}
