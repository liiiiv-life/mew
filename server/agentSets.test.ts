import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSets, AgentSetError } from './agentSets.ts'

const base = { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: '문서', role: '문서를 고친다', runtime: 'codex', modelId: '' }

test('라우터 없는 프리셋 목록을 그대로 쓴다', () => {
  const sets = normalizeSets([base])
  assert.deepEqual(sets, [base])
})

test('이전 저장값의 라우터는 읽을 때 버린다', () => {
  const sets = normalizeSets([{ id: 'router', name: '라우터', role: '옛 역할', runtime: 'codex', modelId: 'gpt-5.5' }, base])
  assert.deepEqual(sets, [base])
})

test('빈 이름·빈 역할·모르는 런타임은 거절한다', () => {
  assert.throws(() => normalizeSets([{ ...base, name: '  ' }]), AgentSetError)
  assert.throws(() => normalizeSets([{ ...base, role: '' }]), AgentSetError)
  assert.throws(() => normalizeSets([{ ...base, runtime: 'gpt' }]), AgentSetError)
  assert.throws(() => normalizeSets([{ ...base, runtime: 'claude' }]), AgentSetError)
  assert.throws(() => normalizeSets([{ ...base, runtime: 'antigravity' }]), AgentSetError)
})

test('id 또는 이름이 겹치면 거절한다', () => {
  assert.throws(() => normalizeSets([base, { ...base }]), AgentSetError)
  assert.throws(() => normalizeSets([base, { ...base, id: '11111111-1111-1111-1111-111111111111' }]), AgentSetError)
})
