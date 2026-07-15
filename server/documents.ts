import fs from 'node:fs'
import path from 'node:path'
import { DOCS_ROOT } from './paths'

export class ConflictError extends Error {}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function nextAdrNumber(): string {
  const dir = path.join(DOCS_ROOT, 'decisions')
  let max = 0
  for (const name of fs.readdirSync(dir)) {
    const m = /^(\d{4})-/.exec(name)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return String(max + 1).padStart(4, '0')
}

/** Walks up from relDir toward DOCS_ROOT looking for the nearest MOC.md, falling back to the root one. */
function findNearestMoc(relDir: string): string {
  let dir = relDir
  while (dir && dir !== '.') {
    const candidate = path.join(dir, 'MOC.md')
    if (fs.existsSync(path.join(DOCS_ROOT, candidate))) return candidate.split(path.sep).join('/')
    dir = path.dirname(dir)
  }
  return 'MOC.md'
}

function appendMocLink(mocRelPath: string, targetRelPath: string, title: string) {
  const mocAbs = path.join(DOCS_ROOT, mocRelPath)
  const linkPath = path.relative(path.dirname(mocAbs), path.join(DOCS_ROOT, targetRelPath)).split(path.sep).join('/')
  const content = fs.readFileSync(mocAbs, 'utf-8')
  fs.writeFileSync(mocAbs, content.replace(/\s*$/, '') + `\n- [${title}](${linkPath})\n`, 'utf-8')
}

/** Inserts `line` at the end of the section under the first line matching `headingText` exactly, before the next `## ` heading. Falls back to appending at end of file if the heading isn't found. */
function insertUnderHeading(mocRelPath: string, headingText: string, line: string) {
  const mocAbs = path.join(DOCS_ROOT, mocRelPath)
  const content = fs.readFileSync(mocAbs, 'utf-8')
  const lines = content.split('\n')
  const headingIdx = lines.findIndex((l) => l.trim() === headingText)
  if (headingIdx === -1) {
    fs.writeFileSync(mocAbs, content.replace(/\s*$/, '') + `\n${line}\n`, 'utf-8')
    return
  }
  let insertAt = lines.length
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      insertAt = i
      break
    }
  }
  while (insertAt > headingIdx + 1 && lines[insertAt - 1].trim() === '') insertAt--
  lines.splice(insertAt, 0, line)
  fs.writeFileSync(mocAbs, lines.join('\n'), 'utf-8')
}

/** Creates a new document with a bare `# title` heading and links it from the nearest MOC.md. */
export function createDocument(relPath: string, title: string): { relPath: string; mocRelPath: string } {
  const abs = path.join(DOCS_ROOT, relPath)
  if (fs.existsSync(abs)) throw new ConflictError(`이미 존재하는 파일입니다: ${relPath}`)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, `# ${title}\n`, 'utf-8')
  const mocRelPath = findNearestMoc(path.dirname(relPath))
  appendMocLink(mocRelPath, relPath, title)
  return { relPath, mocRelPath }
}

const ADR_TEMPLATE = (number: string, title: string, date: string) => `# ${number} — ${title}

- 날짜: ${date}
- 상태: 제안
- 결정자:

## 배경

어떤 상황·문제에서 이 결정이 필요했는가. 당시의 제약 조건.

## 선택지

1. 선택지 A — 장점 / 단점
2. 선택지 B — 장점 / 단점

## 결정

무엇을 하기로 했는가. 한 문단.

## 근거

왜 이 선택지인가. 가능하면 데이터·로그·측정치를 인용.

## 결과 (선택)

시간이 지난 후 확인된 효과·부작용. 결정 자체는 수정하지 말고 이 절만 추가.
`

/** Creates a new numbered ADR under decisions/ and links it from root MOC.md's Decisions section. */
export function createAdr(scope: string, title: string): { relPath: string; number: string } {
  const number = nextAdrNumber()
  const slug = slugify(title)
  const relPath = `decisions/${number}-${scope}-${slug}.md`
  const abs = path.join(DOCS_ROOT, relPath)
  if (fs.existsSync(abs)) throw new ConflictError(`이미 존재하는 파일입니다: ${relPath}`)
  const date = new Date().toISOString().slice(0, 10)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, ADR_TEMPLATE(number, title, date), 'utf-8')
  insertUnderHeading('MOC.md', '## Decisions (ADR)', `- [${number} — ${title}](${relPath})`)
  return { relPath, number }
}
