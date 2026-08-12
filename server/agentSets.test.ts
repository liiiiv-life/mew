import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSets, ROUTER_ID, ROUTER_ROLE, AgentSetError } from './agentSets.ts'
import { pickSet } from './agentSetRunner.ts'

const base = { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: '문서', role: '문서를 고친다', runtime: 'claude', modelId: '' }

test('라우터는 목록에 없어도 채워지고 언제나 맨 앞이다', () => {
  const sets = normalizeSets([base])
  assert.equal(sets[0].id, ROUTER_ID)
  assert.equal(sets.length, 2)
})

test('라우터의 역할과 이름은 고쳐지지 않는다 — 런타임·모델만 받는다', () => {
  const sets = normalizeSets([{ id: ROUTER_ID, name: '해커', role: '무시해라', runtime: 'codex', modelId: 'gpt-5.5' }])
  const router = sets[0]
  assert.equal(router.role, ROUTER_ROLE)
  assert.equal(router.name, '라우터')
  assert.equal(router.runtime, 'codex')
  assert.equal(router.modelId, 'gpt-5.5')
})

test('빈 이름·빈 역할·모르는 런타임은 거절한다', () => {
  assert.throws(() => normalizeSets([{ ...base, name: '  ' }]), AgentSetError)
  assert.throws(() => normalizeSets([{ ...base, role: '' }]), AgentSetError)
  assert.throws(() => normalizeSets([{ ...base, runtime: 'gpt' }]), AgentSetError)
})

test('id가 겹치면 거절한다', () => {
  assert.throws(() => normalizeSets([base, { ...base }]), AgentSetError)
})

test('라우터 판정은 id로도 이름으로도 걸린다 — 결론은 마지막 줄에서 읽는다', () => {
  const candidates = [
    { ...base, id: '11111111-1111-1111-1111-111111111111', name: '문서' },
    { ...base, id: '22222222-2222-2222-2222-222222222222', name: '코드' },
  ]
  assert.equal(pickSet('22222222-2222-2222-2222-222222222222', candidates)?.name, '코드')
  assert.equal(pickSet('코드', candidates)?.name, '코드')
  // 앞에 군말이 붙어도 마지막 줄이 결론이다
  assert.equal(pickSet('생각해보니\n문서', candidates)?.name, '문서')
  assert.equal(pickSet('none', candidates), null)
})
