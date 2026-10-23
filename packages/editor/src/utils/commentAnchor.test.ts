// 댓글 앵커 해석 — 본문이 바뀌어도 문맥으로 자리를 되찾는지 검증한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeCommentAnchor, resolveCommentAnchor } from './commentAnchor.ts'

test('만든 자리 그대로 되찾는다', () => {
  const doc = '첫 줄\n둘째 줄의 핵심 문장\n셋째 줄'
  const from = doc.indexOf('핵심 문장')
  const anchor = makeCommentAnchor(doc, from, from + 5)
  assert.deepEqual(resolveCommentAnchor(doc, anchor), { from, to: from + 5 })
})

test('같은 텍스트가 여러 번 나오면 prefix로 가른다', () => {
  const doc = '사과는 좋다\n바나나도 좋다\n포도도 좋다'
  const from = doc.indexOf('좋다', doc.indexOf('바나나'))
  const anchor = makeCommentAnchor(doc, from, from + 2)
  assert.deepEqual(resolveCommentAnchor(doc, anchor), { from, to: from + 2 })
})

test('앞에 줄이 끼어들어도 따라간다', () => {
  const doc = '머리\n대상 문장 여기\n꼬리'
  const from = doc.indexOf('대상 문장')
  const anchor = makeCommentAnchor(doc, from, from + 5)
  const edited = '새 줄 추가\n또 추가\n' + doc
  const resolved = resolveCommentAnchor(edited, anchor)
  assert.ok(resolved)
  assert.equal(edited.slice(resolved.from, resolved.to), '대상 문장')
})

test('텍스트가 사라지면 null — 고아 댓글', () => {
  const anchor = makeCommentAnchor('이 문장은 지워질 것', 0, 4)
  assert.equal(resolveCommentAnchor('전혀 다른 내용', anchor), null)
})

test('빈 선택에는 앵커를 만들지 않는다 — 댓글은 고른 글자에만 붙는다 (ADR 0051)', () => {
  const doc = '앞 문맥이 있는 줄\n다음 줄'
  const at = doc.indexOf('있는')
  assert.equal(makeCommentAnchor(doc, at, at), null)
  // 띄어쓰기 한 자라도 고르면 앵커가 나온다
  const space = doc.indexOf(' ')
  assert.deepEqual(makeCommentAnchor(doc, space, space + 1)?.text, ' ')
})

test('옛 원장에 남은 커서 댓글(text가 빈 값)은 고아로 둔다', () => {
  // 예전에는 작은 네모로 세웠다 — 없앤 뒤로는 자리를 주지 않고 목록 팝업에만 남긴다
  assert.equal(resolveCommentAnchor('아무 본문', { text: '', prefix: '아무', line: 1 }), null)
})
