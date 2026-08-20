import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { clearAgentInputDraft, readAgentInputDraft, writeAgentInputDraft } from './agentInputDrafts.ts'

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

const DRAFTS_KEY = 'mew:agent-input-drafts'
let mem: MemoryStorage

beforeEach(() => {
  mem = new MemoryStorage()
  ;(globalThis as { localStorage?: unknown }).localStorage = mem
})

test('에이전트 탭별로 입력 초안을 저장하고 읽는다', () => {
  writeAgentInputDraft('tab-a', '첫 탭 질문')
  writeAgentInputDraft('tab-b', '둘째 탭 질문')

  assert.equal(readAgentInputDraft('tab-a'), '첫 탭 질문')
  assert.equal(readAgentInputDraft('tab-b'), '둘째 탭 질문')
  assert.equal(readAgentInputDraft('missing'), '')
})

test('빈 문자열을 쓰면 초안이 지워지고 마지막 초안이면 저장 키도 제거된다', () => {
  writeAgentInputDraft('tab-a', 'draft')
  assert.ok(mem.has(DRAFTS_KEY))

  writeAgentInputDraft('tab-a', '')

  assert.equal(readAgentInputDraft('tab-a'), '')
  assert.equal(mem.has(DRAFTS_KEY), false)
})

test('clearAgentInputDraft는 해당 탭만 지운다', () => {
  writeAgentInputDraft('tab-a', 'aaa')
  writeAgentInputDraft('tab-b', 'bbb')

  clearAgentInputDraft('tab-a')

  assert.equal(readAgentInputDraft('tab-a'), '')
  assert.equal(readAgentInputDraft('tab-b'), 'bbb')
})

test('저장값이 손상되면 빈 문자열로 폴백한다', () => {
  mem.setItem(DRAFTS_KEY, '{broken')

  assert.equal(readAgentInputDraft('tab-a'), '')
})
