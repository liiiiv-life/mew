import test from 'node:test'
import assert from 'node:assert/strict'
import { parse } from 'yaml'
import { mergeTaskFrontmatter, TaskFrontmatterConflict } from './task-frontmatter-merge.ts'
const document = (tags: string, assignees = '[alice@example.test]', body = 'Body') => `---\ntitle: Task\ndone: false\ntags: ${tags}\nassignees: ${assignees}\ncustom: retained # comment\n---\n${body}`
const fields = (content: string) => parse(content.split('---')[1])

test('body-only saves retain tags added, changed or removed in another panel', () => {
  for (const [before, after] of [['[]', '[기능]'], ['[old]', '[new]'], ['[old]', '[]']]) {
    const base = document(before), current = document(after)
    const merged = mergeTaskFrontmatter(base, document(before, undefined, 'Edited body'), current)
    assert.deepEqual(fields(merged).tags, fields(current).tags)
    assert.ok(merged.endsWith('Edited body'))
    assert.ok(merged.includes('custom: retained # comment'))
  }
})
test('explicit removal, unrelated collection changes and conflicting edits remain distinct', () => {
  const base = document('[old]')
  const merged = mergeTaskFrontmatter(base, document('[]'), document('[old]', '[bob@example.test]'))
  assert.deepEqual(fields(merged).tags, [])
  assert.deepEqual(fields(merged).assignees, ['bob@example.test'])
  assert.throws(() => mergeTaskFrontmatter(base, document('[local]'), document('[remote]')), TaskFrontmatterConflict)
  assert.equal(mergeTaskFrontmatter(base, document('[same]'), document('[same]')), document('[same]'))
})
test('server response rebases pending body edits and collection representations compare semantically', () => {
  const base = document('[]'), submitted = document('[]', undefined, 'First body')
  const saved = mergeTaskFrontmatter(base, submitted, document('[remote]'))
  const pending = mergeTaskFrontmatter(submitted, document('[]', undefined, 'Pending body'), saved, false)
  assert.deepEqual(fields(pending).tags, ['remote'])
  assert.ok(pending.endsWith('Pending body'))
  const quoted = document('"[old]"', undefined, 'Edited')
  assert.deepEqual(fields(mergeTaskFrontmatter(document('[old]'), quoted, document('[new]'))).tags, ['new'])
})
