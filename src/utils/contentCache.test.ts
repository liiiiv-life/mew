// 본문 캐시의 디스크 층 — 새로고침 뒤 즉시 그리기 위한 것이라, 무엇이 어떤 키로 남는지가 계약이다.
import test from 'node:test'
import assert from 'node:assert/strict'

// Node에는 localStorage가 없다 — 브라우저와 같은 동기 API만 흉내 낸다
const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  get length() {
    return store.size
  },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
}

const { clearPersistedContent, dropCachedFile, getCachedFile, putCachedFile, setContentIdentity, setContentWorkspace } = await import('./contentCache.ts')

const contentKeys = (prefix = 'mew:content:') => [...store.keys()].filter((k) => k.startsWith(prefix) && !k.endsWith('@order'))

test('본문은 디스크에도 남는다 — 새로고침 뒤 읽을 수 있게', () => {
  setContentIdentity('me@example.com')
  putCachedFile('docs', 'MOC.md', { content: '# 지도', editable: true })
  const raw = store.get('mew:content:me@example.com:docs MOC.md')
  assert.ok(raw, '신원+프로젝트+경로가 키에 들어간다')
  assert.deepEqual(JSON.parse(raw), { content: '# 지도', editable: true })
  assert.deepEqual(getCachedFile('docs', 'MOC.md'), { content: '# 지도', editable: true })
})

test('신원이 바뀌면 다른 사람 칸은 디스크에서 지운다', () => {
  setContentIdentity('me@example.com')
  putCachedFile('docs', 'secret.md', { content: '비밀', editable: true })
  setContentIdentity(null) // 로그아웃 = 게스트
  assert.equal(getCachedFile('docs', 'secret.md'), undefined, '게스트는 남의 본문을 못 읽는다')
  assert.deepEqual(contentKeys(), [], '디스크에도 남지 않는다')
})

test('디스크에 남는 문서 수에 상한이 있다', () => {
  clearPersistedContent()
  setContentIdentity('cap@example.com')
  for (let i = 0; i < 45; i++) putCachedFile('docs', `d${i}.md`, { content: `본문 ${i}`, editable: true })
  assert.equal(contentKeys().length, 40, '넘치면 오래된 것부터 버린다')
  assert.equal(store.has('mew:content:cap@example.com:docs d0.md'), false, '제일 오래된 것이 먼저 나간다')
  assert.equal(store.has('mew:content:cap@example.com:docs d44.md'), true, '마지막 것은 남는다')
})

test('아주 큰 본문은 디스크에 두지 않는다 — 쿼터를 혼자 먹는다', () => {
  clearPersistedContent()
  setContentIdentity('big@example.com')
  putCachedFile('docs', 'huge.md', { content: 'x'.repeat(600 * 1024), editable: true })
  assert.deepEqual(contentKeys(), [], '디스크에는 없고')
  assert.ok(getCachedFile('docs', 'huge.md'), '메모리 층에는 그대로 있다')
})

test('작던 파일이 캐시 상한을 넘으면 예전 본문을 디스크에 남기지 않는다', () => {
  clearPersistedContent()
  setContentIdentity('grown@example.com')
  putCachedFile('docs', 'grown.md', { content: 'old', editable: true })
  putCachedFile('docs', 'grown.md', { content: 'new'.repeat(100_000), editable: true })
  assert.deepEqual(contentKeys(), [])
  assert.equal(getCachedFile('docs', 'grown.md')?.content, 'new'.repeat(100_000))
})

test('탭에서 지운 파일은 디스크에서도 지운다', () => {
  clearPersistedContent()
  setContentIdentity('drop@example.com')
  putCachedFile('docs', 'gone.md', { content: '있다', editable: true })
  dropCachedFile('docs', 'gone.md')
  assert.equal(getCachedFile('docs', 'gone.md'), undefined)
  assert.deepEqual(contentKeys(), [])
})

test('루트 프로젝트마다 같은 API 경로의 본문 캐시를 분리한다', () => {
  clearPersistedContent()
  setContentIdentity('roots@example.com')
  setContentWorkspace('/projects/first')
  putCachedFile('.workspace', 'README.md', { content: 'first', editable: true })
  setContentWorkspace('/projects/second')
  putCachedFile('.workspace', 'README.md', { content: 'second', editable: true })
  assert.deepEqual(getCachedFile('.workspace', 'README.md'), { content: 'second', editable: true })
  setContentWorkspace('/projects/first')
  assert.deepEqual(getCachedFile('.workspace', 'README.md'), { content: 'first', editable: true })
  setContentWorkspace(null)
})
