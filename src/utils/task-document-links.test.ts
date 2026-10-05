import test from 'node:test'
import assert from 'node:assert/strict'
import { taskDocumentLink, taskDocumentLinks } from './task-document-links.ts'

test('task links preserve root-relative paths and escaped labels through text storage', () => {
  for (const path of ['docs/Reference.md', '하위/문서 (초안).md', 'docs/[draft] #100%?.md', 'notes/a\\b.md']) {
    const text = `검토 ${taskDocumentLink(path)}완료`
    assert.deepEqual(taskDocumentLinks(text), [{ label: path.split('/').pop()!.replace(/\.[^.]+$/, ''), path }])
  }
  assert.deepEqual(taskDocumentLinks(taskDocumentLink('a/Reference.md') + taskDocumentLink('b/Reference.md')).map(link => link.path), ['a/Reference.md', 'b/Reference.md'])
})

test('task link buttons ignore external, absolute and malformed URLs', () => {
  assert.deepEqual(taskDocumentLinks('[site](https://example.com) [host](//host) [root](/etc/passwd) [anchor](#tag) [bad](%ZZ) [encoded](https%3A%2F%2Fexample.com)'), [])
})
