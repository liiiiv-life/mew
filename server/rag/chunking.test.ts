import assert from 'node:assert/strict'
import test from 'node:test'
import { chunkText, passageText } from './chunking.ts'

test('frontmatter를 제외하고 heading·줄 범위를 보존한다', () => {
  const content = `---\ntitle: "결정 지도"\ncreated: 2026-08-21\nupdated: 2026-08-21\n---\n\n# 개요\n현재 결정이다.\n\n## 근거\n이유가 여기에 있다.`
  const chunks = chunkText('decisions/test.md', content, 'current', 80)
  assert.equal(chunks.length, 2)
  assert.equal(chunks[0].title, '결정 지도')
  assert.equal(chunks[0].heading, '개요')
  assert.equal(chunks[0].lineStart, 7)
  assert.equal(chunks[1].heading, '근거')
  assert.match(passageText(chunks[1]), /^passage: 결정 지도 · 근거/)
})

test('긴 한 줄도 모델 입력 예산으로 분할한다', () => {
  const chunks = chunkText('large.txt', '가'.repeat(45), 'current', 20)
  assert.equal(chunks.length, 3)
  assert.deepEqual(chunks.map((chunk) => chunk.content.length), [20, 20, 5])
})

test('current MOC 안의 History/raw 절 청크는 history로 내린다', () => {
  const chunks = chunkText('MOC.md', '## Current\n현재 문서\n\n## History / raw\n이전 문서', 'current', 80)
  assert.deepEqual(chunks.map((chunk) => chunk.tier), ['current', 'history'])
})
