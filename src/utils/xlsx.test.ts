// 여기가 틀리면 표가 통째로 어긋난다 — 시트 이름이 뒤바뀌거나(rels 무시), 빈 행이 사라져 줄이 당겨지거나,
// 공유 문자열 인덱스가 숫자로 새어 나온다. 픽스처는 python으로 만든 진짜 xlsx(zip)다:
//   python3 - <<'PY' ... zipfile.ZipFile('src/utils/xlsx.test.fixture.xlsx','w',zipfile.ZIP_DEFLATED) ... PY
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { colIndex, parseXlsx } from './xlsx.ts'

const fixture = fileURLToPath(new URL('./xlsx.test.fixture.xlsx', import.meta.url))

function load(): ArrayBuffer {
  const buf = fs.readFileSync(fixture)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

test('열 참조는 26진수처럼 센다', () => {
  assert.equal(colIndex('A1'), 0)
  assert.equal(colIndex('Z9'), 25)
  assert.equal(colIndex('AA1'), 26)
  assert.equal(colIndex('BC100'), 54)
})

test('시트는 파일명이 아니라 rels가 정한 순서·이름으로 나온다', async () => {
  const sheets = await parseXlsx(load())
  assert.deepEqual(
    sheets.map((s) => s.name),
    ['예시', 'Summary'],
  )
  // 두 번째 시트는 first.xml이 아니라 second.xml에서 왔다 — 수식 셀은 계산값이 아니라 t="str" 값
  assert.deepEqual(sheets[1].rows, [['=1+1']])
})

test('공유 문자열·인라인 문자열·불리언을 읽고 빈 행·빈 칸을 채운다', async () => {
  const [first] = await parseXlsx(load())
  assert.deepEqual(first.rows, [
    ['이름', '값 & 단위', ''], // 여러 런(run)으로 쪼개진 공유 문자열은 이어 붙는다
    ['카카오', '1234.5', ''], // inlineStr도 런이 여러 개일 수 있다
    ['', '', ''], // xml에 없는 3행 — 사라지면 아래 행이 당겨 올라간다
    ['TRUE', '', '끝'], // 건너뛴 B열 자리가 비어 있어야 C가 3번째 칸에 선다
  ])
})

test('xlsx가 아니면 이유를 말하고 실패한다', async () => {
  await assert.rejects(parseXlsx(new TextEncoder().encode('not a zip at all').buffer as ArrayBuffer), /xlsx가 아니거나/)
})
