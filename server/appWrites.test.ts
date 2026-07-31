// appWrites 원장 — 앱 자신의 디스크 쓰기를 "메아리"로 한 번 소비하고, 외부 변경은 통과시킨다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { noteAppWrite, consumeAppWrite } from './appWrites.ts'

test('앱이 쓴 내용은 정확히 한 번만 메아리로 소비된다', () => {
  const p = '/tmp/mew-appwrites-a.md'
  noteAppWrite(p, 'hello')
  assert.equal(consumeAppWrite(p, 'hello'), true, '기록한 내용은 메아리로 인식')
  assert.equal(consumeAppWrite(p, 'hello'), false, '한 번 소비하면 다시는 메아리 아님(외부 변경 취급)')
})

test('기록하지 않은(외부) 내용은 메아리가 아니다', () => {
  const p = '/tmp/mew-appwrites-b.md'
  noteAppWrite(p, 'app-wrote-this')
  assert.equal(consumeAppWrite(p, 'ai-wrote-something-else'), false)
})

test('경로별로 독립적이다', () => {
  noteAppWrite('/tmp/mew-appwrites-c1.md', 'x')
  assert.equal(consumeAppWrite('/tmp/mew-appwrites-c2.md', 'x'), false, '다른 경로의 기록은 소비되지 않음')
  assert.equal(consumeAppWrite('/tmp/mew-appwrites-c1.md', 'x'), true)
})

test('빠른 연속 쓰기는 여러 개를 보관해 어느 쪽 스냅샷을 읽어도 메아리로 잡는다', () => {
  const p = '/tmp/mew-appwrites-d.md'
  noteAppWrite(p, 'v1')
  noteAppWrite(p, 'v2')
  // 감시자가 v1을 읽든 v2를 읽든 둘 다 우리 쓰기 → 주입하면 안 됨
  assert.equal(consumeAppWrite(p, 'v1'), true)
  assert.equal(consumeAppWrite(p, 'v2'), true)
})
