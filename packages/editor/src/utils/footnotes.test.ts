// 각주 번호 재배치 — 중간에 넣거나 지웠을 때 뒤 번호가 내용을 들고 따라가는지가 전부다.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FOOTNOTE_MARKER_RE,
  fromSubscript,
  markerFor,
  nextMarkerNumber,
  planFootnotes,
  toSubscript,
  type ReferenceEntry,
} from './footnotes.ts'

const entries = (...contents: string[]): ReferenceEntry[] => contents.map((content, i) => ({ num: i + 1, content }))

test('아래첨자 변환 — 두 자리도 된다', () => {
  assert.equal(markerFor(1), '₁₎')
  assert.equal(markerFor(12), '₁₂₎')
  assert.equal(fromSubscript('₁₂'), 12)
  assert.equal(toSubscript(305), '₃₀₅')
})

test('마커 정규식은 본문에서 마커만 집는다', () => {
  const found = '국내 50~60대 여성 22만명₁₎ 그리고 다른 곳₁₀₎'.match(FOOTNOTE_MARKER_RE)
  assert.deepEqual(found, ['₁₎', '₁₀₎'])
  assert.equal('보통 괄호 1) 는 마커가 아니다'.match(FOOTNOTE_MARKER_RE), null)
})

test('6번을 지우면 7~10번이 내용을 들고 6~9로 당겨진다', () => {
  const all = entries('하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉', '열')
  // 6번 마커만 사라진 상태
  const plan = planFootnotes([1, 2, 3, 4, 5, 7, 8, 9, 10], all)
  assert.deepEqual(plan.numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.deepEqual(plan.contents, ['하나', '둘', '셋', '넷', '다섯', '일곱', '여덟', '아홉', '열'])
  assert.equal(plan.contents.includes('여섯'), false, '지운 각주의 내용은 사라진다')
})

test('5번 뒤에 새로 넣으면 그게 6번이 되고 옛 6~10번은 한 칸씩 밀린다', () => {
  const all = entries('하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉', '열')
  const fresh = nextMarkerNumber([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], all)
  assert.equal(fresh, 11, '아직 아무도 안 쓰는 번호라야 남의 내용을 가로채지 않는다')
  const plan = planFootnotes([1, 2, 3, 4, 5, fresh, 6, 7, 8, 9, 10], all)
  assert.deepEqual(plan.numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  assert.deepEqual(plan.contents, ['하나', '둘', '셋', '넷', '다섯', '', '여섯', '일곱', '여덟', '아홉', '열'])
})

test('맨 앞에 넣어도 나머지가 통째로 밀린다', () => {
  const all = entries('가', '나')
  const fresh = nextMarkerNumber([1, 2], all)
  const plan = planFootnotes([fresh, 1, 2], all)
  assert.deepEqual(plan.contents, ['', '가', '나'])
})

test('마커를 복사해 같은 번호가 둘이면 먼저 나온 쪽이 내용을 가진다', () => {
  const plan = planFootnotes([1, 1, 2], entries('가', '나'))
  assert.deepEqual(plan.numbers, [1, 2, 3])
  assert.deepEqual(plan.contents, ['가', '', '나'])
})

test('짝이 없는 마커는 빈 내용 — 사람이 이어 쓴다', () => {
  const plan = planFootnotes([7], entries('가'))
  assert.deepEqual(plan.contents, [''])
  assert.deepEqual(plan.sources, [-1], '새 자리라는 표시 — 빈 항목을 끼우라는 뜻이다')
})

test('sources는 내용이 빈 기존 항목과 새 자리를 구별한다', () => {
  // 둘 다 contents는 ''지만, 하나는 이미 있는 줄이고 하나는 새로 끼울 자리다
  const plan = planFootnotes([1, 9], [{ num: 1, content: '' }])
  assert.deepEqual(plan.contents, ['', ''])
  assert.deepEqual(plan.sources, [0, -1])
})

test('마커가 하나도 없으면 계획도 비어 있다 — 부르는 쪽이 References를 건드리지 않는 근거', () => {
  const plan = planFootnotes([], entries('손으로 쓴 참고문헌'))
  assert.deepEqual(plan.numbers, [])
  assert.deepEqual(plan.contents, [])
})

test('두 번 돌려도 결과가 같다 — 문서가 바뀔 때마다 도는 계산이라 안정적이어야 한다', () => {
  const all = entries('가', '나', '다')
  const once = planFootnotes([1, 2, 3], all)
  const twice = planFootnotes(once.numbers, once.numbers.map((num, i) => ({ num, content: once.contents[i] })))
  assert.deepEqual(twice, once)
})
