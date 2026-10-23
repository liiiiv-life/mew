import assert from 'node:assert/strict'
import test from 'node:test'
import { isTextareaVisualBoundary } from './textareaVisualLine.ts'

test('위 방향은 커서가 첫 시각적 줄에 있을 때만 경계다', () => {
  assert.equal(isTextareaVisualBoundary('up', { first: 8, caret: 8, last: 56 }), true)
  assert.equal(isTextareaVisualBoundary('up', { first: 8, caret: 32, last: 56 }), false)
})

test('아래 방향은 커서가 마지막 시각적 줄에 있을 때만 경계다', () => {
  assert.equal(isTextareaVisualBoundary('down', { first: 8, caret: 32, last: 56 }), false)
  assert.equal(isTextareaVisualBoundary('down', { first: 8, caret: 56, last: 56 }), true)
})

test('레이아웃의 소수점 반올림 차이는 같은 줄로 본다', () => {
  assert.equal(isTextareaVisualBoundary('up', { first: 8.25, caret: 8.75, last: 32 }), true)
})
