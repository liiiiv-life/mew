import test from 'node:test'
import assert from 'node:assert/strict'
import { collectTaskTags, extractTaskTags, tagToken, validTags } from '../../shared/task-tags.ts'
import { applyTaskChanges, mergeVisibleTasks, taskChanges, TaskConflict } from '../../shared/task-list.ts'

const a = { id: 'a', text: 'task', done: false, tags: ['abc'] }
test('hashtags support Unicode, prefixes, duplicates and complete-token boundaries', () => {
  assert.deepEqual(tagToken('앞에서 #ab', 7), { start: 4, end: 7, tag: 'ab' })
  assert.equal(tagToken('url#abc', 7), null)
  assert.equal(tagToken('#abc', 2), null)
  assert.deepEqual(extractTaskTags('work #ABC #한글 #abc'), { text: 'work   ', tags: ['abc', '한글'] })
  assert.deepEqual(extractTaskTags('#abc', [], true), { text: '#abc', tags: [] }, 'typing alone does not confirm a tag')
  assert.deepEqual(extractTaskTags('#abc ', [], true), { text: ' ', tags: ['abc'] }, 'native mobile whitespace confirms a tag')
  assert.deepEqual(extractTaskTags('url#abc #bad! #ok'), { text: 'url#abc #bad! ', tags: ['ok'] })
  assert.equal(validTags(['ABC']), false)
  assert.equal(validTags(['abc', 'abc']), false)
  assert.deepEqual(collectTaskTags([a, { ...a, id: 'b', tags: ['abcde', 'abdet', 'abdvf', 'bsas'] }]).filter(tag => tag.startsWith('ab')), ['abc', 'abcde', 'abdet', 'abdvf'])
})
test('tags merge with unrelated content and dates, conflict atomically and retry idempotently', () => {
  const tagged = { ...a, tags: ['abc', 'abcde'] }
  const concurrent = { ...a, text: 'remote', date: '2026-10-06' }
  assert.deepEqual(applyTaskChanges([concurrent], taskChanges([a], [tagged])), [{ ...concurrent, tags: tagged.tags }])
  assert.throws(() => applyTaskChanges([{ ...a, tags: ['different'] }], taskChanges([a], [tagged])), TaskConflict)
  assert.deepEqual(applyTaskChanges([tagged], taskChanges([a], [tagged])), [tagged])
  assert.deepEqual(applyTaskChanges([tagged], taskChanges([], [tagged])), [tagged])
})

test('editing, deleting, adding and reordering a filtered view preserve hidden rows', () => {
  const b = { ...a, id: 'b', tags: ['other'] }, c = { ...a, id: 'c' }, d = { ...a, id: 'd' }
  assert.deepEqual(mergeVisibleTasks([a, b, c], [a, c], [c, { ...a, text: 'updated' }, d]), [c, b, { ...a, text: 'updated' }, d])
  assert.deepEqual(mergeVisibleTasks([a, b, c], [a, c], [c]), [c, b])
})
