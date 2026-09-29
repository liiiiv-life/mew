import test from 'node:test'
import assert from 'node:assert/strict'

const store = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
}
const { loadSidebarState, saveSidebarState, sidebarStateKey } = await import('./sidebarState.ts')

test('Documents와 하위 프로젝트 펼침 상태는 루트 프로젝트별로 남는다', () => {
  saveSidebarState('/work/one', { docsExpanded: true, expandedSubprojects: ['app', 'tools'] })
  saveSidebarState('/work/two', { docsExpanded: false, expandedSubprojects: ['docs-site'] })

  assert.deepEqual(loadSidebarState('/work/one'), { docsExpanded: true, expandedSubprojects: ['app', 'tools'] })
  assert.deepEqual(loadSidebarState('/work/two'), { docsExpanded: false, expandedSubprojects: ['docs-site'] })
  assert.equal(sidebarStateKey('/work/one'), 'mew:sidebar-state:/work/one')
})

test('없거나 손상된 상태는 모두 접힌 안전한 기본값이다', () => {
  assert.deepEqual(loadSidebarState(null), { docsExpanded: false, expandedSubprojects: [] })
  store.set(sidebarStateKey('/broken'), '{')
  assert.deepEqual(loadSidebarState('/broken'), { docsExpanded: false, expandedSubprojects: [] })
})

test('저장소가 가득 차도 사이드바 탐색을 중단하지 않는다', (t) => {
  t.mock.method(localStorage, 'setItem', () => { throw new DOMException('Storage is full', 'QuotaExceededError') })
  assert.doesNotThrow(() => saveSidebarState('/work/full', { docsExpanded: true, expandedSubprojects: ['app'] }))
})


test('탐색 범위는 이전 펼침 값보다 우선하며 이전 저장값은 계속 복원한다', () => {
  saveSidebarState('/scope', { explorerScope: 'docs', docsExpanded: false, expandedSubprojects: [] })
  assert.equal(loadSidebarState('/scope').docsExpanded, true)
  saveSidebarState('/scope', { explorerScope: 'files', docsExpanded: true, expandedSubprojects: [] })
  assert.equal(loadSidebarState('/scope').docsExpanded, false)
})
