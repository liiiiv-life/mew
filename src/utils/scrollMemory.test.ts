import test from 'node:test'
import assert from 'node:assert/strict'

// node에는 localStorage가 없다 — import 전에 스텁을 꽂는다 (모듈이 함수 안에서만 읽으므로 동적 import)
const store = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
}
const { saveScroll, getScroll, flushScroll } = await import('./scrollMemory.ts')

test('flush 뒤 localStorage에 남고, getScroll은 몇 번이고 준다 — 탭 전환마다 복원 (ADR 0039)', () => {
  saveScroll('proj', 'a.md', 123.7)
  flushScroll()
  assert.deepEqual(JSON.parse(store.get('mew:scroll:proj')!), { 'a.md': 124 })
  assert.equal(getScroll('proj', 'a.md'), 124)
  assert.equal(getScroll('proj', 'a.md'), 124)
})

test('flush 전에도 대기 중인 최신값을 준다', () => {
  saveScroll('proj', 'b.md', 50)
  assert.equal(getScroll('proj', 'b.md'), 50)
})

test('저장값 없거나 0이면 null — 괜히 맨 위로 스크롤하지 않는다', () => {
  assert.equal(getScroll('proj', 'none.md'), null)
  saveScroll('proj', 'c.md', 0)
  flushScroll()
  assert.equal(getScroll('proj', 'c.md'), null)
})
