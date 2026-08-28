import test from 'node:test'
import assert from 'node:assert/strict'
import { agentTabStorageKey } from './agentTabStorage.ts'

test('에이전트 탭 저장 키는 루트 프로젝트별로 분리된다', () => {
  const base = 'mew:agent-tabs'
  assert.equal(agentTabStorageKey(base, '/work/liiiiv'), 'mew:agent-tabs:"/work/liiiiv"')
  assert.notEqual(agentTabStorageKey(base, '/work/liiiiv'), agentTabStorageKey(base, '/work/ardt'))
  assert.equal(agentTabStorageKey(base, null), base, '루트 경로를 아직 모를 때만 레거시 키를 쓴다')
})
