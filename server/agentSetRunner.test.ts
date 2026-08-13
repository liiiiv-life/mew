// 라우터 판정 읽기 — 여기가 틀리면 프롬프트가 엉뚱한 셋으로 가거나(더 나쁘다) 아무 데도 안 간다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { pickSet } from './agentSetRunner.ts'
import type { AgentSet } from './agentSets.ts'

const set = (id: string, name: string): AgentSet => ({ id, name, role: '역할', runtime: 'claude', modelId: '' })

const candidates = [set('11111111-1111-1111-1111-111111111111', '코드'), set('22222222-2222-2222-2222-222222222222', '코드리뷰')]

test('시킨 대로 id만 답하면 그 셋이다', () => {
  assert.equal(pickSet('11111111-1111-1111-1111-111111111111', candidates), candidates[0])
})

test('글머리표·따옴표·마침표가 붙어도 같은 줄로 본다', () => {
  assert.equal(pickSet('- `22222222-2222-2222-2222-222222222222`.', candidates), candidates[1])
})

test('이름이 서로의 부분이어도 통째로 맞는 쪽을 고른다', () => {
  assert.equal(pickSet('코드리뷰', candidates), candidates[1])
})

test('군말이 앞에 붙으면 결론 줄(마지막)을 읽는다', () => {
  const answer = ['후보를 살펴보면 코드 쪽도 가능하지만', '코드리뷰'].join('\n')
  assert.equal(pickSet(answer, candidates), candidates[1])
})

test('none이라고 못 박으면 부분 매칭으로 아무나 집지 않는다', () => {
  assert.equal(pickSet('none', candidates), null)
  assert.equal(pickSet('마땅한 후보가 없다.\nnone', candidates), null)
})

test('아무것도 못 고르면 null이다', () => {
  assert.equal(pickSet('', candidates), null)
  assert.equal(pickSet('잘 모르겠습니다', candidates), null)
})
