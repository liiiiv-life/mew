// 여기가 틀리면 표가 통째로 어긋난다 — 따옴표 안의 쉼표·줄바꿈이 칸을 갈라 버리거나,
// 엑셀이 뱉은 cp949 파일이 물음표 덩어리로 보인다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeText, parseCsv, parseDelimited } from './csv.ts'

const bytes = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer

const utf8 = (text: string): ArrayBuffer => {
  const encoded = new TextEncoder().encode(text)
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
}

test('따옴표 안의 구분자·줄바꿈은 글자 그대로다', () => {
  assert.deepEqual(parseDelimited('a,"b,c"\n"두\n줄",d', ','), [
    ['a', 'b,c'],
    ['두\n줄', 'd'],
  ])
})

test('따옴표 두 개는 따옴표 한 글자다', () => {
  assert.deepEqual(parseDelimited('"그는 ""안녕"" 했다",끝', ','), [['그는 "안녕" 했다', '끝']])
})

test('CRLF와 파일 끝 줄바꿈으로 빈 줄이 생기지 않는다', () => {
  assert.deepEqual(parseDelimited('a,b\r\nc,d\r\n', ','), [
    ['a', 'b'],
    ['c', 'd'],
  ])
})

test('cp949로 쓴 csv는 utf-8 대신 cp949로 읽힌다', () => {
  // '가나,다' — 엑셀이 한국어 윈도에서 뱉는 그 바이트
  assert.equal(decodeText(bytes(0xb0, 0xa1, 0xb3, 0xaa, 0x2c, 0xb4, 0xd9)), '가나,다')
  assert.equal(decodeText(utf8('가나,다')), '가나,다')
})

test('짧은 줄은 빈 칸으로 채워 직사각형이 된다', () => {
  const [sheet] = parseCsv(utf8('a,b,c\n1\n'), 'docs/표.csv')
  assert.equal(sheet.name, '표.csv')
  assert.deepEqual(sheet.rows, [
    ['a', 'b', 'c'],
    ['1', '', ''],
  ])
})

test('tsv는 탭으로 가른다', () => {
  const [sheet] = parseCsv(utf8('a\tb\n1\t2\n'), 'x.tsv')
  assert.deepEqual(sheet.rows, [
    ['a', 'b'],
    ['1', '2'],
  ])
})
