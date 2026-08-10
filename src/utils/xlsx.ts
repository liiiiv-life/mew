// xlsx는 ZIP 안에 XML 몇 장이 들어 있는 형식이다 — 브라우저·node 모두 DecompressionStream을 갖고 있으므로
// 파서 라이브러리 없이 읽는다. 값만 본다: 서식·수식·병합셀·차트는 버리고, 수식 셀은 마지막 계산값을 쓴다.
// ponytail: 날짜는 엑셀 일련번호(45678) 그대로 보인다 — styles.xml의 numFmt까지 읽어야 날짜로 바뀐다.

export interface SheetData {
  name: string
  /** 직사각형으로 채워진 표 — 빈 칸은 '' */
  rows: string[][]
}

const EOCD_SIG = 0x06054b50
const CD_SIG = 0x02014b50

interface ZipEntry {
  method: number
  /** 파일 안에서 압축 데이터가 시작하는 바이트 위치 */
  start: number
  compSize: number
}

function readZip(buf: ArrayBuffer): Map<string, ZipEntry> {
  const dv = new DataView(buf)
  const bytes = new Uint8Array(buf)
  // EOCD는 파일 끝에 있고 그 뒤로 최대 64KB의 주석이 붙을 수 있다
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= 0 && i >= buf.byteLength - 22 - 0xffff; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('ZIP 구조를 찾지 못했습니다 — xlsx가 아니거나 파일이 깨졌습니다')

  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  const entries = new Map<string, ZipEntry>()
  const decoder = new TextDecoder()
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== CD_SIG) throw new Error('ZIP 중앙 디렉터리가 깨졌습니다')
    const method = dv.getUint16(p + 10, true)
    const compSize = dv.getUint32(p + 20, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOffset = dv.getUint32(p + 42, true)
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    // 로컬 헤더의 extra는 중앙 디렉터리의 것과 길이가 다를 수 있다 — 데이터 시작은 로컬 헤더에서 다시 잰다
    const localNameLen = dv.getUint16(localOffset + 26, true)
    const localExtraLen = dv.getUint16(localOffset + 28, true)
    entries.set(name, { method, compSize, start: localOffset + 30 + localNameLen + localExtraLen })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function readText(buf: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const raw = new Uint8Array(buf, entry.start, entry.compSize)
  if (entry.method === 0) return new TextDecoder().decode(raw)
  if (entry.method !== 8) throw new Error(`지원하지 않는 ZIP 압축 방식입니다: ${entry.method}`)
  const stream = new Response(raw).body!.pipeThrough(new DecompressionStream('deflate-raw'))
  return await new Response(stream).text()
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function unescapeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(parseInt(code.slice(2), 16))
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10))
    return ENTITIES[code] ?? whole
  })
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
  return m ? unescapeXml(m[1]) : null
}

/** <si>·<is> 안의 런(run)들을 이어 붙인다 — 서식이 섞인 셀은 <t>가 여러 개다 */
function textOf(body: string): string {
  return [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('')
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
}

/** 'B12' → 1 (0-based 열 번호) */
export function colIndex(ref: string): number {
  let n = 0
  for (const ch of ref.toUpperCase()) {
    const code = ch.charCodeAt(0)
    if (code < 65 || code > 90) break
    n = n * 26 + (code - 64)
  }
  return n - 1
}

function cellValue(tag: string, body: string, shared: string[]): string {
  const type = attr(tag, 't') ?? 'n'
  if (type === 'inlineStr') return textOf(body)
  const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)
  const raw = v ? unescapeXml(v[1]) : ''
  if (type === 's') return shared[Number(raw)] ?? ''
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE'
  return raw
}

export function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  let next = 0
  for (const row of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = Number(attr(row[1], 'r') ?? 0)
    const index = r > 0 ? r - 1 : next
    next = index + 1
    const cells: string[] = []
    for (const cell of row[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cell[1], 'r')
      const col = ref ? colIndex(ref) : cells.length
      if (col >= 0) cells[col] = cellValue(cell[1], cell[2] ?? '', shared)
    }
    rows[index] = cells
  }
  // 비어 있는 행·칸은 xml에 아예 없다 — 직사각형으로 메워야 표가 어긋나지 않는다
  const width = rows.reduce((w, cells) => Math.max(w, cells ? cells.length : 0), 0)
  return Array.from(rows, (cells) => Array.from({ length: width }, (_, i) => cells?.[i] ?? ''))
}

/** 시트 이름과 시트 XML의 경로를 workbook.xml + 그 rels에서 맞춰 낸다 — 순서·파일명은 믿을 게 못 된다 */
function parseWorkbook(workbookXml: string, relsXml: string): { name: string; path: string }[] {
  const targets = new Map<string, string>()
  for (const rel of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(rel[0], 'Id')
    const target = attr(rel[0], 'Target')
    if (id && target) targets.set(id, target)
  }
  const sheets: { name: string; path: string }[] = []
  for (const sheet of workbookXml.matchAll(/<sheet\b[^>]*?>/g)) {
    const rid = attr(sheet[0], 'r:id') ?? attr(sheet[0], 'id')
    const target = rid ? targets.get(rid) : null
    if (!target) continue
    // rels의 Target은 workbook.xml 기준 상대 경로다
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    sheets.push({ name: attr(sheet[0], 'name') ?? `Sheet${sheets.length + 1}`, path })
  }
  return sheets
}

export async function parseXlsx(buf: ArrayBuffer): Promise<SheetData[]> {
  const zip = readZip(buf)
  const read = (name: string): Promise<string> => {
    const entry = zip.get(name)
    return entry ? readText(buf, entry) : Promise.resolve('')
  }
  const shared = parseSharedStrings(await read('xl/sharedStrings.xml'))
  const sheets = parseWorkbook(await read('xl/workbook.xml'), await read('xl/_rels/workbook.xml.rels'))
  if (!sheets.length) throw new Error('워크북에서 시트를 찾지 못했습니다')
  const out: SheetData[] = []
  for (const sheet of sheets) {
    const xml = await read(sheet.path)
    if (xml) out.push({ name: sheet.name, rows: parseSheet(xml, shared) })
  }
  return out
}
