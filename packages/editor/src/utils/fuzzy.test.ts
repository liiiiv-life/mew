import assert from 'node:assert/strict'
import test from 'node:test'
import { prefixMatch, resolveRelativePath, isExternalHref } from './fuzzy.ts'

test('prefixMatch — 대소문자를 무시하고 문자열 시작만 자동완성 후보로 삼는다', () => {
  assert.equal(prefixMatch('m', 'med-app'), true)
  assert.equal(prefixMatch('MED', 'med-app'), true)
  assert.equal(prefixMatch('m', 'alaaaarm'), false)
  assert.equal(prefixMatch('abc', 'gantt-abc-maker'), false)
})


test('local links retain absolute roots, escapes, encoded names and file URLs', () => {
  assert.equal(resolveRelativePath('docs/guide.md', '../../other/read me.md#part'), '../other/read me.md')
  assert.equal(resolveRelativePath('docs/guide.md', '/etc/hosts'), '/etc/hosts')
  assert.equal(resolveRelativePath('docs/guide.md', '../read%20me.md?view=1#part'), 'read me.md')
  assert.equal(resolveRelativePath('/projects/other/guide.md', '../third/start.md'), '/projects/third/start.md')
  assert.equal(resolveRelativePath('/guide.md', '../../etc/hosts'), '/etc/hosts')
  assert.equal(resolveRelativePath('guide.md', 'file:///etc/hosts'), '/etc/hosts')
  assert.equal(resolveRelativePath('guide.md', 'file://localhost/tmp/read%20me.md'), '/tmp/read me.md')
  assert.equal(isExternalHref('file:///etc/hosts'), false)
  assert.equal(isExternalHref('file://remote/etc/hosts'), true)
  assert.equal(isExternalHref('https://example.com'), true)
})
