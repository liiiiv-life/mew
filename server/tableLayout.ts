import fs from 'node:fs'
import path from 'node:path'
import { projectRoot } from './paths.ts'

// 표의 열 너비는 마크다운이 담지 못한다 — HTML `<table>`로 쓰면 담을 수 있지만 plain 모드가
// 지저분해져서 본문은 순수 md 표로 유지한다. 그래서 본문과 레이아웃을 분리해, 너비만
// <프로젝트>/.mew/table-layout.json 에 문서 경로별로 저장한다(.mew/cmd-button.json과 같은 자리).
//
// 형식: { "version": 1, "docs": { "<문서 상대경로>": [[120, 80], null, [90, 90, 90]] } }
// 바깥 배열 = 그 문서 안 표의 등장 순서, 안쪽 배열 = 그 표의 열 너비(px). null = 저장된 너비 없음.
//
// 표를 문서 안 순서로만 식별하므로 **표를 추가·삭제·이동하면 너비가 어긋날 수 있다** — 그때는
// 다시 드래그하면 덮어써진다. 본문을 건드리지 않는 대가로 받아들인 한계다.

export type TableWidths = (number[] | null)[]

interface LayoutFile {
  version: 1
  docs: Record<string, TableWidths>
}

const MEW_DIR = '.mew'
const FILE_NAME = 'table-layout.json'
const MAX_DOCS = 2000
const MAX_TABLES = 200
const MAX_COLS = 64
const MIN_WIDTH = 20
const MAX_WIDTH = 4000

export class TableLayoutError extends Error {}

function layoutFile(project: string): string {
  return path.join(projectRoot(project), MEW_DIR, FILE_NAME)
}

function load(project: string): LayoutFile {
  let raw: string
  try {
    raw = fs.readFileSync(layoutFile(project), 'utf-8')
  } catch {
    return { version: 1, docs: {} } // 없음 = 이 프로젝트엔 저장된 표 너비가 없다
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { version: 1, docs: {} } // 깨진 JSON은 "저장된 너비 없음"으로 — 다음 저장에서 다시 만들어진다
  }
  const docs = (parsed as { docs?: unknown } | null)?.docs
  if (!docs || typeof docs !== 'object') return { version: 1, docs: {} }
  const out: Record<string, TableWidths> = {}
  for (const [key, value] of Object.entries(docs as Record<string, unknown>)) {
    const widths = sanitize(value)
    if (widths.length) out[key] = widths
  }
  return { version: 1, docs: out }
}

function save(project: string, data: LayoutFile): void {
  const file = layoutFile(project)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8')
  fs.renameSync(tmp, file) // 쓰는 도중 읽어도 빈 파일을 보지 않도록 (dataDir.writeFileAtomic과 같은 이유)
}

/** 들어온 값을 신뢰하지 않고 형태·범위를 맞춘다 — 마지막의 빈 표들은 잘라낸다 */
function sanitize(value: unknown): TableWidths {
  if (!Array.isArray(value)) return []
  const out: TableWidths = []
  for (const table of value.slice(0, MAX_TABLES)) {
    if (!Array.isArray(table) || table.length === 0 || table.length > MAX_COLS) {
      out.push(null)
      continue
    }
    const cols: number[] = []
    let ok = true
    for (const width of table) {
      const n = Math.round(Number(width))
      // 0 = "그 열은 아직 조절 안 함" — prosemirror-tables는 실제로 끌린 열에만 너비를 심는다
      if (!Number.isFinite(n) || (n !== 0 && (n < MIN_WIDTH || n > MAX_WIDTH))) {
        ok = false
        break
      }
      cols.push(n)
    }
    out.push(ok && cols.some((w) => w > 0) ? cols : null)
  }
  while (out.length && out[out.length - 1] === null) out.pop()
  return out
}

export function readTableLayout(project: string, relPath: string): TableWidths {
  return load(project).docs[relPath] ?? []
}

export function writeTableLayout(project: string, relPath: string, widths: unknown): TableWidths {
  if (!relPath) throw new TableLayoutError('문서 경로가 필요합니다')
  const sanitized = sanitize(widths)
  const data = load(project)
  if (sanitized.length === 0) {
    delete data.docs[relPath] // 저장할 너비가 없으면 항목 자체를 지운다 — 파일이 계속 커지지 않도록
  } else {
    if (!(relPath in data.docs) && Object.keys(data.docs).length >= MAX_DOCS) {
      throw new TableLayoutError('저장된 표 레이아웃이 너무 많습니다')
    }
    data.docs[relPath] = sanitized
  }
  save(project, data)
  return sanitized
}
