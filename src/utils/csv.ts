// csv·tsv를 xlsx와 같은 표 모양(SheetData)으로 읽는다 — 뷰어는 둘을 구분하지 않는다.
//
// 인코딩을 먼저 정한다: 엑셀이 한국어 윈도에서 뱉는 csv는 utf-8이 아니라 cp949다. 그대로 utf-8로
// 읽으면 글자가 통째로 깨져 나온다("깨져서 보이는" csv의 정체). utf-8로 읽어 대체 문자(U+FFFD)가
// 섞이면 cp949로 다시 읽는다 — 둘 다 브라우저·node에 기본으로 있는 디코더다.
import type { SheetData } from './xlsx'

/** utf-8로 읽되 깨지면 cp949(euc-kr)로 다시 읽는다 */
export function decodeText(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf)
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    return new TextDecoder('euc-kr').decode(buf)
  } catch {
    // 그 디코더가 없는 환경이면 깨진 채로라도 보여 준다 — 빈 화면보다 낫다
    return utf8
  }
}

/**
 * RFC 4180 — 따옴표 안에서는 구분자·줄바꿈이 글자 그대로이고, `""`는 따옴표 하나다.
 * 줄 끝 CR은 버린다(엑셀은 CRLF로 쓴다).
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch !== '"') {
        field += ch
        continue
      }
      // 따옴표 두 개는 따옴표 한 글자, 하나면 인용 끝
      if (text[i + 1] === '"') {
        field += '"'
        i++
        continue
      }
      quoted = false
      continue
    }
    if (ch === '"' && field === '') {
      quoted = true
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      continue
    }
    if (ch === '\r') continue
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    field += ch
  }
  // 마지막 줄에 줄바꿈이 없어도 한 줄이다. 파일 끝 줄바꿈 하나로 빈 줄이 생기지는 않는다
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** 시트 하나짜리 표 — 이름은 파일명이다(뷰어의 시트 탭에 그대로 뜬다) */
export function parseCsv(buf: ArrayBuffer, path: string): SheetData[] {
  const text = decodeText(buf).replace(/^\uFEFF/, '')
  const rows = parseDelimited(text, path.toLowerCase().endsWith('.tsv') ? '\t' : ',')
  // 표는 직사각형으로 채워 둔다(xlsx 파서와 같은 약속) — 짧은 줄이 셀 없이 끝나면 칸이 어긋난다
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  return [
    {
      name: path.split('/').pop() ?? 'csv',
      rows: rows.map((row) => (row.length === width ? row : [...row, ...Array<string>(width - row.length).fill('')])),
    },
  ]
}
