// 워크스페이스 전체의 `[TODO:…]` 표식을 모으고 고친다 — 홈 탭의 할 일 트래커가 쓴다.
//
// **원장은 코드 자체다.** 별도 저장소를 두지 않고 소스 안의 표식이 유일한 진실이다. 형식은
// 대괄호 안에 `TODO:` 또는 `DONE:`을 쓰고 라벨을 붙인 것이고, 라벨 뒤에 ` @2026-08-20`을 붙이면
// 그게 기한이다(없어도 된다). 이 파일에 예시를 리터럴로 적지 않는 이유는 하나다 — 적으면
// 이 파일 자신이 목록에 잡힌다. 실물 예시는 README의 "홈 탭"에 있다.
//
// 체크하면 mew가 그 줄의 `TODO`를 `DONE`으로 바꿔 **파일에 되쓴다**(그 반대도). 그래서 목록과
// 코드가 어긋날 수 없고, 파일을 옮기거나 브랜치를 갈아타도 표식이 따라간다 — 저장소를 따로 두면
// 줄 번호·경로가 바뀔 때마다 고아 항목이 남는다.
//
// 되쓸 때 noteAppWrite를 부르지 않는 것은 **일부러**다. 그래야 collabAgent의 감시자가 이 변경을
// 외부 변경으로 보고 열려 있는 협업 방에 주입한다 — 그 파일을 보고 있던 사람 화면에서도 바뀐다.
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_PROJECT, isDeniedSegment, listProjects, projectRoot, resolveProjectPath } from './paths.ts'
import { readIgnoreSet } from './ignoreList.ts'
import { DOWNLOAD_EXTENSIONS, MEDIA_EXTENSIONS } from './tree.ts'

export interface TodoItem {
  project: string
  /** 프로젝트 상대 경로 */
  path: string
  /** 1부터 시작하는 줄번호 */
  line: number
  /** 표식 안의 본문 — 기한 표기(`@날짜`)는 뺀 것 */
  text: string
  done: boolean
  /** YYYY-MM-DD 또는 null */
  due: string | null
}

export class TodoError extends Error {}

// 표식 하나. 본문에는 `]`와 줄바꿈이 들어갈 수 없다 — 그래야 끝을 한 글자로 알 수 있다.
const MARKER_RE = /\[(TODO|DONE):([^\]\n]*)\]/g
// 본문 맨 뒤의 기한 — `… @2026-08-20`
const DUE_SUFFIX_RE = /^([\s\S]*?)[ \t]*@(\d{4}-\d{2}-\d{2})$/
const DUE_RE = /^\d{4}-\d{2}-\d{2}$/

// 워크스페이스를 통째로 훑으므로 상한을 둔다 — 표식이 폭주해도 응답 하나로 끝난다
const MAX_ITEMS = 1000
const MAX_FILES = 20000
const MAX_FILE_BYTES = 512 * 1024

/** 표식 본문을 라벨과 기한으로 가른다 */
export function parseMarkerBody(body: string): { text: string; due: string | null } {
  const m = DUE_SUFFIX_RE.exec(body.trim())
  return m ? { text: m[1].trim(), due: m[2] } : { text: body.trim(), due: null }
}

/** 라벨·기한을 다시 표식 한 덩어리로 */
export function formatMarker(done: boolean, text: string, due: string | null): string {
  return `[${done ? 'DONE' : 'TODO'}:${text}${due ? ` @${due}` : ''}]`
}

/** 텍스트로 읽어 볼 파일인지 — 미디어·빌드 산출물과 너무 큰 파일은 건드리지 않는다 */
function scannable(name: string, size: number): boolean {
  if (size > MAX_FILE_BYTES) return false
  const ext = path.extname(name).toLowerCase()
  return !MEDIA_EXTENSIONS.has(ext) && !DOWNLOAD_EXTENSIONS.has(ext)
}

// 숨김 목록에 없어도 스캔에서는 건너뛰는 폴더 — 빌드 산출물·의존성 캐시다. 표식이 있을 리 없는데
// 항목 수만 수만 개라 여기를 안 접으면 훑기가 초 단위로 늘어진다(flutter build/ 하나가 9천 개).
const SKIP_DIRS = new Set(['build', '.dart_tool', '.gradle', 'target', 'vendor', 'Pods', 'coverage', 'venv'])

// 트리(buildTree)를 재사용하지 않는 이유: 트리는 확장자 화이트리스트로 걸러서 `.dart`·`.kt` 같은
// 파일이 빠진다. 표식은 어느 언어에나 있을 수 있으므로 여기서는 숨김 목록만 존중하고 나머지는 다 본다.
// 점으로 시작하는 폴더도 통째로 접는다 — 도구 상태(.venv·.claude·.foam)지 사람이 쓰는 코드가 아니다.
function walkFiles(absDir: string, relDir: string, ignore: Set<string>, out: string[]): void {
  if (out.length >= MAX_FILES) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return
    if (ignore.has(entry.name) || isDeniedSegment(entry.name)) continue
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name
    const abs = path.join(absDir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      walkFiles(abs, rel, ignore, out)
    } else if (entry.isFile()) {
      let size: number
      try {
        size = fs.statSync(abs).size
      } catch {
        continue
      }
      if (scannable(entry.name, size)) out.push(rel)
    }
  }
}

