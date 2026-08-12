import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAssignment } from './agentSetMention.ts'

const sets = [
  { id: 'router', name: '라우터' },
  { id: 'a', name: '문서' },
  { id: 'b', name: '문서 정리' },
]

test('@가 없으면 라우터가 정한다(setId 없음)', () => {
  assert.deepEqual(parseAssignment('  릴리즈 노트 써줘 ', sets), { setId: null, text: '릴리즈 노트 써줘' })
})

test('공백이 든 이름도 통째로 걸린다 — 긴 이름이 이긴다', () => {
  assert.deepEqual(parseAssignment('@문서 정리 오늘 자 회의록', sets), { setId: 'b', text: '오늘 자 회의록' })
  assert.deepEqual(parseAssignment('@문서 오늘 자 회의록', sets), { setId: 'a', text: '오늘 자 회의록' })
})

test('라우터는 지목 대상이 아니다 — 그냥 글자로 남는다', () => {
  assert.deepEqual(parseAssignment('@라우터 판단해', sets), { setId: null, text: '@라우터 판단해' })
})

test('없는 이름을 대면 지목으로 치지 않는다', () => {
  assert.deepEqual(parseAssignment('@없는셋 일해', sets), { setId: null, text: '@없는셋 일해' })
})
