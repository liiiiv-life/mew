import test from 'node:test'
import assert from 'node:assert/strict'
import { sessionIdOf, withAutoLabel, withRename, withSessionId } from './agentTabs.ts'

test('사람이 붙인 이름은 대화에서 뽑은 이름이 덮지 않는다', () => {
  const tabs = [{ id: 'a', label: '새 대화' }]

  const auto = withAutoLabel(tabs, 'a', '첫 질문 한 줄')
  assert.deepEqual(auto, [{ id: 'a', label: '첫 질문 한 줄' }], '이름이 없던 탭은 대화에서 뽑아 붙인다')

  const named = withRename(auto, 'a', '  배포 작업  ')
  assert.deepEqual(named, [{ id: 'a', label: '배포 작업', renamed: true }], '앞뒤 공백은 떼고 붙인다')

  assert.equal(withAutoLabel(named, 'a', '다음 질문'), named, '그 뒤 대화에서 뽑은 이름은 무시한다')
  assert.equal(withRename(named, 'a', '   '), named, '빈 이름은 취소 — 붙어 있던 이름을 지우지 않는다')
  assert.equal(withAutoLabel(tabs, 'none', '아무거나'), tabs, '없는 탭이면 그대로 둔다')
})

test('선택한 런타임 이름은 빈 대화 이벤트로 바뀌지 않는다', () => {
  const tabs = [{ id: 'a', label: 'Codex', renamed: true }]
  assert.equal(withAutoLabel(tabs, 'a', ''), tabs)
  assert.equal(withAutoLabel(tabs, 'a', '첫 질문'), tabs)
})

test('탭은 런타임·cwd별 마지막 ACP 세션을 기억한다', () => {
  const tabs = [{ id: 'a', label: '배포 작업' }]
  const claude = withSessionId(tabs, 'a', 'claude', '/work', 'claude-session')
  const codex = withSessionId(claude, 'a', 'codex', '/work', 'codex-session')

  assert.equal(sessionIdOf(codex[0], 'claude', '/work'), 'claude-session')
  assert.equal(sessionIdOf(codex[0], 'codex', '/work'), 'codex-session')
  assert.equal(sessionIdOf(codex[0], 'claude', '/other'), null)

  const cleared = withSessionId(codex, 'a', 'claude', '/work', null)
  assert.equal(sessionIdOf(cleared[0], 'claude', '/work'), null)
  assert.equal(sessionIdOf(cleared[0], 'codex', '/work'), 'codex-session')
})