function scanFile(project: string, rel: string, abs: string, out: TodoItem[]): void {
  let content: string
  try {
    content = fs.readFileSync(abs, 'utf-8')
  } catch {
    return
  }
  if (!content.includes('[TODO:') && !content.includes('[DONE:')) return
  if (content.includes('\u0000')) return // 바이너리
  scanContent(project, rel, content, out)
}

/** 파일 하나의 내용에서 표식을 뽑는다 — 디스크 읽기는 호출자 몫이라 테스트가 바로 부른다 */
export function scanContent(project: string, rel: string, content: string, out: TodoItem[] = []): TodoItem[] {
  const lines = content.split('\n')
  for (let i = 0; i < lines.length && out.length < MAX_ITEMS; i++) {
    MARKER_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = MARKER_RE.exec(lines[i])) !== null) {
      const { text, due } = parseMarkerBody(m[2])
      if (!text) continue // 빈 표식은 항목이 아니다
      // 백틱으로 감싼 것(`[TODO:…]`)은 **형식을 설명하는 예시**다 — 문서가 자기 목록을 오염시키지 않게 뺀다
      if (lines[i][m.index - 1] === '`' && lines[i][m.index + m[0].length] === '`') continue
      out.push({ project, path: rel, line: i + 1, text, done: m[1] === 'DONE', due })
      if (out.length >= MAX_ITEMS) break
    }
  }
  return out
}

/** 워크스페이스 전체(docs + 모든 프로젝트)의 표식. 기한이 있는 것이 먼저, 그 안에서는 날짜순 */
export function scanTodos(): { items: TodoItem[]; truncated: boolean } {
  const ignore = readIgnoreSet()
  const items: TodoItem[] = []
  for (const project of [DEFAULT_PROJECT, ...listProjects()]) {
    if (items.length >= MAX_ITEMS) break
    let root: string
    try {
      root = projectRoot(project)
    } catch {
      continue
    }
    const files: string[] = []
    walkFiles(root, '', ignore, files)
    for (const rel of files) {
      if (items.length >= MAX_ITEMS) break
      scanFile(project, rel, path.join(root, rel), items)
    }
  }
  items.sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      Number(b.due != null) - Number(a.due != null) ||
      (a.due ?? '').localeCompare(b.due ?? '') ||
      a.project.localeCompare(b.project) ||
      a.path.localeCompare(b.path) ||
      a.line - b.line,
  )
  return { items, truncated: items.length >= MAX_ITEMS }
}

export interface TodoChange {
  done?: boolean
  /** null이면 기한을 지운다 */
  due?: string | null
}

/**
 * 그 줄의 표식 하나를 고쳐 파일에 되쓴다. 어느 표식인지는 **라벨로** 찾는다 — 줄번호만 믿으면
 * 목록을 받은 뒤 파일이 바뀐 사이에 엉뚱한 표식을 건드린다. 못 찾으면 새로 받아 가라는 뜻의 에러다.
 */
export function updateTodo(
  item: Pick<TodoItem, 'project' | 'path' | 'line' | 'text'>,
  change: TodoChange,
  /** 경로 해석기 — 테스트가 진짜 프로젝트를 건드리지 않게 갈아끼운다 */
  resolve: (project: string, relPath: string) => string = resolveProjectPath,
): TodoItem {
  if (change.due !== undefined && change.due !== null && !DUE_RE.test(change.due)) {
    throw new TodoError(`기한 형식이 올바르지 않습니다: ${change.due}`)
  }
  const abs = resolve(item.project, item.path)
  const content = fs.readFileSync(abs, 'utf-8')
  const lines = content.split('\n')
  const line = lines[item.line - 1]
  if (line === undefined) throw new TodoError('그 줄이 없습니다 — 목록을 새로 받아 주세요')

  let updated: TodoItem | null = null
  MARKER_RE.lastIndex = 0
  const nextLine = line.replace(MARKER_RE, (whole, tag: string, body: string) => {
    if (updated) return whole
    const { text, due } = parseMarkerBody(body)
    if (text !== item.text) return whole
    const done = change.done ?? tag === 'DONE'
    const nextDue = change.due === undefined ? due : change.due
    updated = { project: item.project, path: item.path, line: item.line, text, done, due: nextDue }
    return formatMarker(done, text, nextDue)
  })
  if (!updated) throw new TodoError('그 항목을 찾지 못했습니다 — 목록을 새로 받아 주세요')

  lines[item.line - 1] = nextLine
  // 앱 쓰기 원장(noteAppWrite)에 남기지 않는다 — 열려 있는 협업 방에도 이 변경이 들어가야 한다
  fs.writeFileSync(abs, lines.join('\n'), 'utf-8')
  return updated
}
