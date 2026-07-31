// 세션별 입력 초안 저장소 — localStorage를 인메모리 스텁으로 대체해 읽기·쓰기·정리·이름변경을 검증한다.
// (모듈은 함수 안에서만 localStorage를 참조하므로 스텁을 붙인 뒤 호출하면 브라우저 없이도 돈다.)
import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { clearInputDraft, readInputDraft, renameInputDraft, writeInputDraft } from './inputDrafts.ts'

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(k: string): string | null {
    return this.store.has(k) ? this.store.get(k)! : null
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v)
  }
  removeItem(k: string): void {
    this.store.delete(k)
  }
  has(k: string): boolean {
    return this.store.has(k)
  }
}

const DRAFTS_KEY = 'mew:tmux-input-drafts'
let mem: MemoryStorage

beforeEach(() => {
  mem = new MemoryStorage()
  ;(globalThis as { localStorage?: unknown }).localStorage = mem
})

test('세션별로 초안을 저장하고 읽는다', () => {
  writeInputDraft('session-1', 'git status')
  writeInputDraft('session-2', 'npm test')
  assert.equal(readInputDraft('session-1'), 'git status')
  assert.equal(readInputDraft('session-2'), 'npm test')
  assert.equal(readInputDraft('session-3'), '')
})

test('빈 문자열을 쓰면 초안이 지워지고, 마지막 초안이 사라지면 저장 키 자체가 제거된다', () => {
  writeInputDraft('only', 'hello')
  assert.ok(mem.has(DRAFTS_KEY))
  writeInputDraft('only', '')
  assert.equal(readInputDraft('only'), '')
  assert.equal(mem.has(DRAFTS_KEY), false)
})

test('clearInputDraft는 해당 세션만 지운다', () => {
  writeInputDraft('a', 'aaa')
  writeInputDraft('b', 'bbb')
  clearInputDraft('a')
  assert.equal(readInputDraft('a'), '')
  assert.equal(readInputDraft('b'), 'bbb')
})

test('renameInputDraft는 초안을 새 이름으로 옮기고 옛 이름은 지운다', () => {
  writeInputDraft('old', 'draft body')
  renameInputDraft('old', 'new')
  assert.equal(readInputDraft('old'), '')
  assert.equal(readInputDraft('new'), 'draft body')
})

test('renameInputDraft는 옛 이름에 초안이 없으면 아무것도 하지 않는다', () => {
  writeInputDraft('new', 'keep me')
  renameInputDraft('missing', 'new')
  assert.equal(readInputDraft('new'), 'keep me')
})

test('저장값이 손상되면 빈 문자열로 안전하게 폴백한다', () => {
  mem.setItem(DRAFTS_KEY, '{not valid json')
  assert.equal(readInputDraft('whatever'), '')
})
